import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Simulation } from "../sim/simulation.ts";
import { resolveContext, worldWarning } from "./context.ts";
import type { Interactable } from "./level.ts";

const pendant: Interactable = {
  id: "pendant",
  label: "Carrier pendant",
  x: 4.52,
  y: 1.72,
  z: -6.42,
  r: 2,
  kind: "machine",
};
const carrier: Interactable = {
  id: "carrier",
  label: "Carrier 07-A",
  x: 22,
  y: 6,
  z: 0,
  r: 2.8,
  kind: "machine",
};
const rami: Interactable = {
  id: "rami",
  label: "Rami Okonkwo",
  x: 4.6,
  y: 1.4,
  z: -7.4,
  r: 2,
  kind: "npc",
};

function frame(over: Partial<Parameters<typeof resolveContext>[0]> = {}) {
  const sim = new Simulation();
  return resolveContext({
    px: 5.6,
    py: 0.05,
    pz: -1.35,
    eye: 1.62,
    yaw: -1.62,
    pitch: 0.06,
    interactables: [pendant, carrier, rami],
    colliders: [],
    state: sim.state(),
    prevActionId: null,
    operateId: null,
    slingA: null,
    mantle: false,
    grounded: true,
    speed: 0,
    ...over,
  });
}

describe("contextual action resolver", () => {
  it("lets the player look at the hanging carrier from the west deck without making it actionable", () => {
    const ctx = frame();
    assert.equal(ctx.look?.id, "carrier");
    assert.notEqual(ctx.action?.id, "carrier");
    assert.ok(!ctx.primary || ctx.primary.commit === "inspect" || ctx.primary.commit === "jump");
  });

  it("operates the hoist only at the pulpit pendant", () => {
    const ctx = frame({
      px: 4.55,
      py: 0.05,
      pz: -7.05,
      yaw: Math.PI,
      pitch: 0.15,
    });
    assert.ok(ctx.choices.some((c) => c.commit === "operate" && c.targetId === "pendant"));
    assert.ok(!ctx.choices.some((c) => c.commit === "operate" && c.targetId === "carrier"));
  });

  it("talks to Rami when standing with him on the pulpit", () => {
    const ctx = frame({
      px: 4.6,
      py: 0.05,
      pz: -7.05,
      yaw: 0,
      pitch: 0.15,
    });
    assert.ok(ctx.choices.some((c) => c.commit === "talk" && c.targetId === "rami"));
  });

  it("keeps a sticky action target through modest look drift", () => {
    const a = frame({
      px: 4.55,
      py: 0.05,
      pz: -7.05,
      yaw: Math.PI,
      prevActionId: "pendant",
    });
    const b = frame({
      px: 4.55,
      py: 0.05,
      pz: -7.05,
      yaw: Math.PI + 0.4,
      prevActionId: "pendant",
    });
    assert.equal(a.action?.id, "pendant");
    assert.equal(b.action?.id, "pendant");
  });

  it("surfaces brake heat as a world warning, not a HUD number", () => {
    const sim = new Simulation();
    const s = sim.state();
    s.freight.brake_temperature_k = 430;
    assert.equal(worldWarning(s), "Brake is cooking. Heat is friction.");
  });
});
