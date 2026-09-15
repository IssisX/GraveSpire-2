import { G, clamp, type LinkedCascadeState, type MechanicalDofState } from "./types.ts";
import { addGeneralizedForce, mechDof, type GeneralizedForces } from "./mechanical-network.ts";
import { MECH_ID } from "./mechanical-ids.ts";

/**
 * MC-09/10 continue the same shared generalized-coordinate network.
 * MC-09 adds pressure-volume work; MC-10 adds rotational inertia, centrifugal
 * governor motion and a mechanically linked traversable bridge.
 */
export const PRESSURE_CROWN = {
  z: -36.0,

  // MC-09 — hydro-pneumatic ram.
  ramX: 208.0,
  ramBaseY: 69.0,
  ramTravelM: 22.0,
  ramMassKg: 80000.0,
  pistonAreaM2: 0.16,
  gasVolume0M3: 18.0,
  gasPressure0Pa: 7.0e6,
  gasGamma: 1.4,
  ramDampingNsPm: 1.5e4,
  valveTravelM: 0.28,
  valveClearM: 0.11,
  valveFollowerGain: 0.34,
  valveFollowerStartM: 16.6,
  valveK: 1.2e5,
  valveC: 7.0e3,

  // MC-10 — centrifugal crown.
  crownX: 229.0,
  crownY: 91.0,
  flywheelBaseInertiaKgm2: 1.0e7,
  flywheelDampingNms: 1.1e5,
  flywheelMaxRad: 9.0,
  rackEngageM: 17.4,
  rackRatioRadPerM: 1.85,
  rackKnmPrad: 2.8e6,
  rackCnmSPrad: 2.0e5,
  governorCount: 4,
  governorMassEachKg: 4200.0,
  governorBaseRadiusM: 3.1,
  governorTravelM: 2.5,
  governorSpringK: 1.9e5,
  governorDampingNsPm: 1.4e4,
  bridgeMassKg: 22000.0,
  bridgeTravelM: 16.0,
  bridgeThresholdM: 0.32,
  bridgeGain: 7.2,
  bridgeLinkK: 4.2e5,
  bridgeLinkC: 3.8e4,
} as const;

function addDof(chain: LinkedCascadeState, d: MechanicalDofState): void {
  if (!chain.network.dofs.some((x) => x.id === d.id)) chain.network.dofs.push(d);
}

export function ensurePressureCrownState(chain: LinkedCascadeState): void {
  addDof(chain, {
    id: MECH_ID.mc09Valve,
    kind: "linear",
    q: 0,
    v: 0,
    inertia_si: 42,
    damping_si: 420,
    min_q: 0,
    max_q: PRESSURE_CROWN.valveTravelM,
    stop_restitution: 0,
  });
  addDof(chain, {
    id: MECH_ID.mc09Ram,
    kind: "linear",
    q: 0,
    v: 0,
    inertia_si: PRESSURE_CROWN.ramMassKg,
    damping_si: PRESSURE_CROWN.ramDampingNsPm,
    min_q: 0,
    max_q: PRESSURE_CROWN.ramTravelM,
    stop_restitution: 0.015,
  });
  addDof(chain, {
    id: MECH_ID.mc10Flywheel,
    kind: "rotary",
    q: 0,
    v: 0,
    inertia_si:
      PRESSURE_CROWN.flywheelBaseInertiaKgm2 +
      PRESSURE_CROWN.governorCount * PRESSURE_CROWN.governorMassEachKg * PRESSURE_CROWN.governorBaseRadiusM ** 2,
    damping_si: PRESSURE_CROWN.flywheelDampingNms,
    min_q: 0,
    max_q: PRESSURE_CROWN.flywheelMaxRad,
    stop_restitution: 0.02,
  });
  addDof(chain, {
    id: MECH_ID.mc10Governor,
    kind: "linear",
    q: 0,
    v: 0,
    inertia_si: PRESSURE_CROWN.governorCount * PRESSURE_CROWN.governorMassEachKg,
    damping_si: PRESSURE_CROWN.governorDampingNsPm,
    min_q: 0,
    max_q: PRESSURE_CROWN.governorTravelM,
    stop_restitution: 0.03,
  });
  addDof(chain, {
    id: MECH_ID.mc10Bridge,
    kind: "linear",
    q: 0,
    v: 0,
    inertia_si: PRESSURE_CROWN.bridgeMassKg,
    damping_si: 1.8e4,
    min_q: 0,
    max_q: PRESSURE_CROWN.bridgeTravelM,
    stop_restitution: 0.02,
  });
}

