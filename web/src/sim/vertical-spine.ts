import { G, clamp, type LinkedCascadeState, type MechanicalDofState } from "./types.ts";
import { addGeneralizedForce, mechDof, type GeneralizedForces } from "./mechanical-network.ts";
import { MECH_ID } from "./mechanical-ids.ts";
import { UPPER } from "./upper-cascade.ts";
import {
  applyPressureCrownForces,
  enforcePressureCrownConstraints,
  ensurePressureCrownState,
  pressureCrownFinite,
} from "./pressure-crown.ts";

/** MC-07/08 remain force contributors to the same shared network. */
export const VERTICAL = {
  z: -36.0,
  mc07X: 174.0,
  shaftBaseY: 23.0,
  shaftTravelM: 24.0,
  ascenderMassKg: 26000.0,
  countercarMassKg: 34000.0,
  countercarX: 181.0,
  cableK: 1.2e6,
  cableC: 8.0e4,
  brakeAnchorK: 4.0e6,
  brakeAnchorC: 2.2e5,
  brakeCapacityN: 3.0e5,
  mc06TripY: 22.15,
  mc06TripX: 167.2,
  brakeHandleTravelM: 0.55,
  cradlePivotX: 177.8,
  cradlePivotY: 47.2,
  cradleLengthM: 11.5,
  cradleMassKg: 42000.0,
  cradleCounterMassKg: 45000.0,
  cradleCounterArmM: 5.5,
  cradleMinRad: -0.12,
  cradleMaxRad: 0.72,
  cradleContactQ: 21.8,
  cradleArmM: 1.15,
  mc08PivotX: 190.0,
  mc08PivotY: 50.8,
  ringRadiusM: 8.5,
  ringBaseInertiaKgm2: 7.0e6,
  ringDampingNms: 1.4e5,
  torsionKnmPrad: 1.6e6,
  torsionRestRad: 3.25,
  ringMaxRad: 4.8,
  ballastMassKg: 45000.0,
  ballastMinM: 2.8,
  ballastMaxM: 8.5,
  ballastStartM: 4.0,
  ballastDampingNsPm: 1.2e4,
  latchMaxM: 0.28,
  latchClearM: 0.07,
  latchOverCenterM: 0.045,
  latchReleaseAngleRad: -0.04,
  latchGainMPerRad: 2.4,
  latchK: 1.8e5,
  latchC: 1.2e4,
  latchDetentK: 8.0e4,
  helixMassKg: 30000.0,
  helixTravelM: 18.0,
  helixPitchMPerRad: 4.2,
  helixCouplingK: 5.5e5,
  helixCouplingC: 5.0e4,
} as const;

function addDof(chain: LinkedCascadeState, d: MechanicalDofState): void {
  if (!chain.network.dofs.some((x) => x.id === d.id)) chain.network.dofs.push(d);
}

