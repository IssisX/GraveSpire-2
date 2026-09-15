import { G, type LinkedCascadeState, type MechanicalDofState } from "./types.ts";
import { addGeneralizedForce, mechDof, type GeneralizedForces } from "./mechanical-network.ts";
import { MECH_ID } from "./mechanical-ids.ts";
import { highAltitudeWindMps, SKY } from "./sky-spine.ts";

export type IngredientKind = "beam" | "ballast" | "roller" | "wedge";

export type IngredientSpec = {
  id: string;
  kind: IngredientKind;
  massKg: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  startX: number;
  startY: number;
  startAngle: number;
  windAreaM2: number;
};

/**
 * Persistent industrial ingredients. Their q/v live in MechanicalNetworkState;
 * this table only defines immutable mass/shape/initial placement.
 */
export const INGREDIENTS: readonly IngredientSpec[] = [
  { id: "loose_beam_a", kind: "beam", massKg: 1850, sizeX: 6.2, sizeY: 0.36, sizeZ: 0.72, startX: 242.0, startY: 91.34, startAngle: 0.05, windAreaM2: 4.5 },
  { id: "loose_ballast_a", kind: "ballast", massKg: 2800, sizeX: 1.7, sizeY: 1.25, sizeZ: 1.6, startX: 252.0, startY: 103.625, startAngle: 0, windAreaM2: 2.0 },
  { id: "loose_roller_a", kind: "roller", massKg: 920, sizeX: 1.15, sizeY: 1.15, sizeZ: 1.8, startX: 279.0, startY: 132.575, startAngle: 0, windAreaM2: 1.9 },
  { id: "loose_wedge_a", kind: "wedge", massKg: 640, sizeX: 2.3, sizeY: 0.90, sizeZ: 1.8, startX: 300.0, startY: 132.45, startAngle: -0.10, windAreaM2: 1.7 },
] as const;

const SUPPORTS = [
  { minX: 229.0, maxX: 255.0, y: 91.0 },
  { minX: 244.0, maxX: 271.0, y: 103.0 },
  { minX: 269.0, maxX: 323.0, y: 132.0 },
  { minX: 198.0, maxX: 217.0, y: 69.0 },
  { minX: 184.0, maxX: 206.0, y: 50.8 },
  { minX: 169.0, maxX: 184.0, y: 23.0 },
  { minX: -40.0, maxX: 360.0, y: 0.0 },
] as const;

function idX(id: string) { return `ingredient:${id}:x`; }
function idY(id: string) { return `ingredient:${id}:y`; }
function idA(id: string) { return `ingredient:${id}:a`; }

function addDof(chain: LinkedCascadeState, d: MechanicalDofState): void {
  if (!chain.network.dofs.some((x) => x.id === d.id)) chain.network.dofs.push(d);
}

function inertia(spec: IngredientSpec): number {
  return (spec.massKg * (spec.sizeX * spec.sizeX + spec.sizeY * spec.sizeY)) / 12;
}

export function ensureCompositionBodies(chain: LinkedCascadeState): void {
  for (const spec of INGREDIENTS) {
    addDof(chain, { id: idX(spec.id), kind: "linear", q: spec.startX, v: 0, inertia_si: spec.massKg, damping_si: spec.kind === "roller" ? 120 : 380, min_q: -40, max_q: 360, stop_restitution: 0.12 });
    addDof(chain, { id: idY(spec.id), kind: "linear", q: spec.startY, v: 0, inertia_si: spec.massKg, damping_si: 35, min_q: -60, max_q: 165, stop_restitution: 0.08 });
    addDof(chain, { id: idA(spec.id), kind: "rotary", q: spec.startAngle, v: 0, inertia_si: inertia(spec), damping_si: spec.kind === "roller" ? 75 : 240, min_q: -1.0e6, max_q: 1.0e6, stop_restitution: 0 });
  }
}

function bodySupportY(chain: LinkedCascadeState, spec: IngredientSpec): number | null {
  const x = mechDof(chain.network, idX(spec.id)).q;
  const y = mechDof(chain.network, idY(spec.id)).q;
  const halfY = spec.sizeY * 0.5;
  let best: number | null = null;

  // The moving MC-11 sky-car is a real support. A body carried on it becomes
  // additional hoist mass in the same force assembly below.
  const car = mechDof(chain.network, MECH_ID.mc11SkyCar);
  const carY = SKY.skyCarBaseY + car.q;
  if (x >= SKY.skyCarX - 3.2 && x <= SKY.skyCarX + 3.2 && y - halfY >= carY - 0.8) best = carY;

  for (const s of SUPPORTS) {
    if (x < s.minX - spec.sizeX * 0.35 || x > s.maxX + spec.sizeX * 0.35) continue;
    if (s.y > y + 0.8) continue;
    if (best == null || s.y > best) best = s.y;
  }
  return best;
}

