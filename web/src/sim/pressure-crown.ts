import { G, clamp, type LinkedCascadeState, type MechanicalDofState } from "./types.ts";
import {
  addGeneralizedForce,
  mechDof,
  oneWayClutchTorque,
  retainOverCenter,
  type GeneralizedForces,
} from "./mechanical-network.ts";
import { MECH_ID } from "./mechanical-ids.ts";
import {
  applySkySpineForces,
  enforceSkySpineConstraints,
  ensureSkySpineState,
  skySpineFinite,
} from "./sky-spine.ts";

export const PRESSURE_CROWN = {
  z: -36.0,
  ramX: 208.0,
  ramBaseY: 69.0,
  ramTravelM: 22.0,
  ramMassKg: 80000.0,
  pistonAreaM2: 0.22,
  gasVolume0M3: 18.0,
  gasPressure0Pa: 7.0e6,
  ambientPressurePa: 101325.0,
  gasGamma: 1.4,
  ramDampingNsPm: 1.5e4,
  valveTravelM: 0.28,
  valveClearM: 0.045,
  valveOverCenterM: 0.012,
  valveFollowerGain: 0.65,
  valveFollowerStartM: 14.2,
  valveK: 2.4e5,
  valveC: 1.2e4,
  valveDetentK: 1.2e5,
  crownX: 229.0,
  crownY: 91.0,
  // The ram only has a finite 2.4 m powered rack stroke. This inertia keeps
  // its stored work large and dangerous, while still letting that real stroke
  // spin the governor enough to deploy the bridge.
  flywheelBaseInertiaKgm2: 5.0e5,
  flywheelDampingNms: 2.0e4,
  rackEngageM: 16.8,
  rackRatioRadPerM: 1.20,
  rackClutchNms: 3.4e6,
  rackMaxTorqueNm: 8.0e6,
  rackEfficiency: 0.84,
  governorCount: 4,
  governorMassEachKg: 4200.0,
  governorBaseRadiusM: 3.1,
  governorTravelM: 2.5,
  governorSpringK: 1.35e5,
  governorDampingNsPm: 1.4e4,
  bridgeMassKg: 22000.0,
  bridgeTravelM: 16.0,
  bridgeThresholdM: 0.14,
  bridgeGain: 12.0,
  bridgeLinkK: 2.2e5,
  bridgeLinkC: 2.0e4,
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
    inertia_si: 14,
    damping_si: 240,
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
    min_q: -1.0e9,
    max_q: 1.0e9,
    stop_restitution: 0,
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
  ensureSkySpineState(chain);
}

export function gasPressurePa(chain: LinkedCascadeState): number {
  ensurePressureCrownState(chain);
  const ram = mechDof(chain.network, MECH_ID.mc09Ram);
  const volume = PRESSURE_CROWN.gasVolume0M3 + PRESSURE_CROWN.pistonAreaM2 * ram.q;
  return PRESSURE_CROWN.gasPressure0Pa * Math.pow(PRESSURE_CROWN.gasVolume0M3 / volume, PRESSURE_CROWN.gasGamma);
}

