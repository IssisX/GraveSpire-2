import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
import type { MechanicalNetworkState } from "./types.ts";

const DT = 1 / 120;

function runLinked(rube: ReturnType<typeof createRubeState>, steps: number) {
  for (let i = 0; i < steps; i++) {
    const contact = linkedEntryContactForce(rube);
    stepLinkedCascade(rube, DT, contact);
  }
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

describe("MC-01 to MC-02 to MC-03 causal chain", () => {
  it("counterweight remains physically captured before MC-01 lift clears the pawl", () => {
    const r = createRubeState();
    const chain = ensureLinkedCascadeState(r);
    toggleTransferBrake(r);
    runLinked(r, 720);
    assert.ok(mechDof(chain.network, "entry_pawl").q < CHAIN.entryPawlClearM);
    assert.equal(mechDof(chain.network, "transfer_counterweight").q, 0);
    assert.equal(mechDof(chain.network, "transfer_carriage").q, 0);
  });

  it("lift contact retracts the pawl through force, rocker rotation, and cable tension", () => {
    const r = createRubeState();
    r.lift.y_m = 2.5;
    r.lift.velocity_mps = 0;
    runLinked(r, 480);
    const chain = ensureLinkedCascadeState(r);
    assert.ok(chain.entry_contact_n > 0);
    assert.ok(mechDof(chain.network, "entry_rocker").q > 0.5);
    assert.ok(mechCable(chain.network, "entry_pawl_cable").tension_n > 0);
    assert.ok(mechDof(chain.network, "entry_pawl").q > CHAIN.entryPawlClearM);
  });

  it("released brake lets gravity haul the carriage and carriage contact releases the gravity bridge", () => {
    const r = createRubeState();
    r.lift.y_m = 2.5;
    r.lift.velocity_mps = 0;
    runLinked(r, 480);
    assert.match(toggleTransferBrake(r), /released/i);
    runLinked(r, 2100);
    const chain = ensureLinkedCascadeState(r);
    assert.ok(mechDof(chain.network, "transfer_carriage").q > 13.0);
    assert.ok(mechDof(chain.network, "bridge_release").q > 0.5);
    assert.ok(mechDof(chain.network, "bridge_pawl").q > CHAIN.bridgePawlClearM);
    assert.ok(mechDof(chain.network, "bridge").q < 0.08);
    assert.ok(linkedCascadeFinite(r));
    assert.equal("complete" in chain, false);
  });

  it("identical causal histories reproduce exactly", () => {
    const a = createRubeState();
    const b = createRubeState();
    for (const r of [a, b]) {
      r.lift.y_m = 2.5;
      runLinked(r, 480);
      toggleTransferBrake(r);
      runLinked(r, 1800);
    }
    assert.deepEqual(a.chain, b.chain);
  });
});
