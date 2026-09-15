import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Simulation } from "./simulation.ts";
import { createRubeState } from "./rube-mechanics.ts";
import {
  CHAIN,
  ensureLinkedCascadeState,
  linkedCascadeFinite,
  linkedEntryContactForce,
  stepLinkedCascade,
  toggleTransferBrake,
} from "./linked-cascade.ts";
import { mechCable, mechDof, stepMechanicalNetwork } from "./mechanical-network.ts";
import { MECH_ID } from "./mechanical-ids.ts";
import type { MechanicalNetworkState } from "./types.ts";

const DT = 1 / 120;

function ticks(sim: Simulation, count: number): void {
  for (let i = 0; i < count; i++) sim.advanceAuthorityTick();
}

describe("generic reduced mechanical network", () => {
  it("tension-only cable goes slack instead of pushing", () => {
    const n: MechanicalNetworkState = {
      dofs: [
        { id: "x", kind: "linear", q: -0.2, v: 0, inertia_si: 100, damping_si: 0, min_q: -1, max_q: 1, stop_restitution: 0 },
      ],
      cables: [
        {
          id: "rope",
          base_length_m: 1,
          rest_length_m: 1,
          length_m: 0.8,
          stiffness_npm: 10000,
          damping_ns_pm: 1000,
          tension_n: 0,
          slack: true,
          terms: [{ dof_id: "x", gradient_m_per_q: 1 }],
        },
      ],
      dissipated_j: 0,
    };
    stepMechanicalNetwork(n, DT, {});
    assert.equal(mechCable(n, "rope").tension_n, 0);
    assert.equal(mechCable(n, "rope").slack, true);
  });
});

describe("one causal authority from MC-01 through MC-04", () => {
  it("contains upstream and downstream coordinates in one MechanicalNetworkState", () => {
    const r = createRubeState();
    const ids = new Set(r.chain!.network.dofs.map((d) => d.id));
    for (const id of [
      MECH_ID.mc01Lever,
      MECH_ID.mc01Ballast,
      MECH_ID.mc01Lift,
      MECH_ID.entryRocker,
      MECH_ID.transferCarriage,
      MECH_ID.transferCounterweight,
      MECH_ID.bridge,
      MECH_ID.springShuttle,
    ]) assert.ok(ids.has(id), `missing shared DOF ${id}`);
  });

  it("MC-01 lift and MC-02 rocker meet through physical contact in that same network", () => {
    const r = createRubeState();
    const net = r.chain!.network;
    const lift = mechDof(net, MECH_ID.mc01Lift);
    lift.q = 2.5;
    lift.v = 0;
    const contact = linkedEntryContactForce(r);
    assert.ok(contact > 0, "raised authoritative lift coordinate must penetrate the rocker contact envelope");
    stepLinkedCascade(r, DT, {});
    assert.ok(r.chain!.entry_contact_n > 0);
    assert.ok(mechDof(net, MECH_ID.entryRocker).v > 0, "reciprocal contact must accelerate downstream rocker");
  });

  it("upstream mechanics physically release the counterweight before carriage can move", () => {
    const sim = new Simulation();
    sim.act({ type: "rube_push_ballast", direction: 1 });
    ticks(sim, 90);
    sim.act({ type: "rube_toggle_latch" });
    ticks(sim, 300);
    const r = sim.state().rube!;
    const net = r.chain!.network;
    assert.ok(mechDof(net, MECH_ID.entryRocker).q > 0);
    assert.ok(mechDof(net, MECH_ID.entryPawl).q > CHAIN.entryPawlClearM);
    assert.ok(mechDof(net, MECH_ID.transferCounterweight).q > CHAIN.entryPawlEscapeM);
  });

  it("released finite brake lets gravity haul carriage and carriage contact drops bridge", () => {
    const sim = new Simulation();
    sim.act({ type: "rube_push_ballast", direction: 1 });
    ticks(sim, 90);
    sim.act({ type: "rube_toggle_latch" });
    ticks(sim, 300);
    assert.match(sim.act({ type: "rube_toggle_transfer_brake" }), /released/i);
    ticks(sim, 700);

    const r = sim.state().rube!;
    const net = r.chain!.network;
    assert.ok(mechDof(net, MECH_ID.transferCarriage).q > 13.0);
    assert.ok(mechDof(net, MECH_ID.bridgeRelease).q > 0.5);
    assert.ok(mechDof(net, MECH_ID.bridgePawl).q > CHAIN.bridgePawlClearM);
    assert.ok(mechDof(net, MECH_ID.bridge).q < 0.08);
    assert.ok(linkedCascadeFinite(r));
    assert.equal("complete" in r.chain!, false);
  });

  it("identical causal action histories reproduce the shared authority exactly", () => {
    const a = new Simulation();
    const b = new Simulation();
    for (const sim of [a, b]) {
      sim.act({ type: "rube_push_ballast", direction: 1 });
      ticks(sim, 90);
      sim.act({ type: "rube_toggle_latch" });
      ticks(sim, 300);
      sim.act({ type: "rube_toggle_transfer_brake" });
      ticks(sim, 500);
    }
    assert.deepEqual(a.state().rube!.chain!.network, b.state().rube!.chain!.network);
  });

  it("manual downstream brake still changes constraint state, not completion state", () => {
    const r = createRubeState();
    const chain = ensureLinkedCascadeState(r);
    assert.match(toggleTransferBrake(r), /released/i);
    assert.equal(chain.transfer_brake_engaged, false);
    assert.equal("mc02_complete" in chain, false);
    assert.equal("mc03_complete" in chain, false);
    assert.equal("mc04_complete" in chain, false);
  });
});