export function gasPressurePa(chain: LinkedCascadeState): number {
  ensurePressureCrownState(chain);
  const ram = mechDof(chain.network, MECH_ID.mc09Ram);
  const volume = PRESSURE_CROWN.gasVolume0M3 + PRESSURE_CROWN.pistonAreaM2 * ram.q;
  return PRESSURE_CROWN.gasPressure0Pa * Math.pow(PRESSURE_CROWN.gasVolume0M3 / volume, PRESSURE_CROWN.gasGamma);
}

/** Force assembly only; the caller still performs the one shared network step. */
export function applyPressureCrownForces(chain: LinkedCascadeState, forces: GeneralizedForces): void {
  ensurePressureCrownState(chain);
  const helix = mechDof(chain.network, MECH_ID.mc08Helix);
  const valve = mechDof(chain.network, MECH_ID.mc09Valve);
  const ram = mechDof(chain.network, MECH_ID.mc09Ram);
  const flywheel = mechDof(chain.network, MECH_ID.mc10Flywheel);
  const governor = mechDof(chain.network, MECH_ID.mc10Governor);
  const bridge = mechDof(chain.network, MECH_ID.mc10Bridge);

  // MC-08 -> MC-09: the arriving helical platform physically strokes the valve.
  const valveTarget = clamp(
    (helix.q - PRESSURE_CROWN.valveFollowerStartM) * PRESSURE_CROWN.valveFollowerGain,
    0,
    PRESSURE_CROWN.valveTravelM,
  );
  const valveTargetV = helix.q > PRESSURE_CROWN.valveFollowerStartM
    ? helix.v * PRESSURE_CROWN.valveFollowerGain
    : 0;
  const valveForce =
    PRESSURE_CROWN.valveK * (valveTarget - valve.q) +
    PRESSURE_CROWN.valveC * (valveTargetV - valve.v);
  addGeneralizedForce(forces, MECH_ID.mc09Valve, valveForce);
  if (valveForce > 0) {
    addGeneralizedForce(forces, MECH_ID.mc08Helix, -valveForce * PRESSURE_CROWN.valveFollowerGain);
  }

  // Pressure-volume work against the 80 t ram. The blocked valve is enforced
  // as a real kinematic restraint after integration, not a fake timer.
  const pressure = gasPressurePa(chain);
  const pressureForce = Math.max(0, pressure - PRESSURE_CROWN.ambientPressurePa) * PRESSURE_CROWN.pistonAreaM2;
  addGeneralizedForce(forces, MECH_ID.mc09Ram, pressureForce - PRESSURE_CROWN.ramMassKg * G);

  // MC-09 -> MC-10: ram-mounted rack spins the same flywheel whose centrifugal
  // state drives the bridge. Equal/opposite rack force loads the ram.
  const rackTarget = clamp(
    (ram.q - PRESSURE_CROWN.rackEngageM) * PRESSURE_CROWN.rackRatioRadPerM,
    0,
    PRESSURE_CROWN.flywheelMaxRad,
  );
  const rackTargetV = ram.q > PRESSURE_CROWN.rackEngageM
    ? ram.v * PRESSURE_CROWN.rackRatioRadPerM
    : 0;
  const rackTorque =
    PRESSURE_CROWN.rackKnmPrad * (rackTarget - flywheel.q) +
    PRESSURE_CROWN.rackCnmSPrad * (rackTargetV - flywheel.v);
  addGeneralizedForce(forces, MECH_ID.mc10Flywheel, rackTorque);
  if (ram.q > PRESSURE_CROWN.rackEngageM && rackTorque > 0) {
    addGeneralizedForce(forces, MECH_ID.mc09Ram, -rackTorque * PRESSURE_CROWN.rackRatioRadPerM);
  }

  // Governor: outward centrifugal demand comes from actual angular velocity.
  const radius = PRESSURE_CROWN.governorBaseRadiusM + governor.q;
  const centrifugal =
    PRESSURE_CROWN.governorCount * PRESSURE_CROWN.governorMassEachKg * radius * flywheel.v * flywheel.v;
  const spring = PRESSURE_CROWN.governorSpringK * governor.q;
  addGeneralizedForce(forces, MECH_ID.mc10Governor, centrifugal - spring);
  flywheel.inertia_si =
    PRESSURE_CROWN.flywheelBaseInertiaKgm2 +
    PRESSURE_CROWN.governorCount * PRESSURE_CROWN.governorMassEachKg * radius * radius;

  // Governor linkage extends the bridge; slowing the rotor lets it retract.
  const bridgeTarget = clamp(
    (governor.q - PRESSURE_CROWN.bridgeThresholdM) * PRESSURE_CROWN.bridgeGain,
    0,
    PRESSURE_CROWN.bridgeTravelM,
  );
  const bridgeTargetV = governor.q > PRESSURE_CROWN.bridgeThresholdM
    ? governor.v * PRESSURE_CROWN.bridgeGain
    : 0;
  const linkForce =
    PRESSURE_CROWN.bridgeLinkK * (bridgeTarget - bridge.q) +
    PRESSURE_CROWN.bridgeLinkC * (bridgeTargetV - bridge.v);
  addGeneralizedForce(forces, MECH_ID.mc10Bridge, linkForce);
  addGeneralizedForce(forces, MECH_ID.mc10Governor, -linkForce * PRESSURE_CROWN.bridgeGain);
}

