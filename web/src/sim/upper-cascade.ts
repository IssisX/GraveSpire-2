import { G, clamp, type LinkedCascadeState, type MechanicalDofState, type RubeState } from "./types.ts";
import { addGeneralizedForce, mechCable, mechDof, type GeneralizedForces } from "./mechanical-network.ts";
import { MECH_ID } from "./mechanical-ids.ts";

export const UPPER = {
  z: -36.0,

  // MC-05 — Bascule Exchange.
  mc05PivotX: 118.0,
  mc05PivotY: 10.36,
  basculeLengthM: 26.0,
  basculeMassKg: 52000.0,
  basculeComM: 10.0,
  basculeInitialRad: 1.05,
  basculeMinRad: -0.25,
  ballastMassKg: 65000.0,
  ballastMinM: -8.0,
  ballastMaxM: 2.5,
  ballastStartM: -7.7,
  ballastDriveForceN: 9.0e5,
  ballastRollingMu: 0.006,
  basculeBrakeCapacityNm: 3.0e6,
  basculeDampingNms: 1.2e5,
  entryRockerArmM: 0.72,
  entryContactQ: 7.45,
  entryPawlClearM: 0.13,
  entryPawlEscapeRad: 0.96,
  tableStartX: 141.0,
  tableTravelM: 8.0,
  tableMassKg: 46000.0,
  tableDriveForceN: 2.4e5,
  tableRollingMu: 0.006,
  tableDampingNsPm: 1.0e4,
  tableHalfLengthM: 4.0,
  basculeTableRatioMPerRad: 6.0,
  basculeTableCableK: 3.0e5,
  basculeTableCableC: 4.0e4,

  // MC-06 — Momentum Rotunda.
  mc06PivotX: 156.0,
  mc06PivotY: 10.36,
  rotorBaseInertiaKgm2: 4.0e6,
  rotorDampingNms: 1.0e5,
  rotorBrakeCapacityNm: 2.6e6,
  radialBridgeMassKg: 18000.0,
  radialBaseRadiusM: 3.0,
  radialMinM: 4.0,
  radialMaxM: 12.0,
  radialStartM: 5.0,
  radialDriveForceN: 1.5e5,
  radialDampingNsPm: 8.0e3,
  dropMassKg: 18000.0,
  dropStartQ: 10.0,
  dropTravelM: 18.0,
  dropTopY: 28.0,
  dropDampingNsPm: 3.0e3,
  drumRadiusM: 1.8,
  rotorCableK: 4.0e5,
  rotorCableC: 4.0e4,
  rackStartM: 5.15,
  rackRadiusM: 3.2,
  rackStiffnessNpm: 6.0e5,
  rackDampingNsPm: 8.0e4,
  mc06BrakeTripStartM: 4.45,
  mc06BrakeTripTravelM: 0.52,
} as const;

export type UpperControls = {
  basculeBallastAxis: number;
  basculeTableAxis: number;
  rotorBridgeAxis: number;
  drivePower: number;
};

export const ZERO_UPPER_CONTROLS: UpperControls = {
  basculeBallastAxis: 0,
  basculeTableAxis: 0,
  rotorBridgeAxis: 0,
  drivePower: 0,
};

export type UpperStepSnapshot = {
  basculeQ: number;
  rotorQ: number;
  shuttleQ: number;
};

function addDof(chain: LinkedCascadeState, dof: MechanicalDofState): void {
  if (!chain.network.dofs.some((d) => d.id === dof.id)) chain.network.dofs.push(dof);
}

function addCable(chain: LinkedCascadeState, cable: LinkedCascadeState["network"]["cables"][number]): void {
  if (!chain.network.cables.some((c) => c.id === cable.id)) chain.network.cables.push(cable);
}

function basculeLeafInertia(): number {
  return (UPPER.basculeMassKg * UPPER.basculeLengthM * UPPER.basculeLengthM) / 3;
}

