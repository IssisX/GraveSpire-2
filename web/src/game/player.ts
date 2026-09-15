import type { Actions } from "./input.ts";
import { mantleProbe, moveCapsule, type Collider } from "./collision.ts";

const WALK = 2.8;
const SPRINT = 6.05;
const CROUCH = 1.4;
const GRAVITY = 9.80665;
const JUMP_V = 3.8;
const COYOTE = 0.14;
const EYE = 1.62;
const EYE_CROUCH = 0.96;
const CAP_R = 0.32;
const CAP_H = 1.72;
const CAP_H_CROUCH = 1.05;
const CHUTE_DESCENT = -6.1;
const CHUTE_GLIDE = 6.4;

const FALL_BARKS = [
  "OH SHIT—THAT IS A LOT OF BUILDING!",
  "WHY THE HELL IS THE FLOOR STILL GETTING FARTHER AWAY?!",
  "PARACHUTE! PARACHUTE! ANY TIME THIS CENTURY!",
  "I CAN SEE THE ENTIRE DAMN SHIFT FROM UP HERE!",
  "THIS WAS NOT IN THE SAFETY BRIEF!",
  "FUCK—STEER, STEER, STEER!",
  "WHO BUILDS A SIXTY-METER HOLE THROUGH EVERY FLOOR?!",
  "NOTE TO SELF: GRAVITY REMAINS OPERATIONAL!",
] as const;

function moveToward2D(
  vx: number,
  vz: number,
  tx: number,
  tz: number,
  maxDelta: number,
): { x: number; z: number } {
  const dx = tx - vx;
  const dz = tz - vz;
  const d = Math.hypot(dx, dz);
  if (d <= maxDelta || d < 1e-6) return { x: tx, z: tz };
  const k = maxDelta / d;
  return { x: vx + dx * k, z: vz + dz * k };
}

export class Player {
  x = 5.6;
  y = 0.05;
  z = -1.35;
  yaw = -1.62;
  pitch = 0.06;
  vx = 0;
  vy = 0;
  vz = 0;
  ax = 0;
  az = 0;
  forwardAccel = 0;
  lateralAccel = 0;
  forwardSpeed = 0;
  lateralSpeed = 0;
  yawRate = 0;
  grounded = true;
  groundedId: string | null = null;
  crouch = false;
  eye = EYE;
  speed = 0;
  coyote = 0;
  mantleT = 0;
  mantleTo: { x: number; y: number; z: number } | null = null;
  airTime = 0;
  fallFrom = 0;
  landed = 0;
  sprinting = false;
  jumpBuffered = 0;
  parachuteDeployed = false;
  chuteUsedThisFall = false;
  private barkClock = 0;
  private barkIndex = 0;

  forward(): { x: number; z: number } {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }
  right(): { x: number; z: number } {
    return { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
  }

  applyLook(dx: number, dy: number, sens = 0.0022, invertY = false) {
    const prevYaw = this.yaw;
    this.yaw -= dx * sens;
    this.pitch -= dy * sens * (invertY ? -1 : 1);
    const lim = Math.PI / 2 - 0.01;
    if (this.pitch > lim) this.pitch = lim;
    if (this.pitch < -lim) this.pitch = -lim;
    this.yawRate = this.yaw - prevYaw;
  }

  requestJump() {
    this.jumpBuffered = 0.14;
  }

  tryMantle(colliders: Collider[]) {
    const f = this.forward();
    const m = mantleProbe(this.x, this.y, this.z, f.x, f.z, colliders);
    if (m) {
      this.mantleTo = m;
      this.mantleT = 0.30;
      return true;
    }
    return false;
  }

  private fearBark(force = false) {
    if (!force && this.barkClock > 0) return;
    const line = FALL_BARKS[this.barkIndex % FALL_BARKS.length]!;
    this.barkIndex += 1;
    this.barkClock = 1.55 + (this.barkIndex % 3) * 0.32;
    try {
      window.dispatchEvent(new CustomEvent("gravespire-fall-bark", { detail: line }));
      if ("speechSynthesis" in window && window.speechSynthesis) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(line);
        u.rate = 1.18;
        u.pitch = 0.82 + (this.barkIndex % 3) * 0.08;
        u.volume = 0.86;
        window.speechSynthesis.speak(u);
      }
    } catch {
      /* Voice support is optional; fall physics is not. */
    }
  }

