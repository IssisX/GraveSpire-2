import { G, type LinkedCascadeState, type MechanicalNetworkState, type RubeState } from "./types.ts";
import {
  addGeneralizedForce,
  mechCable,
  mechDof,
  mechanicalNetworkFinite,
  stepMechanicalNetwork,
  type GeneralizedForces,
} from "./mechanical-network.ts";
import { MECH_ID } from "./mechanical-ids.ts";
import {
  applySpringShuttleForces,
  enforceSpringShuttleContact,
  ensureSpringShuttleState,
  springShuttleEnergy,
} from "./spring-shuttle.ts";

export const CHAIN = {
  z: -36.0,
  deckY: 2.36,
  carriageStartX: 68.0,
  carriageTravelM: 14.0,
  carriageMassKg: 30000.0,
  counterweightMassKg: 2500.0,
  counterweightX: 75.0,
  counterweightStartY: 9.0,
  transferBrakeCapacityN: 45000.0,
  entryRockerArmM: 0.62,
  entryContactBaseY: 2.40,
  entryPawlClearM: 0.10,
  entryPawlEscapeM: 0.08,
  bridgeReleaseContactM: 13.05,
  bridgeReleaseArmM: 0.55,
  bridgePawlClearM: 0.18,
  bridgeLatchSeatRad: 1.10,
  bridgeInitialRad: 1.16,
  bridgeLengthM: 11.0,
  bridgeMassKg: 5200.0,
  bridgePivotX: 84.5,
  bridgePivotY: 2.36,
} as const;

function createNetwork(): MechanicalNetworkState {
  const bridgeI = (CHAIN.bridgeMassKg * CHAIN.bridgeLengthM * CHAIN.bridgeLengthM) / 3;
  return {
    dofs: [
      { id: MECH_ID.entryRocker, kind: "rotary", q: 0, v: 0, inertia_si: 200, damping_si: 120, min_q: 0, max_q: 0.78, stop_restitution: 0 },
      { id: MECH_ID.entryPawl, kind: "linear", q: 0, v: 0, inertia_si: 85, damping_si: 500, min_q: 0, max_q: 0.40, stop_restitution: 0 },
      { id: MECH_ID.transferCarriage, kind: "linear", q: 0, v: 0, inertia_si: CHAIN.carriageMassKg, damping_si: 5500, min_q: 0, max_q: CHAIN.carriageTravelM, stop_restitution: 0.03 },
      { id: MECH_ID.transferCounterweight, kind: "linear", q: 0, v: 0, inertia_si: CHAIN.counterweightMassKg, damping_si: 900, min_q: 0, max_q: CHAIN.carriageTravelM, stop_restitution: 0 },
      { id: MECH_ID.bridgeRelease, kind: "rotary", q: 0, v: 0, inertia_si: 5000, damping_si: 2800, min_q: 0, max_q: 0.82, stop_restitution: 0 },
      { id: MECH_ID.bridgePawl, kind: "linear", q: 0, v: 0, inertia_si: 90, damping_si: 500, min_q: 0, max_q: 0.36, stop_restitution: 0 },
      { id: MECH_ID.bridge, kind: "rotary", q: CHAIN.bridgeInitialRad, v: 0, inertia_si: bridgeI, damping_si: 75000, min_q: 0, max_q: CHAIN.bridgeInitialRad, stop_restitution: 0 },
    ],
    cables: [
      {
        id: MECH_ID.entryPawlCable,
        base_length_m: 2,
        rest_length_m: 2,
        length_m: 2,
        stiffness_npm: 30000,
        damping_ns_pm: 2500,
        tension_n: 0,
        slack: true,
        terms: [
          { dof_id: MECH_ID.entryRocker, gradient_m_per_q: 1.0 },
          { dof_id: MECH_ID.entryPawl, gradient_m_per_q: -1 },
        ],
      },
      {
        id: MECH_ID.transferRope,
        base_length_m: 20,
        rest_length_m: 20,
        length_m: 20,
        stiffness_npm: 220000,
        damping_ns_pm: 30000,
        tension_n: 0,
        slack: true,
        terms: [
          { dof_id: MECH_ID.transferCarriage, gradient_m_per_q: -1 },
          { dof_id: MECH_ID.transferCounterweight, gradient_m_per_q: 1 },
        ],
      },
      {
        id: MECH_ID.bridgePawlCable,
        base_length_m: 2,
        rest_length_m: 2,
        length_m: 2,
        stiffness_npm: 85000,
        damping_ns_pm: 11000,
        tension_n: 0,
        slack: true,
        terms: [
          { dof_id: MECH_ID.bridgeRelease, gradient_m_per_q: 0.38 },
          { dof_id: MECH_ID.bridgePawl, gradient_m_per_q: -1 },
        ],
      },
    ],
    dissipated_j: 0,
  };
}

