import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Collider } from "./collision.ts";
import { canShimmy, probeControlledDrop, probeLedgeCatch, probeVault } from "./parkour.ts";

const box = (id: string, minx: number, maxx: number, miny: number, maxy: number, minz: number, maxz: number): Collider => ({
  id, minx, maxx, miny, maxy, minz, maxz,
});

describe("geometry-driven parkour", () => {
  it("classifies a low obstacle from dimensions rather than tags", () => {
    const p = probeVault({
      x: 0, y: 0, z: 0, fx: 1, fz: 0, speed: 3.4, radius: 0.32, height: 1.72,
      colliders: [box("anonymous_steel", 0.45, 0.90, 0, 0.44, -0.8, 0.8)],
    });
    assert.equal(p?.kind, "step");
    assert.equal(p?.colliderId, "anonymous_steel");
  });

  it("vaults a waist-high obstacle only when approach speed is sufficient", () => {
    const c = [box("crate_without_parkour_flag", 0.45, 1.05, 0, 0.86, -0.8, 0.8)];
    assert.equal(probeVault({ x: 0, y: 0, z: 0, fx: 1, fz: 0, speed: 0.8, radius: 0.32, height: 1.72, colliders: c }), null);
    assert.equal(probeVault({ x: 0, y: 0, z: 0, fx: 1, fz: 0, speed: 4.1, radius: 0.32, height: 1.72, colliders: c })?.kind, "vault");
  });

  it("catches and shimmies along a reachable physical ledge", () => {
    const c = [box("moving_beam", 0.42, 3.2, 0, 1.45, -1.0, 1.0)];
    const p = probeLedgeCatch({ x: 0, y: 0, z: 0, fx: 1, fz: 0, vy: -3, radius: 0.32, colliders: c });
    assert.ok(p);
    assert.equal(p?.colliderId, "moving_beam");
    assert.equal(canShimmy(p!, 1, 0.45, c), true);
  });

  it("derives controlled drop from the current support edge", () => {
    const c = [box("narrow_grating", -1, 1, 2, 2.2, -1, 1)];
    const p = probeControlledDrop({ x: 0.55, y: 2.2, z: 0, fx: 1, fz: 0, groundedId: "narrow_grating", radius: 0.32, colliders: c });
    assert.equal(p?.kind, "drop");
    assert.ok((p?.targetY ?? 99) < 1.0);
  });
});
