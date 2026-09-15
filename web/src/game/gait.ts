/**
 * First-person gait presentation.
 *
 * PRESENTATION ONLY. This module reads authoritative player state and produces
 * small camera offsets. It never writes player position, velocity, support, or
 * orientation, and nothing it returns is fed back into collision, targeting, or
 * the simulation. Interaction rays are cast from the authoritative eye pose, so
 * a gait offset can never change what the player is able to touch.
 *
 * The motion is coupled, not layered noise: one stride phase drives vertical
 * displacement, lateral weight transfer and counter-roll together, while the
 * lean, turn-lag and landing responses are damped springs driven by measured
 * acceleration, yaw rate and landing severity.
 */

const TAU = Math.PI * 2;

/** Stride length in metres for each gait, used to convert distance to phase. */
const STRIDE_CROUCH = 0.62;
const STRIDE_WALK = 0.96;
const STRIDE_SPRINT = 1.38;

/** Reference walking speed; amplitude curves are expressed relative to it. */
const WALK_REF = 2.55;

export interface GaitSample {
  dt: number;
  /** Authoritative horizontal speed, m/s. */
  speed: number;
  /** Authoritative horizontal velocity, world axes. */
  vx: number;
  vz: number;
  /** Authoritative yaw, radians. */
  yaw: number;
  grounded: boolean;
  crouch: boolean;
  /** Downward speed at the instant of a landing this frame, else 0. */
  landingImpact: number;
  /** Magnitude of the movement stick/keys this frame, 0..1. */
  moveInput: number;
}

export interface GaitFrame {
  /** Camera-local offsets, metres. */
  offsetRight: number;
  offsetUp: number;
  offsetForward: number;
  /** Camera-local rotations, radians, added to the authoritative view. */
  roll: number;
  pitch: number;
  yaw: number;
  /** A foot planted this frame: 0 none, 1 left, 2 right. */
  step: 0 | 1 | 2;
  /** 0..1 severity of that footfall, for audio. */
  stepStrength: number;
  /** Continuous stride phase, radians. Exposed so audio can stay in step. */
  phase: number;
}

function clamp(v: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, v));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function wrapAngle(a: number): number {
  let r = a;
  while (r > Math.PI) r -= TAU;
  while (r < -Math.PI) r += TAU;
  return r;
}

/** Second-order damped spring toward a target. Returns the new [value, velocity]. */
function spring(
  value: number,
  velocity: number,
  target: number,
  omega: number,
  zeta: number,
  dt: number,
): [number, number] {
  // Semi-implicit so it stays stable at low frame rates.
  const step = Math.min(dt, 1 / 30);
  const accel = omega * omega * (target - value) - 2 * zeta * omega * velocity;
  const nv = velocity + accel * step;
  return [value + nv * step, nv];
}

export class Gait {
  /** Stride phase. One TAU is a full two-step cycle. */
  private phase = 0;
  private stepIndex = 0;
  private amplitude = 0;

  private prevVx = 0;
  private prevVz = 0;
  private prevYaw = 0;
  private haveHistory = false;

  private accelFwd = 0;
  private accelRight = 0;
  private yawRate = 0;

  private leanPitch = 0;
  private leanPitchV = 0;
  private leanRoll = 0;
  private leanRollV = 0;
  private lagYaw = 0;
  private lagYawV = 0;
  private turnRoll = 0;
  private turnRollV = 0;

  private compress = 0;
  private compressV = 0;

  private idleT = 0;

  /** Presentation scale. 0 disables every offset this module produces. */
  intensity = 1;

  reset(yaw: number): void {
    this.phase = 0;
    this.stepIndex = 0;
    this.amplitude = 0;
    this.prevVx = 0;
    this.prevVz = 0;
    this.prevYaw = yaw;
    this.haveHistory = false;
    this.accelFwd = 0;
    this.accelRight = 0;
    this.yawRate = 0;
    this.leanPitch = 0;
    this.leanPitchV = 0;
    this.leanRoll = 0;
    this.leanRollV = 0;
    this.lagYaw = 0;
    this.lagYawV = 0;
    this.turnRoll = 0;
    this.turnRollV = 0;
    this.compress = 0;
    this.compressV = 0;
    this.idleT = 0;
  }

