import { G, clamp, type RubeState } from "./types.ts";
import {
  createLinkedCascadeState,
  ensureLinkedCascadeState,
  linkedCascadeFinite,
  stepLinkedCascade,
  toggleTransferBrake,
} from "./linked-cascade.ts";
import {
  addGeneralizedForce,
  mechCable,
  mechDof,
  type GeneralizedForces,
} from "./mechanical-network.ts";
import { MECH_ID } from "./mechanical-ids.ts";
import {
  ZERO_UPPER_CONTROLS,
  applyUpperCascadeForces,
  captureUpperStep,
  enforceUpperCascadeConstraints,
  ensureUpperCascadeState,
  upperCascadeFinite,
  type UpperControls,
} from "./upper-cascade.ts";
import {
  applyCompositionBodyForces,
  compositionBodiesFinite,
  enforceCompositionBodyContacts,
  ensureCompositionBodies,
} from "./composition-bodies.ts";

export { toggleTransferBrake } from "./linked-cascade.ts";

/**
 * MC-01 geometry/parameters. Dynamic truth is NOT stored here or in the legacy
 * rube.lever/ballast/lift/rope snapshots. MC-01 onward lives in the same
 * MechanicalNetworkState under rube.chain.network.
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
  sliderMuStatic: 0.035,
  sliderMuKinetic: 0.025,
  ballastPushImpulseNs: 1.8e3,
} as const;

function sq(v: number): number {
  return v * v;
}

function leverBaseInertia(): number {
  return (CASCADE.leverMassKg * sq(CASCADE.leverLengthM)) / 12;
}

function addDofIfMissing(rube: RubeState, id: string, dof: Parameters<ReturnType<typeof ensureLinkedCascadeState>["network"]["dofs"]["push"]>[0]): void {
  const net = ensureLinkedCascadeState(rube).network;
  if (!net.dofs.some((d) => d.id === id)) net.dofs.push(dof);
}

function geometryFromAuthority(rube: RubeState) {
  const net = ensureLinkedCascadeState(rube).network;
  const lever = mechDof(net, MECH_ID.mc01Lever);
  const lift = mechDof(net, MECH_ID.mc01Lift);
  const h = CASCADE.leverLengthM * 0.5;
  const a = lever.q;
  const tip = {
    x: CASCADE.pivotX + h * Math.cos(a),
    y: CASCADE.pivotY + h * Math.sin(a),
    z: CASCADE.z,
  };
  const pulley = { x: CASCADE.pulleyX, y: CASCADE.pulleyY, z: CASCADE.z };
  const liftAnchor = { x: CASCADE.liftX, y: lift.q + 0.34, z: CASCADE.z };

  const dxA = tip.x - pulley.x;
  const dyA = tip.y - pulley.y;
  const lenA = Math.hypot(dxA, dyA) || 1e-6;
  const dTipX = -h * Math.sin(a);
  const dTipY = h * Math.cos(a);
  const dLenDLever = (dxA * dTipX + dyA * dTipY) / lenA;

  const dxB = liftAnchor.x - pulley.x;
  const dyB = liftAnchor.y - pulley.y;
  const lenB = Math.hypot(dxB, dyB) || 1e-6;
  const dLenDLift = dyB / lenB;

  return {
    length: lenA + lenB,
    dLenDLever,
    dLenDLift,
    tip,
    pulley,
    lift: liftAnchor,
  };
}

/**
 * One-time migration for pre-unification saves. If the shared DOFs already
 * exist, legacy snapshots are ignored. They never push state back into the solver.
 */
