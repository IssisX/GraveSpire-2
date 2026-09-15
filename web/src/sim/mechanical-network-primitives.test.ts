import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { oneWayClutchTorque, retainOverCenter } from "./mechanical-network.ts";
import type { MechanicalDofState } from "./types.ts";

describe("reusable mechanical primitives", () => {
  it("retains a coordinate only after it physically crosses an over-center point", () => {
    const d: MechanicalDofState = {
      id: "catch", kind: "linear", q: 0.009, v: -0.2, inertia_si: 10,
      damping_si: 0, min_q: 0, max_q: 0.2, stop_restitution: 0,
    };
    assert.equal(retainOverCenter(d, 0.012, 0.045), false);
    assert.equal(d.min_q, 0);
    d.q = 0.014;
    d.v = -0.4;
    assert.equal(retainOverCenter(d, 0.012, 0.045), true);
    assert.equal(d.min_q, 0.045);
    assert.equal(d.q, 0.045);
    assert.equal(d.v, 0);
  });

  it("one-way clutch cannot back-drive and cannot demand more input force than exists", () => {
    assert.equal(oneWayClutchTorque({
      inputVelocity: 0.5, outputVelocity: 1.0, ratioOutputPerInput: 1.2,
      couplingNms: 1e7, maxTorqueNm: 9e6, maxInputForceN: 5e5,
    }), 0);
    const torque = oneWayClutchTorque({
      inputVelocity: 2.0, outputVelocity: 0, ratioOutputPerInput: 1.2,
      couplingNms: 1e7, maxTorqueNm: 9e6, maxInputForceN: 5e5,
    });
    assert.ok(torque > 0);
    assert.ok(torque * 1.2 <= 5e5 + 1e-6, "reaction force must remain within upstream supply");
  });
});
