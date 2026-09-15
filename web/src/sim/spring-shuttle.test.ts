import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRubeState } from "./rube-mechanics.ts";
import { ensureLinkedCascadeState, stepLinkedCascade } from "./linked-cascade.ts";
import { mechDof } from "./mechanical-network.ts";
import { MECH_ID } from "./mechanical-ids.ts";
import { SPRING_SHUTTLE } from "./spring-shuttle.ts";

const DT = 1 / 120;

function step(rube: ReturnType<typeof createRubeState>, count: number) {
  for (let i = 0; i < count; i++) stepLinkedCascade(rube, DT, {});
}

describe("MC-03 -> MC-04 spring shuttle in shared authority", () => {
  it("holds the 12 t shuttle at the upper landing while the bridge nose is still raised", () => {
    const r = createRubeState();
    const chain = ensureLinkedCascadeState(r);
    step(r, 480);
    assert.ok(mechDof(chain.network, MECH_ID.springShuttleLatch).q < SPRING_SHUTTLE.latchClearM);
    assert.equal(mechDof(chain.network, MECH_ID.springShuttle).q, 0);
  });

  it("bridge landing physically retracts the pawl and releases the gravity/spring oscillator", () => {
    const r = createRubeState();
    const chain = ensureLinkedCascadeState(r);
    const bridge = mechDof(chain.network, MECH_ID.bridge);
    bridge.q = 0;
    bridge.v = 0;

    step(r, 480);
    const latch = mechDof(chain.network, MECH_ID.springShuttleLatch);
    const shuttle = mechDof(chain.network, MECH_ID.springShuttle);
    assert.ok(latch.q > SPRING_SHUTTLE.latchClearM, "bridge nose must retract the shuttle pawl");
    assert.ok(shuttle.q > 7.0, "released shuttle should descend close to the lower boarding apron");

    step(r, 480);
    assert.ok(shuttle.q < 2.0, "stored spring energy should carry the shuttle back toward the upper catwalk");
    assert.ok(Math.abs(shuttle.v) < 5, "shuttle velocity remains bounded");
  });

  it("has no completion flag and shares the same DOF collection as MC-01", () => {
    const r = createRubeState();
    const chain = ensureLinkedCascadeState(r);
    assert.ok(chain.network.dofs.some((d) => d.id === MECH_ID.mc01Lever));
    assert.ok(chain.network.dofs.some((d) => d.id === MECH_ID.springShuttle));
    assert.ok(chain.network.dofs.some((d) => d.id === MECH_ID.springShuttleLatch));
    assert.equal("mc04_complete" in chain, false);
  });
});