export function ensureMc01Network(rube: RubeState): void {
  const chain = ensureLinkedCascadeState(rube);
  const net = chain.network;

  addDofIfMissing(rube, MECH_ID.mc01Lever, {
    id: MECH_ID.mc01Lever,
    kind: "rotary",
    q: rube.lever?.angle_rad ?? 0,
    v: rube.lever?.omega_radps ?? 0,
    inertia_si: leverBaseInertia(),
    damping_si: CASCADE.pivotDampingNms,
    min_q: CASCADE.angleMinRad,
    max_q: CASCADE.angleMaxRad,
    stop_restitution: 0.08,
  });
  addDofIfMissing(rube, MECH_ID.mc01Ballast, {
    id: MECH_ID.mc01Ballast,
    kind: "linear",
    q: rube.ballast?.s_m ?? -2.7,
    v: rube.ballast?.velocity_mps ?? 0,
    inertia_si: CASCADE.ballastMassKg,
    damping_si: 0,
    min_q: CASCADE.ballastMinM,
    max_q: CASCADE.ballastMaxM,
    stop_restitution: 0.12,
  });
  addDofIfMissing(rube, MECH_ID.mc01Lift, {
    id: MECH_ID.mc01Lift,
    kind: "linear",
    q: rube.lift?.y_m ?? CASCADE.liftMinY,
    v: rube.lift?.velocity_mps ?? 0,
    inertia_si: CASCADE.liftMassKg,
    damping_si: CASCADE.liftDampingNsPm,
    min_q: CASCADE.liftMinY,
    max_q: CASCADE.liftMaxY,
    stop_restitution: 0,
  });

  if (!net.cables.some((c) => c.id === MECH_ID.mc01Rope)) {
    const g = geometryFromAuthority(rube);
    const rest = rube.rope?.rest_length_m && rube.rope.rest_length_m > 0
      ? rube.rope.rest_length_m
      : g.length + 0.055;
    const lever = mechDof(net, MECH_ID.mc01Lever);
    const lift = mechDof(net, MECH_ID.mc01Lift);
    net.cables.push({
      id: MECH_ID.mc01Rope,
      base_length_m: g.length - g.dLenDLever * lever.q - g.dLenDLift * lift.q,
      rest_length_m: rest,
      length_m: g.length,
      stiffness_npm: CASCADE.ropeStiffnessNpm,
      damping_ns_pm: CASCADE.ropeDampingNsPm,
      tension_n: 0,
      slack: true,
      terms: [
        { dof_id: MECH_ID.mc01Lever, gradient_m_per_q: g.dLenDLever },
        { dof_id: MECH_ID.mc01Lift, gradient_m_per_q: g.dLenDLift },
      ],
    });
  }
  updateMc01CableGeometry(rube);
  ensureUpperCascadeState(chain);
  ensureCompositionBodies(chain);
}

function updateMc01CableGeometry(rube: RubeState): void {
  const net = ensureLinkedCascadeState(rube).network;
  if (!net.dofs.some((d) => d.id === MECH_ID.mc01Lever)) return;
  const cable = net.cables.find((c) => c.id === MECH_ID.mc01Rope);
  if (!cable) return;
  const g = geometryFromAuthority(rube);
  const lever = mechDof(net, MECH_ID.mc01Lever);
  const lift = mechDof(net, MECH_ID.mc01Lift);
  cable.terms = [
    { dof_id: MECH_ID.mc01Lever, gradient_m_per_q: g.dLenDLever },
    { dof_id: MECH_ID.mc01Lift, gradient_m_per_q: g.dLenDLift },
  ];
  cable.base_length_m = g.length - g.dLenDLever * lever.q - g.dLenDLift * lift.q;
  cable.length_m = g.length;
}