export function ensureVerticalSpineState(chain: LinkedCascadeState): void {
  addDof(chain, { id: MECH_ID.mc07BrakeHandle, kind: "linear", q: 0, v: 0, inertia_si: 38, damping_si: 260, min_q: 0, max_q: 1, stop_restitution: 0.02 });
  addDof(chain, { id: MECH_ID.mc07Ascender, kind: "linear", q: 0, v: 0, inertia_si: VERTICAL.ascenderMassKg, damping_si: 2200, min_q: 0, max_q: VERTICAL.shaftTravelM, stop_restitution: 0.025 });
  addDof(chain, { id: MECH_ID.mc07Countercar, kind: "linear", q: VERTICAL.shaftTravelM, v: 0, inertia_si: VERTICAL.countercarMassKg, damping_si: 2600, min_q: 0, max_q: VERTICAL.shaftTravelM, stop_restitution: 0.025 });
  addDof(chain, {
    id: MECH_ID.mc07Cradle,
    kind: "rotary",
    q: VERTICAL.cradleMinRad,
    v: 0,
    inertia_si:
      (VERTICAL.cradleMassKg * VERTICAL.cradleLengthM * VERTICAL.cradleLengthM) / 3 +
      VERTICAL.cradleCounterMassKg * VERTICAL.cradleCounterArmM * VERTICAL.cradleCounterArmM,
    damping_si: 3.2e4,
    min_q: VERTICAL.cradleMinRad,
    max_q: VERTICAL.cradleMaxRad,
    stop_restitution: 0.02,
  });
  addDof(chain, { id: MECH_ID.mc08Latch, kind: "linear", q: 0, v: 0, inertia_si: 18, damping_si: 260, min_q: 0, max_q: VERTICAL.latchMaxM, stop_restitution: 0 });
  addDof(chain, { id: MECH_ID.mc08Ring, kind: "rotary", q: 0, v: 0, inertia_si: VERTICAL.ringBaseInertiaKgm2 + VERTICAL.ballastMassKg * VERTICAL.ballastStartM ** 2, damping_si: VERTICAL.ringDampingNms, min_q: 0, max_q: VERTICAL.ringMaxRad, stop_restitution: 0.03 });
  addDof(chain, { id: MECH_ID.mc08Ballast, kind: "linear", q: VERTICAL.ballastStartM, v: 0, inertia_si: VERTICAL.ballastMassKg, damping_si: VERTICAL.ballastDampingNsPm, min_q: VERTICAL.ballastMinM, max_q: VERTICAL.ballastMaxM, stop_restitution: 0.05 });
  addDof(chain, { id: MECH_ID.mc08Helix, kind: "linear", q: 0, v: 0, inertia_si: VERTICAL.helixMassKg, damping_si: 1.8e4, min_q: 0, max_q: VERTICAL.helixTravelM, stop_restitution: 0.03 });

  if (!chain.network.cables.some((c) => c.id === MECH_ID.mc07BalanceCable)) {
    const initialLength = 60 - VERTICAL.shaftTravelM;
    const supportTension = 0.5 * (VERTICAL.ascenderMassKg + VERTICAL.countercarMassKg) * G;
    chain.network.cables.push({
      id: MECH_ID.mc07BalanceCable,
      base_length_m: 60,
      rest_length_m: initialLength - supportTension / VERTICAL.cableK,
      length_m: initialLength,
      stiffness_npm: VERTICAL.cableK,
      damping_ns_pm: VERTICAL.cableC,
      tension_n: supportTension,
      slack: false,
      terms: [
        { dof_id: MECH_ID.mc07Ascender, gradient_m_per_q: -1 },
        { dof_id: MECH_ID.mc07Countercar, gradient_m_per_q: -1 },
      ],
    });
  }
  ensurePressureCrownState(chain);
}

function finiteBrakeFraction(chain: LinkedCascadeState): number {
  return 1 - clamp(mechDof(chain.network, MECH_ID.mc07BrakeHandle).q, 0, 1);
}

