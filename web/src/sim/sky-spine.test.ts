import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRubeState, stepRubeMechanics } from "./rube-mechanics.ts";
import { ensureLinkedCascadeState } from "./linked-cascade.ts";
import { mechDof } from "./mechanical-network.ts";
import { MECH_ID } from "./mechanical-ids.ts";
import { ensureSkySpineState, mc11World, mc12World, SKY } from "./sky-spine.ts";

describe("MC-11/12 high-altitude causal spine", () => {
  it("keeps wind hoist and pendulum crown inside the existing shared network", () => {
    const r = createRubeState();
    const chain = ensureLinkedCascadeState(r);
    ensureSkySpineState(chain);
    for (const id of [MECH_ID.mc11WindLatch, MECH_ID.mc11Sail, MECH_ID.mc11SkyCar, MECH_ID.mc11Counterweight, MECH_ID.mc12PendulumLatch, MECH_ID.mc12Pendulum, MECH_ID.mc12Ballast, MECH_ID.mc12LandingBridge]) {
      assert.ok(chain.network.dofs.some((d) => d.id === id), `missing ${id}`);
    }
    assert.ok(chain.network.cables.some((c) => c.id === MECH_ID.mc11HoistCable));
    assert.equal("mc11_complete" in (r as unknown as Record<string, unknown>), false);
    assert.equal("mc12_complete" in (r as unknown as Record<string, unknown>), false);
  });

  it("MC-10 bridge physically releases the exposed wind hoist and raises the sky-car", () => {
    const r = createRubeState();
    const chain = ensureLinkedCascadeState(r);
    ensureSkySpineState(chain);
    const upstream = mechDof(chain.network, MECH_ID.mc10Bridge);
    upstream.q = 16.0;
    upstream.v = 0;
    for (let i = 0; i < 120 * 10; i++) stepRubeMechanics(r, 1 / 120);
    const w = mc11World(chain);
    assert.ok(mechDof(chain.network, MECH_ID.mc11WindLatch).q >= SKY.windLatchClearM, "MC-10 span must physically clear the wind brake");
    assert.ok(Math.abs(w.sail.omega) > 0.02 || w.sail.angle > 0.05, "high-altitude wind must do real work on the sail");
    assert.ok(w.car.y > SKY.skyCarBaseY + 2.0, "wind/counterweight system must raise the player sky-car");
  });

  it("arriving sky-car releases the 70 t pendulum and its impact drives the next bridge", () => {
    const r = createRubeState();
    const chain = ensureLinkedCascadeState(r);
    ensureSkySpineState(chain);
    const car = mechDof(chain.network, MECH_ID.mc11SkyCar);
    car.q = SKY.skyCarTravelM;
    car.v = 0;
    for (let i = 0; i < 120 * 12; i++) stepRubeMechanics(r, 1 / 120);
    const w = mc12World(chain);
    assert.ok(mechDof(chain.network, MECH_ID.mc12PendulumLatch).q >= SKY.pendulumLatchClearM, "sky-car must mechanically release the pendulum latch");
    assert.ok(w.pendulum.angle > SKY.pendulumInitialRad + 0.25, "gravity must swing the released pendulum");
    assert.ok(w.bridge.q > 0.5, "pendulum impact must physically drive the crown bridge");
  });
});
