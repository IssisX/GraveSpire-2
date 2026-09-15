import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createInitialState } from "../sim/world-init.ts";
import { tickNpcs } from "../sim/npcs.ts";
import { npcMutter } from "./npc-ai.ts";

describe("npc presence", () => {
  it("Chen starts at the process board, not a remote desk", () => {
    const s = createInitialState();
    assert.ok(s.npcs.find((n) => n.id === "chen")!.x < 42);
  });

  it("Rami walks to the well lip under high strain", () => {
    const s = createInitialState();
    s.frame.twist_rad = 0.05;
    for (let i = 0; i < 80; i++) tickNpcs(s);
    const rami = s.npcs.find((n) => n.id === "rami")!;
    assert.ok(rami.x > 7.5, "crane lead moves to read the load");
  });

  it("mutters are world-state, not a second dialogue tree", () => {
    const s = createInitialState();
    const line = npcMutter(s, "rami", 2.4);
    assert.ok(line && /pendant|well|dock/i.test(line));
    assert.equal(npcMutter(s, "rami", 12), null);
  });
});
