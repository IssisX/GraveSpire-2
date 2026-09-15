import { G, clamp, type LinkedCascadeState, type MechanicalDofState } from "./types.ts";
import { addGeneralizedForce, mechDof, type GeneralizedForces } from "./mechanical-network.ts";

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

/**
 * MC-04 is persisted in the same generalized-coordinate network as MC-02/MC-03.
 * q for spring_shuttle is downward travel from the upper landing.
 */
export function ensureSpringShuttleState(chain: LinkedCascadeState): void {
  addDof(chain, {
    id: "spring_shuttle_latch",
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
    id: "spring_shuttle",
    kind: "linear",
    q: 0,
    v: 0,
    inertia_si: SPRING_SHUTTLE.massKg,
    damping_si: SPRING_SHUTTLE.dampingNsPm,
    min_q: 0,
    max_q: SPRING_SHUTTLE.travelM,
    stop_restitution: 0.12,
  });
}

/**
 * Adds MC-04 forces before the shared network integrator runs.
 * The falling MC-03 bridge nose physically drives a small release follower.
 * Once that follower clears its pawl, gravity starts the 12 t shuttle downward.
 * A preloaded spring stores that gravitational work and returns the shuttle upward.
 */
export function applySpringShuttleForces(chain: LinkedCascadeState, forces: GeneralizedForces): void {
  ensureSpringShuttleState(chain);
  const bridge = mechDof(chain.network, "bridge");
  const latch = mechDof(chain.network, "spring_shuttle_latch");
  const shuttle = mechDof(chain.network, "spring_shuttle");

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
  addGeneralizedForce(forces, "spring_shuttle_latch", followerForce);

  // Reciprocal low-force reaction on the bridge release contact.
  if (followerForce > 0 && bridge.q < SPRING_SHUTTLE.releaseAngleRad) {
    addGeneralizedForce(forces, "bridge", followerForce * SPRING_SHUTTLE.releaseGainMPerRad);
  }

  // q is downward travel. Gravity drives +q; spring preload/stiffness drive -q.
  const springUpN = SPRING_SHUTTLE.springPreloadN + SPRING_SHUTTLE.springK * shuttle.q;
  addGeneralizedForce(forces, "spring_shuttle", SPRING_SHUTTLE.massKg * G - springUpN);
}

/** Pawl is unilateral: while its face blocks the guide, the shuttle cannot descend. */
export function enforceSpringShuttleContact(chain: LinkedCascadeState, beforeQ: number): void {
  ensureSpringShuttleState(chain);
  const latch = mechDof(chain.network, "spring_shuttle_latch");
  const shuttle = mechDof(chain.network, "spring_shuttle");
  if (beforeQ < SPRING_SHUTTLE.latchEscapeM && latch.q < SPRING_SHUTTLE.latchClearM && shuttle.q > 0) {
    shuttle.q = 0;
    if (shuttle.v > 0) shuttle.v = 0;
  }
}

export function springShuttleWorld(chain: LinkedCascadeState): { x: number; y: number; z: number; vy: number } {
  ensureSpringShuttleState(chain);
  const shuttle = mechDof(chain.network, "spring_shuttle");
  return {
    x: SPRING_SHUTTLE.x,
    y: SPRING_SHUTTLE.upperY - shuttle.q,
    z: SPRING_SHUTTLE.z,
    vy: -shuttle.v,
  };
}

export function springShuttleEnergy(chain: LinkedCascadeState): { kineticJ: number; springJ: number; gravitationalJ: number } {
  ensureSpringShuttleState(chain);
  const shuttle = mechDof(chain.network, "spring_shuttle");
  const y = SPRING_SHUTTLE.upperY - shuttle.q;
  return {
    kineticJ: 0.5 * SPRING_SHUTTLE.massKg * shuttle.v * shuttle.v,
    springJ: SPRING_SHUTTLE.springPreloadN * shuttle.q + 0.5 * SPRING_SHUTTLE.springK * shuttle.q * shuttle.q,
    gravitationalJ: SPRING_SHUTTLE.massKg * G * y,
  };
}