export function ensureUpperCascadeState(chain: LinkedCascadeState): void {
  addDof(chain, {
    id: MECH_ID.mc05EntryRocker,
    kind: "rotary",
    q: 0,
    v: 0,
    inertia_si: 420,
    damping_si: 520,
    min_q: 0,
    max_q: 0.82,
    stop_restitution: 0,
  });
  addDof(chain, {
    id: MECH_ID.mc05Pawl,
    kind: "linear",
    q: 0,
    v: 0,
    inertia_si: 95,
    damping_si: 700,
    min_q: 0,
    max_q: 0.36,
    stop_restitution: 0,
  });
  addDof(chain, {
    id: MECH_ID.mc05Bascule,
    kind: "rotary",
    q: UPPER.basculeInitialRad,
    v: 0,
    inertia_si: basculeLeafInertia() + UPPER.ballastMassKg * UPPER.ballastStartM * UPPER.ballastStartM,
    damping_si: UPPER.basculeDampingNms,
    min_q: UPPER.basculeMinRad,
    max_q: UPPER.basculeInitialRad,
    stop_restitution: 0.025,
  });
  addDof(chain, {
    id: MECH_ID.mc05Ballast,
    kind: "linear",
    q: UPPER.ballastStartM,
    v: 0,
    inertia_si: UPPER.ballastMassKg,
    damping_si: 1200,
    min_q: UPPER.ballastMinM,
    max_q: UPPER.ballastMaxM,
    stop_restitution: 0.04,
  });
  addDof(chain, {
    id: MECH_ID.mc05Table,
    kind: "linear",
    q: 0,
    v: 0,
    inertia_si: UPPER.tableMassKg,
    damping_si: UPPER.tableDampingNsPm,
    min_q: 0,
    max_q: UPPER.tableTravelM,
    stop_restitution: 0.025,
  });
  addDof(chain, {
    id: MECH_ID.mc05BrakeHandle,
    kind: "linear",
    q: 0,
    v: 0,
    inertia_si: 16,
    damping_si: 110,
    min_q: 0,
    max_q: 1,
    stop_restitution: 0.05,
  });

  addDof(chain, {
    id: MECH_ID.mc06Rotor,
    kind: "rotary",
    q: 0,
    v: 0,
    inertia_si: UPPER.rotorBaseInertiaKgm2,
    damping_si: UPPER.rotorDampingNms,
    min_q: -Math.PI * 6,
    max_q: Math.PI * 6,
    stop_restitution: 0,
  });
  addDof(chain, {
    id: MECH_ID.mc06Bridge,
    kind: "linear",
    q: UPPER.radialStartM,
    v: 0,
    inertia_si: UPPER.radialBridgeMassKg,
    damping_si: UPPER.radialDampingNsPm,
    min_q: UPPER.radialMinM,
    max_q: UPPER.radialMaxM,
    stop_restitution: 0.02,
  });
  addDof(chain, {
    id: MECH_ID.mc06Dropweight,
    kind: "linear",
    q: UPPER.dropStartQ,
    v: 0,
    inertia_si: UPPER.dropMassKg,
    damping_si: UPPER.dropDampingNsPm,
    min_q: 0,
    max_q: UPPER.dropTravelM,
    stop_restitution: 0.02,
  });
  addDof(chain, {
    id: MECH_ID.mc06BrakeHandle,
    kind: "linear",
    q: 0,
    v: 0,
    inertia_si: 18,
    damping_si: 120,
    min_q: 0,
    max_q: 1,
    stop_restitution: 0.05,
  });

  addCable(chain, {
    id: MECH_ID.mc05PawlCable,
    base_length_m: 2.0,
    rest_length_m: 2.0,
    length_m: 2.0,
    stiffness_npm: 9.0e4,
    damping_ns_pm: 1.2e4,
    tension_n: 0,
    slack: true,
    terms: [
      { dof_id: MECH_ID.mc05EntryRocker, gradient_m_per_q: 0.42 },
      { dof_id: MECH_ID.mc05Pawl, gradient_m_per_q: -1 },
    ],
  });

  // One routed haul line couples the bascule angle to the transfer table.
  // The line is not a scripted ratio: tension comes from the shared cable law.
  addCable(chain, {
    id: MECH_ID.mc05TransferCable,
    base_length_m: 20.0 + UPPER.basculeTableRatioMPerRad * UPPER.basculeInitialRad,
    rest_length_m: 20.0,
    length_m: 20.0,
    stiffness_npm: UPPER.basculeTableCableK,
    damping_ns_pm: UPPER.basculeTableCableC,
    tension_n: 0,
    slack: true,
    terms: [
      { dof_id: MECH_ID.mc05Bascule, gradient_m_per_q: -UPPER.basculeTableRatioMPerRad },
      { dof_id: MECH_ID.mc05Table, gradient_m_per_q: -1 },
    ],
  });

  // Rotor positive angle pays out cable; a descending drop weight therefore
  // back-drives positive rotation. Negative rotation winds/lifts the weight.
  const initialLength = 20 + UPPER.dropStartQ;
  const initialExtension = (UPPER.dropMassKg * G) / UPPER.rotorCableK;
  addCable(chain, {
    id: MECH_ID.mc06DriveCable,
    base_length_m: 20,
    rest_length_m: initialLength - initialExtension,
    length_m: initialLength,
    stiffness_npm: UPPER.rotorCableK,
    damping_ns_pm: UPPER.rotorCableC,
    tension_n: UPPER.dropMassKg * G,
    slack: false,
    terms: [
      { dof_id: MECH_ID.mc06Dropweight, gradient_m_per_q: 1 },
      { dof_id: MECH_ID.mc06Rotor, gradient_m_per_q: UPPER.drumRadiusM },
    ],
  });
}

