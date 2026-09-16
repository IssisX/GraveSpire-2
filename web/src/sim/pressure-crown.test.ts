import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRubeState, stepRubeMechanics } from "./rube-mechanics.ts";
import { ensureLinkedCascadeState } from "./linked-cascade.ts";
import { mechDof } from "./mechanical-network.ts";
import { MECH_ID } from "./mechanical-ids.ts";
import { ensurePressureCrownState, gasPressurePa, mc09World, mc10World, PRESSURE_CROWN } from "./pressure-crown.ts";
import { VERTICAL } from "./vertical-spine.ts";

describe("MC-09/10 pressure crown", () => {
  it("adds pressure and centrifugal coordinates to the existing shared network", () => {
    const r = createRubeState();
    const chain = ensureLinkedCascadeState(r);
    ensurePressureCrownState(chain);
    for (const id of [MECH_ID.mc09Valve, MECH_ID.mc09Ram, MECH_ID.mc10Flywheel, MECH_ID.mc10Governor, MECH_ID.mc10Bridge]) {
      assert.ok(chain.network.dofs.some((d) => d.id === id), `missing ${id}`);
    }
    assert.equal("mc09_complete" in (r as unknown as Record<string, unknown>), false);
    assert.equal("mc10_complete" in (r as unknown as Record<string, unknown>), false);
  });

  it("MC-08 arrival physically opens the pressure path and raises the 80 t ram", () => {
    const r = createRubeState();
    const chain = ensureLinkedCascadeState(r);
    ensurePressureCrownState(chain);
    const helix = mechDof(chain.network, MECH_ID.mc08Helix);
    helix.q = VERTICAL.helixTravelM;
    helix.v = 0;
    const p0 = gasPressurePa(chain);
    for (let i = 0; i < 120 * 6; i++) stepRubeMechanics(r, 1 / 120);
    const w = mc09World(chain);
    assert.ok(w.valve >= PRESSURE_CROWN.valveClearM, "arriving helix must physically clear the pressure lock");
    assert.ok(w.ram.y > PRESSURE_CROWN.ramBaseY + 2.0, "gas pressure must lift the loaded ram");
    assert.ok(w.pressurePa < p0, "gas pressure must fall as the working volume expands");
  });

  it("ram rack transfers work into flywheel, centrifugal governor, and traversable bridge", () => {
    const r = createRubeState();
    const chain = ensureLinkedCascadeState(r);
    ensurePressureCrownState(chain);
    const valve = mechDof(chain.network, MECH_ID.mc09Valve);
    const ram = mechDof(chain.network, MECH_ID.mc09Ram);
    valve.q = PRESSURE_CROWN.valveTravelM;
    ram.q = PRESSURE_CROWN.rackEngageM + 2.8;
    ram.v = 1.4;
    let peakGovernor = mechDof(chain.network, MECH_ID.mc10Governor).q;
    let peakBridge = mechDof(chain.network, MECH_ID.mc10Bridge).q;
    for (let i = 0; i < 120 * 7; i++) {
      stepRubeMechanics(r, 1 / 120);
      peakGovernor = Math.max(peakGovernor, mechDof(chain.network, MECH_ID.mc10Governor).q);
      peakBridge = Math.max(peakBridge, mechDof(chain.network, MECH_ID.mc10Bridge).q);
    }
    const w = mc10World(chain);
    assert.ok(Math.abs(w.flywheel.omega) > 0.15, "ram-mounted rack must spin the flywheel");
    assert.ok(peakGovernor > 0.05, "centrifugal demand must move real governor mass");
    assert.ok(peakBridge > 0.25, "governor linkage must move the transfer span");
  });
});
