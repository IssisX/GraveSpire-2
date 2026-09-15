import type { Actions } from "./input.ts";
import { mantleProbe, moveCapsule, type Collider } from "./collision.ts";

const WALK = 2.55;
const SPRINT = 4.85;
const CROUCH = 1.15;
const GRAVITY = 9.80665;
const JUMP_V = 3.55;
const COYOTE = 0.14;
const EYE = 1.62;
const EYE_CROUCH = 0.96;
const CAP_R = 0.32;
const CAP_H = 1.72;
const CAP_H_CROUCH = 1.05;

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
      this.mantleT = 0.32;
      return true;
    }
    return false;
  }

  step(dt: number, actions: Actions, colliders: Collider[], platformDelta?: { x: number; y: number; z: number }) {
    this.landed = 0;
    if (this.mantleTo && this.mantleT > 0) {
      this.mantleT -= dt;
      const u = Math.max(0, this.mantleT) / 0.32;
      const t = 1 - u;
      this.x += (this.mantleTo.x - this.x) * Math.min(1, t * 3);
      this.y += (this.mantleTo.y - this.y) * Math.min(1, t * 3);
      this.z += (this.mantleTo.z - this.z) * Math.min(1, t * 3);
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
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 10);

    this.applyLook(actions.lookX, actions.lookY, actions.lookSens, actions.invertY);

    const f = this.forward();
    const r = this.right();
    const mag = Math.hypot(actions.moveX, actions.moveY);
    this.sprinting = Boolean(!this.crouch && this.grounded && (actions.sprint || (actions.autoSprint && mag > 0.86)));
    const maxSp = this.crouch ? CROUCH : this.sprinting ? SPRINT : WALK;
    const wishX = f.x * actions.moveY + r.x * actions.moveX;
    const wishZ = f.z * actions.moveY + r.z * actions.moveX;
    const wishLen = Math.hypot(wishX, wishZ);
    const nx = wishLen > 0 ? wishX / wishLen : 0;
    const nz = wishLen > 0 ? wishZ / wishLen : 0;
    const accel = this.grounded ? 18 : 4.5;
    const targetVx = nx * maxSp;
    const targetVz = nz * maxSp;
    const pvX = this.vx;
    const pvZ = this.vz;
    this.vx += (targetVx - this.vx) * Math.min(1, accel * dt);
    this.vz += (targetVz - this.vz) * Math.min(1, accel * dt);
    this.ax = (this.vx - pvX) / Math.max(dt, 1e-4);
    this.az = (this.vz - pvZ) / Math.max(dt, 1e-4);
    this.forwardAccel = this.ax * f.x + this.az * f.z;

    const wasGround = this.grounded;
    if (this.grounded) {
      this.coyote = COYOTE;
      this.airTime = 0;
      this.fallFrom = this.y;
    } else {
      this.coyote -= dt;
      this.airTime += dt;
      this.vy -= GRAVITY * dt;
    }

    if (this.jumpBuffered > 0) this.jumpBuffered -= dt;
    const wantJump = actions.jumpPressed || this.jumpBuffered > 0;
    if (wantJump && this.coyote > 0) {
      this.vy = JUMP_V;
      this.grounded = false;
      this.coyote = 0;
      this.jumpBuffered = 0;
    } else if (wantJump && !this.grounded) {
      if (this.tryMantle(colliders)) {
        this.jumpBuffered = 0;
        return;
      }
    }

    if (platformDelta && this.grounded && this.groundedId === "carrier") {
      this.x += platformDelta.x;
      this.y += platformDelta.y;
      this.z += platformDelta.z;
    }

    const steps = Math.max(1, Math.ceil((Math.hypot(this.vx, this.vy, this.vz) * dt) / 0.18));
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      const res = moveCapsule(
        { x: this.x, y: this.y, z: this.z, r: CAP_R, h: wantH },
        this.vx * sdt,
        this.vy * sdt,
        this.vz * sdt,
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
    }

    this.speed = Math.hypot(this.vx, this.vz);
  }

  fallDamage(): "none" | "hurt" | "dead" {
    if (this.y < -6) return "dead";
    if (this.grounded && this.airTime > 0.05) {
      const drop = this.fallFrom - this.y;
      this.airTime = 0;
      if (drop > 8.5) return "dead";
      if (drop > 4.8) return "hurt";
    }
    return "none";
  }
}
