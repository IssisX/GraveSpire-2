import { G, clamp, type LinkedCascadeState, type MechanicalDofState } from "./types.ts";
import { addGeneralizedForce, mechDof, type GeneralizedForces } from "./mechanical-network.ts";
import { MECH_ID } from "./mechanical-ids.ts";
import {
  applyVerticalSpineForces,
  enforceVerticalSpineConstraints,
  ensureVerticalSpineState,
} from "./vertical-spine.ts";

export const SPRING_SHUTTLE = {
  massKg: 12000.0,
  travelM: 8.0,
  upperY: 10.36,
  lowerY: 2.36,
  x: 101.8,
  z: -36.0,
  springK: 7000.0,
  springPreloadN: 12000.0 * G - 4.0 * 7000.0,
  dampingNsPm: 250.0,
  latchClearM: 0.10,
  latchEscapeM: 0.08,
  latchMaxM: 0.18,
  releaseAngleRad: 0.12,
  releaseGainMPerRad: 1.55,
  releaseStiffnessNpm: 42000.0,
  releaseDampingNsPm: 2200.0,
} as const;

function hasDof(chain: LinkedCascadeState, id: string): boolean {
  return chain.network.dofs.some((d) => d.id === id);
}

function addDof(chain: LinkedCascadeState, dof: MechanicalDofState): void {
  if (!hasDof(chain, dof.id)) chain.network.dofs.push(dof);
}

/** MC-04 contributes coordinates to the same network as every upstream mechanism. */
export function ensureSpringShuttleState(chain: LinkedCascadeState): void {
  addDof(chain, {
    id: MECH_ID.springShuttleLatch,
    kind: "linear",
    q: 0,
    v: 0,
    inertia_si: 55,
    damping_si: 500,
    min_q: 0,
    max_q: SPRING_SHUTTLE.latchMaxM,
    stop_restitution: 0,
  });
  addDof(chain, {
    id: MECH_ID.springShuttle,
    kind: "linear",
    q: 0,
    v: 0,
    inertia_si: SPRING_SHUTTLE.massKg,
    damping_si: SPRING_SHUTTLE.dampingNsPm,
    min_q: 0,
    max_q: SPRING_SHUTTLE.travelM,
    stop_restitution: 0.12,
  });
  ensureVerticalSpineState(chain);
}

/**
 * MC-03 bridge geometry drives the MC-04 release follower through reciprocal force.
 * No completion state exists: q/v and unilateral contact are the entire handoff.
 */
export function applySpringShuttleForces(chain: LinkedCascadeState, forces: GeneralizedForces): void {
  ensureSpringShuttleState(chain);
  const bridge = mechDof(chain.network, MECH_ID.bridge);
  const latch = mechDof(chain.network, MECH_ID.springShuttleLatch);
  const shuttle = mechDof(chain.network, MECH_ID.springShuttle);

  const target = clamp(
    (SPRING_SHUTTLE.releaseAngleRad - bridge.q) * SPRING_SHUTTLE.releaseGainMPerRad,
    0,
    SPRING_SHUTTLE.latchMaxM,
  );
  const targetRate = bridge.q < SPRING_SHUTTLE.releaseAngleRad
    ? -bridge.v * SPRING_SHUTTLE.releaseGainMPerRad
    : 0;
  const followerForce =
    SPRING_SHUTTLE.releaseStiffnessNpm * (target - latch.q) +
    SPRING_SHUTTLE.releaseDampingNsPm * (targetRate - latch.v);
  addGeneralizedForce(forces, MECH_ID.springShuttleLatch, followerForce);

  if (followerForce > 0 && bridge.q < SPRING_SHUTTLE.releaseAngleRad) {
    addGeneralizedForce(forces, MECH_ID.bridge, followerForce * SPRING_SHUTTLE.releaseGainMPerRad);
  }

  const springUpN = SPRING_SHUTTLE.springPreloadN + SPRING_SHUTTLE.springK * shuttle.q;
  addGeneralizedForce(forces, MECH_ID.springShuttle, SPRING_SHUTTLE.massKg * G - springUpN);

  // MC-07/08 contribute forces to this SAME GeneralizedForces object before
  // linked-cascade performs the one authoritative mechanical-network step.
  applyVerticalSpineForces(chain, forces);
}

/** Pawl is unilateral: while its face blocks the guide, the shuttle cannot descend. */
export function enforceSpringShuttleContact(chain: LinkedCascadeState, beforeQ: number): void {
  ensureSpringShuttleState(chain);
  const latch = mechDof(chain.network, MECH_ID.springShuttleLatch);
  const shuttle = mechDof(chain.network, MECH_ID.springShuttle);
  if (beforeQ < SPRING_SHUTTLE.latchEscapeM && latch.q < SPRING_SHUTTLE.latchClearM && shuttle.q > 0) {
    shuttle.q = 0;
    if (shuttle.v > 0) shuttle.v = 0;
  }
  enforceVerticalSpineConstraints(chain);
}

export function springShuttleWorld(chain: LinkedCascadeState): { x: number; y: number; z: number; vy: number } {
  ensureSpringShuttleState(chain);
  const shuttle = mechDof(chain.network, MECH_ID.springShuttle);
  return {
    x: SPRING_SHUTTLE.x,
    y: SPRING_SHUTTLE.upperY - shuttle.q,
    z: SPRING_SHUTTLE.z,
    vy: -shuttle.v,
  };
}

export function springShuttleEnergy(chain: LinkedCascadeState): { kineticJ: number; springJ: number; gravitationalJ: number } {
  ensureSpringShuttleState(chain);
  const shuttle = mechDof(chain.network, MECH_ID.springShuttle);
  const y = SPRING_SHUTTLE.upperY - shuttle.q;
  return {
    kineticJ: 0.5 * SPRING_SHUTTLE.massKg * shuttle.v * shuttle.v,
    springJ: SPRING_SHUTTLE.springPreloadN * shuttle.q + 0.5 * SPRING_SHUTTLE.springK * shuttle.q * shuttle.q,
    gravitationalJ: SPRING_SHUTTLE.massKg * G * y,
  };
}
