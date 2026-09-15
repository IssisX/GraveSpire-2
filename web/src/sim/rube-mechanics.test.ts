import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Simulation } from "./simulation.ts";
import {
  CASCADE,
  createRubeState,
  ensureRubeState,
  rubeFinite,
  ropeGeometry,
  stepRubeMechanics,
} from "./rube-mechanics.ts";
import { mechCable, mechDof } from "./mechanical-network.ts";
import { MECH_ID } from "./mechanical-ids.ts";

function ticks(sim: Simulation, count: number): void {
  for (let i = 0; i < count; i++) sim.advanceAuthorityTick();
}

describe("MC-01 unified mechanical authority", () => {
  it("stores MC-01 coordinates and routed rope in the same network as downstream mechanisms", () => {
    const r = createRubeState();
    const net = r.chain!.network;
    assert.ok(net.dofs.some((d) => d.id === MECH_ID.mc01Lever));
    assert.ok(net.dofs.some((d) => d.id === MECH_ID.mc01Ballast));
    assert.ok(net.dofs.some((d) => d.id === MECH_ID.mc01Lift));
    assert.ok(net.dofs.some((d) => d.id === MECH_ID.transferCarriage));
    assert.ok(net.dofs.some((d) => d.id === MECH_ID.bridge));
    assert.ok(net.dofs.some((d) => d.id === MECH_ID.springShuttle));
    assert.ok(net.cables.some((c) => c.id === MECH_ID.mc01Rope));
    assert.ok(net.cables.some((c) => c.id === MECH_ID.transferRope));
    assert.equal(r.rope.tension_n, 0);
    assert.ok(r.rope.rest_length_m > ropeGeometry(r).length, "initial routed rope should have declared slack");
    assert.ok(rubeFinite(r));
  });

  it("a bounded shove changes shared ballast momentum instead of teleporting position", () => {
    const sim = new Simulation();
    const r = sim.state().rube!;
    const ballast = mechDof(r.chain!.network, MECH_ID.mc01Ballast);
    const start = ballast.q;
    const msg = sim.act({ type: "rube_push_ballast", direction: 1 });
    assert.match(msg, /shoved outboard/i);
    assert.equal(ballast.q, start, "action applies impulse, not position teleport");
    assert.ok(ballast.v > 0, "impulse must enter the authoritative DOF");
    ticks(sim, 90);
    assert.ok(mechDof(sim.state().rube!.chain!.network, MECH_ID.mc01Ballast).q > 0);
  });

  it("ballast moment drives shared lever, shared routed tension, lift, and downstream contact", () => {
    const sim = new Simulation();
    sim.act({ type: "rube_push_ballast", direction: 1 });
    ticks(sim, 90);
    const beforeRelease = sim.state().rube!;
    assert.ok(mechDof(beforeRelease.chain!.network, MECH_ID.mc01Ballast).q > 0);

    assert.match(sim.act({ type: "rube_toggle_latch" }), /released/i);
    ticks(sim, 240);

    const r = sim.state().rube!;
    const net = r.chain!.network;
    assert.ok(mechDof(net, MECH_ID.mc01Lever).q < -0.25, "outboard ballast should rotate the shared lever DOF");
    assert.ok(mechCable(net, MECH_ID.mc01Rope).tension_n > 1000, "shared routed cable should carry tension");
    assert.ok(mechDof(net, MECH_ID.mc01Lift).q > 2.30, "same network tension should raise the lift");
    assert.ok(mechDof(net, MECH_ID.entryRocker).q > 0, "lift motion should physically load the downstream rocker");
    assert.ok(mechDof(net, MECH_ID.mc01Lift).q <= CASCADE.liftMaxY + 1e-9);
    assert.ok(sim.finite());
  });

  it("legacy snapshots cannot overwrite mechanical truth after migration", () => {
    const r = createRubeState();
    const net = r.chain!.network;
    const lever = mechDof(net, MECH_ID.mc01Lever);
    const ballast = mechDof(net, MECH_ID.mc01Ballast);
    const lift = mechDof(net, MECH_ID.mc01Lift);

    const qLever = lever.q;
    const qBallast = ballast.q;
    const qLift = lift.q;
    r.lever.angle_rad = 99;
    r.ballast.s_m = 99;
    r.lift.y_m = 99;
    r.rope.tension_n = 9e9;

    stepRubeMechanics(r, 1 / 120);

    assert.ok(Math.abs(lever.q - qLever) < 0.05, "legacy lever snapshot must not drive the solver");
    assert.ok(Math.abs(ballast.q - qBallast) < 0.05, "legacy ballast snapshot must not drive the solver");
    assert.ok(Math.abs(lift.q - qLift) < 0.05, "legacy lift snapshot must not drive the solver");
    assert.equal(r.lever.angle_rad, lever.q, "snapshot must be overwritten from authority");
    assert.equal(r.ballast.s_m, ballast.q);
    assert.equal(r.lift.y_m, lift.q);
    assert.equal(r.rope.tension_n, mechCable(net, MECH_ID.mc01Rope).tension_n);
  });

  it("identical action streams reproduce the full shared network exactly", () => {
    const a = new Simulation();
    const b = new Simulation();
    for (const sim of [a, b]) {
      sim.act({ type: "rube_push_ballast", direction: 1 });
      ticks(sim, 90);
      sim.act({ type: "rube_toggle_latch" });
      ticks(sim, 180);
    }
    assert.deepEqual(a.state().rube!.chain!.network, b.state().rube!.chain!.network);
  });

  it("migrates a pre-unification save once, then makes network state authoritative", () => {
    const r = createRubeState();
    r.lever.angle_rad = 0.12;
    r.ballast.s_m = 1.1;
    r.lift.y_m = 1.4;
    r.chain!.network.dofs = r.chain!.network.dofs.filter((d) => !d.id.startsWith("mc01_"));
    r.chain!.network.cables = r.chain!.network.cables.filter((c) => c.id !== MECH_ID.mc01Rope);

    ensureRubeState({ rube: r });
    assert.equal(mechDof(r.chain!.network, MECH_ID.mc01Lever).q, 0.12);
    assert.equal(mechDof(r.chain!.network, MECH_ID.mc01Ballast).q, 1.1);
    assert.equal(mechDof(r.chain!.network, MECH_ID.mc01Lift).q, 1.4);

    r.ballast.s_m = -3.5;
    ensureRubeState({ rube: r });
    assert.equal(mechDof(r.chain!.network, MECH_ID.mc01Ballast).q, 1.1, "migration snapshot must not become a second authority");
    assert.equal(r.ballast.s_m, 1.1, "projection returns to authoritative q");
  });

  it("keeps the unified network finite through a long free response", () => {
    const r = createRubeState();
    mechDof(r.chain!.network, MECH_ID.mc01Ballast).v = 1.8;
    for (let i = 0; i < 360; i++) stepRubeMechanics(r, 1 / 120);
    r.lever.latch_engaged = false;
    for (let i = 0; i < 2400; i++) stepRubeMechanics(r, 1 / 120);
    assert.ok(rubeFinite(r));
    assert.ok(mechCable(r.chain!.network, MECH_ID.mc01Rope).tension_n >= 0);
  });
});