  private deployParachute() {
    if (this.parachuteDeployed || this.grounded || this.airTime < 0.55 || this.vy > -4.5) return false;
    this.parachuteDeployed = true;
    this.chuteUsedThisFall = true;
    this.vy = Math.max(this.vy, -11.0);
    this.fearBark(true);
    return true;
  }

  step(dt: number, actions: Actions, colliders: Collider[], platformDelta?: { x: number; y: number; z: number }) {
    this.landed = 0;
    this.barkClock = Math.max(0, this.barkClock - dt);
    if (this.mantleTo && this.mantleT > 0) {
      this.mantleT -= dt;
      const u = Math.max(0, this.mantleT) / 0.30;
      const t = 1 - u;
      const ease = t * t * (3 - 2 * t);
      this.x += (this.mantleTo.x - this.x) * Math.min(1, ease * 0.36 + dt * 7.5);
      this.y += (this.mantleTo.y - this.y) * Math.min(1, ease * 0.40 + dt * 7.5);
      this.z += (this.mantleTo.z - this.z) * Math.min(1, ease * 0.36 + dt * 7.5);
      this.vy = 0;
      if (this.mantleT <= 0) {
        this.x = this.mantleTo.x;
        this.y = this.mantleTo.y;
        this.z = this.mantleTo.z;
        this.mantleTo = null;
        this.grounded = true;
      }
      return;
    }

    this.crouch = actions.crouch;
    const wantH = this.crouch ? CAP_H_CROUCH : CAP_H;
    const targetEye = this.crouch ? EYE_CROUCH : EYE;
    this.eye += (targetEye - this.eye) * (1 - Math.exp(-12 * dt));

    this.applyLook(actions.lookX, actions.lookY, actions.lookSens, actions.invertY);

    const f = this.forward();
    const r = this.right();
    const rawMag = Math.hypot(actions.moveX, actions.moveY);
    const inputMag = Math.min(1, rawMag);
    this.sprinting = Boolean(!this.crouch && this.grounded && actions.moveY > 0.25 && (actions.sprint || (actions.autoSprint && inputMag > 0.86)));

    let maxSp = this.crouch ? CROUCH : this.sprinting ? SPRINT : this.parachuteDeployed ? CHUTE_GLIDE : WALK;
    // Athletic footwork: sprinting favors forward drive rather than impossible full-speed side strafing.
    const strafeScale = this.sprinting ? 0.70 : 0.92;
    const wishForward = actions.moveY;
    const wishSide = actions.moveX * strafeScale;
    const wishX = f.x * wishForward + r.x * wishSide;
    const wishZ = f.z * wishForward + r.z * wishSide;
    const wishLen = Math.hypot(wishX, wishZ);
    const nx = wishLen > 0 ? wishX / wishLen : 0;
    const nz = wishLen > 0 ? wishZ / wishLen : 0;
    maxSp *= inputMag;
    const targetVx = nx * maxSp;
    const targetVz = nz * maxSp;

    const pvX = this.vx;
    const pvZ = this.vz;
    const currentSpeed = Math.hypot(this.vx, this.vz);
    const targetSpeed = Math.hypot(targetVx, targetVz);
    const alignment = currentSpeed > 0.15 && targetSpeed > 0.15
      ? (this.vx * targetVx + this.vz * targetVz) / (currentSpeed * targetSpeed)
      : 1;
    let accel: number;
    if (!this.grounded) accel = this.parachuteDeployed ? 4.4 : 3.2;
    else if (inputMag < 0.05) accel = this.crouch ? 16 : 22;
    else if (alignment < 0.15) accel = this.sprinting ? 19 : 26;
    else accel = this.sprinting ? 11.5 : this.crouch ? 10 : 17.5;

    const moved = moveToward2D(this.vx, this.vz, targetVx, targetVz, accel * dt);
    this.vx = moved.x;
    this.vz = moved.z;
    this.ax = (this.vx - pvX) / Math.max(dt, 1e-4);
    this.az = (this.vz - pvZ) / Math.max(dt, 1e-4);
    this.forwardAccel = this.ax * f.x + this.az * f.z;
    this.lateralAccel = this.ax * r.x + this.az * r.z;
    this.forwardSpeed = this.vx * f.x + this.vz * f.z;
    this.lateralSpeed = this.vx * r.x + this.vz * r.z;

    const wasGround = this.grounded;
    if (this.grounded) {
      this.coyote = COYOTE;
      this.airTime = 0;
      this.fallFrom = this.y;
      this.parachuteDeployed = false;
    } else {
      this.coyote -= dt;
      this.airTime += dt;
      this.vy -= GRAVITY * dt;
      if (this.parachuteDeployed) {
        this.vy += (CHUTE_DESCENT - this.vy) * Math.min(1, 2.8 * dt);
        if (this.vy < -9 && this.airTime > 1.0) this.fearBark();
      } else if (this.vy < -11 && this.airTime > 1.0) {
        this.fearBark();
      }
    }

    if (actions.jumpPressed && !this.grounded) this.deployParachute();

    if (this.jumpBuffered > 0) this.jumpBuffered -= dt;
    const wantJump = actions.jumpPressed || this.jumpBuffered > 0;
    if (wantJump && this.coyote > 0) {
      this.vy = JUMP_V;
      this.grounded = false;
      this.coyote = 0;
      this.jumpBuffered = 0;
    } else if (wantJump && !this.grounded && !this.parachuteDeployed) {
      if (this.tryMantle(colliders)) {
        this.jumpBuffered = 0;
        return;
      }
    }

    // Legacy carrier support remains frame-delta based. New causal mechanisms expose
    // authoritative surface velocity on their collider and are integrated per player substep.
    if (platformDelta && this.grounded && this.groundedId === "carrier") {
      this.x += platformDelta.x;
      this.y += platformDelta.y;
      this.z += platformDelta.z;
    }

    let supportVx = 0;
    let supportVy = 0;
    let supportVz = 0;
    if (this.grounded && this.groundedId) {
      const support = colliders.find((c) => c.id === this.groundedId && !c.disabled);
      if (support) {
        supportVx = support.surfaceVx ?? 0;
        supportVy = support.surfaceVy ?? 0;
        supportVz = support.surfaceVz ?? 0;
        if (
          support.surfaceAngularZ != null &&
          support.surfacePivotX != null &&
          support.surfacePivotY != null
        ) {
          const rx = this.x - support.surfacePivotX;
          const ry = this.y - support.surfacePivotY;
          supportVx += -support.surfaceAngularZ * ry;
          supportVy += support.surfaceAngularZ * rx;
        }
      }
    }

    const steps = Math.max(1, Math.ceil((Math.hypot(this.vx + supportVx, this.vy + supportVy, this.vz + supportVz) * dt) / 0.18));
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      const res = moveCapsule(
        { x: this.x, y: this.y, z: this.z, r: CAP_R, h: wantH },
        (this.vx + supportVx) * sdt,
        (this.vy + supportVy) * sdt,
        (this.vz + supportVz) * sdt,
        colliders,
      );
      this.x = res.x;
      this.y = res.y;
      this.z = res.z;
      this.grounded = res.grounded;
      this.groundedId = res.groundedId;
      if (res.grounded && this.vy < 0) this.vy = 0;
      if (res.hitHead && this.vy > 0) this.vy = 0;
    }

    if (!wasGround && this.grounded) {
      const drop = this.fallFrom - this.y;
      this.landed = Math.max(0, Math.min(1, (drop - 0.35) / 4.2));
      this.parachuteDeployed = false;
    }

    this.speed = Math.hypot(this.vx, this.vz);
  }

  fallDamage(): "none" | "hurt" | "dead" {
    if (this.y < -80) return "dead";
    if (this.grounded && this.airTime > 0.05) {
      const drop = this.fallFrom - this.y;
      this.airTime = 0;
      if (this.chuteUsedThisFall) {
        this.chuteUsedThisFall = false;
        return drop > 55 ? "hurt" : "none";
      }
      if (drop > 12.5) return "dead";
      if (drop > 5.8) return "hurt";
    }
    return "none";
  }
}