export function enforcePressureCrownConstraints(chain: LinkedCascadeState): void {
  ensurePressureCrownState(chain);
  const valve = mechDof(chain.network, MECH_ID.mc09Valve);
  const ram = mechDof(chain.network, MECH_ID.mc09Ram);
  if (valve.q < PRESSURE_CROWN.valveClearM && ram.q > 0) {
    ram.q = 0;
    if (ram.v > 0) ram.v = 0;
  }
}

export function pressureCrownFinite(chain: LinkedCascadeState): boolean {
  ensurePressureCrownState(chain);
  const ids = [MECH_ID.mc09Valve, MECH_ID.mc09Ram, MECH_ID.mc10Flywheel, MECH_ID.mc10Governor, MECH_ID.mc10Bridge];
  return ids.every((id) => {
    const d = mechDof(chain.network, id);
    return Number.isFinite(d.q) && Number.isFinite(d.v) && Number.isFinite(d.inertia_si);
  }) && Number.isFinite(gasPressurePa(chain));
}

export function mc09World(chain: LinkedCascadeState) {
  ensurePressureCrownState(chain);
  const ram = mechDof(chain.network, MECH_ID.mc09Ram);
  const valve = mechDof(chain.network, MECH_ID.mc09Valve);
  return {
    ram: { x: PRESSURE_CROWN.ramX, y: PRESSURE_CROWN.ramBaseY + ram.q, z: PRESSURE_CROWN.z, vy: ram.v },
    valve: valve.q,
    pressurePa: gasPressurePa(chain),
  };
}

export function mc10World(chain: LinkedCascadeState) {
  ensurePressureCrownState(chain);
  const flywheel = mechDof(chain.network, MECH_ID.mc10Flywheel);
  const governor = mechDof(chain.network, MECH_ID.mc10Governor);
  const bridge = mechDof(chain.network, MECH_ID.mc10Bridge);
  return {
    flywheel: { angle: flywheel.q, omega: flywheel.v },
    governorRadius: PRESSURE_CROWN.governorBaseRadiusM + governor.q,
    governorTravel: governor.q,
    bridgeTravel: bridge.q,
    bridgeVelocity: bridge.v,
  };
}
