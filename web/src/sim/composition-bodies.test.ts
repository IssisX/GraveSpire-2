import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRubeState, stepRubeMechanics } from "./rube-mechanics.ts";
import { ensureLinkedCascadeState } from "./linked-cascade.ts";
import { mechDof } from "./mechanical-network.ts";
import {
  applyCompositionBodyForces,
  compositionBodiesFinite,
  compositionBodyWorld,
  ensureCompositionBodies,
  nudgeCompositionBody,
} from "./composition-bodies.ts";
import { MECH_ID } from "./mechanical-ids.ts";
import { SKY } from "./sky-spine.ts";

describe("reusable consequential composition bodies", () => {
  it("stores loose ingredients inside the same MechanicalNetworkState", () => {
    const r = createRubeState();
    const chain = ensureLinkedCascadeState(r);
    ensureCompositionBodies(chain);
    for (const id of [
      "ingredient:loose_beam_a:x",
      "ingredient:loose_ballast_a:x",
      "ingredient:loose_roller_a:a",
      "ingredient:loose_wedge_a:x",
      "ingredient:hanging_load_a:a",
    ]) {
      assert.ok(chain.network.dofs.some((d) => d.id === id), `missing ${id}`);
    }
    assert.equal("composition" in (r as unknown as Record<string, unknown>), false, "must not create parallel composition state");
  });

  it("player shove changes momentum without teleporting a loose beam", () => {
    const r = createRubeState();
    const chain = ensureLinkedCascadeState(r);
    const before = compositionBodyWorld(chain).find((x) => x.id === "loose_beam_a")!;
    assert.equal(nudgeCompositionBody(chain, "ingredient:loose_beam_a:3", 3100), true);
    const immediate = compositionBodyWorld(chain).find((x) => x.id === "loose_beam_a")!;
    assert.equal(immediate.x, before.x);
    assert.ok(immediate.vx > before.vx);
    for (let i = 0; i < 120; i++) stepRubeMechanics(r, 1 / 120);
    const after = compositionBodyWorld(chain).find((x) => x.id === "loose_beam_a")!;
    assert.notEqual(after.x, before.x);
  });

  it("the hanging load is a real pendular mass on an authoritative sling coordinate", () => {
    const r = createRubeState();
    const chain = ensureLinkedCascadeState(r);
    const angle = mechDof(chain.network, "ingredient:hanging_load_a:a");
    const q0 = angle.q;
    nudgeCompositionBody(chain, "ingredient:hanging_load_a:0", 4200);
    assert.ok(angle.v > 0);
    for (let i = 0; i < 120 * 2; i++) stepRubeMechanics(r, 1 / 120);
    assert.ok(Number.isFinite(angle.q) && Number.isFinite(angle.v));
    assert.notEqual(angle.q, q0);
  });

  it("high-altitude wind is a real generalized load on exposed loose bodies", () => {
    const r = createRubeState();
    const chain = ensureLinkedCascadeState(r);
    const forces: Record<string, number> = {};
    applyCompositionBodyForces(chain, forces);
    assert.ok((forces["ingredient:loose_beam_a:x"] ?? 0) > 0);
  });

  it("loose ballast physically increases sky-car carried mass when placed on its deck", () => {
    const r = createRubeState();
    const chain = ensureLinkedCascadeState(r);
    const x = mechDof(chain.network, "ingredient:loose_ballast_a:x");
    const y = mechDof(chain.network, "ingredient:loose_ballast_a:y");
    x.q = SKY.skyCarX;
    y.q = SKY.skyCarBaseY + 1.25 * 0.5;
    const forces: Record<string, number> = {};
    applyCompositionBodyForces(chain, forces);
    const car = mechDof(chain.network, MECH_ID.mc11SkyCar);
    assert.ok(car.inertia_si > SKY.skyCarMassKg);
    assert.ok((forces[MECH_ID.mc11SkyCar] ?? 0) < -20000, "car must carry the ballast weight, not just render it");
  });

  it("remains finite through a long mixed free response", () => {
    const r = createRubeState();
    const chain = ensureLinkedCascadeState(r);
    nudgeCompositionBody(chain, "ingredient:loose_roller_a:0", 3900);
    nudgeCompositionBody(chain, "ingredient:hanging_load_a:0", -4700);
    for (let i = 0; i < 120 * 12; i++) stepRubeMechanics(r, 1 / 120);
    assert.equal(compositionBodiesFinite(chain), true);
  });
});
