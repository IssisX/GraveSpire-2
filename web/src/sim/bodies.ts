/**
 * Movable mass with contact.
 *
 * This is authoritative simulation, not decoration. Every body here has mass,
 * a real inertia tensor, orientation, and resolves contact against the static
 * world and against other bodies through impulses applied at actual contact
 * points. Because impulses land at their true locations, torque about a contact
 * is real: a mass placed past a support edge tips, a beam over a drum levers, a
 * load moved outboard shifts the centre of mass of whatever is carrying it.
 *
 * None of those are special cases. There is no "lever mechanic" and no "bridge
 * flag". A beam laid across a gap is walkable because its contact volume is a
 * contact volume; a block becomes a counterweight because it has weight.
 *
 * DECLARED REDUCTION. Contacts are generated from box corner points against
 * oriented boxes and against the world's axis-aligned static colliders. That is
 * enough for resting, stacking, tipping, sliding, wedging and bridging. It is
 * not a general convex solver: edge-on-edge contact between two tilted boxes is
 * approximated by whichever corners are penetrating, and no body deforms. This
 * file does not model fracture.
 */

import { G, clamp } from "./types.ts";

export type BodyMaterial = "steel" | "concrete" | "crate";

export interface BodyState {
  id: string;
  name: string;
  material: BodyMaterial;
  /** Half extents in body space, metres. */
  hx: number;
  hy: number;
  hz: number;
  mass_kg: number;

  px: number;
  py: number;
  pz: number;
  /** Orientation quaternion. */
  qx: number;
  qy: number;
  qz: number;
  qw: number;

  vx: number;
  vy: number;
  vz: number;
  wx: number;
  wy: number;
  wz: number;

  /** Seconds this body has been below the sleep threshold. */
  restT: number;
  /** Asleep bodies keep their state and their support role; they do not expire. */
  sleeping: boolean;
  /** Set while the player or a machine is driving this body. */
  attached: "player" | "hook" | null;
  /** Accumulated contact reaction magnitude last tick, N. Diagnostic. */
  reaction_n: number;
}

export interface BodyDef {
  id: string;
  name: string;
  material: BodyMaterial;
  size: [number, number, number];
  mass_kg: number;
  at: [number, number, number];
  /** Initial yaw, radians. */
  yaw?: number;
}

/** Static world box the bodies can rest on. Mirrors the player's collider. */
export interface StaticBox {
  id: string;
  /** Kinematic velocity, m/s. A moving machine carries what rests on it. */
  vx?: number;
  vy?: number;
  vz?: number;
  minx: number;
  miny: number;
  minz: number;
  maxx: number;
  maxy: number;
  maxz: number;
  disabled?: boolean;
}

/** Normal reaction delivered into each static collider this tick, in newtons. */
export type SupportReactions = Map<string, number>;

const FRICTION: Record<BodyMaterial, number> = {
  steel: 0.42,
  concrete: 0.62,
  crate: 0.54,
};

const RESTITUTION = 0.02;
/** Allowed overlap before position correction fights it, metres. */
const SLOP = 0.004;
/** Fraction of remaining penetration removed per substep. */
const BAUMGARTE = 0.22;
const SOLVER_ITERATIONS = 6;

const SLEEP_LINEAR = 0.045;
const SLEEP_ANGULAR = 0.07;
const SLEEP_TIME_S = 0.7;

export function makeBody(def: BodyDef): BodyState {
  const [sx, sy, sz] = def.size;
  const yaw = def.yaw ?? 0;
  return {
    id: def.id,
    name: def.name,
    material: def.material,
    hx: sx / 2,
    hy: sy / 2,
    hz: sz / 2,
    mass_kg: def.mass_kg,
    px: def.at[0],
    py: def.at[1],
    pz: def.at[2],
    qx: 0,
    qy: Math.sin(yaw / 2),
    qz: 0,
    qw: Math.cos(yaw / 2),
    vx: 0,
    vy: 0,
    vz: 0,
    wx: 0,
    wy: 0,
    wz: 0,
    restT: 0,
    sleeping: false,
    attached: null,
    reaction_n: 0,
  };
}

/* ------------------------------------------------------------ quaternions -- */