function brakeFraction(chain: LinkedCascadeState, id: string): number {
  return 1 - clamp(mechDof(chain.network, id).q, 0, 1);
}

function applyDetent(chain: LinkedCascadeState, forces: GeneralizedForces, id: string): void {
  const h = mechDof(chain.network, id);
  const target = h.q < 0.5 ? 0 : 1;
  addGeneralizedForce(forces, id, -4200 * (h.q - target));
}

function applyFiniteBrake(
  chain: LinkedCascadeState,
  forces: GeneralizedForces,
  dofId: string,
  handleId: string,
  capacity: number,
  approximateDemand: number,
): void {
  const d = mechDof(chain.network, dofId);
  const cap = capacity * brakeFraction(chain, handleId);
  if (cap <= 1) return;
  const signSource = Math.abs(d.v) > 0.008 ? d.v : approximateDemand;
  if (Math.abs(d.v) < 0.008 && Math.abs(approximateDemand) <= cap) {
    addGeneralizedForce(forces, dofId, -approximateDemand);
    return;
  }
  if (Math.abs(signSource) > 1e-6) addGeneralizedForce(forces, dofId, -Math.sign(signSource) * cap);
}

export function captureUpperStep(chain: LinkedCascadeState): UpperStepSnapshot {
  ensureUpperCascadeState(chain);
  return {
    basculeQ: mechDof(chain.network, MECH_ID.mc05Bascule).q,
    rotorQ: mechDof(chain.network, MECH_ID.mc06Rotor).q,
    shuttleQ: mechDof(chain.network, MECH_ID.springShuttle).q,
  };
}