export function applyPressureCrownForces(chain: LinkedCascadeState, forces: GeneralizedForces): void {
  ensurePressureCrownState(chain);
  const helix = mechDof(chain.network, MECH_ID.mc08Helix);
  const valve = mechDof(chain.network, MECH_ID.mc09Valve);
  const ram = mechDof(chain.network, MECH_ID.mc09Ram);
  const flywheel = mechDof(chain.network, MECH_ID.mc10Flywheel);
  const governor = mechDof(chain.network, MECH_ID.mc10Governor);
  const bridge = mechDof(chain.network, MECH_ID.mc10Bridge);

  // Persist the physical topology before force assembly. This matters both for
  // saved/loading states and for an already-open valve: it must not receive one
  // unconstrained spring step that erases its real over-center crossing.
  retainOverCenter(valve, PRESSURE_CROWN.valveOverCenterM, PRESSURE_CROWN.valveClearM);

  const valveTarget = clamp(
    (helix.q - PRESSURE_CROWN.valveFollowerStartM) * PRESSURE_CROWN.valveFollowerGain,
    0,
    PRESSURE_CROWN.valveTravelM,
  );
  const valveTargetV = helix.q > PRESSURE_CROWN.valveFollowerStartM ? helix.v * PRESSURE_CROWN.valveFollowerGain : 0;
  const valveForce = PRESSURE_CROWN.valveK * (valveTarget - valve.q) + PRESSURE_CROWN.valveC * (valveTargetV - valve.v);
  addGeneralizedForce(forces, MECH_ID.mc09Valve, valveForce);
  if (valveForce > 0) addGeneralizedForce(forces, MECH_ID.mc08Helix, -valveForce * PRESSURE_CROWN.valveFollowerGain);

  // The spring only biases the follower. Permanent retention is handled by the
  // generic over-center topology after actual crossing of the cam point.
  const detentTarget = valve.q >= PRESSURE_CROWN.valveOverCenterM ? PRESSURE_CROWN.valveTravelM : 0;
  addGeneralizedForce(forces, MECH_ID.mc09Valve, PRESSURE_CROWN.valveDetentK * (detentTarget - valve.q));

  const pressure = gasPressurePa(chain);
  const pressureForce = Math.max(0, pressure - PRESSURE_CROWN.ambientPressurePa) * PRESSURE_CROWN.pistonAreaM2;
  const gravityForce = PRESSURE_CROWN.ramMassKg * G;
  addGeneralizedForce(forces, MECH_ID.mc09Ram, pressureForce - gravityForce);

  // Energy-consistent one-way rack clutch. The flywheel can only receive torque
  // the pressure ram can supply after gravity/damping, so the clutch no longer
  // produces a numerically huge reaction that instantaneously reverses the ram.
  if (ram.q > PRESSURE_CROWN.rackEngageM && ram.v > 0) {
    const availableInputForce = Math.max(
      0,
      (pressureForce - gravityForce - PRESSURE_CROWN.ramDampingNsPm * Math.max(0, ram.v)) * PRESSURE_CROWN.rackEfficiency,
    );
    const rackTorque = oneWayClutchTorque({
      inputVelocity: ram.v,
      outputVelocity: flywheel.v,
      ratioOutputPerInput: PRESSURE_CROWN.rackRatioRadPerM,
      couplingNms: PRESSURE_CROWN.rackClutchNms,
      maxTorqueNm: PRESSURE_CROWN.rackMaxTorqueNm,
      maxInputForceN: availableInputForce,
    });
    if (rackTorque > 0) {
      addGeneralizedForce(forces, MECH_ID.mc10Flywheel, rackTorque);
      addGeneralizedForce(forces, MECH_ID.mc09Ram, -rackTorque * PRESSURE_CROWN.rackRatioRadPerM);
    }
  }

  const radius = PRESSURE_CROWN.governorBaseRadiusM + governor.q;
  const centrifugal = PRESSURE_CROWN.governorCount * PRESSURE_CROWN.governorMassEachKg * radius * flywheel.v * flywheel.v;
  addGeneralizedForce(forces, MECH_ID.mc10Governor, centrifugal - PRESSURE_CROWN.governorSpringK * governor.q);
  flywheel.inertia_si = PRESSURE_CROWN.flywheelBaseInertiaKgm2 + PRESSURE_CROWN.governorCount * PRESSURE_CROWN.governorMassEachKg * radius * radius;

  const bridgeTarget = clamp((governor.q - PRESSURE_CROWN.bridgeThresholdM) * PRESSURE_CROWN.bridgeGain, 0, PRESSURE_CROWN.bridgeTravelM);
  const bridgeTargetV = governor.q > PRESSURE_CROWN.bridgeThresholdM ? governor.v * PRESSURE_CROWN.bridgeGain : 0;
  const linkForce = PRESSURE_CROWN.bridgeLinkK * (bridgeTarget - bridge.q) + PRESSURE_CROWN.bridgeLinkC * (bridgeTargetV - bridge.v);
  addGeneralizedForce(forces, MECH_ID.mc10Bridge, linkForce);
  addGeneralizedForce(forces, MECH_ID.mc10Governor, -linkForce * PRESSURE_CROWN.bridgeGain);

  applySkySpineForces(chain, forces);
}

export function enforcePressureCrownConstraints(chain: LinkedCascadeState): void {
  ensurePressureCrownState(chain);
  const valve = mechDof(chain.network, MECH_ID.mc09Valve);
  const ram = mechDof(chain.network, MECH_ID.mc09Ram);
  retainOverCenter(valve, PRESSURE_CROWN.valveOverCenterM, PRESSURE_CROWN.valveClearM);
  if (valve.q < PRESSURE_CROWN.valveClearM && ram.q > 0) {
    ram.q = 0;
    if (ram.v > 0) ram.v = 0;
  }
  enforceSkySpineConstraints(chain);
}

export function pressureCrownFinite(chain: LinkedCascadeState): boolean {
  ensurePressureCrownState(chain);
  const ids = [MECH_ID.mc09Valve, MECH_ID.mc09Ram, MECH_ID.mc10Flywheel, MECH_ID.mc10Governor, MECH_ID.mc10Bridge];
  return ids.every((id) => {
    const d = mechDof(chain.network, id);
    return Number.isFinite(d.q) && Number.isFinite(d.v) && Number.isFinite(d.inertia_si);
  }) && Number.isFinite(gasPressurePa(chain)) && skySpineFinite(chain);
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
