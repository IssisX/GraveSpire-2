export type Collider = {
  id: string;
  minx: number;
  miny: number;
  minz: number;
  maxx: number;
  maxy: number;
  maxz: number;
  platform?: "carrier" | "gate";
  disabled?: boolean;
};

export type Capsule = {
  x: number;
  y: number;
  z: number;
  r: number;
  h: number;
};

function overlapX(c: Collider, x: number, r: number) {
  return x + r > c.minx && x - r < c.maxx;
}
function overlapZ(c: Collider, z: number, r: number) {
  return z + r > c.minz && z - r < c.maxz;
}
function overlapY(c: Collider, y: number, h: number) {
  return y + h > c.miny && y < c.maxy;
}

export function moveCapsule(
  cap: Capsule,
  vx: number,
  vy: number,
  vz: number,
  colliders: Collider[],
  stepUp = 0.4,
): { x: number; y: number; z: number; grounded: boolean; groundedId: string | null; hitHead: boolean } {
  let { x, y, z, r, h } = cap;
  const list = colliders.filter((c) => !c.disabled);

  const resolveAxis = (axis: "x" | "z") => {
    for (const c of list) {
      if (!overlapY(c, y + 0.02, h - 0.04)) continue;
      if (axis === "x" && overlapX(c, x, r) && overlapZ(c, z, r * 0.92)) {
        const left = Math.abs(x + r - c.minx);
        const right = Math.abs(c.maxx - (x - r));
        const upTry = c.maxy - y;
        if (upTry > 0 && upTry <= stepUp && y + 0.05 < c.maxy) {
          const ny = c.maxy;
          let blocked = false;
          for (const o of list) {
            if (o === c) continue;
            if (overlapX(o, x, r) && overlapZ(o, z, r) && ny + h > o.miny && ny < o.maxy) blocked = true;
          }
          if (!blocked) {
            y = ny;
            continue;
          }
        }
        if (left < right) x = c.minx - r - 0.001;
        else x = c.maxx + r + 0.001;
      }
      if (axis === "z" && overlapZ(c, z, r) && overlapX(c, x, r * 0.92)) {
        const dn = Math.abs(z + r - c.minz);
        const up = Math.abs(c.maxz - (z - r));
        const upTry = c.maxy - y;
        if (upTry > 0 && upTry <= stepUp && y + 0.05 < c.maxy) {
          const ny = c.maxy;
          let blocked = false;
          for (const o of list) {
            if (o === c) continue;
            if (overlapX(o, x, r) && overlapZ(o, z, r) && ny + h > o.miny && ny < o.maxy) blocked = true;
          }
          if (!blocked) {
            y = ny;
            continue;
          }
        }
        if (dn < up) z = c.minz - r - 0.001;
        else z = c.maxz + r + 0.001;
      }
    }
  };

  x += vx;
  resolveAxis("x");
  z += vz;
  resolveAxis("z");
  y += vy;

  let grounded = false;
  let groundedId: string | null = null;
  let hitHead = false;
  for (const c of list) {
    if (!overlapX(c, x, r * 0.9) || !overlapZ(c, z, r * 0.9)) continue;
    if (y < c.maxy && y + h > c.miny) {
      const fromAbove = cap.y >= c.maxy - 0.08 || vy <= 0;
      const fromBelow = cap.y + cap.h <= c.miny + 0.08 || vy > 0;
      if (fromAbove && y <= c.maxy && y + h > c.maxy) {
        y = c.maxy;
        grounded = true;
        groundedId = c.id;
      } else if (fromBelow && y + h >= c.miny && y < c.miny) {
        y = c.miny - h;
        hitHead = true;
      } else {
        const down = c.maxy - y;
        const up = y + h - c.miny;
        if (down < up && down < 0.5) {
          y = c.maxy;
          grounded = true;
          groundedId = c.id;
        } else if (up < 0.5) {
          y = c.miny - h;
          hitHead = true;
        }
      }
    }
  }

  return { x, y, z, grounded, groundedId, hitHead };
}

export function mantleProbe(
  x: number,
  y: number,
  z: number,
  fx: number,
  fz: number,
  colliders: Collider[],
): { x: number; y: number; z: number } | null {
  const dist = 0.55;
  const px = x + fx * dist;
  const pz = z + fz * dist;
  let best: Collider | null = null;
  for (const c of colliders) {
    if (c.disabled) continue;
    if (px < c.minx - 0.1 || px > c.maxx + 0.1 || pz < c.minz - 0.1 || pz > c.maxz + 0.1) continue;
    const top = c.maxy - y;
    if (top > 0.55 && top < 1.35) {
      if (!best || c.maxy > best.maxy) best = c;
    }
  }
  if (!best) return null;
  return { x: px, y: best.maxy, z: pz };
}
