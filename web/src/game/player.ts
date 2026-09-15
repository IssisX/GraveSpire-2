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

/**
 * Arcade parachute flight, not simulated aerodynamics: a controlled glide
 * with a low terminal velocity, not a drag/lift body. Brake (crouch) and
 * dive (sprint) both target a different descent rate; steering reuses the
 * same forward/right wish direction ordinary movement already computes,
 * just with the chute's own accel and top speed instead of walking's.
 */
const CHUTE_VY_BASE = -4.5;
const CHUTE_VY_DIVE = -11;
const CHUTE_VY_BRAKE = -1.8;
const CHUTE_VY_RATE = 3.0;
const CHUTE_LATERAL_MAX = 9;
const CHUTE_LATERAL_ACCEL = 14;

export class Player {
  x = 8.8;
  y = 0.05;
  z = -4.0;
  yaw = 1.1;
  pitch = -0.02;
  vx = 0;
  vy = 0;
  vz = 0;
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
  /** Downward speed at the instant of the most recent landing, m/s. Read and
   *  cleared by presentation; it is never used to move the player. */
  landingImpact = 0;
  /** Magnitude of the movement request last step, 0..1. */
  moveInput = 0;

  /** Handed out at the tower's entrance, not earned mid-climb (world code
   *  sets this true once the player is equipped, false in every other
   *  context). Gates whether a second jump-press deploys the chute instead
   *  of just trying to mantle. */
  chuteEquipped = false;
  /** True from deploy until landing. Overrides the normal gravity/movement
   *  integration below with an arcade glide instead of free fall. */
  parachuting = false;
  /** Set for exactly one step on a chute-assisted landing, consumed by
   *  fallDamage() so any height under canopy is survivable -- that is the
   *  entire point of the mechanic -- without weakening fall damage for a
   *  normal, chute-less fall anywhere else in the game. */
  landedByChute = false;
  /** True once the player has hit the absolute floor of the world (see
   *  step()). Persists, unlike landedByChute: there is no real collider
   *  down there to naturally re-ground on, so a one-shot flag gets
   *  overwritten by moveCapsule's own (correct) `grounded=false` on the
   *  very next step -- with parachuting already cleared, that reopens the
   *  unconditional y<-6 death check and kills the player one frame after
   *  "safely" landing them. Movement/gravity stay parked while this holds;
   *  only external code (a future checkpoint return) clears it. */
  worldFloored = false;