function syncLegacyProjection(rube: RubeState, solvedForces: GeneralizedForces = {}): void {
  ensureMc01Network(rube);
  const net = ensureLinkedCascadeState(rube).network;
  const lever = mechDof(net, MECH_ID.mc01Lever);
  const ballast = mechDof(net, MECH_ID.mc01Ballast);
  const lift = mechDof(net, MECH_ID.mc01Lift);
  const rope = mechCable(net, MECH_ID.mc01Rope);

  rube.lever.angle_rad = lever.q;
  rube.lever.omega_radps = lever.v;
  rube.lever.mass_kg = CASCADE.leverMassKg;
  rube.lever.inertia_kgm2 = leverBaseInertia();
  rube.lever.net_torque_nm = solvedForces[MECH_ID.mc01Lever] ?? rube.lever.net_torque_nm ?? 0;
  rube.ballast.mass_kg = CASCADE.ballastMassKg;
  rube.ballast.s_m = ballast.q;
  rube.ballast.velocity_mps = ballast.v;
  rube.lift.mass_kg = CASCADE.liftMassKg;
  rube.lift.y_m = lift.q;
  rube.lift.velocity_mps = lift.v;
  rube.rope.rest_length_m = rope.rest_length_m;
  rube.rope.length_m = rope.length_m;
  rube.rope.tension_n = rope.tension_n;
  rube.rope.slack = rope.slack;
  rube.rope.rated_tension_n = CASCADE.ropeRatedN;

  const effectiveI = leverBaseInertia() + CASCADE.ballastMassKg * sq(ballast.q);
  rube.energy.kinetic_j =
    0.5 * effectiveI * sq(lever.v) +
    0.5 * CASCADE.ballastMassKg * sq(ballast.v) +
    0.5 * CASCADE.liftMassKg * sq(lift.v);
  const bw = ballastWorld(rube);
  rube.energy.potential_j = CASCADE.ballastMassKg * G * bw.y + CASCADE.liftMassKg * G * lift.q;
  rube.energy.dissipated_j = net.dissipated_j;
}

export function leverTip(rube: RubeState): { x: number; y: number; z: number } {
  ensureMc01Network(rube);
  return geometryFromAuthority(rube).tip;
}

export function ballastWorld(rube: RubeState): { x: number; y: number; z: number } {
  ensureMc01Network(rube);
  const net = ensureLinkedCascadeState(rube).network;
  const lever = mechDof(net, MECH_ID.mc01Lever);
  const ballast = mechDof(net, MECH_ID.mc01Ballast);
  return {
    x: CASCADE.pivotX + ballast.q * Math.cos(lever.q),
    y: CASCADE.pivotY + ballast.q * Math.sin(lever.q) + 0.42,
    z: CASCADE.z,
  };
}

export function liftWorld(rube: RubeState): { x: number; y: number; z: number } {
  ensureMc01Network(rube);
  const lift = mechDof(ensureLinkedCascadeState(rube).network, MECH_ID.mc01Lift);
  return { x: CASCADE.liftX, y: lift.q, z: CASCADE.z };
}

export function ropeGeometry(rube: RubeState) {
  ensureMc01Network(rube);
  const g = geometryFromAuthority(rube);
  return { length: g.length, tip: g.tip, pulley: g.pulley, lift: g.lift };
}

export function createRubeState(): RubeState {
  const base: RubeState = {
    lever: {
      angle_rad: 0,
      omega_radps: 0,
      mass_kg: CASCADE.leverMassKg,
      inertia_kgm2: leverBaseInertia(),
      net_torque_nm: 0,
      latch_engaged: true,
      latch_angle_rad: 0,
    },
    ballast: { mass_kg: CASCADE.ballastMassKg, s_m: -2.7, velocity_mps: 0 },
    lift: { mass_kg: CASCADE.liftMassKg, y_m: CASCADE.liftMinY, velocity_mps: 0 },
    rope: {
      rest_length_m: 0,
      length_m: 0,
      tension_n: 0,
      slack: true,
      rated_tension_n: CASCADE.ropeRatedN,
    },
    energy: { kinetic_j: 0, potential_j: 0, dissipated_j: 0 },
    chain: createLinkedCascadeState(),
  };
  ensureMc01Network(base);
  syncLegacyProjection(base);
  return base;
}

export function ensureRubeState(world: { rube?: RubeState }): RubeState {
  if (!world.rube) world.rube = createRubeState();
  ensureLinkedCascadeState(world.rube);
  ensureMc01Network(world.rube);
  syncLegacyProjection(world.rube);
  return world.rube;
}