function restingOnSkyCar(chain: LinkedCascadeState, spec: IngredientSpec): boolean {
  const x = mechDof(chain.network, idX(spec.id)).q;
  const y = mechDof(chain.network, idY(spec.id)).q;
  const car = mechDof(chain.network, MECH_ID.mc11SkyCar);
  const carY = SKY.skyCarBaseY + car.q;
  return (
    x >= SKY.skyCarX - 3.0 &&
    x <= SKY.skyCarX + 3.0 &&
    Math.abs((y - spec.sizeY * 0.5) - carY) < 0.08
  );
}

/** Force assembly only; integration is still performed by the one network step. */
export function applyCompositionBodyForces(chain: LinkedCascadeState, forces: GeneralizedForces): void {
  ensureCompositionBodies(chain);
  const car = mechDof(chain.network, MECH_ID.mc11SkyCar);
  car.inertia_si = SKY.skyCarMassKg;

  for (const spec of INGREDIENTS) {
    const x = mechDof(chain.network, idX(spec.id));
    const y = mechDof(chain.network, idY(spec.id));
    const a = mechDof(chain.network, idA(spec.id));
    addGeneralizedForce(forces, y.id, -spec.massKg * G);

    const exposure = Math.max(0, Math.min(1, (y.q - 80) / 52));
    if (exposure > 0) {
      const wind = highAltitudeWindMps(y.q);
      const windForce = 0.5 * 1.18 * spec.windAreaM2 * wind * wind * exposure;
      addGeneralizedForce(forces, x.id, windForce);
      if (spec.kind === "beam" || spec.kind === "wedge") {
        addGeneralizedForce(forces, a.id, windForce * spec.sizeY * 0.22);
      }
    }

    const support = bodySupportY(chain, spec);
    if (support != null && Math.abs((y.q - spec.sizeY * 0.5) - support) < 0.08) {
      const mu = spec.kind === "roller" ? 0.018 : 0.16;
      if (Math.abs(x.v) > 0.01) addGeneralizedForce(forces, x.id, -mu * spec.massKg * G * Math.sign(x.v));
      if (spec.kind === "roller") {
        const radius = spec.sizeY * 0.5;
        const slip = x.v + a.v * radius;
        const rollingForce = -Math.max(-35000, Math.min(35000, slip * 14000));
        addGeneralizedForce(forces, x.id, rollingForce);
        addGeneralizedForce(forces, a.id, rollingForce * radius);
      }
    }

    if (restingOnSkyCar(chain, spec)) {
      car.inertia_si += spec.massKg;
      addGeneralizedForce(forces, MECH_ID.mc11SkyCar, -spec.massKg * G);
    }
  }
}

/** Post-step unilateral support contacts for the reusable bodies. */
export function enforceCompositionBodyContacts(chain: LinkedCascadeState): void {
  ensureCompositionBodies(chain);
  const car = mechDof(chain.network, MECH_ID.mc11SkyCar);
  for (const spec of INGREDIENTS) {
    const y = mechDof(chain.network, idY(spec.id));
    const support = bodySupportY(chain, spec);
    if (support == null) continue;
    const bottom = y.q - spec.sizeY * 0.5;
    if (y.v <= 0 && bottom <= support && bottom >= support - 0.95) {
      y.q = support + spec.sizeY * 0.5;
      const onCar = restingOnSkyCar(chain, spec) || Math.abs(support - (SKY.skyCarBaseY + car.q)) < 0.04;
      y.v = onCar ? car.v : Math.max(0, -y.v * 0.08);
    }
  }
}

/** Player/body contact impulse. Collider ids are projection names, not mechanics state. */
export function nudgeCompositionBody(chain: LinkedCascadeState, colliderId: string, impulseXNs: number): boolean {
  ensureCompositionBodies(chain);
  const raw = colliderId.startsWith("ingredient:") ? colliderId.slice("ingredient:".length).split(":")[0] : colliderId;
  const spec = INGREDIENTS.find((x) => x.id === raw);
  if (!spec) return false;
  const x = mechDof(chain.network, idX(spec.id));
  const a = mechDof(chain.network, idA(spec.id));
  const bounded = Math.max(-5200, Math.min(5200, impulseXNs));
  x.v += bounded / spec.massKg;
  a.v += (bounded * spec.sizeY * 0.16) / Math.max(1, a.inertia_si);
  return true;
}

export function compositionBodiesFinite(chain: LinkedCascadeState): boolean {
  ensureCompositionBodies(chain);
  return INGREDIENTS.every((spec) => [idX(spec.id), idY(spec.id), idA(spec.id)].every((id) => {
    const d = mechDof(chain.network, id);
    return Number.isFinite(d.q) && Number.isFinite(d.v) && Number.isFinite(d.inertia_si);
  }));
}

export function compositionBodyWorld(chain: LinkedCascadeState) {
  ensureCompositionBodies(chain);
  return INGREDIENTS.map((spec) => {
    const x = mechDof(chain.network, idX(spec.id));
    const y = mechDof(chain.network, idY(spec.id));
    const a = mechDof(chain.network, idA(spec.id));
    return {
      ...spec,
      x: x.q,
      y: y.q,
      z: SKY.z,
      vx: x.v,
      vy: y.v,
      angle: a.q,
      omega: a.v,
    };
  });
}
