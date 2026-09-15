import { G, type LinkedCascadeState, type MechanicalNetworkState, type RubeState } from "./types.ts";
import {
  addGeneralizedForce,
  mechCable,
  mechDof,
  mechanicalNetworkFinite,
  stepMechanicalNetwork,
  type GeneralizedForces,
} from "./mechanical-network.ts";

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
  // Light trip linkage: MC-01 must trigger the next mechanism, not power it.
  entryContactBaseY: 2.40,
  // A pawl only needs to clear its tooth/face, not travel like an actuator.
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
      { id: "entry_rocker", kind: "rotary", q: 0, v: 0, inertia_si: 200, damping_si: 120, min_q: 0, max_q: 0.78, stop_restitution: 0 },
      { id: "entry_pawl", kind: "linear", q: 0, v: 0, inertia_si: 85, damping_si: 500, min_q: 0, max_q: 0.40, stop_restitution: 0 },
      { id: "transfer_carriage", kind: "linear", q: 0, v: 0, inertia_si: CHAIN.carriageMassKg, damping_si: 5500, min_q: 0, max_q: CHAIN.carriageTravelM, stop_restitution: 0.03 },
      { id: "transfer_counterweight", kind: "linear", q: 0, v: 0, inertia_si: CHAIN.counterweightMassKg, damping_si: 900, min_q: 0, max_q: CHAIN.carriageTravelM, stop_restitution: 0 },
      { id: "bridge_release", kind: "rotary", q: 0, v: 0, inertia_si: 5000, damping_si: 2800, min_q: 0, max_q: 0.82, stop_restitution: 0 },
      { id: "bridge_pawl", kind: "linear", q: 0, v: 0, inertia_si: 90, damping_si: 500, min_q: 0, max_q: 0.36, stop_restitution: 0 },
      { id: "bridge", kind: "rotary", q: CHAIN.bridgeInitialRad, v: 0, inertia_si: bridgeI, damping_si: 75000, min_q: 0, max_q: CHAIN.bridgeInitialRad, stop_restitution: 0 },
    ],
    cables: [
      {
        id: "entry_pawl_cable",
        base_length_m: 2,
        rest_length_m: 2,
        length_m: 2,
        stiffness_npm: 30000,
        damping_ns_pm: 2500,
        tension_n: 0,
        slack: true,
        terms: [
          // One radian of rocker rotation pays out/retracts one metre of this reduced linkage.
          // This travel ratio lets a low-force trip release the pawl without stealing lift power.
          { dof_id: "entry_rocker", gradient_m_per_q: 1.0 },
          { dof_id: "entry_pawl", gradient_m_per_q: -1 },
        ],
      },
      {
        id: "transfer_rope",
        base_length_m: 20,
        rest_length_m: 20,
        length_m: 20,
        stiffness_npm: 220000,
        damping_ns_pm: 30000,
        tension_n: 0,
        slack: true,
        terms: [
          { dof_id: "transfer_carriage", gradient_m_per_q: -1 },
          { dof_id: "transfer_counterweight", gradient_m_per_q: 1 },
        ],
      },
      {
        id: "bridge_pawl_cable",
        base_length_m: 2,
        rest_length_m: 2,
        length_m: 2,
        stiffness_npm: 85000,
        damping_ns_pm: 11000,
        tension_n: 0,
        slack: true,
        terms: [
          { dof_id: "bridge_release", gradient_m_per_q: 0.38 },
          { dof_id: "bridge_pawl", gradient_m_per_q: -1 },
        ],
      },
    ],
    dissipated_j: 0,
  };
}

