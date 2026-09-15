import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRubeState, stepRubeMechanics } from "./rube-mechanics.ts";
import { ensureLinkedCascadeState } from "./linked-cascade.ts";
import { mechDof } from "./mechanical-network.ts";
import { MECH_ID } from "./mechanical-ids.ts";
import { ensureVerticalSpineState, mc07World, mc08World, VERTICAL } from "./vertical-spine.ts";

describe("vertical mechanical skyscraper", () => {
  it("keeps MC-07/08 inside the existing shared network", () => {
    const r = createRubeState();
    const chain = ensureLinkedCascadeState(r);
    ensureVerticalSpineState(chain);
    for (const id of [
      MECH_ID.mc07Ascender,
      MECH_ID.mc07Countercar,
      MECH_ID.mc07Cradle,
      MECH_ID.mc08Ring,
      MECH_ID.mc08Ballast,
      MECH_ID.mc08Helix,
    ]) {
      assert.ok(chain.network.dofs.some((d) => d.id === id), `missing shared DOF ${id}`);
    }
    assert.ok(chain.network.cables.some((c) => c.id === MECH_ID.mc07BalanceCable));
    assert.equal("mc07_complete" in (r as unknown as Record<string, unknown>), false);
    assert.equal("mc08_complete" in (r as unknown as Record<string, unknown>), false);
  });

  it("uses counterweight imbalance to raise the player carrier after release", () => {
    const r = createRubeState();
    const chain = ensureLinkedCascadeState(r);
    ensureVerticalSpineState(chain);
    mechDof(chain.network, MECH_ID.mc07BrakeHandle).q = 1;
    const before = mc07World(chain);
    for (let i = 0; i < 120 * 4; i++) stepRubeMechanics(r, 1 / 120);
    const after = mc07World(chain);
    assert.ok(after.ascender.y > before.ascender.y + 0.5, "released heavier counter-car must raise ascender");
    assert.ok(after.countercar.y < before.countercar.y - 0.5, "counter-car must descend under gravity");
  });

  it("hands an arriving ascender into the cradle and torsion stack", () => {
    const r = createRubeState();
    const chain = ensureLinkedCascadeState(r);
    ensureVerticalSpineState(chain);
    const asc = mechDof(chain.network, MECH_ID.mc07Ascender);
    const counter = mechDof(chain.network, MECH_ID.mc07Countercar);
    const brake = mechDof(chain.network, MECH_ID.mc07BrakeHandle);
    asc.q = VERTICAL.cradleContactQ + 0.8;
    asc.v = 1.2;
    counter.q = VERTICAL.shaftTravelM - asc.q;
    brake.q = 1;
    for (let i = 0; i < 120 * 3; i++) stepRubeMechanics(r, 1 / 120);
    const w7 = mc07World(chain);
    const w8 = mc08World(chain);
    assert.ok(w7.cradle.angle > VERTICAL.cradleMinRad + 0.05, "arriving car must rotate the transfer cradle");
    assert.ok(w8.latch > 0.01, "cradle rotation must pull the torsion-stage latch");
  });
});