export function applyVerticalSpineForces(chain: LinkedCascadeState, forces: GeneralizedForces): void {
  ensureVerticalSpineState(chain);
  const net = chain.network;
  const rotor = mechDof(net, MECH_ID.mc06Rotor);
  const radial = mechDof(net, MECH_ID.mc06Bridge);
  const brake = mechDof(net, MECH_ID.mc07BrakeHandle);
  const asc = mechDof(net, MECH_ID.mc07Ascender);
  const cradle = mechDof(net, MECH_ID.mc07Cradle);
  const latch = mechDof(net, MECH_ID.mc08Latch);
  const ring = mechDof(net, MECH_ID.mc08Ring);
  const ballast = mechDof(net, MECH_ID.mc08Ballast);
  const helix = mechDof(net, MECH_ID.mc08Helix);

  const radius = UPPER.radialBaseRadiusM + radial.q;
  const tipX = UPPER.mc06PivotX + radius * Math.cos(rotor.q);
  const tipY = UPPER.mc06PivotY + radius * Math.sin(rotor.q);
  const xReach = clamp((tipX - VERTICAL.mc06TripX + 1.2) / 1.2, 0, 1);
  const penetration = Math.max(0, tipY - VERTICAL.mc06TripY - VERTICAL.brakeHandleTravelM * brake.q) * xReach;
  if (penetration > 0) {
    const tipVy = radius * Math.cos(rotor.q) * rotor.v + Math.sin(rotor.q) * radial.v;
    const closing = tipVy - VERTICAL.brakeHandleTravelM * brake.v;
    const reaction = Math.min(2.4e5, Math.max(0, 4.0e5 * penetration + 3.5e4 * Math.max(0, closing)));
    addGeneralizedForce(forces, MECH_ID.mc07BrakeHandle, reaction * VERTICAL.brakeHandleTravelM);
    addGeneralizedForce(forces, MECH_ID.mc06Rotor, -reaction * radius * Math.cos(rotor.q));
    addGeneralizedForce(forces, MECH_ID.mc06Bridge, -reaction * Math.sin(rotor.q));
  }
  const detentTarget = brake.q < 0.5 ? 0 : 1;
  addGeneralizedForce(forces, MECH_ID.mc07BrakeHandle, -5200 * (brake.q - detentTarget));

  addGeneralizedForce(forces, MECH_ID.mc07Ascender, -VERTICAL.ascenderMassKg * G);
  addGeneralizedForce(forces, MECH_ID.mc07Countercar, -VERTICAL.countercarMassKg * G);
  const brakeScale = finiteBrakeFraction(chain);
  if (brakeScale > 0.01) {
    const staticImbalanceN = 0.5 * (VERTICAL.countercarMassKg - VERTICAL.ascenderMassKg) * G;
    const anchorCorrection = -VERTICAL.brakeAnchorK * asc.q - VERTICAL.brakeAnchorC * asc.v;
    const ascBrake = clamp(anchorCorrection - staticImbalanceN, -VERTICAL.brakeCapacityN, VERTICAL.brakeCapacityN) * brakeScale;
    addGeneralizedForce(forces, MECH_ID.mc07Ascender, ascBrake);
    addGeneralizedForce(forces, MECH_ID.mc07Countercar, -ascBrake);
  }

  const cradleBoundary = VERTICAL.cradleContactQ + VERTICAL.cradleArmM * Math.sin(cradle.q);
  const cradlePen = Math.max(0, asc.q - cradleBoundary);
  if (cradlePen > 0) {
    const pointV = VERTICAL.cradleArmM * Math.cos(cradle.q) * cradle.v;
    const closing = asc.v - pointV;
    const reaction = Math.min(9.0e5, Math.max(0, 7.0e5 * cradlePen + 7.0e4 * Math.max(0, closing)));
    addGeneralizedForce(forces, MECH_ID.mc07Ascender, -reaction);
    addGeneralizedForce(forces, MECH_ID.mc07Cradle, reaction * VERTICAL.cradleArmM);
  }
  const cradleGravity = -VERTICAL.cradleMassKg * G * (VERTICAL.cradleLengthM * 0.5) * Math.cos(cradle.q);
  const counterbalanceGravity = VERTICAL.cradleCounterMassKg * G * VERTICAL.cradleCounterArmM * Math.cos(cradle.q);
  addGeneralizedForce(forces, MECH_ID.mc07Cradle, cradleGravity + counterbalanceGravity);

  // The cradle pulls a light over-center latch. Once past center, geometry keeps it released.
  const latchTarget = clamp((cradle.q - VERTICAL.latchReleaseAngleRad) * VERTICAL.latchGainMPerRad, 0, VERTICAL.latchMaxM);
  const latchTargetV = cradle.q > VERTICAL.latchReleaseAngleRad ? cradle.v * VERTICAL.latchGainMPerRad : 0;
  const latchForce = VERTICAL.latchK * (latchTarget - latch.q) + VERTICAL.latchC * (latchTargetV - latch.v);
  addGeneralizedForce(forces, MECH_ID.mc08Latch, latchForce);
  if (latchForce > 0) addGeneralizedForce(forces, MECH_ID.mc07Cradle, -latchForce * VERTICAL.latchGainMPerRad);
  const latchDetentTarget = latch.q >= VERTICAL.latchOverCenterM ? VERTICAL.latchMaxM : 0;
  addGeneralizedForce(forces, MECH_ID.mc08Latch, VERTICAL.latchDetentK * (latchDetentTarget - latch.q));

  ring.inertia_si = VERTICAL.ringBaseInertiaKgm2 + VERTICAL.ballastMassKg * ballast.q * ballast.q;
  addGeneralizedForce(forces, MECH_ID.mc08Ring,
    VERTICAL.torsionKnmPrad * (VERTICAL.torsionRestRad - ring.q) -
    VERTICAL.ballastMassKg * G * ballast.q * Math.cos(ring.q));
  addGeneralizedForce(forces, MECH_ID.mc08Ballast, -VERTICAL.ballastMassKg * G * Math.sin(ring.q));

  const helixTarget = clamp(VERTICAL.helixPitchMPerRad * ring.q, 0, VERTICAL.helixTravelM);
  const helixTargetV = ring.q > 0 && ring.q < VERTICAL.ringMaxRad ? VERTICAL.helixPitchMPerRad * ring.v : 0;
  const transmission = VERTICAL.helixCouplingK * (helixTarget - helix.q) + VERTICAL.helixCouplingC * (helixTargetV - helix.v);
  addGeneralizedForce(forces, MECH_ID.mc08Helix, transmission - VERTICAL.helixMassKg * G);
  addGeneralizedForce(forces, MECH_ID.mc08Ring, -transmission * VERTICAL.helixPitchMPerRad);

  applyPressureCrownForces(chain, forces);
}