export function createLinkedCascadeState(): LinkedCascadeState {
  const state: LinkedCascadeState = {
    network: createNetwork(),
    transfer_brake_engaged: true,
    transfer_brake_capacity_n: CHAIN.transferBrakeCapacityN,
    entry_contact_n: 0,
    entry_pawl_reaction_n: 0,
    transfer_brake_reaction_n: 0,
    bridge_contact_n: 0,
    bridge_pawl_reaction_nm: 0,
    kinetic_j: 0,
    potential_j: 0,
  };
  ensureSpringShuttleState(state);
  return state;
}

export function ensureLinkedCascadeState(rube: RubeState): LinkedCascadeState {
  if (!rube.chain) rube.chain = createLinkedCascadeState();
  ensureSpringShuttleState(rube.chain);
  return rube.chain;
}

export function toggleTransferBrake(rube: RubeState): string {
  const chain = ensureLinkedCascadeState(rube);
  chain.transfer_brake_engaged = !chain.transfer_brake_engaged;
  return chain.transfer_brake_engaged
    ? "Transfer carriage brake engaged. Counterweight load is held by finite brake reaction."
    : "Transfer carriage brake released. Counterweight and routed rope now own the carriage.";
}

/**
 * Force transmitted where the MC-01 lift physically contacts the MC-02 rocker.
 * Both coordinates are in the SAME network; the caller applies equal/opposite
 * generalized reactions in the same integration step.
 */
export function linkedEntryContactForce(rube: RubeState): number {
  const chain = ensureLinkedCascadeState(rube);
  const lift = mechDof(chain.network, MECH_ID.mc01Lift);
  const rocker = mechDof(chain.network, MECH_ID.entryRocker);
  const contactY = CHAIN.entryContactBaseY + CHAIN.entryRockerArmM * Math.sin(rocker.q);
  const penetration = Math.max(0, lift.q - contactY);
  if (penetration <= 0) return 0;
  const rockerPointVelocity = CHAIN.entryRockerArmM * Math.cos(rocker.q) * rocker.v;
  const closingVelocity = lift.v - rockerPointVelocity;
  return Math.min(900, Math.max(0, 12000 * penetration + 1000 * Math.max(0, closingVelocity)));
}

function updateEnergy(chain: LinkedCascadeState): void {
  let kinetic = 0;
  for (const d of chain.network.dofs) {
    if (!d.id.startsWith("mc01_")) kinetic += 0.5 * d.inertia_si * d.v * d.v;
  }
  const cw = mechDof(chain.network, MECH_ID.transferCounterweight);
  const bridge = mechDof(chain.network, MECH_ID.bridge);
  const cwHeight = CHAIN.counterweightStartY - cw.q;
  const bridgeComHeight = CHAIN.bridgePivotY + 0.5 * CHAIN.bridgeLengthM * Math.sin(bridge.q);
  const shuttle = springShuttleEnergy(chain);
  chain.kinetic_j = kinetic;
  chain.potential_j =
    CHAIN.counterweightMassKg * G * cwHeight +
    CHAIN.bridgeMassKg * G * bridgeComHeight +
    shuttle.springJ +
    shuttle.gravitationalJ;
}

/**
 * ONE shared mechanical step for MC-01 -> MC-04.
 * Mechanism modules contribute forces/constraints; they do not own parallel q/v.
 */
