import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRubeState, stepRubeMechanics } from "./rube-mechanics.ts";
import { ensureUpperCascadeState, UPPER } from "./upper-cascade.ts";
import { mechDof } from "./mechanical-network.ts";
import { MECH_ID } from "./mechanical-ids.ts";

const DT = 1 / 120;

function step(r: ReturnType<typeof createRubeState>, n: number, power = 1, ballast = 0, table = 0, bridge = 0) {
  for (let i = 0; i < n; i++) {
    stepRubeMechanics(r, DT, {
      basculeBallastAxis: ballast,
      basculeTableAxis: table,
      rotorBridgeAxis: bridge,
      drivePower: power,
    });
  }
}

describe("MC-04 -> MC-05 -> MC-06 shared mechanical spine", () => {
  it("stores every new mechanism in the existing shared network", () => {
    const r = createRubeState();
    const chain = r.chain!;
    ensureUpperCascadeState(chain);
    for (const id of [
      MECH_ID.mc05EntryRocker,
      MECH_ID.mc05Pawl,
      MECH_ID.mc05Bascule,
      MECH_ID.mc05Ballast,
      MECH_ID.mc05Table,
      MECH_ID.mc06Rotor,
      MECH_ID.mc06Bridge,
      MECH_ID.mc06Dropweight,
    ]) assert.ok(chain.network.dofs.some((d) => d.id === id), `missing shared DOF ${id}`);
    assert.ok(chain.network.cables.some((c) => c.id === MECH_ID.mc05TransferCable));
    assert.ok(chain.network.cables.some((c) => c.id === MECH_ID.mc06DriveCable));
    assert.equal("mc05_complete" in chain, false);
    assert.equal("mc06_complete" in chain, false);
  });

  it("MC-04 lower stroke physically retracts the MC-05 pawl", () => {
    const r = createRubeState();
    const chain = r.chain!;
    ensureUpperCascadeState(chain);
    const shuttle = mechDof(chain.network, MECH_ID.springShuttle);
    shuttle.q = 7.95;
    shuttle.v = 0.5;
    step(r, 180, 0);
    assert.ok(mechDof(chain.network, MECH_ID.mc05EntryRocker).q > 0.05);
    assert.ok(mechDof(chain.network, MECH_ID.mc05Pawl).q > UPPER.entryPawlClearM);
  });

  it("powered ballast travel changes the same bascule inertia it later rotates", () => {
    const r = createRubeState();
    const chain = r.chain!;
    ensureUpperCascadeState(chain);
    const ballast = mechDof(chain.network, MECH_ID.mc05Ballast);
    const leaf = mechDof(chain.network, MECH_ID.mc05Bascule);
    const q0 = ballast.q;
    const i0 = leaf.inertia_si;
    step(r, 120, 1, 1);
    assert.ok(ballast.q > q0 + 0.25, "finite powered gantry should move ballast uphill/outboard");
    assert.notEqual(leaf.inertia_si, i0, "mass relocation must change rotational inertia");
  });

  it("MC-05 transfer table contact reaches and turns the MC-06 rotor without completion flags", () => {
    const r = createRubeState();
    const chain = r.chain!;
    ensureUpperCascadeState(chain);
    const table = mechDof(chain.network, MECH_ID.mc05Table);
    const rotor = mechDof(chain.network, MECH_ID.mc06Rotor);
    const brake = mechDof(chain.network, MECH_ID.mc06BrakeHandle);
    table.q = UPPER.rackStartM + 0.1;
    table.v = 1.5;
    brake.q = 1;
    const before = rotor.q;
    step(r, 60, 0);
    assert.ok(rotor.q < before, "eastward rack contact must transfer angular impulse into rotor");
  });

  it("identical upper control histories reproduce exactly", () => {
    const a = createRubeState();
    const b = createRubeState();
    for (const r of [a, b]) {
      step(r, 90, 1, 1, 0, 0);
      step(r, 120, 1, 0, 1, 1);
    }
    assert.deepEqual(a.chain, b.chain);
  });
});
