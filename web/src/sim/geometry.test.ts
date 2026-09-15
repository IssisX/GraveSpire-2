import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { slingCompatible, slingRestLength, overDock, TRAVERSE_MAX_M, DOCK_LATERAL_M } from "./geometry.ts";
import { createInitialState } from "./world-init.ts";

describe("dock geometry", () => {
  it("receiving deck is inside gantry travel", () => {
    assert.ok(DOCK_LATERAL_M <= TRAVERSE_MAX_M);
  });

  it("spawn pose is not over the dock", () => {
    const s = createInitialState();
    assert.equal(overDock(s.freight), false);
  });

  it("carrier-dock is compatible; npc attachments are not", () => {
    assert.equal(slingCompatible("carrier", "dock"), true);
    assert.equal(slingCompatible("carrier", "frame"), true);
    assert.equal(slingCompatible("carrier", "rami"), false);
    assert.equal(slingCompatible("g12_a", "g12_b"), true);
  });

  it("rest length is the pose distance, not a magic constant", () => {
    const s = createInitialState();
    const rest = slingRestLength(s, "carrier", "dock");
    assert.ok(rest != null && rest > 8);
  });
});