export function applyUpperCascadeForces(
  rube: RubeState,
  controls: UpperControls,
  forces: GeneralizedForces,
): void {
  if (!rube.chain) return;
  const chain = rube.chain;
  ensureUpperCascadeState(chain);
  const net = chain.network;

  const shuttle = mechDof(net, MECH_ID.springShuttle);
  const entry = mechDof(net, MECH_ID.mc05EntryRocker);
  const bascule = mechDof(net, MECH_ID.mc05Bascule);
  const ballast = mechDof(net, MECH_ID.mc05Ballast);
  const table = mechDof(net, MECH_ID.mc05Table);
  const rotor = mechDof(net, MECH_ID.mc06Rotor);
  const bridge = mechDof(net, MECH_ID.mc06Bridge);
  const drop = mechDof(net, MECH_ID.mc06Dropweight);
  const rotorRope = mechCable(net, MECH_ID.mc06DriveCable);

  // MC-04 -> MC-05: the 12 t shuttle reaches the lower apron and physically
  // bears on a rocker. The reaction is reciprocal inside this same force solve.
  const contactBoundary = UPPER.entryContactQ + UPPER.entryRockerArmM * Math.sin(entry.q);
  const penetration = Math.max(0, shuttle.q - contactBoundary);
  if (penetration > 0) {
    const rockerPointV = UPPER.entryRockerArmM * Math.cos(entry.q) * entry.v;
    const closing = shuttle.v - rockerPointV;
    const reaction = Math.min(1.6e5, Math.max(0, 1.8e5 * penetration + 1.6e4 * Math.max(0, closing)));
    addGeneralizedForce(forces, MECH_ID.springShuttle, -reaction);
    addGeneralizedForce(forces, MECH_ID.mc05EntryRocker, reaction * UPPER.entryRockerArmM);
  }

  // MC-05: a 65 t travelling ballast changes BOTH gravity moment and inertia.
  bascule.inertia_si = basculeLeafInertia() + UPPER.ballastMassKg * ballast.q * ballast.q;
  const leafGravityMoment = -UPPER.basculeMassKg * G * UPPER.basculeComM * Math.cos(bascule.q);
  const ballastGravityMoment = -UPPER.ballastMassKg * G * ballast.q * Math.cos(bascule.q);
  const basculeDemand = leafGravityMoment + ballastGravityMoment;
  addGeneralizedForce(forces, MECH_ID.mc05Bascule, basculeDemand);

  const ballastDrive = clamp(controls.basculeBallastAxis, -1, 1) * UPPER.ballastDriveForceN * clamp(controls.drivePower, 0, 1.1);
  let ballastForce = -UPPER.ballastMassKg * G * Math.sin(bascule.q) + ballastDrive;
  if (Math.abs(ballast.v) > 0.02) {
    ballastForce -= UPPER.ballastRollingMu * UPPER.ballastMassKg * G * Math.sign(ballast.v);
  }
  addGeneralizedForce(forces, MECH_ID.mc05Ballast, ballastForce);

  const tableDrive = clamp(controls.basculeTableAxis, -1, 1) * UPPER.tableDriveForceN * clamp(controls.drivePower, 0, 1.1);
  let tableForce = tableDrive;
  if (Math.abs(table.v) > 0.02) {
    tableForce -= UPPER.tableRollingMu * UPPER.tableMassKg * G * Math.sign(table.v);
  }
  addGeneralizedForce(forces, MECH_ID.mc05Table, tableForce);

  applyDetent(chain, forces, MECH_ID.mc05BrakeHandle);
  applyDetent(chain, forces, MECH_ID.mc06BrakeHandle);
  applyFiniteBrake(chain, forces, MECH_ID.mc05Bascule, MECH_ID.mc05BrakeHandle, UPPER.basculeBrakeCapacityNm, basculeDemand);

  // MC-05 -> MC-06: the arriving transfer table first knocks the fail-safe
  // rotor brake handle open, then its rack contact imparts angular impulse.
  const rotorBrake = mechDof(net, MECH_ID.mc06BrakeHandle);
  if (table.q > UPPER.mc06BrakeTripStartM && table.v > 0.01 && rotorBrake.q < 0.98) {
    const p = table.q - UPPER.mc06BrakeTripStartM - UPPER.mc06BrakeTripTravelM * rotorBrake.q;
    if (p > 0) {
      const closing = table.v - UPPER.mc06BrakeTripTravelM * rotorBrake.v;
      const r = Math.max(0, 3.2e5 * p + 3.5e4 * Math.max(0, closing));
      addGeneralizedForce(forces, MECH_ID.mc05Table, -r);
      addGeneralizedForce(forces, MECH_ID.mc06BrakeHandle, r * UPPER.mc06BrakeTripTravelM);
    }
  }

  // Overrunning rack: only eastward table motion can charge the rotor. The
  // drop weight can later back-drive the rotor without dragging MC-05 backward.
  if (table.q > UPPER.rackStartM && table.v > 0.02) {
    const p = Math.max(0, table.q - UPPER.rackStartM + UPPER.rackRadiusM * rotor.q);
    const closing = table.v + UPPER.rackRadiusM * rotor.v;
    if (p > 0 || closing > 0) {
      const reaction = Math.max(0, UPPER.rackStiffnessNpm * p + UPPER.rackDampingNsPm * Math.max(0, closing));
      addGeneralizedForce(forces, MECH_ID.mc05Table, -reaction);
      addGeneralizedForce(forces, MECH_ID.mc06Rotor, -reaction * UPPER.rackRadiusM);
    }
  }

  // MC-06: drop weight, variable radial bridge inertia, and finite local drive.
  const effectiveRadius = UPPER.radialBaseRadiusM + 0.5 * bridge.q;
  rotor.inertia_si = UPPER.rotorBaseInertiaKgm2 + UPPER.radialBridgeMassKg * effectiveRadius * effectiveRadius;
  addGeneralizedForce(forces, MECH_ID.mc06Dropweight, UPPER.dropMassKg * G);
  addGeneralizedForce(
    forces,
    MECH_ID.mc06Rotor,
    -UPPER.radialBridgeMassKg * G * effectiveRadius * Math.cos(rotor.q),
  );
  addGeneralizedForce(
    forces,
    MECH_ID.mc06Bridge,
    -0.5 * UPPER.radialBridgeMassKg * G * Math.sin(rotor.q) +
      clamp(controls.rotorBridgeAxis, -1, 1) * UPPER.radialDriveForceN * clamp(controls.drivePower, 0, 1.1),
  );

  const rotorDemand =
    -(rotorRope.tension_n * UPPER.drumRadiusM) -
    UPPER.radialBridgeMassKg * G * effectiveRadius * Math.cos(rotor.q);
  applyFiniteBrake(chain, forces, MECH_ID.mc06Rotor, MECH_ID.mc06BrakeHandle, UPPER.rotorBrakeCapacityNm, rotorDemand);

  // Keep the compiler honest about these coordinates being live state.
  void drop;
}