  update(s: GaitSample): GaitFrame {
    const dt = clamp(s.dt, 1 / 240, 1 / 20);

    // ---- measured derivatives of authoritative state -----------------------
    if (!this.haveHistory) {
      this.prevVx = s.vx;
      this.prevVz = s.vz;
      this.prevYaw = s.yaw;
      this.haveHistory = true;
    }
    const ax = (s.vx - this.prevVx) / dt;
    const az = (s.vz - this.prevVz) / dt;
    this.prevVx = s.vx;
    this.prevVz = s.vz;

    // World -> camera-local. forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw).
    const sy = Math.sin(s.yaw);
    const cy = Math.cos(s.yaw);
    const aFwdRaw = -sy * ax - cy * az;
    const aRightRaw = cy * ax - sy * az;
    // Low-pass so a single collision frame does not snap the camera.
    const aBlend = 1 - Math.exp(-10 * dt);
    this.accelFwd += (aFwdRaw - this.accelFwd) * aBlend;
    this.accelRight += (aRightRaw - this.accelRight) * aBlend;

    const yawDelta = wrapAngle(s.yaw - this.prevYaw);
    this.prevYaw = s.yaw;
    const rawYawRate = yawDelta / dt;
    const yBlend = 1 - Math.exp(-14 * dt);
    this.yawRate += (rawYawRate - this.yawRate) * yBlend;

    // ---- stride phase ------------------------------------------------------
    const stride = s.crouch ? STRIDE_CROUCH : s.speed > WALK_REF * 1.25 ? STRIDE_SPRINT : STRIDE_WALK;
    const moving = s.grounded && s.speed > 0.35;
    if (moving) {
      this.phase += (s.speed / stride) * TAU * dt;
      if (this.phase > TAU * 1024) this.phase -= TAU * 1024;
    }

    // Amplitude follows speed on the ground and collapses in the air, so a jump
    // does not keep bobbing.
    const speedNorm = clamp(s.speed / WALK_REF, 0, 2);
    const groundTarget = s.grounded ? smoothstep(0.1, 0.6, s.speed) : 0;
    const ampBlend = 1 - Math.exp(-(s.grounded ? 9 : 16) * dt);
    this.amplitude += (groundTarget - this.amplitude) * ampBlend;

    const crouchScale = s.crouch ? 0.58 : 1;
    const vertA = (0.0055 + 0.0135 * Math.min(speedNorm, 1) + 0.0145 * Math.max(0, speedNorm - 1)) * crouchScale;
    const latA = (0.0075 + 0.0135 * Math.min(speedNorm, 1) + 0.0075 * Math.max(0, speedNorm - 1)) * crouchScale;
    const rollA = (0.0028 + 0.0048 * Math.min(speedNorm, 1) + 0.0042 * Math.max(0, speedNorm - 1)) * crouchScale;

    // Vertical dips twice per cycle; lateral and counter-roll once.
    const gaitUp = -vertA * this.amplitude * (1 - Math.cos(2 * this.phase)) * 0.5;
    const gaitRight = latA * this.amplitude * Math.sin(this.phase);
    const gaitRoll = -rollA * this.amplitude * Math.sin(this.phase);
    // Slight forward pull at the drive phase of each step.
    const gaitFwd = vertA * 0.35 * this.amplitude * Math.sin(2 * this.phase);

    // ---- footfall ----------------------------------------------------------
    // A foot plants at the bottom of each vertical dip: 2*phase = pi, 3pi, ...
    let step: 0 | 1 | 2 = 0;
    let stepStrength = 0;
    const idx = Math.floor((this.phase - Math.PI / 2) / Math.PI);
    if (moving && idx !== this.stepIndex) {
      // Only ever advance one plant per frame, and never fire from rewinds.
      if (idx > this.stepIndex) {
        step = idx % 2 === 0 ? 1 : 2;
        stepStrength = clamp(0.35 + 0.5 * speedNorm, 0, 1) * (s.crouch ? 0.45 : 1);
      }
      this.stepIndex = idx;
    } else if (!moving) {
      this.stepIndex = idx;
    }

    // ---- acceleration lean and deceleration recovery -----------------------
    // Under-damped on purpose: stopping produces a short settle, not a snap.
    const leanPitchTarget = clamp(-this.accelFwd * 0.0022, -0.028, 0.028);
    const leanRollTarget = clamp(-this.accelRight * 0.0016, -0.022, 0.022);
    [this.leanPitch, this.leanPitchV] = spring(this.leanPitch, this.leanPitchV, leanPitchTarget, 11, 0.72, dt);
    [this.leanRoll, this.leanRollV] = spring(this.leanRoll, this.leanRollV, leanRollTarget, 10, 0.68, dt);

    // ---- turn inertia: the head trails the view, then catches up ------------
    const lagTarget = clamp(-this.yawRate * 0.016, -0.03, 0.03);
    const turnRollTarget = clamp(-this.yawRate * 0.011, -0.024, 0.024);
    [this.lagYaw, this.lagYawV] = spring(this.lagYaw, this.lagYawV, lagTarget, 13, 0.85, dt);
    [this.turnRoll, this.turnRollV] = spring(this.turnRoll, this.turnRollV, turnRollTarget, 11, 0.8, dt);

    // ---- landing compression ----------------------------------------------
    if (s.landingImpact > 0.6) {
      // Impulse into the spring; severity is the real vertical speed at contact.
      this.compressV -= clamp(s.landingImpact, 0, 11) * 0.028;
    }
    [this.compress, this.compressV] = spring(this.compress, this.compressV, 0, 17, 0.52, dt);
    const compressUp = clamp(this.compress, -0.085, 0.02);
    const compressPitch = clamp(this.compress * 0.35, -0.03, 0.01);

    // ---- idle postural micro-motion ---------------------------------------
    if (s.grounded && s.speed < 0.3 && s.moveInput < 0.1) this.idleT += dt;
    else this.idleT = 0;
    const breath = smoothstep(0.45, 1.8, this.idleT);
    const breathUp = breath * 0.0052 * Math.sin(this.idleT * 1.32);
    const breathRight = breath * 0.0034 * Math.sin(this.idleT * 0.47 + 0.9);
    const breathPitch = breath * 0.0021 * Math.sin(this.idleT * 1.32 + 1.6);

    // ---- assemble ----------------------------------------------------------
    const k = clamp(this.intensity, 0, 1.5);
    return {
      offsetRight: clamp(gaitRight + breathRight, -0.055, 0.055) * k,
      offsetUp: clamp(gaitUp + compressUp + breathUp, -0.1, 0.045) * k,
      offsetForward: clamp(gaitFwd, -0.02, 0.02) * k,
      roll: clamp(gaitRoll + this.leanRoll + this.turnRoll, -0.05, 0.05) * k,
      pitch: clamp(this.leanPitch + compressPitch + breathPitch, -0.055, 0.045) * k,
      yaw: clamp(this.lagYaw, -0.035, 0.035) * k,
      step,
      stepStrength,
      phase: this.phase,
    };
  }
}