  forward(): { x: number; z: number } {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }
  right(): { x: number; z: number } {
    return { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
  }

  /** Radians per unit of look delta. Sensitivity is applied upstream. */
  applyLook(dx: number, dy: number, sens = 0.0022) {
    this.yaw -= dx * sens;
    this.pitch -= dy * sens;
    const lim = Math.PI / 2 - 0.01;
    if (this.pitch > lim) this.pitch = lim;
    if (this.pitch < -lim) this.pitch = -lim;
  }

  step(dt: number, actions: Actions, colliders: Collider[], platformDelta?: { x: number; y: number; z: number }) {
    if (this.worldFloored) {
      this.vx = 0;
      this.vy = 0;
      this.vz = 0;
      this.grounded = true;
      return;
    }
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

    this.applyLook(actions.lookX, actions.lookY);

    const f = this.forward();
    const r = this.right();
    const gaitTop = this.crouch ? CROUCH : actions.sprint && this.grounded ? SPRINT : WALK;
    const wishX = f.x * actions.moveY + r.x * actions.moveX;
    const wishZ = f.z * actions.moveY + r.z * actions.moveX;
    const wishLen = Math.hypot(wishX, wishZ);
    const nx = wishLen > 0 ? wishX / wishLen : 0;
    const nz = wishLen > 0 ? wishZ / wishLen : 0;
    // Analogue magnitude is preserved: a half-deflected thumb walks at half
    // pace instead of snapping to the full gait.
    this.moveInput = Math.min(1, Math.max(wishLen, actions.moveMag ?? wishLen));
    const maxSp = gaitTop * this.moveInput;
    const accel = this.grounded ? 18 : 4.5;
    const targetVx = nx * maxSp;
    const targetVz = nz * maxSp;
    this.vx += (targetVx - this.vx) * Math.min(1, accel * dt);
    this.vz += (targetVz - this.vz) * Math.min(1, accel * dt);

    if (this.grounded) {
      this.coyote = COYOTE;
      this.airTime = 0;
      this.fallFrom = this.y;
    } else {
      this.coyote -= dt;
      this.airTime += dt;
      // While parachuting, the glide block below owns vy entirely (its
      // target-seeking ease already stands in for gravity vs. canopy drag
      // together); applying raw gravity here too would fight that term and
      // settle at target - GRAVITY/CHUTE_VY_RATE instead of at target.
      if (!this.parachuting) this.vy -= GRAVITY * dt;
    }

    if (actions.jumpPressed && this.coyote > 0) {
      this.vy = JUMP_V;
      this.grounded = false;
      this.coyote = 0;
    } else if (actions.jumpPressed && !this.grounded) {
      const m = mantleProbe(this.x, this.y, this.z, f.x, f.z, colliders);
      if (m) {
        this.mantleTo = m;
        this.mantleT = 0.32;
        return;
      }
      if (this.chuteEquipped && !this.parachuting) {
        this.parachuting = true;
        // Fall damage tracks total drop since last grounded; deploying
        // resets what counts as "the fall" from here, rather than
        // grandfathering in whatever height preceded the decision to open
        // it -- the chute is meant to make anything after this survivable.
        this.fallFrom = this.y;
      }
    }

    if (platformDelta && this.grounded && this.groundedId === "carrier") {
      this.x += platformDelta.x;
      this.y += platformDelta.y;
      this.z += platformDelta.z;
    }

    if (this.parachuting) {
      const chuteTargetVx = nx * CHUTE_LATERAL_MAX;
      const chuteTargetVz = nz * CHUTE_LATERAL_MAX;
      this.vx += (chuteTargetVx - this.vx) * Math.min(1, CHUTE_LATERAL_ACCEL * dt);
      this.vz += (chuteTargetVz - this.vz) * Math.min(1, CHUTE_LATERAL_ACCEL * dt);
      const chuteTargetVy = this.crouch ? CHUTE_VY_BRAKE : actions.sprint ? CHUTE_VY_DIVE : CHUTE_VY_BASE;
      this.vy += (chuteTargetVy - this.vy) * Math.min(1, CHUTE_VY_RATE * dt);
    }

    const wasGrounded = this.grounded;
    const approachSpeed = this.vy;
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

    if (!wasGrounded && this.grounded && approachSpeed < -0.6) {
      this.landingImpact = -approachSpeed;
    }
    if (!wasGrounded && this.grounded && this.parachuting) {
      this.parachuting = false;
      this.landedByChute = true;
    }

    // Absolute floor of the world. A chute-suppressed y < -6 death check
    // means whatever real collider geometry may or may not exist below a
    // given point, a parachuting player must still always resolve to a
    // landing eventually -- e.g. the freight well's pit floor is a visual
    // box with no collider, so without this a glide out over it would fall
    // forever with no death and no ground. Matches the existing "anything
    // that leaves the world is clamped, not lost" convention already used
    // for bodies (simulation.ts), rather than a special case for one pit.
    // Persistent (worldFloored), not a one-shot grounded=true: there is no
    // real geometry down here, so moveCapsule would just recompute
    // grounded=false again next step and, with parachuting now cleared,
    // walk straight back into the unconditional death check one frame
    // later. See the worldFloored early-return at the top of this method.
    if (!this.grounded && this.y < -30) {
      this.y = -30;
      this.vx = 0;
      this.vy = 0;
      this.vz = 0;
      this.grounded = true;
      this.worldFloored = true;
      if (this.parachuting) {
        this.parachuting = false;
        this.landedByChute = true;
      }
    }

    this.speed = Math.hypot(this.vx, this.vz);
  }

  /** Consume the landing severity recorded by the last step. */
  takeLandingImpact(): number {
    const v = this.landingImpact;
    this.landingImpact = 0;
    return v;
  }

  fallDamage(): "none" | "hurt" | "dead" {
    if (this.worldFloored) return "none";
    if (this.landedByChute) {
      this.landedByChute = false;
      this.airTime = 0;
      return "none";
    }
    // The depth check is an absolute-altitude safety net for an accidental
    // fall; it must not fire while a deliberate, controlled descent under
    // canopy is still in progress, or a tall drop would kill the player
    // before they ever reach the ground to land safely on.
    if (this.y < -6 && !this.parachuting) return "dead";
    if (this.grounded && this.airTime > 0.05) {
      const drop = this.fallFrom - this.y;
      this.airTime = 0;
      if (drop > 8.5) return "dead";
      if (drop > 4.8) return "hurt";
    }
    return "none";
  }
}
