/**
 * Act I authority reference cases.
 *
 * These lock the behaviours a player can actually see. Every one of them can
 * fail: they assert directions and magnitudes of coupled response, not that a
 * function returns without throwing.
 *
 * Run with `npm test` in `web/`.
 */

import { Simulation } from "@/sim/simulation.ts";
import { evaluateMissions, evaluateTraversal, inhabitantCanReachShop } from "@/sim/missions.ts";
import { applySave, captureSave, migrate, type SaveBlob } from "@/sim/save.ts";
import { Gait } from "@/game/gait.ts";
import { ContextResolver, eyePose, type Interactable } from "@/game/context.ts";
import type { Collider } from "@/game/collision.ts";

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = ""): void {
  checks++;
  if (ok) {
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function group(name: string): void {
  console.log(`\n${name}`);
}

function tick(sim: Simulation, n: number): void {
  for (let i = 0; i < n; i++) sim.advanceAuthorityTick();
}

/** Release the fail-safe brake, which requires live control power. */
function releaseBrake(sim: Simulation): void {
  sim.setCommand("CarrierBrake", true);
  sim.setCommand("CarrierBrake", false);
}

// ---------------------------------------------------------------------------
group("three-dimensional coupling");
{
  const sim = new Simulation();
  tick(sim, 240);
  const twisted = sim.state().frame.twist_rad;
  const misalign = sim.state().gate.seal_misalignment_m;
  check(
    "offset load and gate pressure twist the transfer frame",
    Math.abs(twisted) > 0.02,
    `${((twisted * 180) / Math.PI).toFixed(2)} deg`,
  );
  check(
    "frame twist misaligns the gate seal",
    Math.abs(misalign) > 0.05,
    `${(misalign * 1000).toFixed(1)} mm`,
  );

  // Traversing the trolley outward increases the eccentricity, so torsion rises.
  const before = Math.abs(sim.state().frame.twist_rad);
  releaseBrake(sim);
  sim.setCommand("CarrierRight", true);
  tick(sim, 300);
  sim.setCommand("CarrierRight", false);
  tick(sim, 400);
  check(
    "moving the load outboard changes frame torsion",
    Math.abs(sim.state().frame.twist_rad) !== before,
    `${((before * 180) / Math.PI).toFixed(2)} -> ${((sim.state().frame.twist_rad * 180) / Math.PI).toFixed(2)} deg`,
  );
}

// ---------------------------------------------------------------------------
group("vent unloads the shared structure");
{
  const sim = new Simulation();
  tick(sim, 300);
  const before = Math.abs(sim.state().gate.seal_misalignment_m);
  sim.setCommand("GateVent", true);
  sim.setCommand("GateVent", false);
  check("vent command latches the valve open", sim.state().gate.vent_open);
  tick(sim, 1800);
  const after = Math.abs(sim.state().gate.seal_misalignment_m);
  check(
    "venting pressure relieves seal misalignment",
    after < before * 0.4,
    `${(before * 1000).toFixed(1)} -> ${(after * 1000).toFixed(1)} mm`,
  );
  check("inventory is conserved down to empty, not deleted", sim.state().gate.inventory_kg >= 0);
  sim.act({ type: "vent_close" });
  check("the valve can be shut again", !sim.state().gate.vent_open);
}

// ---------------------------------------------------------------------------
group("plasticity: unloading does not erase permanent set");
{
  const sim = new Simulation();
  // Drive the frame past yield by hanging the load fully outboard.
  releaseBrake(sim);
  sim.setCommand("CarrierRight", true);
  tick(sim, 600);
  sim.setCommand("CarrierRight", false);
  tick(sim, 300);
  const loadedSet = sim.state().frame.plastic_set_m;
  check("loading past yield writes permanent set", loadedSet > 0, `${(loadedSet * 1000).toFixed(2)} mm`);
  check(
    "hardening arrests plastic flow at a finite set",
    loadedSet < 0.05,
    `${(loadedSet * 1000).toFixed(2)} mm, well inside the ${(0.24 * 1000).toFixed(0)} mm limit`,
  );
  check(
    "deflection stays inside the declared limit",
    Math.abs(sim.state().frame.deflection_m) <= 0.2400001,
    `${(sim.state().frame.deflection_m * 1000).toFixed(1)} mm`,
  );

  // Now unload: vent the vessel and bring the trolley back inboard.
  sim.setCommand("GateVent", true);
  sim.setCommand("GateVent", false);
  sim.setCommand("CarrierLeft", true);
  tick(sim, 900);
  sim.setCommand("CarrierLeft", false);
  tick(sim, 900);
  const unloadedSet = sim.state().frame.plastic_set_m;
  check(
    "unloading preserves the set",
    unloadedSet >= loadedSet - 1e-9,
    `${(loadedSet * 1000).toFixed(3)} -> ${(unloadedSet * 1000).toFixed(3)} mm`,
  );
  check("damage is monotone", sim.state().frame.damage > 0);
}

// ---------------------------------------------------------------------------
group("the hoist drive is a finite machine");
{
  const sim = new Simulation();
  tick(sim, 30);
  const beforeH = sim.state().freight.height_m;
  sim.setCommand("CarrierRaise", true);
  tick(sim, 120);
  check(
    "a set brake refuses the hoist",
    Math.abs(sim.state().freight.height_m - beforeH) < 1e-6,
    "height unchanged with the drum brake holding",
  );
  check("a held brake draws no hoist current", sim.state().freight.hoist_current_a === 0);

  releaseBrake(sim);
  tick(sim, 30);
  check(
    "holding the load off the brake costs real current",
    sim.state().freight.hoist_current_a > 100,
    `${sim.state().freight.hoist_current_a.toFixed(0)} A`,
  );
  tick(sim, 240);
  check(
    "drive current stays inside the drive's limit",
    sim.state().freight.hoist_current_a <= 190.0001,
    `${sim.state().freight.hoist_current_a.toFixed(0)} A of 190 A`,
  );
  check(
    "the hoist actually lifts when commanded",
    sim.state().freight.height_m > beforeH,
    `${beforeH.toFixed(2)} -> ${sim.state().freight.height_m.toFixed(2)} m`,
  );
}

// ---------------------------------------------------------------------------
group("electrical protection and the fail-safe brake");
{
  const sim = new Simulation();
  tick(sim, 30);
  const gen = () => sim.state().electrical.breakers.find((b) => b.id === "brk_gen")!;
  check("bus is inside rating at rest", gen().load_a < gen().rating_a, `${gen().load_a.toFixed(0)} A`);

  releaseBrake(sim);
  tick(sim, 30);
  check(
    "hoisting with every feeder closed exceeds the bus rating",
    gen().load_a > gen().rating_a,
    `${gen().load_a.toFixed(0)} A of ${gen().rating_a.toFixed(0)} A`,
  );
  check("a brief overload has not tripped yet", !gen().tripped, `thermal ${(gen().thermal * 100).toFixed(0)}%`);

  tick(sim, 1200);
  check("sustained overload trips on inverse time", gen().tripped);
  check(
    "losing control power sets the fail-safe drum brake",
    sim.state().freight.brake_engaged,
    "the load is held, not dropped",
  );
  check("a dead bus kills the bay lights", !sim.state().electrical.bay_lights);
  const msg = sim.act({ type: "toggle_breaker", id: "brk_gen" });
  tick(sim, 30);
  check("the breaker can be reset at the board", !gen().tripped && gen().closed, msg);

  // Shedding a feeder is what makes a sustained hoist possible.
  const shed = new Simulation();
  shed.act({ type: "toggle_breaker", id: "brk_drive" });
  tick(shed, 30);
  releaseBrake(shed);
  tick(shed, 1200);
  const shedGen = shed.state().electrical.breakers.find((b) => b.id === "brk_gen")!;
  check(
    "shedding the drive cabinet keeps the same hoist inside rating",
    !shedGen.tripped && shedGen.load_a < shedGen.rating_a,
    `${shedGen.load_a.toFixed(0)} A of ${shedGen.rating_a.toFixed(0)} A`,
  );
}

// ---------------------------------------------------------------------------
group("the suspended load swings");
{
  const sim = new Simulation();
  tick(sim, 30);
  releaseBrake(sim);
  sim.setCommand("CarrierRight", true);
  tick(sim, 120);
  sim.setCommand("CarrierRight", false);
  tick(sim, 40);
  const peak = Math.abs(sim.state().freight.payload_swing_rad);
  check("stopping a traverse swings the load", peak > 0.01, `${((peak * 180) / Math.PI).toFixed(2)} deg`);
  tick(sim, 600);
  const settled = Math.abs(sim.state().freight.payload_swing_rad);
  check(
    "the swing damps out",
    settled < peak * 0.25,
    `${((peak * 180) / Math.PI).toFixed(2)} -> ${((settled * 180) / Math.PI).toFixed(2)} deg`,
  );
}

// ---------------------------------------------------------------------------
group("determinism: identical command streams agree");
{
  const run = (): string => {
    const sim = new Simulation();
    tick(sim, 60);
    sim.setCommand("GateVent", true);
    sim.setCommand("GateVent", false);
    releaseBrake(sim);
    sim.setCommand("CarrierRight", true);
    tick(sim, 240);
    sim.setCommand("CarrierRight", false);
    tick(sim, 300);
    sim.act({ type: "cut_member", id: "g12_b" });
    tick(sim, 120);
    const s = sim.state();
    return JSON.stringify([
      s.freight.height_m,
      s.freight.lateral_m,
      s.freight.payload_swing_rad,
      s.frame.deflection_m,
      s.frame.twist_rad,
      s.frame.plastic_set_m,
      s.gate.pressure_pa,
      s.electrical.process_load_a,
    ]);
  };
  check("two identical streams produce identical authority state", run() === run());
}

// ---------------------------------------------------------------------------
group("persistence: a save does not heal the building");
{
  const sim = new Simulation();
  sim.setCommand("GateVent", true);
  sim.setCommand("GateVent", false);
  releaseBrake(sim);
  sim.setCommand("CarrierRight", true);
  tick(sim, 500);
  sim.setCommand("CarrierRight", false);
  tick(sim, 200);
  sim.act({ type: "cut_member", id: "g12_a" });
  tick(sim, 60);

  const before = sim.state();
  const blob = captureSave(sim, { x: 1, y: 2, z: 3, yaw: 0.4, pitch: -0.1 });
  const restored = new Simulation();
  const pose = applySave(restored, blob);
  const after = restored.state();

  check("plastic set survives", after.frame.plastic_set_m === before.frame.plastic_set_m);
  check("damage survives", after.frame.damage === before.frame.damage);
  check("hoist payout survives", after.freight.payout_m === before.freight.payout_m);
  check("brake state survives", after.freight.brake_engaged === before.freight.brake_engaged);
  check("vessel pressure survives", after.gate.pressure_pa === before.gate.pressure_pa);
  check("the latched vent valve survives", after.gate.vent_open === before.gate.vent_open);
  check("mid-motion velocity survives", after.freight.lateral_velocity_mps === before.freight.lateral_velocity_mps);
  check("broken connectivity survives", after.members.find((m) => m.id === "g12_a")!.cut);
  check("player pose survives", pose.x === 1 && pose.yaw === 0.4);

  // A save written before the newer fields existed must not resume as NaN.
  const legacy = JSON.parse(JSON.stringify(blob)) as SaveBlob & { authority: Record<string, unknown> };
  delete (legacy.authority.freight as Record<string, unknown>).payload_swing_rad;
  delete (legacy.authority.freight as Record<string, unknown>).hoist_current_a;
  delete (legacy.authority.gate as Record<string, unknown>).vent_open;
  legacy.version = 1;
  const migrated = migrate(legacy as SaveBlob);
  const old = new Simulation();
  applySave(old, migrated);
  tick(old, 30);
  check(
    "a legacy save migrates without producing non-finite state",
    old.finite() && Number.isFinite(old.state().freight.payload_swing_rad),
  );
  check(
    "migration does not reset the damage the legacy save recorded",
    old.state().frame.plastic_set_m === before.frame.plastic_set_m,
  );
}

// ---------------------------------------------------------------------------
group("traversal follows structure, not scripting");
{
  const sim = new Simulation();
  tick(sim, 60);
  const edge = () => evaluateTraversal(sim.state()).find((e) => e.id === "gallery_span")!;
  check("the gallery carries a route while its spans are live", edge().valid);
  sim.act({ type: "cut_member", id: "g12_a" });
  sim.act({ type: "cut_member", id: "g12_b" });
  sim.act({ type: "cut_member", id: "g12_c" });
  sim.act({ type: "cut_member", id: "g12_d" });
  tick(sim, 120);
  check("cutting its supports kills the edge", !edge().valid, edge().reason ?? "");
  check("an NPC will not use an unsafe deck", !edge().npc_safe);
  check("the shop becomes unreachable by that route", !inhabitantCanReachShop(sim.state()));
}

// ---------------------------------------------------------------------------
group("missions read world state");
{
  const sim = new Simulation();
  const done = () => Object.fromEntries(evaluateMissions(sim.state()).map((m) => [m.id, m.done]));
  check("nothing is complete at t=0", Object.values(done()).every((v) => v === false));

  sim.setCommand("GateVent", true);
  sim.setCommand("GateVent", false);
  tick(sim, 1800);
  sim.act({ type: "vent_close" });
  sim.act({ type: "toggle_breaker", id: "brk_drive" });
  tick(sim, 15);
  releaseBrake(sim);
  sim.setCommand("CarrierRight", true);
  tick(sim, 330);
  sim.setCommand("CarrierRight", false);
  tick(sim, 400);
  releaseBrake(sim);
  tick(sim, 60);
  // Holding over the deck is not docking. The load is docked when it is put
  // down and its weight leaves the rope.
  check("holding over the deck is not yet a dock", done().dock === false);
  const released = sim.act({ type: "carrier_release" });
  tick(sim, 60);
  check("releasing over the deck docks the load", done().dock === true, released);
  check("the payload's weight left the rope", sim.state().freight.payload_kg < 1000);

  sim.setCommand("GateOpen", true);
  tick(sim, 300);
  sim.setCommand("GateOpen", false);
  tick(sim, 60);
  check("the maintenance walk opens by load path", done().walk === true);

  sim.act({ type: "chen_reroute" });
  sim.act({ type: "toggle_breaker", id: "brk_shop" });
  sim.act({ type: "mark_save_used" });
  tick(sim, 30);
  check("the shop stands up on a live island", done().shop === true);
  check("the shop is fed from the west bus", sim.state().electrical.chen_rerouted);

  check("the act will not close while the drive is undecided", sim.act({ type: "end_act" }).includes("still a choice"));
  sim.act({ type: "recover_drive" });
  tick(sim, 30);
  check("the drive resolves", done().drive === true);
  sim.act({ type: "end_act" });
  check("act I closes", sim.state().flags.act_ended);

  const alt = new Simulation();
  alt.act({ type: "abandon_drive" });
  check("the fast pull is a second valid ending", alt.state().flags.drive_abandoned);
  check("and it costs the neck", alt.state().frame.plastic_set_m > 0 && alt.state().frame.damage > 0);
}

// ---------------------------------------------------------------------------
group("presentation cannot become world truth");
{
  const gait = new Gait();
  gait.reset(0);
  let maxUp = 0;
  let maxRoll = 0;
  for (let i = 0; i < 600; i++) {
    const f = gait.update({
      dt: 1 / 60,
      speed: 4.85,
      vx: 4.85,
      vz: 0,
      yaw: i * 0.01,
      grounded: true,
      crouch: false,
      landingImpact: i === 100 ? 9 : 0,
      moveInput: 1,
    });
    maxUp = Math.max(maxUp, Math.abs(f.offsetUp));
    maxRoll = Math.max(maxRoll, Math.abs(f.roll));
    if (!Number.isFinite(f.offsetUp + f.roll + f.pitch + f.yaw)) {
      check("gait stays finite", false);
      break;
    }
  }
  check("gait vertical offset stays small", maxUp < 0.11, `${(maxUp * 1000).toFixed(0)} mm`);
  check("gait roll stays under three degrees", maxRoll < 0.053, `${((maxRoll * 180) / Math.PI).toFixed(2)} deg`);

  const off = new Gait();
  off.reset(0);
  off.intensity = 0;
  let any = 0;
  for (let i = 0; i < 120; i++) {
    const f = off.update({
      dt: 1 / 60, speed: 4.85, vx: 4.85, vz: 0, yaw: i * 0.02,
      grounded: true, crouch: false, landingImpact: i === 30 ? 8 : 0, moveInput: 1,
    });
    any += Math.abs(f.offsetUp) + Math.abs(f.offsetRight) + Math.abs(f.roll) + Math.abs(f.pitch) + Math.abs(f.yaw);
  }
  check("gait intensity 0 produces exactly no offset", any === 0);
}

// ---------------------------------------------------------------------------
group("look target and action target are different things");
{
  const items: Interactable[] = [
    { id: "machine", label: "Carrier", x: 0, y: 1.6, z: -20, reach: 3, kind: "machine", lookRange: 40 },
    { id: "station", label: "Pulpit", x: 0.4, y: 1.6, z: -2, reach: 2.9, kind: "station", lookRange: 16 },
  ];
  const colliders: Collider[] = [];
  const resolver = new ContextResolver();
  const eye = eyePose(0, 1.6, 0, 0, 0); // looking down -Z at the distant machine
  const r = resolver.resolve(eye, items, colliders, () => true);
  check("a distant machine is identified", r.look?.id === "machine", r.look?.label ?? "none");
  check("but it cannot be acted on from here", r.action?.id !== "machine");
  check("the nearby station is the action target", r.action?.id === "station");

  // A wall between the eye and the station removes it from both resolutions.
  const walled = new ContextResolver();
  const wall: Collider[] = [{ id: "wall", minx: -4, maxx: 4, miny: 0, maxy: 3, minz: -1.4, maxz: -1.2 }];
  const r2 = walled.resolve(eye, items, wall, () => true);
  check("line of sight is enforced", r2.action?.id !== "station" && r2.look?.id !== "station");
}

// ---------------------------------------------------------------------------
console.log(`\n${failures === 0 ? "PASS" : "FAIL"}: ${checks - failures}/${checks} authority reference checks`);
if (failures > 0) process.exit(1);