export function enforceUpperCascadeConstraints(
  rube: RubeState,
  before: UpperStepSnapshot,
): void {
  if (!rube.chain) return;
  const chain = rube.chain;
  ensureUpperCascadeState(chain);
  const net = chain.network;
  const pawl = mechDof(net, MECH_ID.mc05Pawl);
  const bascule = mechDof(net, MECH_ID.mc05Bascule);

  // The MC-05 pawl is an ordinary unilateral retaining face. Once the leaf
  // physically escapes the face it cannot be magically re-captured remotely.
  if (
    before.basculeQ > UPPER.entryPawlEscapeRad &&
    pawl.q < UPPER.entryPawlClearM &&
    bascule.q < UPPER.basculeInitialRad
  ) {
    bascule.q = UPPER.basculeInitialRad;
    if (bascule.v < 0) bascule.v = 0;
  }
}

export function toggleUpperBrake(rube: RubeState, which: "mc05" | "mc06"): string {
  if (!rube.chain) return "No upper mechanical authority.";
  const chain = rube.chain;
  ensureUpperCascadeState(chain);
  const id = which === "mc05" ? MECH_ID.mc05BrakeHandle : MECH_ID.mc06BrakeHandle;
  const h = mechDof(chain.network, id);
  const towardRelease = h.q < 0.5;
  h.v += towardRelease ? 5.2 : -5.2;
  h.v = clamp(h.v, -5.2, 5.2);
  return towardRelease
    ? `${which.toUpperCase()} brake handle struck toward RELEASE. Detent and finite brake reaction decide the result.`
    : `${which.toUpperCase()} brake handle struck toward HOLD. Detent and finite brake reaction decide the result.`;
}

