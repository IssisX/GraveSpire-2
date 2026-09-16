import { highAltitudeWindMps } from "../sim/sky-spine.ts";
import type { Actions } from "./input.ts";
import { moveCapsule, type Collider } from "./collision.ts";
import {
  canShimmy,
  probeControlledDrop,
  probeLadderGrab,
  probeLedgeCatch,
  probeVault,
  type ParkourProbe,
} from "./parkour.ts";

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
const PLAYER_MASS_KG = 86;
const LADDER_SPEED = 2.75;
const PRECISION_MOMENTUM_S = 0.26;

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

const RECOVERY_BARKS = [
  "Nailed it. Absolutely intentional.",
  "OSHA can send the paperwork to the parachute.",
  "Still alive. Extremely irritating for gravity.",
  "That counts as a shortcut and I refuse further questions.",
] as const;

type TraverseMode = "free" | "vault" | "hang" | "pullup" | "ladder";
type Vec3 = { x: number; y: number; z: number };
type ContactImpulse = (colliderId: string, impulseXNs: number, impulseZNs: number) => void;

function moveToward2D(vx: number, vz: number, tx: number, tz: number, maxDelta: number): { x: number; z: number } {
  const dx = tx - vx;
  const dz = tz - vz;
  const d = Math.hypot(dx, dz);
  if (d <= maxDelta || d < 1e-6) return { x: tx, z: tz };
  const k = maxDelta / d;
  return { x: vx + dx * k, z: vz + dz * k };
}

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