function qNormalize(b: BodyState): void {
  const n = Math.hypot(b.qx, b.qy, b.qz, b.qw) || 1;
  b.qx /= n;
  b.qy /= n;
  b.qz /= n;
  b.qw /= n;
}

/** Rotate a vector by the body's orientation. */
function rotate(b: BodyState, x: number, y: number, z: number): [number, number, number] {
  const { qx, qy, qz, qw } = b;
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [
    x + qw * tx + (qy * tz - qz * ty),
    y + qw * ty + (qz * tx - qx * tz),
    z + qw * tz + (qx * ty - qy * tx),
  ];
}

/** Rotate a vector by the inverse orientation (world -> body). */
function unrotate(b: BodyState, x: number, y: number, z: number): [number, number, number] {
  const { qx, qy, qz, qw } = b;
  const tx = 2 * (-qy * z + qz * y);
  const ty = 2 * (-qz * x + qx * z);
  const tz = 2 * (-qx * y + qy * x);
  return [
    x + qw * tx + (-qy * tz + qz * ty),
    y + qw * ty + (-qz * tx + qx * tz),
    z + qw * tz + (-qx * ty + qy * tx),
  ];
}

/** Inverse inertia tensor diagonal in body space, for a solid box. */
function invInertiaLocal(b: BodyState): [number, number, number] {
  const w = 2 * b.hx;
  const h = 2 * b.hy;
  const d = 2 * b.hz;
  const k = b.mass_kg / 12;
  const ix = k * (h * h + d * d);
  const iy = k * (w * w + d * d);
  const iz = k * (w * w + h * h);
  return [ix > 0 ? 1 / ix : 0, iy > 0 ? 1 / iy : 0, iz > 0 ? 1 / iz : 0];
}

/** Apply the inverse inertia tensor to a world-space vector. */
function applyInvInertia(b: BodyState, x: number, y: number, z: number): [number, number, number] {
  const [lx, ly, lz] = unrotate(b, x, y, z);
  const [ax, ay, az] = invInertiaLocal(b);
  return rotate(b, lx * ax, ly * ay, lz * az);
}

/* ---------------------------------------------------------------- shapes -- */

const CORNER_SIGNS: ReadonlyArray<readonly [number, number, number]> = [
  [-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1],
];

/** World-space corners of a body, written into `out` as 8 [x,y,z] triples. */
export function bodyCorners(b: BodyState, out: number[]): void {
  for (let i = 0; i < 8; i++) {
    const s = CORNER_SIGNS[i]!;
    const [x, y, z] = rotate(b, s[0] * b.hx, s[1] * b.hy, s[2] * b.hz);
    out[i * 3] = b.px + x;
    out[i * 3 + 1] = b.py + y;
    out[i * 3 + 2] = b.pz + z;
  }
}

/** Conservative world-space AABB of a body. */
export function bodyAabb(b: BodyState): { minx: number; miny: number; minz: number; maxx: number; maxy: number; maxz: number } {
  const c: number[] = new Array(24);
  bodyCorners(b, c);
  let minx = Infinity, miny = Infinity, minz = Infinity;
  let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  for (let i = 0; i < 8; i++) {
    const x = c[i * 3]!, y = c[i * 3 + 1]!, z = c[i * 3 + 2]!;
    if (x < minx) minx = x;
    if (y < miny) miny = y;
    if (z < minz) minz = z;
    if (x > maxx) maxx = x;
    if (y > maxy) maxy = y;
    if (z > maxz) maxz = z;
  }
  return { minx, miny, minz, maxx, maxy, maxz };
}

/**
 * How far the body's own up-axis has tilted from world up, radians.
 * A body lying flat is safe to expose to the player's axis-aligned collider;
 * a steeply tilted one is not, and is left non-walkable rather than lying
 * about where its surface is.
 */
export function bodyTilt(b: BodyState): number {
  const [, uy] = rotate(b, 0, 1, 0);
  return Math.acos(clamp(Math.abs(uy), -1, 1));
}