export function createLinkedCascadeState(): LinkedCascadeState {
  return {
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
}

export function ensureLinkedCascadeState(rube: RubeState): LinkedCascadeState {
  if (!rube.chain) rube.chain = createLinkedCascadeState();
  return rube.chain;
}

export function toggleTransferBrake(rube: RubeState): string {
  const chain = ensureLinkedCascadeState(rube);
  chain.transfer_brake_engaged = !chain.transfer_brake_engaged;
  return chain.transfer_brake_engaged
    ? "Transfer carriage brake engaged. Counterweight load is held by finite brake reaction."
    : "Transfer carriage brake released. Counterweight and routed rope now own the carriage.";
}

/** Force transmitted where the rising MC-01 lift physically contacts the entry rocker. */
export function linkedEntryContactForce(rube: RubeState): number {
  const chain = ensureLinkedCascadeState(rube);
  const rocker = mechDof(chain.network, "entry_rocker");
  const contactY = CHAIN.entryContactBaseY + CHAIN.entryRockerArmM * Math.sin(rocker.q);
  const penetration = Math.max(0, rube.lift.y_m - contactY);
  if (penetration <= 0) return 0;
  const rockerPointVelocity = CHAIN.entryRockerArmM * Math.cos(rocker.q) * rocker.v;
  const closingVelocity = rube.lift.velocity_mps - rockerPointVelocity;
  // The release is a trip, not a power transfer. Cap the reciprocal load so MC-01
  // can move the rocker without the rocker becoming a second hidden lift brake.
  return Math.min(900, Math.max(0, 12000 * penetration + 1000 * Math.max(0, closingVelocity)));
}

function updateEnergy(chain: LinkedCascadeState): void {
  let kinetic = 0;
  for (const d of chain.network.dofs) kinetic += 0.5 * d.inertia_si * d.v * d.v;
  const cw = mechDof(chain.network, "transfer_counterweight");
  const bridge = mechDof(chain.network, "bridge");
  const cwHeight = CHAIN.counterweightStartY - cw.q;
  const bridgeComHeight = CHAIN.bridgePivotY + 0.5 * CHAIN.bridgeLengthM * Math.sin(bridge.q);
  chain.kinetic_j = kinetic;
  chain.potential_j =
    CHAIN.counterweightMassKg * G * cwHeight +
    CHAIN.bridgeMassKg * G * bridgeComHeight;
}

/**
 * Advances MC-02/MC-03 from generalized coordinates and constraint forces.
 * There are no completion flags: lift contact moves the rocker, cable retracts the pawl,
 * gravity drops the counterweight, rope pulls the carriage, carriage contact rotates the
 * second release, and gravity lowers the bridge when its pawl is geometrically clear.
 */
export function stepLinkedCascade(rube: RubeState, dt: number, entryContactN: number): void {
  const chain = ensureLinkedCascadeState(rube);
  const net = chain.network;
  const rocker = mechDof(net, "entry_rocker");
  const pawl = mechDof(net, "entry_pawl");
  const carriage = mechDof(net, "transfer_carriage");
  const counterweight = mechDof(net, "transfer_counterweight");
  const release = mechDof(net, "bridge_release");
  const bridgePawl = mechDof(net, "bridge_pawl");
  const bridge = mechDof(net, "bridge");

  const forces: GeneralizedForces = {};
  addGeneralizedForce(forces, "entry_rocker", entryContactN * CHAIN.entryRockerArmM);
  // Light pawl return spring; the rocker/cable geometry supplies travel, not brute force.
  addGeneralizedForce(forces, "entry_pawl", -300 * pawl.q);
  addGeneralizedForce(forces, "transfer_counterweight", CHAIN.counterweightMassKg * G);
  if (Math.abs(carriage.v) > 0.02) {
    // Rail-car scale rolling resistance, not dry sliding friction.
    addGeneralizedForce(forces, "transfer_carriage", -0.010 * CHAIN.carriageMassKg * G * Math.sign(carriage.v));
  }

  const releaseBoundary = CHAIN.bridgeReleaseContactM + CHAIN.bridgeReleaseArmM * Math.sin(release.q);
  const bridgeContactPenetration = Math.max(0, carriage.q - releaseBoundary);
  let bridgeContactN = 0;
  if (bridgeContactPenetration > 0) {
    const releasePointVelocity = CHAIN.bridgeReleaseArmM * Math.cos(release.q) * release.v;
    const closingVelocity = carriage.v - releasePointVelocity;
    bridgeContactN = Math.max(0, 240000 * bridgeContactPenetration + 18000 * Math.max(0, closingVelocity));
    addGeneralizedForce(forces, "transfer_carriage", -bridgeContactN);
    addGeneralizedForce(forces, "bridge_release", bridgeContactN * CHAIN.bridgeReleaseArmM);
  }
  addGeneralizedForce(forces, "bridge_pawl", -16000 * bridgePawl.q);
  addGeneralizedForce(
    forces,
    "bridge",
    -CHAIN.bridgeMassKg * G * (CHAIN.bridgeLengthM * 0.5) * Math.cos(bridge.q),
  );

  const beforeCarriageQ = carriage.q;
  const beforeCounterweightQ = counterweight.q;
  const beforeBridgeQ = bridge.q;
  stepMechanicalNetwork(net, dt, forces);

  const transfer = mechCable(net, "transfer_rope");
  chain.entry_contact_n = entryContactN;
  chain.bridge_contact_n = bridgeContactN;
  chain.entry_pawl_reaction_n = 0;
  chain.bridge_pawl_reaction_nm = 0;
  chain.transfer_brake_reaction_n = 0;

  // The pawl is a unilateral contact at the mouth of the counterweight guide.
  // Once the weight has physically escaped the pawl face it cannot be magically recaptured.
  if (beforeCounterweightQ < CHAIN.entryPawlEscapeM && pawl.q < CHAIN.entryPawlClearM && counterweight.q > 0) {
    chain.entry_pawl_reaction_n = Math.max(0, CHAIN.counterweightMassKg * G - transfer.tension_n);
    counterweight.q = 0;
    if (counterweight.v > 0) counterweight.v = 0;
  }

  // Finite static brake: it holds while routed rope demand remains below capacity.
  if (chain.transfer_brake_engaged && transfer.tension_n <= chain.transfer_brake_capacity_n) {
    chain.transfer_brake_reaction_n = transfer.tension_n;
    carriage.q = beforeCarriageQ;
    carriage.v = 0;
  } else if (chain.transfer_brake_engaged && transfer.tension_n > chain.transfer_brake_capacity_n) {
    chain.transfer_brake_reaction_n = chain.transfer_brake_capacity_n;
  }

  // Same geometry rule at the drop bridge: pawl can hold only while the bridge is still on its seat.
  if (beforeBridgeQ > CHAIN.bridgeLatchSeatRad && bridgePawl.q < CHAIN.bridgePawlClearM && bridge.q < CHAIN.bridgeInitialRad) {
    chain.bridge_pawl_reaction_nm = Math.max(
      0,
      CHAIN.bridgeMassKg * G * (CHAIN.bridgeLengthM * 0.5) * Math.cos(CHAIN.bridgeInitialRad),
    );
    bridge.q = CHAIN.bridgeInitialRad;
    if (bridge.v < 0) bridge.v = 0;
  }

  updateEnergy(chain);
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
  const q = mechDof(ensureLinkedCascadeState(rube).network, "transfer_carriage");
  return { x: CHAIN.carriageStartX + q.q, y: CHAIN.deckY, z: CHAIN.z, vx: q.v };
}

export function counterweightWorld(rube: RubeState): { x: number; y: number; z: number; vy: number } {
  const q = mechDof(ensureLinkedCascadeState(rube).network, "transfer_counterweight");
  return { x: CHAIN.counterweightX, y: CHAIN.counterweightStartY - q.q, z: CHAIN.z - 4.6, vy: -q.v };
}

export function bridgeAngle(rube: RubeState): number {
  return mechDof(ensureLinkedCascadeState(rube).network, "bridge").q;
}
