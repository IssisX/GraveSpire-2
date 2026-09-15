import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Simulation } from "./simulation.ts";
import { CASCADE, createRubeState, rubeFinite, ropeGeometry, stepRubeMechanics } from "./rube-mechanics.ts";

function ticks(sim: Simulation, count: number): void {
  for (let i = 0; i < count; i++) sim.advanceAuthorityTick();
}

describe("MC-01 mechanical cascade reference cases", () => {
  it("starts latched with slack tension-only rope and finite authority", () => {
    const r = createRubeState();
    assert.equal(r.lever.latch_engaged, true);
    assert.equal(r.rope.tension_n, 0);
    assert.equal(r.rope.slack, true);
    assert.ok(r.rope.rest_length_m > ropeGeometry(r).length, "initial rope should have declared slack");
    assert.ok(rubeFinite(r));
  });

  it("a bounded shove moves ballast through dynamics instead of teleporting it", () => {
    const sim = new Simulation();
    const start = sim.state().rube!.ballast.s_m;
    const msg = sim.act({ type: "rube_push_ballast", direction: 1 });
    assert.match(msg, /shoved outboard/i);
    assert.equal(sim.state().rube!.ballast.s_m, start, "action applies impulse, not position teleport");
    ticks(sim, 90);
    assert.ok(sim.state().rube!.ballast.s_m > 0, "wheeled ballast should coast across the fulcrum under the applied impulse");
  });

  it("ballast moment drives lever, routed tension, and lift without a completion flag", () => {
    const sim = new Simulation();
    sim.act({ type: "rube_push_ballast", direction: 1 });
    ticks(sim, 90);
    assert.ok(sim.state().rube!.ballast.s_m > 0, "ballast must first establish an outboard moment arm");

    const release = sim.act({ type: "rube_toggle_latch" });
    assert.match(release, /released/i);
    ticks(sim, 240);

    const r = sim.state().rube!;
    assert.ok(r.lever.angle_rad < -0.25, "outboard ballast should rotate the lever under gravity");
    assert.ok(r.rope.tension_n > 1000, "lever motion should create routed rope tension");
    assert.ok(r.lift.y_m > 2.30, "rope force should raise the lift close to its physical landing");
    assert.ok(r.lift.y_m <= CASCADE.liftMaxY + 1e-9, "lift must respect its mechanical stop");
    assert.ok(r.rope.tension_n >= 0, "tension-only rope may never push");
    assert.ok(sim.finite());
  });

  it("identical action streams reproduce the cascade state", () => {
    const a = new Simulation();
    const b = new Simulation();
    for (const sim of [a, b]) {
      sim.act({ type: "rube_push_ballast", direction: 1 });
      ticks(sim, 90);
      sim.act({ type: "rube_toggle_latch" });
      ticks(sim, 180);
    }
    assert.deepEqual(a.state().rube, b.state().rube);
  });

  it("lazily upgrades pre-cascade authority state instead of invalidating old saves", () => {
    const seed = new Simulation();
    const legacy = structuredClone(seed.state());
    delete legacy.rube;
    const restored = new Simulation(legacy);
    assert.ok(restored.state().rube, "constructor must restore missing cascade authority");
    assert.ok(restored.finite());
  });

  it("direct substeps keep the reduced cell finite over a long free response", () => {
    const r = createRubeState();
    r.ballast.velocity_mps = 1.8;
    for (let i = 0; i < 360; i++) stepRubeMechanics(r, 1 / 120);
    r.lever.latch_engaged = false;
    for (let i = 0; i < 2400; i++) stepRubeMechanics(r, 1 / 120);
    assert.ok(rubeFinite(r));
    assert.ok(r.rope.tension_n >= 0);
  });
});