interface Contact {
  /** Body receiving the impulse. */
  a: BodyState;
  /** Other body, or null for the static world. */
  other: BodyState | null;
  /** Static collider id when `other` is null. */
  staticId: string | null;
  /** Velocity of a kinematic static support. */
  svx: number;
  svy: number;
  svz: number;
  /** Contact point, world space. */
  px: number;
  py: number;
  pz: number;
  /** Unit normal pushing `a` out. */
  nx: number;
  ny: number;
  nz: number;
  depth: number;
  friction: number;
  /** Accumulated normal impulse, for friction clamping and reporting. */
  jn: number;
  /**
   * Friction tangent direction, fixed for the whole solve once contact is
   * built. Accumulated impulse (`jt`) is only meaningful measured along a
   * direction that does not itself change between iterations.
   */
  ttx: number;
  tty: number;
  ttz: number;
  hasTangent: boolean;
  /** Accumulated tangential (friction) impulse along ttx/tty/ttz. */
  jt: number;
}

/** Unit tangent-plane direction of a relative velocity, or null if negligible. */
function tangentDirection(
  vx: number,
  vy: number,
  vz: number,
  nx: number,
  ny: number,
  nz: number,
): [number, number, number] | null {
  const vn = vx * nx + vy * ny + vz * nz;
  const tx = vx - vn * nx;
  const ty = vy - vn * ny;
  const tz = vz - vn * nz;
  const m = Math.hypot(tx, ty, tz);
  if (m < 1e-6) return null;
  return [tx / m, ty / m, tz / m];
}

/** Relative velocity at a contact point, static support included. */
function relativeVelocityAt(
  a: BodyState,
  o: BodyState | null,
  svx: number,
  svy: number,
  svz: number,
  arx: number,
  ary: number,
  arz: number,
  orx: number,
  ory: number,
  orz: number,
): [number, number, number] {
  const [avx, avy, avz] = velocityAt(a, arx, ary, arz);
  let bvx = svx, bvy = svy, bvz = svz;
  if (o) [bvx, bvy, bvz] = velocityAt(o, orx, ory, orz);
  return [avx - bvx, avy - bvy, avz - bvz];
}

/** Deepest-axis penetration of a world point inside an axis-aligned box. */
function pointInStatic(
  s: StaticBox,
  x: number,
  y: number,
  z: number,
): { nx: number; ny: number; nz: number; depth: number } | null {
  if (x <= s.minx || x >= s.maxx || y <= s.miny || y >= s.maxy || z <= s.minz || z >= s.maxz) return null;
  const dxMin = x - s.minx;
  const dxMax = s.maxx - x;
  const dyMin = y - s.miny;
  const dyMax = s.maxy - y;
  const dzMin = z - s.minz;
  const dzMax = s.maxz - z;
  let best = dyMax;
  let nx = 0, ny = 1, nz = 0;
  if (dyMin < best) { best = dyMin; nx = 0; ny = -1; nz = 0; }
  if (dxMax < best) { best = dxMax; nx = 1; ny = 0; nz = 0; }
  if (dxMin < best) { best = dxMin; nx = -1; ny = 0; nz = 0; }
  if (dzMax < best) { best = dzMax; nx = 0; ny = 0; nz = 1; }
  if (dzMin < best) { best = dzMin; nx = 0; ny = 0; nz = -1; }
  return { nx, ny, nz, depth: best };
}

/** Deepest-axis penetration of a world point inside an oriented body. */
function pointInBody(
  b: BodyState,
  x: number,
  y: number,
  z: number,
): { nx: number; ny: number; nz: number; depth: number } | null {
  const [lx, ly, lz] = unrotate(b, x - b.px, y - b.py, z - b.pz);
  const ax = b.hx - Math.abs(lx);
  if (ax <= 0) return null;
  const ay = b.hy - Math.abs(ly);
  if (ay <= 0) return null;
  const az = b.hz - Math.abs(lz);
  if (az <= 0) return null;
  let best = ay;
  let nlx = 0, nly = Math.sign(ly) || 1, nlz = 0;
  if (ax < best) { best = ax; nlx = Math.sign(lx) || 1; nly = 0; nlz = 0; }
  if (az < best) { best = az; nlx = 0; nly = 0; nlz = Math.sign(lz) || 1; }
  const [nx, ny, nz] = rotate(b, nlx, nly, nlz);
  return { nx, ny, nz, depth: best };
}

function aabbOverlap(
  a: { minx: number; miny: number; minz: number; maxx: number; maxy: number; maxz: number },
  b: { minx: number; miny: number; minz: number; maxx: number; maxy: number; maxz: number },
  pad: number,
): boolean {
  return (
    a.maxx + pad > b.minx && a.minx - pad < b.maxx &&
    a.maxy + pad > b.miny && a.miny - pad < b.maxy &&
    a.maxz + pad > b.minz && a.minz - pad < b.maxz
  );
}