export function stepLinkedCascade(
  rube: RubeState,
  dt: number,
  external: GeneralizedForces = {},
): GeneralizedForces {
  const chain = ensureLinkedCascadeState(rube);
  const net = chain.network;
  const forces: GeneralizedForces = { ...external };

  const lever = mechDof(net, MECH_ID.mc01Lever);
  const lift = mechDof(net, MECH_ID.mc01Lift);
  const rocker = mechDof(net, MECH_ID.entryRocker);
  const pawl = mechDof(net, MECH_ID.entryPawl);
  const carriage = mechDof(net, MECH_ID.transferCarriage);
  const counterweight = mechDof(net, MECH_ID.transferCounterweight);
  const release = mechDof(net, MECH_ID.bridgeRelease);
  const bridgePawl = mechDof(net, MECH_ID.bridgePawl);
  const bridge = mechDof(net, MECH_ID.bridge);
  const springShuttle = mechDof(net, MECH_ID.springShuttle);

  // MC-01 -> MC-02 is now an actual reciprocal contact inside one solve.
  const entryContactN = linkedEntryContactForce(rube);
  addGeneralizedForce(forces, MECH_ID.mc01Lift, -entryContactN);
  addGeneralizedForce(forces, MECH_ID.entryRocker, entryContactN * CHAIN.entryRockerArmM);

  addGeneralizedForce(forces, MECH_ID.entryPawl, -300 * pawl.q);
  addGeneralizedForce(forces, MECH_ID.transferCounterweight, CHAIN.counterweightMassKg * G);
  if (Math.abs(carriage.v) > 0.02) {
    addGeneralizedForce(
      forces,
      MECH_ID.transferCarriage,
      -0.010 * CHAIN.carriageMassKg * G * Math.sign(carriage.v),
    );
  }

  const releaseBoundary = CHAIN.bridgeReleaseContactM + CHAIN.bridgeReleaseArmM * Math.sin(release.q);
  const bridgeContactPenetration = Math.max(0, carriage.q - releaseBoundary);
  let bridgeContactN = 0;
  if (bridgeContactPenetration > 0) {
    const releasePointVelocity = CHAIN.bridgeReleaseArmM * Math.cos(release.q) * release.v;
    const closingVelocity = carriage.v - releasePointVelocity;
    bridgeContactN = Math.max(0, 240000 * bridgeContactPenetration + 18000 * Math.max(0, closingVelocity));
    addGeneralizedForce(forces, MECH_ID.transferCarriage, -bridgeContactN);
    addGeneralizedForce(forces, MECH_ID.bridgeRelease, bridgeContactN * CHAIN.bridgeReleaseArmM);
  }
  addGeneralizedForce(forces, MECH_ID.bridgePawl, -16000 * bridgePawl.q);
  addGeneralizedForce(
    forces,
    MECH_ID.bridge,
    -CHAIN.bridgeMassKg * G * (CHAIN.bridgeLengthM * 0.5) * Math.cos(bridge.q),
  );
  applySpringShuttleForces(chain, forces);

  const beforeCarriageQ = carriage.q;
  const beforeCounterweightQ = counterweight.q;
  const beforeBridgeQ = bridge.q;
  const beforeSpringShuttleQ = springShuttle.q;
  stepMechanicalNetwork(net, dt, forces);

  // Generic network owns the lever coordinate. Latch metadata only changes the
  // active constraint topology; it never stores a competing angle/velocity.
  if (rube.lever.latch_engaged) {
    lever.q = rube.lever.latch_angle_rad;
    lever.v = 0;
  }

  const transfer = mechCable(net, MECH_ID.transferRope);
  chain.entry_contact_n = entryContactN;
  chain.bridge_contact_n = bridgeContactN;
  chain.entry_pawl_reaction_n = 0;
  chain.bridge_pawl_reaction_nm = 0;
  chain.transfer_brake_reaction_n = 0;

  if (beforeCounterweightQ < CHAIN.entryPawlEscapeM && pawl.q < CHAIN.entryPawlClearM && counterweight.q > 0) {
    chain.entry_pawl_reaction_n = Math.max(0, CHAIN.counterweightMassKg * G - transfer.tension_n);
    counterweight.q = 0;
    if (counterweight.v > 0) counterweight.v = 0;
  }

  if (chain.transfer_brake_engaged && transfer.tension_n <= chain.transfer_brake_capacity_n) {
    chain.transfer_brake_reaction_n = transfer.tension_n;
    carriage.q = beforeCarriageQ;
    carriage.v = 0;
  } else if (chain.transfer_brake_engaged && transfer.tension_n > chain.transfer_brake_capacity_n) {
    chain.transfer_brake_reaction_n = chain.transfer_brake_capacity_n;
  }

  if (beforeBridgeQ > CHAIN.bridgeLatchSeatRad && bridgePawl.q < CHAIN.bridgePawlClearM && bridge.q < CHAIN.bridgeInitialRad) {
    chain.bridge_pawl_reaction_nm = Math.max(
      0,
      CHAIN.bridgeMassKg * G * (CHAIN.bridgeLengthM * 0.5) * Math.cos(CHAIN.bridgeInitialRad),
    );
    bridge.q = CHAIN.bridgeInitialRad;
    if (bridge.v < 0) bridge.v = 0;
  }

  enforceSpringShuttleContact(chain, beforeSpringShuttleQ);
  updateEnergy(chain);
  void lift;
  void rocker;
  return forces;
}

export function linkedCascadeFinite(rube: RubeState): boolean {
  const chain = ensureLinkedCascadeState(rube);
  return (
    mechanicalNetworkFinite(chain.network) &&
    [
      chain.entry_contact_n,
      chain.entry_pawl_reaction_n,
      chain.transfer_brake_reaction_n,
      chain.bridge_contact_n,
      chain.bridge_pawl_reaction_nm,
      chain.kinetic_j,
      chain.potential_j,
    ].every(Number.isFinite)
  );
}

export function carriageWorld(rube: RubeState): { x: number; y: number; z: number; vx: number } {
  const q = mechDof(ensureLinkedCascadeState(rube).network, MECH_ID.transferCarriage);
  return { x: CHAIN.carriageStartX + q.q, y: CHAIN.deckY, z: CHAIN.z, vx: q.v };
}

export function counterweightWorld(rube: RubeState): { x: number; y: number; z: number; vy: number } {
  const q = mechDof(ensureLinkedCascadeState(rube).network, MECH_ID.transferCounterweight);
  return { x: CHAIN.counterweightX, y: CHAIN.counterweightStartY - q.q, z: CHAIN.z - 4.6, vy: -q.v };
}

export function bridgeAngle(rube: RubeState): number {
  return mechDof(ensureLinkedCascadeState(rube).network, MECH_ID.bridge).q;
}