function surfaceVelocity(c: Collider | undefined, x: number, y: number): Vec3 {
  if (!c) return { x: 0, y: 0, z: 0 };
  let vx = c.surfaceVx ?? 0;
  let vy = c.surfaceVy ?? 0;
  const vz = c.surfaceVz ?? 0;
  if (c.surfaceAngularZ != null && c.surfacePivotX != null && c.surfacePivotY != null) {
    const rx = x - c.surfacePivotX;
    const ry = y - c.surfacePivotY;
    vx += -c.surfaceAngularZ * ry;
    vy += c.surfaceAngularZ * rx;
  }
  return { x: vx, y: vy, z: vz };
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
  airTime = 0;
  fallFrom = 0;
  landed = 0;
  sprinting = false;
  jumpBuffered = 0;
  parachuteDeployed = false;
  chuteUsedThisFall = false;
  parkourMode: TraverseMode = "free";
  balance = 0;
  supportLean = 0;
  supportAccel = 0;
  windAccel = 0;

  private parkourProbe: ParkourProbe | null = null;
  private traverseT = 0;
  private traverseDuration = 0;
  private traverseFrom: Vec3 = { x: 0, y: 0, z: 0 };
  private traverseTo: Vec3 = { x: 0, y: 0, z: 0 };
  private traverseExitVelocity: Vec3 = { x: 0, y: 0, z: 0 };
  private precisionMomentumT = 0;
  private precisionSpeed = 0;
  private balanceSlip: Vec3 = { x: 0, y: 0, z: 0 };
  private barkClock = 0;
  private barkIndex = 0;
  private recoveryIndex = 0;
  private prevSupportV: Vec3 = { x: 0, y: 0, z: 0 };

  forward(): { x: number; z: number } { return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }; }
  right(): { x: number; z: number } { return { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) }; }

  applyLook(dx: number, dy: number, sens = 0.0022, invertY = false) {
    const prevYaw = this.yaw;
    this.yaw -= dx * sens;
    this.pitch -= dy * sens * (invertY ? -1 : 1);
    const lim = Math.PI / 2 - 0.01;
    this.pitch = clamp(this.pitch, -lim, lim);
    this.yawRate = this.yaw - prevYaw;
  }

  requestJump() { this.jumpBuffered = 0.14; }

  private speak(line: string, urgent = false) {
    try {
      window.dispatchEvent(new CustomEvent("gravespire-fall-bark", { detail: line }));
      if ("speechSynthesis" in window && window.speechSynthesis) {
        if (urgent) window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(line);
        u.rate = urgent ? 1.18 : 1.02;
        u.pitch = urgent ? 0.82 + (this.barkIndex % 3) * 0.08 : 0.92;
        u.volume = urgent ? 0.86 : 0.68;
        window.speechSynthesis.speak(u);
      }
    } catch { /* optional presentation path */ }
  }

  private fearBark(force = false) {
    if (!force && this.barkClock > 0) return;
    const line = FALL_BARKS[this.barkIndex % FALL_BARKS.length]!;
    this.barkIndex += 1;
    this.barkClock = 1.55 + (this.barkIndex % 3) * 0.32;
    this.speak(line, true);
  }

  private recoveryBark(drop: number) {
    if (drop < 22) return;
    const line = RECOVERY_BARKS[this.recoveryIndex % RECOVERY_BARKS.length]!;
    this.recoveryIndex += 1;
    this.speak(line, false);
  }

  private deployParachute() {
    if (this.parachuteDeployed || this.grounded || this.airTime < 0.55 || this.vy > -4.5 || this.parkourMode !== "free") return false;
    this.parachuteDeployed = true;
    this.chuteUsedThisFall = true;
    this.vy = Math.max(this.vy, -11.0);
    this.fearBark(true);
    return true;
  }

  private emitAtmosphere() {
    try {
      window.dispatchEvent(new CustomEvent("gravespire-altitude", {
        detail: {
          height: this.y + this.eye,
          verticalSpeed: this.vy,
          chute: this.parachuteDeployed,
          windAccel: this.windAccel,
          parkour: this.parkourMode,
          balance: this.balance,
        },
      }));
    } catch { /* presentation hook only */ }
  }

  private emitContact(impact: number, drop: number, colliderId: string) {
    try {
      window.dispatchEvent(new CustomEvent("gravespire-contact", { detail: { impact, drop, colliderId } }));
    } catch { /* presentation hook only */ }
  }

  private beginTraverse(mode: "vault" | "pullup", to: Vec3, duration: number, probe: ParkourProbe) {
    this.parkourMode = mode;
    this.parkourProbe = probe;
    this.traverseT = 0;
    this.traverseDuration = duration;
    this.traverseFrom = { x: this.x, y: this.y, z: this.z };
    this.traverseTo = { ...to };
    // Traversal animation owns the body for a few frames, but not the real
    // approach momentum. The exit feeds it back into the support velocity.
    const retain = mode === "vault" ? 0.82 : 0.34;
    this.traverseExitVelocity = { x: this.vx * retain, y: this.vy * 0.22, z: this.vz * retain };
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.grounded = false;
  }

  private beginHang(probe: ParkourProbe) {
    this.parkourMode = "hang";
    this.parkourProbe = probe;
    this.x = probe.targetX;
    this.y = probe.targetY;
    this.z = probe.targetZ;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.grounded = false;
    this.groundedId = null;
  }

  private beginLadder(probe: ParkourProbe) {
    this.parkourMode = "ladder";
    this.parkourProbe = probe;
    this.x = probe.targetX;
    this.y = probe.targetY;
    this.z = probe.targetZ;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.grounded = false;
    this.groundedId = null;
  }

  /** Context/UI compatibility: jump at geometry starts the same parkour system. */
  tryMantle(colliders: Collider[]) {
    const f = this.forward();
    const p = probeVault({
      x: this.x, y: this.y, z: this.z, fx: f.x, fz: f.z,
      speed: Math.max(this.speed, 1.8), radius: CAP_R, height: CAP_H, colliders,
    });
    if (!p) return false;
    this.beginTraverse("vault", { x: p.targetX, y: p.targetY, z: p.targetZ }, p.kind === "step" ? 0.18 : 0.34, p);
    return true;
  }

  private stepTraverse(dt: number, colliders: Collider[]): boolean {
    if ((this.parkourMode !== "vault" && this.parkourMode !== "pullup") || !this.parkourProbe) return false;
    const support = colliders.find((c) => c.id === this.parkourProbe!.colliderId && !c.disabled);
    const sv = surfaceVelocity(support, this.x, this.y);
    this.traverseTo.x += sv.x * dt;
    this.traverseTo.y += sv.y * dt;
    this.traverseTo.z += sv.z * dt;
    this.traverseT += dt;
    const t = clamp(this.traverseT / Math.max(0.01, this.traverseDuration), 0, 1);
    const ease = t * t * (3 - 2 * t);
    const arc = this.parkourMode === "vault" ? Math.sin(Math.PI * t) * 0.34 : Math.sin(Math.PI * t) * 0.10;
    this.x = this.traverseFrom.x + (this.traverseTo.x - this.traverseFrom.x) * ease;
    this.y = this.traverseFrom.y + (this.traverseTo.y - this.traverseFrom.y) * ease + arc;
    this.z = this.traverseFrom.z + (this.traverseTo.z - this.traverseFrom.z) * ease;
    if (t >= 1) {
      const finishedMode = this.parkourMode;
      this.parkourMode = "free";
      this.parkourProbe = null;
      this.grounded = true;
      this.vx = sv.x + this.traverseExitVelocity.x;
      this.vy = Math.max(0, sv.y + this.traverseExitVelocity.y);
      this.vz = sv.z + this.traverseExitVelocity.z;
      this.precisionMomentumT = finishedMode === "vault" ? 0.16 : 0;
      this.precisionSpeed = Math.hypot(this.vx, this.vz);
    }
    this.emitAtmosphere();
    return true;
  }

  private stepHang(dt: number, actions: Actions, colliders: Collider[]): boolean {
    if (this.parkourMode !== "hang" || !this.parkourProbe) return false;
    const p = this.parkourProbe;
    const support = colliders.find((c) => c.id === p.colliderId && !c.disabled);
    if (!support) {
      this.parkourMode = "free";
      this.parkourProbe = null;
      this.vy = -0.8;
      return false;
    }
    const sv = surfaceVelocity(support, this.x, this.y);
    this.x += sv.x * dt;
    this.y += sv.y * dt;
    this.z += sv.z * dt;
    p.targetX += sv.x * dt;
    p.targetY += sv.y * dt;
    p.targetZ += sv.z * dt;
    p.topY += sv.y * dt;

    const shimmy = Math.abs(actions.moveX) > 0.18 ? (Math.sign(actions.moveX) as -1 | 1) : 0;
    if (shimmy && canShimmy(p, shimmy, 0.34, colliders)) {
      const d = 1.45 * dt * shimmy;
      this.x += p.tangentX * d;
      this.z += p.tangentZ * d;
      p.targetX = this.x;
      p.targetZ = this.z;
    }

    if (actions.crouch || actions.moveY < -0.60) {
      this.parkourMode = "free";
      this.parkourProbe = null;
      this.vx = sv.x;
      this.vy = Math.min(-0.8, sv.y - 0.35);
      this.vz = sv.z;
      this.airTime = 0.2;
      return false;
    }

    if (actions.jumpPressed || actions.moveY > 0.72) {
      const f = this.forward();
      this.beginTraverse(
        "pullup",
        { x: this.x + f.x * 0.58, y: p.topY + 0.02, z: this.z + f.z * 0.58 },
        0.38,
        p,
      );
      return true;
    }

    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.emitAtmosphere();
    return true;
  }

  private stepLadder(dt: number, actions: Actions, colliders: Collider[]): boolean {
    if (this.parkourMode !== "ladder" || !this.parkourProbe) return false;
    const p = this.parkourProbe;
    const ladder = colliders.find((c) => c.id === p.colliderId && !c.disabled && c.climbable);
    if (!ladder) {
      this.parkourMode = "free";
      this.parkourProbe = null;
      this.vy = -0.8;
      return false;
    }
    const face = ladder.climbable!;
    const climb = clamp(actions.moveY, -1, 1);
    this.x = clamp(this.x, ladder.minx, ladder.maxx) + face.normalX * (CAP_R + 0.07);
    this.z = clamp(this.z, ladder.minz, ladder.maxz) + face.normalZ * (CAP_R + 0.07);
    this.y = clamp(this.y + climb * LADDER_SPEED * dt, ladder.miny, ladder.maxy - 0.03);

    if (actions.crouch || actions.moveY < -0.72) {
      this.parkourMode = "free";
      this.parkourProbe = null;
      this.vx = face.normalX * 0.45;
      this.vy = -0.85;
      this.vz = face.normalZ * 0.45;
      this.airTime = Math.max(this.airTime, 0.2);
      return false;
    }
    if ((actions.jumpPressed || climb > 0.72) && this.y >= ladder.maxy - 0.10) {
      this.parkourMode = "free";
      this.parkourProbe = null;
      // Exit through the real top edge; collision decides whether steel is
      // there to receive the player. No top-of-ladder teleport occurs.
      this.x += face.normalX * 0.22;
      this.z += face.normalZ * 0.22;
      this.vx = face.normalX * 1.3;
      this.vy = 0.55;
      this.vz = face.normalZ * 1.3;
      return false;
    }
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.emitAtmosphere();
    return true;
  }

  private currentSupport(colliders: Collider[]): { col?: Collider; velocity: Vec3 } {
    const col = this.groundedId ? colliders.find((c) => c.id === this.groundedId && !c.disabled) : undefined;
    return { col, velocity: surfaceVelocity(col, this.x, this.y) };
  }

  private updateBalance(dt: number, support: Collider | undefined, sv: Vec3) {
    const sax = (sv.x - this.prevSupportV.x) / Math.max(dt, 1e-4);
    const say = (sv.y - this.prevSupportV.y) / Math.max(dt, 1e-4);
    const saz = (sv.z - this.prevSupportV.z) / Math.max(dt, 1e-4);
    this.supportAccel = Math.hypot(sax, say, saz);
    this.prevSupportV = sv;
    if (!support || !this.grounded) {
      this.balance += (0 - this.balance) * Math.min(1, dt * 9);
      this.supportLean += (0 - this.supportLean) * Math.min(1, dt * 8);
      this.balanceSlip = { x: 0, y: 0, z: 0 };
      return;
    }
    const w = support.maxx - support.minx;
    const d = support.maxz - support.minz;
    const narrow = clamp((1.35 - Math.min(w, d)) / 1.0, 0, 1);
    const edge = Math.min(
      Math.abs(this.x - support.minx),
      Math.abs(support.maxx - this.x),
      Math.abs(this.z - support.minz),
      Math.abs(support.maxz - this.z),
    );
    const edgeStress = clamp((0.48 - edge) / 0.48, 0, 1);
    const accelStress = clamp(this.supportAccel / 5.4, 0, 1);
    const target = clamp(narrow * 0.74 + edgeStress * 0.48 + accelStress * 0.58, 0, 1);
    this.balance += (target - this.balance) * Math.min(1, dt * 8);
    const r = this.right();
    const lateralSupportAccel = sax * r.x + saz * r.z;
    const targetLean = clamp(-lateralSupportAccel * 0.022, -0.22, 0.22) * (0.3 + 0.7 * this.balance);
    this.supportLean += (targetLean - this.supportLean) * Math.min(1, dt * 10);
    // Deterministic slip comes from measured platform acceleration and the
    // player's actual footing. It matters on narrow fast carriers but has no
    // random branch and cannot push through a collider.
    const outward = edge < 0.34 ? clamp((0.34 - edge) / 0.34, 0, 1) : 0;
    const slip = narrow * accelStress * (0.20 + outward * 0.42);
    this.balanceSlip = {
      x: -r.x * lateralSupportAccel * slip * 0.09,
      y: 0,
      z: -r.z * lateralSupportAccel * slip * 0.09,
    };
  }

  private applyWind(dt: number, airborne: boolean) {
    const height = this.y + this.eye;
    const exposure = clamp((height - 80) / 52, 0, 1);
    if (exposure <= 0) {
      this.windAccel = 0;
      return;
    }
    const wind = highAltitudeWindMps(height);
    const wx = wind * 0.84;
    const wz = -wind * 0.54;
    const mag = Math.hypot(wx, wz) || 1;
    const area = this.parachuteDeployed ? 13.5 : airborne ? 0.78 : 0.34;
    const cd = this.parachuteDeployed ? 1.25 : 1.0;
    const force = 0.5 * 1.18 * cd * area * wind * wind * exposure;
    const accel = Math.min(this.parachuteDeployed ? 3.8 : airborne ? 1.25 : 0.28, force / PLAYER_MASS_KG);
    this.windAccel = accel;
    this.vx += (wx / mag) * accel * dt;
    this.vz += (wz / mag) * accel * dt;
  }

  step(
    dt: number,
    actions: Actions,
    colliders: Collider[],
    platformDelta?: { x: number; y: number; z: number },
    onContactImpulse?: ContactImpulse,
  ) {
    this.landed = 0;
    this.barkClock = Math.max(0, this.barkClock - dt);
    this.applyLook(actions.lookX, actions.lookY, actions.lookSens, actions.invertY);

    if (this.stepTraverse(dt, colliders)) return;
    if (this.stepHang(dt, actions, colliders)) return;
    if (this.stepLadder(dt, actions, colliders)) return;

    this.crouch = actions.crouch;
    const wantH = this.crouch ? CAP_H_CROUCH : CAP_H;
    const targetEye = this.crouch ? EYE_CROUCH : EYE;
    this.eye += (targetEye - this.eye) * (1 - Math.exp(-12 * dt));

    const f = this.forward();
    const r = this.right();
    const rawMag = Math.hypot(actions.moveX, actions.moveY);
    const inputMag = Math.min(1, rawMag);
    this.sprinting = Boolean(!this.crouch && this.grounded && actions.moveY > 0.25 && (actions.sprint || (actions.autoSprint && inputMag > 0.86)));

    const supportNow = this.currentSupport(colliders);
    this.updateBalance(dt, supportNow.col, supportNow.velocity);

    if (this.grounded && actions.jumpPressed && actions.crouch) {
      const drop = probeControlledDrop({
        x: this.x, y: this.y, z: this.z, fx: f.x, fz: f.z,
        groundedId: this.groundedId, radius: CAP_R, colliders,
      });
      if (drop) {
        this.beginHang(drop);
        this.emitAtmosphere();
        return;
      }
    }
    if (this.grounded && actions.jumpPressed && actions.moveY > 0.12) {
      const vault = probeVault({
        x: this.x, y: this.y, z: this.z, fx: f.x, fz: f.z,
        speed: this.speed, radius: CAP_R, height: wantH, colliders,
      });
      if (vault) {
        this.beginTraverse("vault", { x: vault.targetX, y: vault.targetY, z: vault.targetZ }, vault.kind === "step" ? 0.17 : 0.33, vault);
        this.emitAtmosphere();
        return;
      }
    }

    this.precisionMomentumT = Math.max(0, this.precisionMomentumT - dt);
    let maxSp = this.crouch ? CROUCH : this.sprinting ? SPRINT : this.parachuteDeployed ? CHUTE_GLIDE : WALK;
    maxSp *= 1 - this.balance * 0.12;
    const strafeScale = this.sprinting ? 0.70 : 0.92;
    const wishX = f.x * actions.moveY + r.x * actions.moveX * strafeScale;
    const wishZ = f.z * actions.moveY + r.z * actions.moveX * strafeScale;
    const wishLen = Math.hypot(wishX, wishZ);
    const nx = wishLen > 0 ? wishX / wishLen : 0;
    const nz = wishLen > 0 ? wishZ / wishLen : 0;
    maxSp *= inputMag;
    let targetVx = nx * maxSp;
    let targetVz = nz * maxSp;
    if (!this.grounded && !this.parachuteDeployed && this.precisionMomentumT > 0) {
      const carried = Math.max(3.4, this.precisionSpeed * 0.88);
      const carryX = inputMag > 0.12 ? nx : this.vx / Math.max(0.01, Math.hypot(this.vx, this.vz));
      const carryZ = inputMag > 0.12 ? nz : this.vz / Math.max(0.01, Math.hypot(this.vx, this.vz));
      targetVx = carryX * carried;
      targetVz = carryZ * carried;
    }

    const pvX = this.vx;
    const pvZ = this.vz;
    const currentSpeed = Math.hypot(this.vx, this.vz);
    const targetSpeed = Math.hypot(targetVx, targetVz);
    const alignment = currentSpeed > 0.15 && targetSpeed > 0.15 ? (this.vx * targetVx + this.vz * targetVz) / (currentSpeed * targetSpeed) : 1;
    let accel: number;
    if (!this.grounded) accel = this.parachuteDeployed ? 4.4 : 3.2;
    else if (inputMag < 0.05) accel = this.crouch ? 16 : 22;
    else if (alignment < 0.15) accel = this.sprinting ? 19 : 26;
    else accel = this.sprinting ? 11.5 : this.crouch ? 10 : 17.5;
    accel *= 1 - this.balance * 0.16;

    const moved = moveToward2D(this.vx, this.vz, targetVx, targetVz, accel * dt);
    this.vx = moved.x;
    this.vz = moved.z;
    if (this.grounded) {
      this.vx += this.balanceSlip.x * dt;
      this.vz += this.balanceSlip.z * dt;
    }
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
      } else if (this.vy < -11 && this.airTime > 1.0) this.fearBark();
    }

    this.applyWind(dt, !this.grounded);

    if (!this.grounded && !this.parachuteDeployed && actions.moveY > 0.08 && this.vy < 1.2) {
      const ledge = probeLedgeCatch({
        x: this.x, y: this.y, z: this.z, fx: f.x, fz: f.z,
        vy: this.vy, radius: CAP_R, colliders,
      });
      if (ledge) {
        this.beginHang(ledge);
        this.emitAtmosphere();
        return;
      }
    }

    if (actions.jumpPressed && !this.parachuteDeployed) {
      const ladder = probeLadderGrab({
        x: this.x, y: this.y, z: this.z, fx: f.x, fz: f.z, radius: CAP_R, colliders,
      });
      if (ladder && (!this.grounded || this.speed < 2.2)) {
        this.beginLadder(ladder);
        this.emitAtmosphere();
        return;
      }
    }
    if (actions.jumpPressed && !this.grounded) this.deployParachute();
    if (this.jumpBuffered > 0) this.jumpBuffered -= dt;
    const wantJump = actions.jumpPressed || this.jumpBuffered > 0;
    if (wantJump && this.coyote > 0) {
      const runSpeed = Math.hypot(this.vx, this.vz);
      this.vx += supportNow.velocity.x;
      this.vy = JUMP_V + Math.max(-0.5, supportNow.velocity.y);
      this.vz += supportNow.velocity.z;
      this.grounded = false;
      this.groundedId = null;
      this.coyote = 0;
      this.jumpBuffered = 0;
      this.precisionMomentumT = this.sprinting && runSpeed > 4.15 ? PRECISION_MOMENTUM_S : 0;
      this.precisionSpeed = runSpeed;
    } else if (wantJump && !this.grounded && !this.parachuteDeployed && this.tryMantle(colliders)) {
      this.jumpBuffered = 0;
      return;
    }

    if (platformDelta && this.grounded && this.groundedId === "carrier") {
      this.x += platformDelta.x;
      this.y += platformDelta.y;
      this.z += platformDelta.z;
    }

    const supportV = this.grounded ? supportNow.velocity : { x: 0, y: 0, z: 0 };
    const steps = Math.max(1, Math.ceil((Math.hypot(this.vx + supportV.x, this.vy + supportV.y, this.vz + supportV.z) * dt) / 0.18));
    const sdt = dt / steps;
    const pushed = new Set<string>();
    let strongestSideImpact = 0;
    let strongestSideId = "";
    const preCollisionVertical = this.vy;
    for (let i = 0; i < steps; i++) {
      const res = moveCapsule(
        { x: this.x, y: this.y, z: this.z, r: CAP_R, h: wantH },
        (this.vx + supportV.x) * sdt,
        (this.vy + supportV.y) * sdt,
        (this.vz + supportV.z) * sdt,
        colliders,
      );
      if (onContactImpulse) {
        for (const id of res.sideHits) {
          if (pushed.has(id) || !id.startsWith("ingredient:")) continue;
          pushed.add(id);
          onContactImpulse(
            id,
            (this.vx + supportV.x) * PLAYER_MASS_KG * 0.62,
            (this.vz + supportV.z) * PLAYER_MASS_KG * 0.62,
          );
        }
      }
      if (res.sideHits.length) {
        const impact = Math.hypot(this.vx + supportV.x, this.vz + supportV.z);
        if (impact > strongestSideImpact) {
          strongestSideImpact = impact;
          strongestSideId = res.sideHits[0]!;
        }
      }
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
      this.landed = clamp((drop - 0.35) / 4.2, 0, 1);
      this.emitContact(Math.max(0, -preCollisionVertical), drop, this.groundedId ?? "steel");
      if (this.chuteUsedThisFall) this.recoveryBark(drop);
      this.parachuteDeployed = false;
    }
    if (strongestSideImpact > 2.4) this.emitContact(strongestSideImpact, 0, strongestSideId);
    this.speed = Math.hypot(this.vx, this.vz);
    this.emitAtmosphere();
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