/* ------------------------------------------------------------- integrate -- */

function velocityAt(b: BodyState, rx: number, ry: number, rz: number): [number, number, number] {
  return [
    b.vx + (b.wy * rz - b.wz * ry),
    b.vy + (b.wz * rx - b.wx * rz),
    b.vz + (b.wx * ry - b.wy * rx),
  ];
}

function applyImpulse(b: BodyState, jx: number, jy: number, jz: number, rx: number, ry: number, rz: number): void {
  const invM = 1 / b.mass_kg;
  b.vx += jx * invM;
  b.vy += jy * invM;
  b.vz += jz * invM;
  const tx = ry * jz - rz * jy;
  const ty = rz * jx - rx * jz;
  const tz = rx * jy - ry * jx;
  const [dwx, dwy, dwz] = applyInvInertia(b, tx, ty, tz);
  b.wx += dwx;
  b.wy += dwy;
  b.wz += dwz;
}

/**
 * What a person can put into an object with their hands and a bar, in newtons.
 *
 * This single number is the whole carry/drag/machinery ladder. A 26 kg crate
 * lifts (255 N). A 58 kg plate lifts, awkwardly (569 N). A 150 kg spool will not
 * lift but slides (618 N of friction). A 245 kg section beam neither lifts nor
 * slides (1010 N of friction) and needs the hook, a lever, or something else
 * clever. Nothing in the code enumerates those cases.
 */
export const PLAYER_FORCE_N = 900;

/** Drive a held body toward a target point with the player's bounded force. */
export function applyCarryForce(
  b: BodyState,
  tx: number,
  ty: number,
  tz: number,
  dt: number,
): void {
  // A hand actively pulling on something is the definition of "not at rest."
  // Without this, a held body that briefly slows near equilibrium can cross
  // the sleep threshold; stepBodies then skips it entirely (no contact, no
  // position integration) while this function keeps writing raw velocity into
  // it every frame, producing runaway velocity with zero actual displacement.
  b.sleeping = false;
  b.restT = 0;
  const dx = tx - b.px;
  const dy = ty - b.py;
  const dz = tz - b.pz;
  // Critically damped pull toward the hands, saturated at what a person has.
  const kP = 28;
  const kD = 9;
  let fx = (dx * kP - b.vx * kD) * b.mass_kg;
  let fy = (dy * kP - b.vy * kD) * b.mass_kg;
  let fz = (dz * kP - b.vz * kD) * b.mass_kg;
  // No gravity feedforward: gravity is already integrated once, in stepBodies.
  // A drag along the ground spends the budget on friction, because the floor
  // — not the player's arms — is what is holding the weight up. Lifting a
  // body clear of the ground genuinely costs the full mg, because now this
  // term is the only thing opposing gravity.
  const mag = Math.hypot(fx, fy, fz);
  if (mag > PLAYER_FORCE_N) {
    const k = PLAYER_FORCE_N / mag;
    fx *= k;
    fy *= k;
    fz *= k;
  }
  const invM = 1 / b.mass_kg;
  b.vx += fx * invM * dt;
  b.vy += fy * invM * dt;
  b.vz += fz * invM * dt;
  // Damp spin so a carried object does not windmill.
  const s = Math.exp(-6 * dt);
  b.wx *= s;
  b.wy *= s;
  b.wz *= s;
}

/**
 * Advance every body one substep and resolve contact.
 *
 * Returns the normal reaction delivered into each static collider, in newtons,
 * so the structural layer can treat resting mass as measured load rather than
 * as a hardcoded constant.
 */
