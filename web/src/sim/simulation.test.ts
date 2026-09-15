import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Simulation } from "./simulation.ts";
import { evaluateTraversal, liveGalleryCount } from "./missions.ts";
import { captureSave, applySave } from "./save.ts";

function runTicks(sim: Simulation, count: number): void {
  for (let i = 0; i < count; i++) sim.advanceAuthorityTick();
}

describe("coupled freight/frame/gate reference cases", () => {
  it("off-axis freight load twists the transfer frame and misaligns the gate", () => {
    const loaded = new Simulation();
    loaded.setCommand("CarrierRight", true);
    runTicks(loaded, 90);
    loaded.setCommand("CarrierRight", false);
    assert.ok(loaded.state().frame.twist_rad > 0, "off-axis freight load must twist the transfer frame");
    assert.ok(
      Math.abs(loaded.state().gate.seal_misalignment_m) > 0.001,
      "frame deformation must misalign the pressure gate",
    );
  });

  it("venting reduces pressure and unloads the shared frame", () => {
    const vented = new Simulation();
    const pressurized = new Simulation();
    vented.setCommand("GateVent", true);
    runTicks(vented, 180);
    runTicks(pressurized, 180);
    vented.setCommand("GateVent", false);
    assert.ok(
      vented.state().gate.pressure_pa < pressurized.state().gate.pressure_pa,
      "venting must reduce authoritative pressure inventory",
    );
    assert.ok(
      Math.abs(vented.state().frame.deflection_m) < Math.abs(pressurized.state().frame.deflection_m),
      "reduced gate pressure must unload the shared frame",
    );
  });

  it("over-yield loading preserves permanent set and monotone damage", () => {
    const yielded = new Simulation();
    yielded.setCommand("CarrierRight", true);
    yielded.setCommand("GateClose", true);
    runTicks(yielded, 600);
    yielded.setCommand("CarrierRight", false);
    yielded.setCommand("GateClose", false);
    yielded.setCommand("GateVent", true);
    yielded.setCommand("FrameJack", true);
    runTicks(yielded, 360);
    assert.ok(Math.abs(yielded.state().frame.plastic_set_m) > 0.0001, "over-yield loading must preserve permanent set");
    assert.ok(yielded.state().frame.damage > 0, "damage history must be monotone after over-yield loading");
    assert.ok(yielded.finite(), "committed state must remain finite");
  });

  it("identical command streams reproduce authoritative state", () => {
    const a = new Simulation();
    const b = new Simulation();
    a.setCommand("FrameBrace", true);
    b.setCommand("FrameBrace", true);
    runTicks(a, 240);
    runTicks(b, 240);
    assert.equal(a.state().mechanics_step, 4 * a.state().authority_tick, "authority tick must commit exactly four mechanics steps");
    assert.equal(a.state().frame.deflection_m, b.state().frame.deflection_m, "identical command streams must reproduce authoritative state");
  });
});

describe("Act I reductions", () => {
  it("cutting a gallery span redistributes load onto survivors", () => {
    const sim = new Simulation();
    runTicks(sim, 30);
    const before = sim.state().members.find((m) => m.id === "g12_b")!.force_n;
    sim.act({ type: "cut_member", id: "g12_a" });
    runTicks(sim, 8);
    const after = sim.state().members.find((m) => m.id === "g12_b")!.force_n;
    assert.ok(after > before * 1.05, "survivor must take more axial demand");
    assert.equal(liveGalleryCount(sim.state()), 4);
  });

  it("traversal dies when too many supports are cut", () => {
    const sim = new Simulation();
    sim.act({ type: "cut_member", id: "g12_a" });
    sim.act({ type: "cut_member", id: "g12_b" });
    sim.act({ type: "cut_member", id: "g12_c" });
    sim.act({ type: "cut_member", id: "g12_d" });
    runTicks(sim, 12);
    const edge = evaluateTraversal(sim.state()).find((e) => e.id === "gallery_span");
    assert.ok(edge);
    assert.equal(edge.valid, false);
    assert.equal(liveGalleryCount(sim.state()), 1);
  });

  it("save/load mid-motion restores plastic set, payout, brake, pressure", () => {
    const sim = new Simulation();
    sim.setCommand("CarrierRight", true);
    sim.setCommand("GateClose", true);
    runTicks(sim, 400);
    sim.setCommand("CarrierBrake", true);
    const blob = captureSave(sim, { x: 1, y: 2, z: 3, yaw: 0.2, pitch: -0.1 });
    const plastic = sim.state().frame.plastic_set_m;
    const payout = sim.state().freight.payout_m;
    const brake = sim.state().freight.brake_engaged;
    const pressure = sim.state().gate.pressure_pa;
    const restored = new Simulation();
    const player = applySave(restored, blob);
    assert.equal(restored.state().frame.plastic_set_m, plastic);
    assert.equal(restored.state().freight.payout_m, payout);
    assert.equal(restored.state().freight.brake_engaged, brake);
    assert.equal(restored.state().gate.pressure_pa, pressure);
    assert.equal(player.x, 1);
    assert.equal(restored.state().freight.lateral_velocity_mps, sim.state().freight.lateral_velocity_mps);
  });

  it("view cannot dock by wishing — only geometry + brake commit payload_on_neck", () => {
    const sim = new Simulation();
    runTicks(sim, 10);
    assert.equal(sim.state().flags.payload_on_neck, false);
    sim.act({ type: "carrier_release" });
    assert.equal(sim.state().flags.payload_on_neck, false);
  });
});