export function enforceVerticalSpineConstraints(chain: LinkedCascadeState): void {
  ensureVerticalSpineState(chain);
  const latch = mechDof(chain.network, MECH_ID.mc08Latch);
  const ring = mechDof(chain.network, MECH_ID.mc08Ring);
  if (latch.q < VERTICAL.latchClearM && ring.q > 0) {
    ring.q = 0;
    if (ring.v > 0) ring.v = 0;
  }
  enforcePressureCrownConstraints(chain);
}

export function verticalSpineFinite(chain: LinkedCascadeState): boolean {
  ensureVerticalSpineState(chain);
  const ids = [MECH_ID.mc07BrakeHandle, MECH_ID.mc07Ascender, MECH_ID.mc07Countercar, MECH_ID.mc07Cradle, MECH_ID.mc08Latch, MECH_ID.mc08Ring, MECH_ID.mc08Ballast, MECH_ID.mc08Helix];
  return ids.every((id) => {
    const d = mechDof(chain.network, id);
    return Number.isFinite(d.q) && Number.isFinite(d.v) && Number.isFinite(d.inertia_si);
  }) && pressureCrownFinite(chain);
}

export function mc07World(chain: LinkedCascadeState) {
  ensureVerticalSpineState(chain);
  const asc = mechDof(chain.network, MECH_ID.mc07Ascender);
  const counter = mechDof(chain.network, MECH_ID.mc07Countercar);
  const cradle = mechDof(chain.network, MECH_ID.mc07Cradle);
  const brake = mechDof(chain.network, MECH_ID.mc07BrakeHandle);
  return {
    ascender: { x: VERTICAL.mc07X, y: VERTICAL.shaftBaseY + asc.q, z: VERTICAL.z, vy: asc.v, q: asc.q },
    countercar: { x: VERTICAL.countercarX, y: VERTICAL.shaftBaseY + counter.q, z: VERTICAL.z, vy: counter.v, q: counter.q },
    cradle: { x: VERTICAL.cradlePivotX, y: VERTICAL.cradlePivotY, z: VERTICAL.z, angle: cradle.q, omega: cradle.v },
    brakeRelease: brake.q,
  };
}

export function mc08World(chain: LinkedCascadeState) {
  ensureVerticalSpineState(chain);
  const ring = mechDof(chain.network, MECH_ID.mc08Ring);
  const ballast = mechDof(chain.network, MECH_ID.mc08Ballast);
  const helix = mechDof(chain.network, MECH_ID.mc08Helix);
  const latch = mechDof(chain.network, MECH_ID.mc08Latch);
  return {
    ring: { x: VERTICAL.mc08PivotX, y: VERTICAL.mc08PivotY, z: VERTICAL.z, angle: ring.q, omega: ring.v },
    ballastRadius: ballast.q,
    ballastVelocity: ballast.v,
    helixY: VERTICAL.mc08PivotY + helix.q,
    helixVy: helix.v,
    latch: latch.q,
  };
}