export function stepBodies(
  bodies: BodyState[],
  statics: StaticBox[],
  dt: number,
  reactions: SupportReactions,
): void {
  if (bodies.length === 0) return;

  // ---- integrate velocities ----------------------------------------------
  for (const b of bodies) {
    if (b.sleeping || b.attached === "hook") continue;
    b.vy -= G * dt;
    // Mild drag keeps the explicit integrator well behaved without pretending
    // to be air resistance.
    const d = Math.exp(-0.25 * dt);
    b.vx *= d;
    b.vy *= d;
    b.vz *= d;
    b.wx *= Math.exp(-1.2 * dt);
    b.wy *= Math.exp(-1.2 * dt);
    b.wz *= Math.exp(-1.2 * dt);
  }

  // ---- build contacts ------------------------------------------------------
  const contacts: Contact[] = [];
  const corners: number[] = new Array(24);
  const aabbs = bodies.map((b) => bodyAabb(b));

  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i]!;
    if (b.sleeping) continue;
    bodyCorners(b, corners);
    const friction = FRICTION[b.material];
    const box = aabbs[i]!;

    for (const s of statics) {
      if (s.disabled) continue;
      if (!aabbOverlap(box, s, 0.02)) continue;
      for (let c = 0; c < 8; c++) {
        const cx = corners[c * 3]!, cy = corners[c * 3 + 1]!, cz = corners[c * 3 + 2]!;
        const hit = pointInStatic(s, cx, cy, cz);
        if (!hit) continue;
        const svx0 = s.vx ?? 0, svy0 = s.vy ?? 0, svz0 = s.vz ?? 0;
        const arx0 = cx - b.px, ary0 = cy - b.py, arz0 = cz - b.pz;
        const [rvx0, rvy0, rvz0] = relativeVelocityAt(b, null, svx0, svy0, svz0, arx0, ary0, arz0, 0, 0, 0);
        const tan0 = tangentDirection(rvx0, rvy0, rvz0, hit.nx, hit.ny, hit.nz);
        contacts.push({
          a: b, other: null, staticId: s.id,
          svx: svx0, svy: svy0, svz: svz0,
          px: cx, py: cy, pz: cz,
          nx: hit.nx, ny: hit.ny, nz: hit.nz,
          depth: hit.depth, friction, jn: 0,
          ttx: tan0?.[0] ?? 0, tty: tan0?.[1] ?? 0, ttz: tan0?.[2] ?? 0,
          hasTangent: tan0 !== null, jt: 0,
        });
      }
    }

    for (let j = 0; j < bodies.length; j++) {
      if (i === j) continue;
      const o = bodies[j]!;
      if (!aabbOverlap(box, aabbs[j]!, 0.02)) continue;
      const mu = Math.min(friction, FRICTION[o.material]);
      for (let c = 0; c < 8; c++) {
        const cx = corners[c * 3]!, cy = corners[c * 3 + 1]!, cz = corners[c * 3 + 2]!;
        const hit = pointInBody(o, cx, cy, cz);
        if (!hit) continue;
        const arx1 = cx - b.px, ary1 = cy - b.py, arz1 = cz - b.pz;
        const orx1 = cx - o.px, ory1 = cy - o.py, orz1 = cz - o.pz;
        const [rvx1, rvy1, rvz1] = relativeVelocityAt(b, o, 0, 0, 0, arx1, ary1, arz1, orx1, ory1, orz1);
        const tan1 = tangentDirection(rvx1, rvy1, rvz1, hit.nx, hit.ny, hit.nz);
        contacts.push({
          a: b, other: o, staticId: null,
          svx: 0, svy: 0, svz: 0,
          px: cx, py: cy, pz: cz,
          nx: hit.nx, ny: hit.ny, nz: hit.nz,
          depth: hit.depth, friction: mu, jn: 0,
          ttx: tan1?.[0] ?? 0, tty: tan1?.[1] ?? 0, ttz: tan1?.[2] ?? 0,
          hasTangent: tan1 !== null, jt: 0,
        });
      }
    }
  }

  // ---- sequential impulses -------------------------------------------------
  for (let iter = 0; iter < SOLVER_ITERATIONS; iter++) {
    for (const k of contacts) {
      const a = k.a;
      const o = k.other;
      const arx = k.px - a.px, ary = k.py - a.py, arz = k.pz - a.pz;
      const [avx, avy, avz] = velocityAt(a, arx, ary, arz);

      let orx = 0, ory = 0, orz = 0;
      let bvx = k.svx, bvy = k.svy, bvz = k.svz;
      if (o) {
        orx = k.px - o.px; ory = k.py - o.py; orz = k.pz - o.pz;
        [bvx, bvy, bvz] = velocityAt(o, orx, ory, orz);
      }

      const rvx = avx - bvx, rvy = avy - bvy, rvz = avz - bvz;
      const vn = rvx * k.nx + rvy * k.ny + rvz * k.nz;

      // Effective mass along the normal, including the angular term. This is
      // what makes an impulse at the edge of a body rotate it.
      let effInv = 1 / a.mass_kg;
      {
        const cx = ary * k.nz - arz * k.ny;
        const cy = arz * k.nx - arx * k.nz;
        const cz = arx * k.ny - ary * k.nx;
        const [ix, iy, iz] = applyInvInertia(a, cx, cy, cz);
        effInv += (iy * arz - iz * ary) * k.nx + (iz * arx - ix * arz) * k.ny + (ix * ary - iy * arx) * k.nz;
      }
      if (o && o.attached !== "hook") {
        effInv += 1 / o.mass_kg;
        const cx = ory * k.nz - orz * k.ny;
        const cy = orz * k.nx - orx * k.nz;
        const cz = orx * k.ny - ory * k.nx;
        const [ix, iy, iz] = applyInvInertia(o, cx, cy, cz);
        effInv += (iy * orz - iz * ory) * k.nx + (iz * orx - ix * orz) * k.ny + (ix * ory - iy * orx) * k.nz;
      }
      if (effInv <= 1e-9) continue;

      const bias = (BAUMGARTE * Math.max(0, k.depth - SLOP)) / dt;
      let j = (-(1 + RESTITUTION) * vn + bias) / effInv;
      // Accumulated clamp: the total normal impulse may never pull.
      const prev = k.jn;
      k.jn = Math.max(0, prev + j);
      j = k.jn - prev;
      if (j !== 0) {
        applyImpulse(a, k.nx * j, k.ny * j, k.nz * j, arx, ary, arz);
        if (o && o.attached !== "hook" && !o.sleeping) {
          applyImpulse(o, -k.nx * j, -k.ny * j, -k.nz * j, orx, ory, orz);
        }
      }

      // ---- Coulomb friction ---------------------------------------------------
      // The tangent direction was fixed when this contact was built, and `jt`
      // is the TOTAL friction impulse applied along it so far this solve.
      // Each sweep computes only the additional impulse needed to zero the
      // remaining tangential velocity, clamps the *running total* to
      // mu * jn, and applies the difference. Without that accumulation, six
      // Gauss-Seidel sweeps each re-apply up to a full mu*jn impulse
      // independently — friction ends up several times stronger than
      // Coulomb's limit allows, and nothing can ever slide.
      if (!k.hasTangent) continue;
      const [avx2, avy2, avz2] = velocityAt(a, arx, ary, arz);
      let ovx = k.svx, ovy = k.svy, ovz = k.svz;
      if (o) [ovx, ovy, ovz] = velocityAt(o, orx, ory, orz);
      const vt = (avx2 - ovx) * k.ttx + (avy2 - ovy) * k.tty + (avz2 - ovz) * k.ttz;

      let effT = 1 / a.mass_kg;
      {
        const cx = ary * k.ttz - arz * k.tty;
        const cy = arz * k.ttx - arx * k.ttz;
        const cz = arx * k.tty - ary * k.ttx;
        const [ix, iy, iz] = applyInvInertia(a, cx, cy, cz);
        effT += (iy * arz - iz * ary) * k.ttx + (iz * arx - ix * arz) * k.tty + (ix * ary - iy * arx) * k.ttz;
      }
      if (o && o.attached !== "hook") effT += 1 / o.mass_kg;
      if (effT <= 1e-9) continue;

      const jtMax = k.friction * k.jn;
      const prevJt = k.jt;
      k.jt = clamp(prevJt - vt / effT, -jtMax, jtMax);
      const dJt = k.jt - prevJt;
      if (dJt === 0) continue;
      applyImpulse(a, k.ttx * dJt, k.tty * dJt, k.ttz * dJt, arx, ary, arz);
      if (o && o.attached !== "hook" && !o.sleeping) {
        applyImpulse(o, -k.ttx * dJt, -k.tty * dJt, -k.ttz * dJt, orx, ory, orz);
      }
    }
  }

  // ---- report measured reactions ------------------------------------------
  for (const b of bodies) b.reaction_n = 0;
  for (const k of contacts) {
    const force = k.jn / dt;
    k.a.reaction_n += force;
    if (k.staticId) {
      reactions.set(k.staticId, (reactions.get(k.staticId) ?? 0) + force);
    }
  }

  // ---- integrate positions and manage sleep --------------------------------
  for (const b of bodies) {
    if (b.sleeping || b.attached === "hook") continue;
    b.px += b.vx * dt;
    b.py += b.vy * dt;
    b.pz += b.vz * dt;
    const wl = Math.hypot(b.wx, b.wy, b.wz);
    if (wl > 1e-8) {
      const half = wl * dt * 0.5;
      const s = Math.sin(half) / wl;
      const cw = Math.cos(half);
      const ix = b.wx * s, iy = b.wy * s, iz = b.wz * s;
      const nx = cw * b.qx + ix * b.qw + iy * b.qz - iz * b.qy;
      const ny = cw * b.qy - ix * b.qz + iy * b.qw + iz * b.qx;
      const nz = cw * b.qz + ix * b.qy - iy * b.qx + iz * b.qw;
      const nw = cw * b.qw - ix * b.qx - iy * b.qy - iz * b.qz;
      b.qx = nx; b.qy = ny; b.qz = nz; b.qw = nw;
      qNormalize(b);
    }

    const speed = Math.hypot(b.vx, b.vy, b.vz);
    if (speed < SLEEP_LINEAR && wl < SLEEP_ANGULAR) {
      b.restT += dt;
      if (b.restT > SLEEP_TIME_S) {
        b.sleeping = true;
        b.vx = 0; b.vy = 0; b.vz = 0;
        b.wx = 0; b.wy = 0; b.wz = 0;
      }
    } else {
      b.restT = 0;
    }
  }
}