export function pushBallast(rube: RubeState, direction: -1 | 1): string {
  ensureMc01Network(rube);
  const ballast = mechDof(ensureLinkedCascadeState(rube).network, MECH_ID.mc01Ballast);
  const atEnd = direction > 0
    ? ballast.q >= CASCADE.ballastMaxM - 0.03
    : ballast.q <= CASCADE.ballastMinM + 0.03;
  if (atEnd) return direction > 0 ? "Ballast is against the outboard stop." : "Ballast is against the inboard stop.";
  ballast.v += (direction * CASCADE.ballastPushImpulseNs) / CASCADE.ballastMassKg;
  ballast.v = clamp(ballast.v, -2.2, 2.2);
  syncLegacyProjection(rube);
  return direction > 0
    ? "Ballast shoved outboard. Its moment arm is changing."
    : "Ballast shoved inboard. Its moment arm is changing.";
}

export function toggleRubeLatch(rube: RubeState): string {
  ensureMc01Network(rube);
  const lever = mechDof(ensureLinkedCascadeState(rube).network, MECH_ID.mc01Lever);
  if (rube.lever.latch_engaged) {
    rube.lever.latch_engaged = false;
    return "Pivot latch released. Gravity, ballast and rope now own the lever.";
  }
  if (Math.abs(lever.v) > 0.32) {
    return "Latch cannot catch a fast-moving lever. Let the pivot settle first.";
  }
  rube.lever.latch_engaged = true;
  rube.lever.latch_angle_rad = lever.q;
  lever.v = 0;
  syncLegacyProjection(rube);
  return "Pivot latch caught at the current angle.";
}

function applyMc01Forces(rube: RubeState, forces: GeneralizedForces): void {
  ensureMc01Network(rube);
  updateMc01CableGeometry(rube);
  const net = ensureLinkedCascadeState(rube).network;
  const lever = mechDof(net, MECH_ID.mc01Lever);
  const ballast = mechDof(net, MECH_ID.mc01Ballast);
  const lift = mechDof(net, MECH_ID.mc01Lift);
  lever.inertia_si = leverBaseInertia() + CASCADE.ballastMassKg * sq(ballast.q);
  const normal = CASCADE.ballastMassKg * G * Math.max(0.1, Math.cos(lever.q));
  const gravityAlong = -CASCADE.ballastMassKg * G * Math.sin(lever.q);
  const staticLimit = CASCADE.sliderMuStatic * normal;
  let sliderForce = gravityAlong;
  if (Math.abs(ballast.v) < 0.025 && Math.abs(gravityAlong) <= staticLimit) {
    ballast.v = 0;
    sliderForce = 0;
  } else {
    const oppose = Math.sign(Math.abs(ballast.v) > 0.01 ? ballast.v : gravityAlong);
    sliderForce -= oppose * CASCADE.sliderMuKinetic * normal;
  }
  addGeneralizedForce(forces, MECH_ID.mc01Ballast, sliderForce);
  addGeneralizedForce(forces, MECH_ID.mc01Lever, -CASCADE.ballastMassKg * G * ballast.q * Math.cos(lever.q));
  addGeneralizedForce(forces, MECH_ID.mc01Lift, -CASCADE.liftMassKg * G);
  void lift;
}

export function stepRubeMechanics(
  rube: RubeState,
  dt: number,
  upperControls: UpperControls = ZERO_UPPER_CONTROLS,
): void {
  ensureMc01Network(rube);
  const chain = ensureLinkedCascadeState(rube);
  const external: GeneralizedForces = {};
  applyMc01Forces(rube, external);
  const beforeUpper = captureUpperStep(chain);
  applyUpperCascadeForces(rube, upperControls, external);
  applyCompositionBodyForces(chain, external);
  const solved = stepLinkedCascade(rube, dt, external);
  enforceUpperCascadeConstraints(rube, beforeUpper);
  enforceCompositionBodyContacts(chain);
  updateMc01CableGeometry(rube);
  syncLegacyProjection(rube, solved);
}

export function rubeFinite(rube: RubeState): boolean {
  ensureMc01Network(rube);
  syncLegacyProjection(rube);
  const chain = ensureLinkedCascadeState(rube);
  return linkedCascadeFinite(rube) && upperCascadeFinite(rube) && compositionBodiesFinite(chain) && [
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
  ].every(Number.isFinite);
}
