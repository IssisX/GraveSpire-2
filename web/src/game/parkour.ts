import type { Collider } from "./collision.ts";

export type ParkourProbe = {
  kind: "step" | "vault" | "ledge" | "drop" | "ladder";
  colliderId: string;
  targetX: number;
  targetY: number;
  targetZ: number;
  topY: number;
  tangentX: number;
  tangentZ: number;
};

function active(colliders: Collider[]): Collider[] {
  return colliders.filter((c) => !c.disabled);
}

function pointInXZ(c: Collider, x: number, z: number, pad = 0): boolean {
  return x >= c.minx - pad && x <= c.maxx + pad && z >= c.minz - pad && z <= c.maxz + pad;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function capsuleClear(
  x: number,
  y: number,
  z: number,
  r: number,
  h: number,
  colliders: Collider[],
  ignoreId?: string,
): boolean {
  for (const c of colliders) {
    if (c.disabled || c.id === ignoreId) continue;
    if (x + r <= c.minx || x - r >= c.maxx || z + r <= c.minz || z - r >= c.maxz) continue;
    if (y + h <= c.miny || y >= c.maxy) continue;
    return false;
  }
  return true;
}

function forwardDepth(c: Collider, x: number, z: number, fx: number, fz: number): number {
  const cx = (c.minx + c.maxx) * 0.5;
  const cz = (c.minz + c.maxz) * 0.5;
  const hx = (c.maxx - c.minx) * 0.5;
  const hz = (c.maxz - c.minz) * 0.5;
  return (cx - x) * fx + (cz - z) * fz + Math.abs(fx) * hx + Math.abs(fz) * hz;
}

/**
 * Finds a real AABB obstacle in front of the capsule. No parkour tags are used:
 * eligibility is entirely height, approach geometry and landing clearance.
 */
export function probeVault(args: {
  x: number;
  y: number;
  z: number;
  fx: number;
  fz: number;
  speed: number;
  radius: number;
  height: number;
  colliders: Collider[];
}): ParkourProbe | null {
  const list = active(args.colliders);
  let best: { c: Collider; d: number; top: number } | null = null;
  for (const c of list) {
    const top = c.maxy - args.y;
    if (top < 0.18 || top > 1.08) continue;
    for (let d = 0.34; d <= 0.92; d += 0.10) {
      const px = args.x + args.fx * d;
      const pz = args.z + args.fz * d;
      if (!pointInXZ(c, px, pz, 0.05)) continue;
      if (!best || d < best.d) best = { c, d, top };
      break;
    }
  }
  if (!best) return null;
  if (best.top > 0.58 && args.speed < 1.6) return null;
  const far = Math.max(0.55, forwardDepth(best.c, args.x, args.z, args.fx, args.fz) + 0.46);
  const tx = args.x + args.fx * far;
  const tz = args.z + args.fz * far;
  const ty = best.c.maxy;
  if (!capsuleClear(tx, ty + 0.02, tz, args.radius * 0.9, args.height, list, best.c.id)) return null;
  return {
    kind: best.top <= 0.48 ? "step" : "vault",
    colliderId: best.c.id,
    targetX: tx,
    targetY: ty,
    targetZ: tz,
    topY: ty,
    tangentX: -args.fz,
    tangentZ: args.fx,
  };
}

/**
 * Finds an edge that the player's hand envelope can actually reach while
 * airborne. This is geometry-derived and works on moving mechanism colliders.
 */
export function probeLedgeCatch(args: {
  x: number;
  y: number;
  z: number;
  fx: number;
  fz: number;
  vy: number;
  radius: number;
  colliders: Collider[];
}): ParkourProbe | null {
  if (args.vy > 2.0 || args.vy < -13.5) return null;
  const list = active(args.colliders);
  let best: { c: Collider; d: number } | null = null;
  for (const c of list) {
    const handReach = c.maxy - args.y;
    if (handReach < 0.92 || handReach > 1.76) continue;
    for (let d = 0.28; d <= 0.72; d += 0.08) {
      const px = args.x + args.fx * d;
      const pz = args.z + args.fz * d;
      if (!pointInXZ(c, px, pz, 0.08)) continue;
      if (!best || d < best.d) best = { c, d };
      break;
    }
  }
  if (!best) return null;
  const c = best.c;
  const hangX = args.x + args.fx * Math.max(0.08, best.d - args.radius * 0.75);
  const hangZ = args.z + args.fz * Math.max(0.08, best.d - args.radius * 0.75);
  const hangY = c.maxy - 1.42;
  if (!capsuleClear(hangX, hangY, hangZ, args.radius * 0.85, 1.35, list, c.id)) return null;
  return {
    kind: "ledge",
    colliderId: c.id,
    targetX: hangX,
    targetY: hangY,
    targetZ: hangZ,
    topY: c.maxy,
    tangentX: -args.fz,
    tangentZ: args.fx,
  };
}

/**
 * Finds a hand-reachable physical ladder face. A ladder must be approached
 * from its declared side and the probe is derived from the player capsule,
 * so there is no invisible climb field beside the steel.
 */
export function probeLadderGrab(args: {
  x: number;
  y: number;
  z: number;
  fx: number;
  fz: number;
  radius: number;
  colliders: Collider[];
}): ParkourProbe | null {
  let best: { c: Collider; distance: number } | null = null;
  for (const c of active(args.colliders)) {
    const face = c.climbable;
    if (!face) continue;
    const approach = args.fx * face.normalX + args.fz * face.normalZ;
    if (approach > -0.18) continue;
    if (args.y + 1.42 < c.miny + 0.12 || args.y > c.maxy - 0.08) continue;
    const cx = clamp(args.x, c.minx, c.maxx);
    const cz = clamp(args.z, c.minz, c.maxz);
    const distance = Math.hypot(args.x - cx, args.z - cz);
    if (distance > args.radius + 0.48) continue;
    if (!best || distance < best.distance) best = { c, distance };
  }
  if (!best) return null;
  const c = best.c;
  const face = c.climbable!;
  const targetY = clamp(args.y, c.miny + 0.02, c.maxy - 0.08);
  const centerX = clamp(args.x, c.minx, c.maxx);
  const centerZ = clamp(args.z, c.minz, c.maxz);
  return {
    kind: "ladder",
    colliderId: c.id,
    targetX: centerX + face.normalX * (args.radius + 0.07),
    targetY,
    targetZ: centerZ + face.normalZ * (args.radius + 0.07),
    topY: c.maxy,
    tangentX: -face.normalZ,
    tangentZ: face.normalX,
  };
}

function rayExitDistance(c: Collider, x: number, z: number, fx: number, fz: number): number {
  const candidates: number[] = [];
  if (fx > 1e-5) candidates.push((c.maxx - x) / fx);
  else if (fx < -1e-5) candidates.push((c.minx - x) / fx);
  if (fz > 1e-5) candidates.push((c.maxz - z) / fz);
  else if (fz < -1e-5) candidates.push((c.minz - z) / fz);
  const positive = candidates.filter((t) => t >= 0);
  return positive.length ? Math.min(...positive) : Number.POSITIVE_INFINITY;
}

/** Controlled transition from standing on a support to hanging from its edge. */
export function probeControlledDrop(args: {
  x: number;
  y: number;
  z: number;
  fx: number;
  fz: number;
  groundedId: string | null;
  radius: number;
  colliders: Collider[];
}): ParkourProbe | null {
  if (!args.groundedId) return null;
  const c = args.colliders.find((x) => x.id === args.groundedId && !x.disabled);
  if (!c || Math.abs(args.y - c.maxy) > 0.18) return null;
  const exit = rayExitDistance(c, args.x, args.z, args.fx, args.fz);
  if (!Number.isFinite(exit) || exit > 0.72) return null;
  const x = args.x + args.fx * (exit + args.radius * 0.72);
  const z = args.z + args.fz * (exit + args.radius * 0.72);
  return {
    kind: "drop",
    colliderId: c.id,
    targetX: x,
    targetY: c.maxy - 1.42,
    targetZ: z,
    topY: c.maxy,
    tangentX: -args.fz,
    tangentZ: args.fx,
  };
}

/** A shimmy is valid only while hands remain beside the same physical edge. */
export function canShimmy(
  probe: ParkourProbe,
  sign: -1 | 1,
  distance: number,
  colliders: Collider[],
): boolean {
  const c = colliders.find((x) => x.id === probe.colliderId && !x.disabled);
  if (!c) return false;
  // targetX/Z are the capsule center while hanging. Check the physical hand
  // envelope against the ledge, not the body center left behind its face.
  const handReach = 0.36;
  const forwardX = probe.tangentZ;
  const forwardZ = -probe.tangentX;
  const x = probe.targetX + forwardX * handReach + probe.tangentX * sign * distance;
  const z = probe.targetZ + forwardZ * handReach + probe.tangentZ * sign * distance;
  return pointInXZ(c, x, z, 0.22);
}
