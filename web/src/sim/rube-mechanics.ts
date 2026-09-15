import { G, clamp, type RubeState } from "./types.ts";
import {
  createLinkedCascadeState,
  ensureLinkedCascadeState,
  linkedCascadeFinite,
  linkedEntryContactForce,
  stepLinkedCascade,
  toggleTransferBrake,
} from "./linked-cascade.ts";

export { toggleTransferBrake } from "./linked-cascade.ts";

/**
 * Transfer Cascade M-01 is a deliberately reduced planar multibody cell.
 * It lives inside the authoritative Simulation tick; presentation only reads it.
 * The point is not a bespoke "lever puzzle" but reusable force/torque/constraint
 * relationships that can later be generalized into the C++ mechanics authority.
 */
export const CASCADE = {
  z: -31.5,
  pivotX: 56.0,
  pivotY: 1.35,
  leverLengthM: 9.0,
  leverMassKg: 900.0,
  angleMinRad: -0.46,
  angleMaxRad: 0.42,
  ballastMassKg: 1400.0,
  ballastMinM: -3.65,
  ballastMaxM: 3.65,
  liftX: 64.0,
  liftMinY: 0.48,
  liftMaxY: 2.50,
  liftMassKg: 760.0,
  pulleyX: 61.5,
  pulleyY: 6.4,
  ropeStiffnessNpm: 4.2e4,
  ropeDampingNsPm: 4.5e3,
  ropeRatedN: 7.2e4,
  pivotDampingNms: 8.0e3,
  liftDampingNsPm: 1.1e3,
  // The ballast rides on wheels constrained to the beam: use rolling-resistance scale,
  // not dry sliding-friction values. Static resistance still prevents micro-creep.
  sliderMuStatic: 0.035,
  sliderMuKinetic: 0.025,
  ballastPushImpulseNs: 1.8e3,
} as const;

function sq(v: number): number {
  return v * v;
}

export function leverTip(rube: RubeState): { x: number; y: number; z: number } {
  const h = CASCADE.leverLengthM * 0.5;
  return {
    x: CASCADE.pivotX + h * Math.cos(rube.lever.angle_rad),
    y: CASCADE.pivotY + h * Math.sin(rube.lever.angle_rad),
    z: CASCADE.z,
  };
}

export function ballastWorld(rube: RubeState): { x: number; y: number; z: number } {
  const a = rube.lever.angle_rad;
  return {
    x: CASCADE.pivotX + rube.ballast.s_m * Math.cos(a),
    y: CASCADE.pivotY + rube.ballast.s_m * Math.sin(a) + 0.42,
    z: CASCADE.z,
  };
}

export function liftWorld(rube: RubeState): { x: number; y: number; z: number } {
  return { x: CASCADE.liftX, y: rube.lift.y_m, z: CASCADE.z };
}

export function ropeGeometry(rube: RubeState): {
  length: number;
  tip: { x: number; y: number; z: number };
  pulley: { x: number; y: number; z: number };
  lift: { x: number; y: number; z: number };
} {
  const tip = leverTip(rube);
  const pulley = { x: CASCADE.pulleyX, y: CASCADE.pulleyY, z: CASCADE.z };
  const lift = { x: CASCADE.liftX, y: rube.lift.y_m + 0.34, z: CASCADE.z };
  const a = Math.hypot(pulley.x - tip.x, pulley.y - tip.y);
  const b = Math.hypot(lift.x - pulley.x, lift.y - pulley.y);
  return { length: a + b, tip, pulley, lift };
}

export function createRubeState(): RubeState {
  const base: RubeState = {
    lever: {
      angle_rad: 0,
      omega_radps: 0,
      mass_kg: CASCADE.leverMassKg,
      inertia_kgm2: (CASCADE.leverMassKg * sq(CASCADE.leverLengthM)) / 12,
      net_torque_nm: 0,
      latch_engaged: true,
      latch_angle_rad: 0,
    },
    ballast: {
      mass_kg: CASCADE.ballastMassKg,
      s_m: -2.7,
      velocity_mps: 0,
    },
    lift: {
      mass_kg: CASCADE.liftMassKg,
      y_m: CASCADE.liftMinY,
      velocity_mps: 0,
    },
    rope: {
      rest_length_m: 0,
      length_m: 0,
      tension_n: 0,
      slack: true,
      rated_tension_n: CASCADE.ropeRatedN,
    },
    energy: {
      kinetic_j: 0,
      potential_j: 0,
      dissipated_j: 0,
    },
    chain: createLinkedCascadeState(),
  };
  const l0 = ropeGeometry(base).length;
  // Small initial slack: the latch, not phantom cable tension, holds the rig at spawn.
  base.rope.rest_length_m = l0 + 0.055;
  base.rope.length_m = l0;
  return base;
}

