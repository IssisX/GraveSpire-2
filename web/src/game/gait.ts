import type { Settings } from "./settings.ts";

/** Presentation-only first-person embodiment. Never writes player world pose. */
export type Gait = {
  phase: number;
  time: number;
  vert: number;
  lat: number;
  fore: number;
  roll: number;
  yaw: number;
  pitch: number;
  land: number;
  breath: number;
  trauma: number;
  prevPhase: number;
  foot: boolean;
};

export function createGait(): Gait {
  return {
    phase: 0,
    time: 0,
    vert: 0,
    lat: 0,
    fore: 0,
    roll: 0,
    yaw: 0,
    pitch: 0,
    land: 0,
    breath: 0,
    trauma: 0,
    prevPhase: 0,
    foot: false,
  };
}

function damp(current: number, target: number, lambda: number, dt: number) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export function impulseGait(g: Gait, amount: number) {
  g.trauma = Math.min(1, g.trauma + amount);
}

export function stepGait(
  g: Gait,
  dt: number,
  sample: {
    speed: number;
    grounded: boolean;
    crouch: boolean;
    sprint: boolean;
    forwardAccel: number;
    lateralAccel?: number;
    lateralSpeed?: number;
    yawRate: number;
    landed: number;
    supportLean?: number;
    balance?: number;
    parkourMode?: "free" | "vault" | "hang" | "pullup" | "ladder";
  },
  settings: Settings,
) {
  g.time += dt;
  g.foot = false;
  const reduced = settings.reducedMotion;
  const shakeK = reduced ? 0 : settings.shake;
  const lateralAccel = sample.lateralAccel ?? 0;
  const lateralSpeed = sample.lateralSpeed ?? 0;
  const balance = Math.max(0, Math.min(1, sample.balance ?? 0));
  const supportLean = sample.supportLean ?? 0;
  const parkour = sample.parkourMode ?? "free";

  // Full gait-cycle distance, so cadence emerges from actual traveled speed.
  const stride = sample.sprint ? 2.35 : sample.crouch ? 1.18 : 1.62;
  g.prevPhase = g.phase;
  if (sample.grounded && sample.speed > 0.24 && parkour === "free") {
    g.phase += (sample.speed / stride) * Math.PI * 2 * dt;
    while (g.phase > Math.PI * 2) g.phase -= Math.PI * 2;
  }

  const crossed =
    (g.prevPhase < Math.PI && g.phase >= Math.PI) ||
    (g.prevPhase > g.phase && g.phase < 0.35);
  if (sample.grounded && sample.speed > 0.6 && crossed && parkour === "free") g.foot = true;

  const speedRef = sample.sprint ? 5.6 : sample.crouch ? 1.35 : 2.7;
  const speedK = Math.min(1.15, sample.speed / speedRef);
  const balanceQuiet = 1 - balance * 0.58;
  const stepAmp = (reduced ? 0 : sample.crouch ? 0.006 : sample.sprint ? 0.024 : 0.015) * balanceQuiet;
  const stepWidth = (reduced ? 0 : sample.crouch ? 0.010 : sample.sprint ? 0.018 : 0.014) * balanceQuiet;

  let wantV = sample.grounded && parkour === "free" ? -Math.cos(g.phase * 2) * stepAmp * speedK : 0;
  const accelFore = Math.max(-5.5, Math.min(5.5, sample.forwardAccel));
  const accelLat = Math.max(-6.0, Math.min(6.0, lateralAccel));
  let wantL = sample.grounded && parkour === "free"
    ? Math.sin(g.phase) * stepWidth * speedK - accelLat * (reduced ? 0.0004 : 0.0017)
    : 0;
  let wantFore = sample.grounded && parkour === "free"
    ? Math.sin(g.phase * 2 + Math.PI * 0.5) * stepAmp * 0.24 * speedK
    : 0;

  const turnLean = Math.max(-1.4, Math.min(1.4, sample.yawRate));
  const strafeLean = Math.max(-3.0, Math.min(3.0, lateralSpeed));
  let wantRoll = reduced
    ? 0
    : -Math.sin(g.phase) * 0.009 * speedK + turnLean * 0.028 - accelLat * 0.0030 - strafeLean * 0.004 + supportLean;
  let wantYaw = -sample.yawRate * (reduced ? 0.015 : 0.055);
  let wantPitch = -accelFore * (reduced ? 0.0025 : 0.0085);

  // Parkour camera movement comes from actual traversal state, not a canned
  // animation clip. These offsets only embody the body motion around world pose.
  if (!reduced && parkour !== "free") {
    const p = Math.sin(g.time * 13.0);
    if (parkour === "vault") {
      wantV = 0.025;
      wantFore = 0.035;
      wantPitch -= 0.055;
      wantRoll += p * 0.010;
    } else if (parkour === "pullup") {
      wantV = 0.018;
      wantFore = 0.018;
      wantPitch -= 0.035;
    } else if (parkour === "hang") {
      wantV = -0.020;
      wantFore = -0.012;
      wantRoll += p * 0.006;
      wantYaw *= 0.35;
    } else if (parkour === "ladder") {
      wantV = p * 0.008;
      wantFore = 0.010;
      wantRoll *= 0.28;
      wantYaw *= 0.22;
    }
  }

  if (sample.landed > 0 && !reduced) {
    g.land = Math.max(g.land, sample.landed);
    g.trauma = Math.min(1, g.trauma + sample.landed * 0.28 * shakeK);
  }

  g.vert = damp(g.vert, wantV, 15, dt) - (reduced ? 0 : g.land * 0.045);
  g.lat = damp(g.lat, wantL, 13, dt);
  g.fore = damp(g.fore, wantFore, 12, dt);
  g.roll = damp(g.roll, wantRoll, 11, dt);
  g.yaw = damp(g.yaw, wantYaw, 9, dt);
  g.pitch = damp(g.pitch, wantPitch + (reduced ? 0 : g.land * 0.022), 10, dt);
  g.land = damp(g.land, 0, 7.2, dt);

  const idle = sample.grounded && sample.speed < 0.22 && parkour === "free" ? 1 : 0;
  const wantBreath = reduced ? 0 : Math.sin(g.time * 1.25) * 0.0035 * idle;
  g.breath = damp(g.breath, wantBreath, 3.4, dt);

  g.trauma = Math.max(0, g.trauma - dt * 1.8);
}

export function gaitOffset(g: Gait, settings: Settings): {
  x: number;
  y: number;
  z: number;
  roll: number;
  yaw: number;
  pitch: number;
} {
  const shake = g.trauma * g.trauma * (settings.reducedMotion ? 0 : settings.shake);
  const t = g.time * 29;
  const sx = Math.sin(t * 1.13) * 0.010 * shake;
  const sy = Math.cos(t * 1.31) * 0.009 * shake;
  const sz = Math.sin(t * 0.83) * 0.006 * shake;
  const sr = Math.sin(t * 0.9) * 0.007 * shake;
  return {
    x: g.lat + sx,
    y: g.vert + g.breath + sy,
    z: g.fore + sz,
    roll: g.roll + sr,
    yaw: g.yaw,
    pitch: g.pitch,
  };
}
