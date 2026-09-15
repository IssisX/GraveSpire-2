import { clamp, type MechanicalCableState, type MechanicalDofState, type MechanicalNetworkState } from "./types.ts";

export type GeneralizedForces = Record<string, number>;

export function mechDof(network: MechanicalNetworkState, id: string): MechanicalDofState {
  const d = network.dofs.find((x) => x.id === id);
  if (!d) throw new Error(`Missing mechanical DOF: ${id}`);
  return d;
}

export function mechCable(network: MechanicalNetworkState, id: string): MechanicalCableState {
  const c = network.cables.find((x) => x.id === id);
  if (!c) throw new Error(`Missing mechanical cable: ${id}`);
  return c;
}

export function addGeneralizedForce(forces: GeneralizedForces, id: string, value: number): void {
  forces[id] = (forces[id] ?? 0) + value;
}

/**
 * Generic over-center retaining topology. Once the coordinate physically crosses
 * the over-center point, its lower stop moves to the retained side of the cam.
 * The DOF remains the sole q/v authority; no parallel completion boolean exists.
 */
export function retainOverCenter(
  dof: MechanicalDofState,
  overCenterQ: number,
  retainedMinQ: number,
): boolean {
  if (dof.min_q < retainedMinQ && dof.q >= overCenterQ) {
    dof.min_q = retainedMinQ;
    if (dof.q < retainedMinQ) dof.q = retainedMinQ;
    if (dof.v < 0) dof.v = 0;
  }
  return dof.min_q >= retainedMinQ;
}

/**
 * Energy-direction preserving one-way transmission. Input motion may accelerate
 * an output only while it is overtaking that output; reaction torque is bounded
 * by the finite force the upstream machine can actually supply.
 */
export function oneWayClutchTorque(args: {
  inputVelocity: number;
  outputVelocity: number;
  ratioOutputPerInput: number;
  couplingNms: number;
  maxTorqueNm: number;
  maxInputForceN: number;
}): number {
  const ratio = Math.max(1e-6, Math.abs(args.ratioOutputPerInput));
  const driven = args.ratioOutputPerInput * args.inputVelocity;
  const slip = driven - args.outputVelocity;
  if (slip <= 0 || args.maxInputForceN <= 0) return 0;
  return Math.max(
    0,
    Math.min(
      args.couplingNms * slip,
      args.maxTorqueNm,
      args.maxInputForceN / ratio,
    ),
  );
}

export function cableLength(network: MechanicalNetworkState, cable: MechanicalCableState): number {
  let l = cable.base_length_m;
  for (const term of cable.terms) l += term.gradient_m_per_q * mechDof(network, term.dof_id).q;
  return l;
}

export function cableRate(network: MechanicalNetworkState, cable: MechanicalCableState): number {
  let dl = 0;
  for (const term of cable.terms) dl += term.gradient_m_per_q * mechDof(network, term.dof_id).v;
  return dl;
}

/**
 * Reduced generalized-coordinate mechanics shared by the linked cascade.
 * A linear DOF uses kg / N; a rotary DOF uses kg·m² / N·m. Cable term gradients
 * map a scalar routed length into generalized forces through Q = -T dl/dq.
 */
export function stepMechanicalNetwork(
  network: MechanicalNetworkState,
  dt: number,
  external: GeneralizedForces = {},
): GeneralizedForces {
  const forces: GeneralizedForces = { ...external };

  for (const d of network.dofs) {
    addGeneralizedForce(forces, d.id, -d.damping_si * d.v);
  }

  for (const cable of network.cables) {
    const length = cableLength(network, cable);
    const rate = cableRate(network, cable);
    const extension = Math.max(0, length - cable.rest_length_m);
    const raw = cable.stiffness_npm * extension + cable.damping_ns_pm * rate;
    const tension = length >= cable.rest_length_m ? Math.max(0, raw) : 0;
    cable.length_m = length;
    cable.tension_n = tension;
    cable.slack = tension < 25;
    for (const term of cable.terms) {
      addGeneralizedForce(forces, term.dof_id, -tension * term.gradient_m_per_q);
    }
  }

  for (const d of network.dofs) {
    const q0 = d.q;
    const v0 = d.v;
    d.v += ((forces[d.id] ?? 0) / Math.max(1e-6, d.inertia_si)) * dt;
    d.q += d.v * dt;

    if (d.q <= d.min_q) {
      d.q = d.min_q;
      if (d.v < 0) d.v *= -d.stop_restitution;
    } else if (d.q >= d.max_q) {
      d.q = d.max_q;
      if (d.v > 0) d.v *= -d.stop_restitution;
    }

    if (d.q === d.min_q || d.q === d.max_q) {
      const before = 0.5 * d.inertia_si * v0 * v0;
      const after = 0.5 * d.inertia_si * d.v * d.v;
      network.dissipated_j += Math.max(0, before - after);
    }

    if (!Number.isFinite(d.q) || !Number.isFinite(d.v)) {
      d.q = clamp(q0, d.min_q, d.max_q);
      d.v = 0;
    }
  }

  return forces;
}

export function mechanicalNetworkFinite(network: MechanicalNetworkState): boolean {
  return (
    Number.isFinite(network.dissipated_j) &&
    network.dofs.every((d) => Number.isFinite(d.q) && Number.isFinite(d.v) && Number.isFinite(d.inertia_si)) &&
    network.cables.every((c) => Number.isFinite(c.length_m) && Number.isFinite(c.tension_n) && c.tension_n >= 0)
  );
}