/**
 * Wake a body and anything resting near it.
 *
 * Sleeping preserves state and support relationships; it never deletes a body
 * or forfeits its mechanical role. Waking is how a change propagates into a
 * settled stack.
 */
export function wakeBody(bodies: BodyState[], b: BodyState, radius = 2.2): void {
  b.sleeping = false;
  b.restT = 0;
  for (const o of bodies) {
    if (o === b || !o.sleeping) continue;
    if (Math.hypot(o.px - b.px, o.py - b.py, o.pz - b.pz) < radius + Math.max(o.hx, o.hy, o.hz)) {
      o.sleeping = false;
      o.restT = 0;
    }
  }
}

export function wakeAll(bodies: BodyState[]): void {
  for (const b of bodies) {
    b.sleeping = false;
    b.restT = 0;
  }
}

/**
 * Static weight a sleeping body still presses into a named support.
 *
 * Sleep exists so a settled body stops paying for contact solving every
 * frame; it must not also mean the body stops existing structurally. A
 * ballast block dragged onto a deck and left there keeps loading that deck
 * while asleep exactly as it did the instant before it settled — this is
 * that resting weight, read geometrically instead of from the (idle) solver.
 */
export function sleepingWeightOn(
  bodies: readonly BodyState[],
  statics: readonly StaticBox[],
  ids: readonly string[],
): number {
  let total = 0;
  for (const b of bodies) {
    if (!b.sleeping) continue;
    const ab = bodyAabb(b);
    for (const sid of ids) {
      const st = statics.find((x) => x.id === sid);
      if (!st || st.disabled) continue;
      const restingOnTop = Math.abs(ab.miny - st.maxy) < 0.03;
      const overlapsX = ab.maxx > st.minx && ab.minx < st.maxx;
      const overlapsZ = ab.maxz > st.minz && ab.minz < st.maxz;
      if (restingOnTop && overlapsX && overlapsZ) {
        total += supportedMass(bodies as BodyState[], b) * G;
        break;
      }
    }
  }
  return total;
}

/** Mass a body presents to whatever is carrying it, including anything stacked. */
export function supportedMass(bodies: BodyState[], b: BodyState): number {
  let m = b.mass_kg;
  const top = bodyAabb(b).maxy;
  for (const o of bodies) {
    if (o === b) continue;
    const ob = bodyAabb(o);
    if (ob.miny > top - 0.12 && ob.miny < top + 0.25) {
      const bb = bodyAabb(b);
      if (ob.maxx > bb.minx && ob.minx < bb.maxx && ob.maxz > bb.minz && ob.minz < bb.maxz) {
        m += o.mass_kg;
      }
    }
  }
  return m;
}