export function upperBrakeEngaged(rube: RubeState, which: "mc05" | "mc06"): boolean {
  if (!rube.chain) return true;
  ensureUpperCascadeState(rube.chain);
  const id = which === "mc05" ? MECH_ID.mc05BrakeHandle : MECH_ID.mc06BrakeHandle;
  return mechDof(rube.chain.network, id).q < 0.5;
}

export function upperCascadeFinite(rube: RubeState): boolean {
  if (!rube.chain) return false;
  ensureUpperCascadeState(rube.chain);
  const ids = [
    MECH_ID.mc05EntryRocker,
    MECH_ID.mc05Pawl,
    MECH_ID.mc05Bascule,
    MECH_ID.mc05Ballast,
    MECH_ID.mc05Table,
    MECH_ID.mc05BrakeHandle,
    MECH_ID.mc06Rotor,
    MECH_ID.mc06Bridge,
    MECH_ID.mc06Dropweight,
    MECH_ID.mc06BrakeHandle,
  ];
  return ids.every((id) => {
    const d = mechDof(rube.chain!.network, id);
    return Number.isFinite(d.q) && Number.isFinite(d.v) && Number.isFinite(d.inertia_si);
  });
}

export function mc05BasculeWorld(rube: RubeState) {
  if (!rube.chain) return null;
  ensureUpperCascadeState(rube.chain);
  const d = mechDof(rube.chain.network, MECH_ID.mc05Bascule);
  return { x: UPPER.mc05PivotX, y: UPPER.mc05PivotY, z: UPPER.z, angle: d.q, omega: d.v };
}

export function mc05BallastWorld(rube: RubeState) {
  if (!rube.chain) return null;
  ensureUpperCascadeState(rube.chain);
  const leaf = mechDof(rube.chain.network, MECH_ID.mc05Bascule);
  const b = mechDof(rube.chain.network, MECH_ID.mc05Ballast);
  return {
    x: UPPER.mc05PivotX + b.q * Math.cos(leaf.q),
    y: UPPER.mc05PivotY + b.q * Math.sin(leaf.q) + 0.72,
    z: UPPER.z,
    angle: leaf.q,
    q: b.q,
    v: b.v,
  };
}

export function mc05TableWorld(rube: RubeState) {
  if (!rube.chain) return null;
  ensureUpperCascadeState(rube.chain);
  const d = mechDof(rube.chain.network, MECH_ID.mc05Table);
  return { x: UPPER.tableStartX + d.q, y: UPPER.mc05PivotY, z: UPPER.z, vx: d.v, q: d.q };
}

export function mc06World(rube: RubeState) {
  if (!rube.chain) return null;
  ensureUpperCascadeState(rube.chain);
  const rotor = mechDof(rube.chain.network, MECH_ID.mc06Rotor);
  const bridge = mechDof(rube.chain.network, MECH_ID.mc06Bridge);
  const drop = mechDof(rube.chain.network, MECH_ID.mc06Dropweight);
  return {
    rotorAngle: rotor.q,
    rotorOmega: rotor.v,
    bridgeExtension: bridge.q,
    bridgeVelocity: bridge.v,
    dropY: UPPER.dropTopY - drop.q,
    dropVelocity: -drop.v,
    dropQ: drop.q,
  };
}