export function ensureRubeState(world: { rube?: RubeState }): RubeState {
  if (!world.rube) world.rube = createRubeState();
  ensureLinkedCascadeState(world.rube);
  return world.rube;
}

export function pushBallast(rube: RubeState, direction: -1 | 1): string {
  const atEnd = direction > 0 ? rube.ballast.s_m >= CASCADE.ballastMaxM - 0.03 : rube.ballast.s_m <= CASCADE.ballastMinM + 0.03;
  if (atEnd) return direction > 0 ? "Ballast is against the outboard stop." : "Ballast is against the inboard stop.";
  // Player input supplies a bounded impulse; position is never teleported.
  rube.ballast.velocity_mps += (direction * CASCADE.ballastPushImpulseNs) / rube.ballast.mass_kg;
  rube.ballast.velocity_mps = clamp(rube.ballast.velocity_mps, -2.2, 2.2);
  return direction > 0 ? "Ballast shoved outboard. Its moment arm is changing." : "Ballast shoved inboard. Its moment arm is changing.";
}

export function toggleRubeLatch(rube: RubeState): string {
  if (rube.lever.latch_engaged) {
    rube.lever.latch_engaged = false;
    return "Pivot latch released. Gravity, ballast and rope now own the lever.";
  }
  if (Math.abs(rube.lever.omega_radps) > 0.32) {
    return "Latch cannot catch a fast-moving lever. Let the pivot settle first.";
  }
  rube.lever.latch_engaged = true;
  rube.lever.latch_angle_rad = rube.lever.angle_rad;
  rube.lever.omega_radps = 0;
  return "Pivot latch caught at the current angle.";
}

function ropeTension(rube: RubeState, dt: number) {
  const g = ropeGeometry(rube);
  const rate = (g.length - rube.rope.length_m) / Math.max(dt, 1e-6);
  const extension = Math.max(0, g.length - rube.rope.rest_length_m);
  const tension = Math.max(0, CASCADE.ropeStiffnessNpm * extension + CASCADE.ropeDampingNsPm * rate);
  return { ...g, rate, extension, tension };
}

