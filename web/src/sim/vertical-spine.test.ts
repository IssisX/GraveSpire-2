import { describe, expect, it } from "vitest";
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
      expect(chain.network.dofs.some((d) => d.id === id)).toBe(true);
    }
    expect(chain.network.cables.some((c) => c.id === MECH_ID.mc07BalanceCable)).toBe(true);
    expect("mc07_complete" in (r as unknown as Record<string, unknown>)).toBe(false);
    expect("mc08_complete" in (r as unknown as Record<string, unknown>)).toBe(false);
  });

  it("uses counterweight imbalance to raise the player carrier after release", () => {
    const r = createRubeState();
    const chain = ensureLinkedCascadeState(r);
    ensureVerticalSpineState(chain);
    mechDof(chain.network, MECH_ID.mc07BrakeHandle).q = 1;
    const before = mc07World(chain);
    for (let i = 0; i < 120 * 4; i++) stepRubeMechanics(r, 1 / 120);
    const after = mc07World(chain);
    expect(after.ascender.y).toBeGreaterThan(before.ascender.y + 0.5);
    expect(after.countercar.y).toBeLessThan(before.countercar.y - 0.5);
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
    expect(w7.cradle.angle).toBeGreaterThan(VERTICAL.cradleMinRad + 0.05);
    expect(w8.latch).toBeGreaterThan(0.01);
  });
});