export function stepRubeMechanics(rube: RubeState, dt: number): void {
  ensureLinkedCascadeState(rube);
  const entryContactN = linkedEntryContactForce(rube);
  const a = rube.lever.angle_rad;

  // Ballast is a massive wheeled trolley constrained to the lever axis.
  // Gravity component and rolling resistance determine whether it holds or rolls.
  const normal = rube.ballast.mass_kg * G * Math.max(0.1, Math.cos(a));
  const gravityAlong = -rube.ballast.mass_kg * G * Math.sin(a);
  const staticLimit = CASCADE.sliderMuStatic * normal;
  let sliderForce = gravityAlong;
  if (Math.abs(rube.ballast.velocity_mps) < 0.025 && Math.abs(gravityAlong) <= staticLimit) {
    rube.ballast.velocity_mps = 0;
    sliderForce = 0;
  } else {
    const oppose = Math.sign(Math.abs(rube.ballast.velocity_mps) > 0.01 ? rube.ballast.velocity_mps : gravityAlong);
    sliderForce -= oppose * CASCADE.sliderMuKinetic * normal;
  }
  rube.ballast.velocity_mps += (sliderForce / rube.ballast.mass_kg) * dt;
  const oldSliderV = rube.ballast.velocity_mps;
  rube.ballast.s_m += rube.ballast.velocity_mps * dt;
  if (rube.ballast.s_m <= CASCADE.ballastMinM) {
    rube.ballast.s_m = CASCADE.ballastMinM;
    if (rube.ballast.velocity_mps < 0) rube.ballast.velocity_mps *= -0.12;
  } else if (rube.ballast.s_m >= CASCADE.ballastMaxM) {
    rube.ballast.s_m = CASCADE.ballastMaxM;
    if (rube.ballast.velocity_mps > 0) rube.ballast.velocity_mps *= -0.12;
  }
  rube.energy.dissipated_j += Math.max(0, 0.5 * rube.ballast.mass_kg * (sq(oldSliderV) - sq(rube.ballast.velocity_mps)));

  const ropeBefore = ropeTension(rube, dt);
  const h = CASCADE.leverLengthM * 0.5;
  const rx = h * Math.cos(rube.lever.angle_rad);
  const ry = h * Math.sin(rube.lever.angle_rad);
  const ropeDx = ropeBefore.pulley.x - ropeBefore.tip.x;
  const ropeDy = ropeBefore.pulley.y - ropeBefore.tip.y;
  const ropeD = Math.hypot(ropeDx, ropeDy) || 1;
  const ropeFx = ropeBefore.tension * ropeDx / ropeD;
  const ropeFy = ropeBefore.tension * ropeDy / ropeD;
  const ropeTorque = rx * ropeFy - ry * ropeFx;
  const ballastTorque = -rube.ballast.mass_kg * G * rube.ballast.s_m * Math.cos(rube.lever.angle_rad);
  const dampingTorque = -CASCADE.pivotDampingNms * rube.lever.omega_radps;
  const netTorque = ballastTorque + ropeTorque + dampingTorque;
  rube.lever.net_torque_nm = netTorque;

  if (rube.lever.latch_engaged) {
    rube.lever.angle_rad = rube.lever.latch_angle_rad;
    rube.lever.omega_radps = 0;
  } else {
    // The trolley contributes m*s^2 to the instantaneous rotational inertia.
    const inertia = rube.lever.inertia_kgm2 + rube.ballast.mass_kg * sq(rube.ballast.s_m);
    rube.lever.omega_radps += (netTorque / Math.max(1, inertia)) * dt;
    rube.lever.angle_rad += rube.lever.omega_radps * dt;
    if (rube.lever.angle_rad < CASCADE.angleMinRad) {
      rube.lever.angle_rad = CASCADE.angleMinRad;
      if (rube.lever.omega_radps < 0) rube.lever.omega_radps *= -0.08;
    } else if (rube.lever.angle_rad > CASCADE.angleMaxRad) {
      rube.lever.angle_rad = CASCADE.angleMaxRad;
      if (rube.lever.omega_radps > 0) rube.lever.omega_radps *= -0.08;
    }
  }

  // Re-evaluate routed length after the lever update, then solve the lift's vertical DOF.
  // MC-02 entry contact is reciprocal: the rocker load pushes back on this lift.
  const rope = ropeTension(rube, dt);
  const liftDx = rope.pulley.x - rope.lift.x;
  const liftDy = rope.pulley.y - rope.lift.y;
  const liftD = Math.hypot(liftDx, liftDy) || 1;
  const liftFy = rope.tension * liftDy / liftD;
  const liftForce =
    liftFy -
    rube.lift.mass_kg * G -
    CASCADE.liftDampingNsPm * rube.lift.velocity_mps -
    entryContactN;
  rube.lift.velocity_mps += (liftForce / rube.lift.mass_kg) * dt;
  rube.lift.y_m += rube.lift.velocity_mps * dt;
  if (rube.lift.y_m <= CASCADE.liftMinY) {
    rube.lift.y_m = CASCADE.liftMinY;
    if (rube.lift.velocity_mps < 0) rube.lift.velocity_mps = 0;
  } else if (rube.lift.y_m >= CASCADE.liftMaxY) {
    rube.lift.y_m = CASCADE.liftMaxY;
    if (rube.lift.velocity_mps > 0) rube.lift.velocity_mps = 0;
  }

  const finalRope = ropeGeometry(rube);
  const finalRate = (finalRope.length - rube.rope.length_m) / Math.max(dt, 1e-6);
  const finalExtension = Math.max(0, finalRope.length - rube.rope.rest_length_m);
  rube.rope.length_m = finalRope.length;
  rube.rope.tension_n = Math.max(0, CASCADE.ropeStiffnessNpm * finalExtension + CASCADE.ropeDampingNsPm * finalRate);
  rube.rope.slack = rube.rope.tension_n < 30;

  const inertia = rube.lever.inertia_kgm2 + rube.ballast.mass_kg * sq(rube.ballast.s_m);
  rube.energy.kinetic_j =
    0.5 * inertia * sq(rube.lever.omega_radps) +
    0.5 * rube.ballast.mass_kg * sq(rube.ballast.velocity_mps) +
    0.5 * rube.lift.mass_kg * sq(rube.lift.velocity_mps);
  const bw = ballastWorld(rube);
  rube.energy.potential_j = rube.ballast.mass_kg * G * bw.y + rube.lift.mass_kg * G * rube.lift.y_m;

  stepLinkedCascade(rube, dt, entryContactN);
}

export function rubeFinite(rube: RubeState): boolean {
  return [
    rube.lever.angle_rad,
    rube.lever.omega_radps,
    rube.lever.net_torque_nm,
    rube.ballast.s_m,
    rube.ballast.velocity_mps,
    rube.lift.y_m,
    rube.lift.velocity_mps,
    rube.rope.length_m,
    rube.rope.tension_n,
    rube.energy.kinetic_j,
    rube.energy.potential_j,
  ].every(Number.isFinite) && linkedCascadeFinite(rube);
}
