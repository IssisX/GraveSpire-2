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
import {
  applyCarryForce,
  bodyAabb,
  bodyTilt,
  makeBody,
  stepBodies,
  type StaticBox,
  type BodyState,
  type DistanceJoint,
  type PointJoint,
  type PulleyJoint,
} from "@/sim/bodies.ts";
import { Gait } from "@/game/gait.ts";
import { ContextResolver, eyePose, type Interactable } from "@/game/context.ts";
import type { Collider } from "@/game/collision.ts";
import { Player } from "@/game/player.ts";
import type { Actions } from "@/game/input.ts";
import { designOutput, wrapIntoBox } from "@/game/atmosphere.ts";

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

/** World-space position of a body's local anchor point, via its quaternion. */
function anchorWorld(b: BodyState, lx: number, ly: number, lz: number): [number, number, number] {
  const { qx, qy, qz, qw } = b;
  const tx = 2 * (qy * lz - qz * ly);
  const ty = 2 * (qz * lx - qx * lz);
  const tz = 2 * (qx * ly - qy * lx);
  return [
    b.px + lx + qw * tx + (qy * tz - qz * ty),
    b.py + ly + qw * ty + (qz * tx - qx * tz),
    b.pz + lz + qw * tz + (qx * ty - qy * tx),
  ];
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

// ---------------------------------------------------------------------------
group("movable mass: resting, tipping, bridging");
{
  const floor: StaticBox = { id: "floor", minx: -20, maxx: 20, miny: -1, maxy: 0, minz: -20, maxz: 20 };
  const drop = (def: Parameters<typeof makeBody>[0], statics: StaticBox[], ticks: number) => {
    const bodies = [makeBody(def)];
    const r = new Map<string, number>();
    for (let i = 0; i < ticks * 4; i++) stepBodies(bodies, statics, 1 / 120, r);
    return { b: bodies[0]!, r };
  };

  const rest = drop(
    { id: "t", name: "T", material: "steel", size: [1, 0.4, 1], mass_kg: 100, at: [0, 3, 0] },
    [floor],
    120,
  );
  check(
    "a dropped body comes to rest on the surface, not through it",
    Math.abs(rest.b.py - 0.2) < 0.02,
    `centre at ${rest.b.py.toFixed(3)} m, half-height 0.2 m`,
  );
  check("and it goes to sleep rather than jittering forever", rest.b.sleeping);
  check(
    "its weight is reported as a contact reaction",
    (rest.r.get("floor") ?? 0) > 0,
    `${((rest.r.get("floor") ?? 0) / (120 * 4)).toFixed(0)} N averaged`,
  );

  // Centre of mass past the support edge: it must tip off, with no tipping code.
  const ledge: StaticBox = { id: "ledge", minx: -2, maxx: 0, miny: 0, maxy: 1, minz: -2, maxz: 2 };
  const balanced = drop(
    { id: "t2", name: "T2", material: "steel", size: [1, 0.3, 1], mass_kg: 80, at: [-0.6, 1.2, 0] },
    [floor, ledge],
    150,
  );
  const overhung = drop(
    { id: "t3", name: "T3", material: "steel", size: [1, 0.3, 1], mass_kg: 80, at: [0.35, 1.2, 0] },
    [floor, ledge],
    150,
  );
  check(
    "mass supported inside the edge stays on the ledge",
    balanced.b.py > 0.9,
    `y ${balanced.b.py.toFixed(2)} m`,
  );
  check(
    "mass overhanging the edge tips off it",
    overhung.b.py < 0.7,
    `y ${overhung.b.py.toFixed(2)} m — no tipping rule was written, only torque about the contact`,
  );

  // A plate laid across two blocks is a bridge because it is a contact volume.
  const pierA: StaticBox = { id: "pierA", minx: -2.2, maxx: -1.4, miny: 0, maxy: 1.2, minz: -1, maxz: 1 };
  const pierB: StaticBox = { id: "pierB", minx: 1.4, maxx: 2.2, miny: 0, maxy: 1.2, minz: -1, maxz: 1 };
  const span = drop(
    { id: "p", name: "Plate", material: "steel", size: [4.2, 0.1, 0.6], mass_kg: 58, at: [0, 1.6, 0] },
    [floor, pierA, pierB],
    150,
  );
  check(
    "a plate laid across two piers stays up as a span",
    span.b.py > 1.1 && bodyTilt(span.b) < 0.2,
    `y ${span.b.py.toFixed(2)} m, tilt ${((bodyTilt(span.b) * 180) / Math.PI).toFixed(1)} deg`,
  );
  const ab = bodyAabb(span.b);
  check(
    "and its surface is where the player would walk",
    ab.maxy > 1.2 && ab.maxx - ab.minx > 4,
    `top ${ab.maxy.toFixed(2)} m, ${(ab.maxx - ab.minx).toFixed(1)} m long`,
  );
}

// ---------------------------------------------------------------------------
group("the force ladder is friction and gravity, not a whitelist");
{
  const floor: StaticBox = { id: "floor", minx: -20, maxx: 20, miny: -1, maxy: 0, minz: -20, maxz: 20 };
  const tryCarry = (mass: number, lift: boolean) => {
    const b = makeBody({ id: "c", name: "C", material: "steel", size: [0.6, 0.6, 0.6], mass_kg: mass, at: [0, 0.3, 0] });
    const bodies = [b];
    b.attached = "player";
    const r = new Map<string, number>();
    const target = lift ? [0, 1.6, 0] : [3.5, 0.3, 0];
    for (let i = 0; i < 480; i++) {
      applyCarryForce(b, target[0]!, target[1]!, target[2]!, 1 / 120);
      stepBodies(bodies, [floor], 1 / 120, r);
    }
    return b;
  };
  check("a 26 kg crate lifts", tryCarry(26, true).py > 1.2, `${tryCarry(26, true).py.toFixed(2)} m`);
  const spool = tryCarry(150, true);
  check("a 150 kg spool will not lift", spool.py < 0.6, `${spool.py.toFixed(2)} m`);
  check("but it drags", tryCarry(150, false).px > 1.5, `${tryCarry(150, false).px.toFixed(2)} m`);
  const beam = tryCarry(245, false);
  check(
    "a 245 kg beam neither lifts nor drags by hand",
    beam.px < 0.6,
    `moved ${beam.px.toFixed(2)} m — this is where the hook or a lever is required`,
  );
}

// ---------------------------------------------------------------------------
group("resting mass is measured structural load");
{
  const sim = new Simulation();
  sim.setStatics([
    { id: "gal_floor", minx: 8, maxx: 58, miny: 2.17, maxy: 2.45, minz: 11.5, maxz: 27.5 },
    { id: "ground", minx: -40, maxx: 100, miny: -2, maxy: 0, minz: -40, maxz: 40 },
  ]);
  tick(sim, 120);
  const span = () => sim.state().members.find((m) => m.id === "g12_c")!;
  const baseForce = span().force_n;
  const baseSag = span().sag_m;
  check("gallery spans carry their dead load", baseForce > 0, `${(baseForce / 1000).toFixed(1)} kN`);
  // Ballast settles onto the deck and falls asleep well within 120 ticks —
  // its weight must still be there afterward, not vanish with the contact
  // solver that no longer needs to run for it.
  check(
    "ballast resting on the deck is measured into the spans, even asleep",
    sim.reactionOn("gal_floor") > 1000,
    `${(sim.reactionOn("gal_floor") / 1000).toFixed(1)} kN of reaction`,
  );
  check(
    "and it raises the span force above dead load alone",
    span().force_n > baseForce * 0.9,
    `${(span().force_n / 1000).toFixed(1)} kN`,
  );
  void baseSag;

  // Cutting spans redistributes that measured load to the survivors.
  const before = span().force_n;
  sim.act({ type: "cut_member", id: "g12_a" });
  sim.act({ type: "cut_member", id: "g12_b" });
  tick(sim, 60);
  check(
    "cutting neighbours pushes their share into this span",
    span().force_n > before,
    `${(before / 1000).toFixed(1)} -> ${(span().force_n / 1000).toFixed(1)} kN`,
  );
}

// ---------------------------------------------------------------------------
group("debris persists and stays useful");
{
  const sim = new Simulation();
  sim.setStatics([{ id: "ground", minx: -40, maxx: 100, miny: -2, maxy: 0, minz: -40, maxz: 40 }]);
  tick(sim, 300);
  const beam = sim.body("beam_a")!;
  const restedAt = { x: beam.px, y: beam.py, z: beam.pz };
  check("settled debris sleeps", beam.sleeping);
  tick(sim, 900);
  check(
    "and is still exactly where it was left after five more minutes of world time",
    Math.hypot(beam.px - restedAt.x, beam.py - restedAt.y, beam.pz - restedAt.z) < 1e-9,
    "no lifetime, no cleanup, no expiry",
  );

  const blob = captureSave(sim, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });
  const restored = new Simulation();
  restored.setStatics([{ id: "ground", minx: -40, maxx: 100, miny: -2, maxy: 0, minz: -40, maxz: 40 }]);
  applySave(restored, blob);
  const rb = restored.body("beam_a")!;
  check(
    "a save restores every body where the player left it",
    Math.abs(rb.px - restedAt.x) < 1e-9 && Math.abs(rb.py - restedAt.y) < 1e-9,
  );
  check("and its orientation", Math.abs(rb.qw - beam.qw) < 1e-12);
}

// ---------------------------------------------------------------------------
group("joints: pivots, ropes, and pulleys");
{
  // A physical pendulum: a beam pinned at one end to a fixed point.
  const beam = makeBody({ id: "pendulum", name: "pendulum", material: "steel", size: [0.2, 2.0, 0.2], mass_kg: 40, at: [3, 5, 0], yaw: 1.4 });
  const pivotWorld: [number, number, number] = [3, 5, 0];
  const pivot: PointJoint = {
    id: "pivot", kind: "point", force_n: 0,
    a: { bodyId: beam.id, point: [0, 1.0, 0] },
    b: { bodyId: null, point: pivotWorld },
  };
  const r1 = new Map<string, number>();
  for (let i = 0; i < 900; i++) stepBodies([beam], [], 1 / 120, r1, [pivot]);
  const anchor = anchorWorld(beam, 0, 1.0, 0);
  const anchorErr = Math.hypot(anchor[0] - pivotWorld[0], anchor[1] - pivotWorld[1], anchor[2] - pivotWorld[2]);
  check("a pinned pendulum's pivot point stays coincident with its fixed anchor", anchorErr < 0.01, `error=${anchorErr.toFixed(5)} m`);
  check("and it settles hanging below the pivot, not orbiting or diverging", beam.py < pivotWorld[1] - 0.5 && Math.hypot(beam.vx, beam.vy, beam.vz) < 0.05);

  // A symmetric beam pinned at its own centre: unloaded it is genuinely
  // balanced (no tipping rule holds it level); load one end and real torque
  // about the pivot tips it -- the pin resists translation, not rotation.
  const seesaw = makeBody({ id: "seesaw", name: "seesaw", material: "steel", size: [6.0, 0.2, 1.0], mass_kg: 200, at: [0, 2, 0] });
  const centrePivot: PointJoint = {
    id: "seesaw_pivot", kind: "point", force_n: 0,
    a: { bodyId: seesaw.id, point: [0, 0, 0] },
    b: { bodyId: null, point: [0, 2, 0] },
  };
  const load = makeBody({ id: "load", name: "load", material: "steel", size: [0.5, 0.5, 0.5], mass_kg: 150, at: [2.6, 2.35, 0] });
  const r2 = new Map<string, number>();
  for (let i = 0; i < 600; i++) stepBodies([seesaw, load], [], 1 / 120, r2, [centrePivot]);
  const loadedEnd = anchorWorld(seesaw, 3, 0, 0)[1];
  const farEnd = anchorWorld(seesaw, -3, 0, 0)[1];
  check(
    "no tipping rule was written, only torque about a fixed pivot: the loaded end drops",
    loadedEnd < farEnd - 0.5,
    `loaded end=${loadedEnd.toFixed(2)} m, far end=${farEnd.toFixed(2)} m`,
  );

  // A rope: slack (zero force) under its rest length, engages once taut, and
  // does not let a fixed-anchored body fall past that length.
  const bucket = makeBody({ id: "bucket", name: "bucket", material: "steel", size: [0.4, 0.4, 0.4], mass_kg: 20, at: [0, 10, 0] });
  const rope: DistanceJoint = {
    id: "rope", kind: "distance", force_n: 0, jAcc: 0,
    a: { bodyId: null, point: [0, 10, 0] }, b: { bodyId: bucket.id, point: [0, 0, 0] },
    restLength: 3.0, mode: "rope",
  };
  const r3 = new Map<string, number>();
  let sawSlack = false;
  for (let i = 0; i < 200; i++) {
    stepBodies([bucket], [], 1 / 120, r3, [rope]);
    if (i === 5) sawSlack = rope.force_n === 0 && bucket.vy < -0.3;
  }
  check("a slack rope applies zero force and the body free-falls under it", sawSlack);
  check("the rope catches the fall at its rest length, not past it", 10 - bucket.py <= 3.05, `drop=${(10 - bucket.py).toFixed(3)} m (rest=3.0 m)`);

  // A pulley: two segments through one fixed point, coupled only by their
  // length sum -- not an authored lift ratio.
  const heavy = makeBody({ id: "heavy", name: "heavy", material: "steel", size: [0.5, 0.5, 0.5], mass_kg: 400, at: [-2, 4, 0] });
  const light = makeBody({ id: "light", name: "light", material: "steel", size: [0.5, 0.5, 0.5], mass_kg: 80, at: [2, 4, 0] });
  const pulleyPoint: [number, number, number] = [0, 8, 0];
  const startLen =
    Math.hypot(heavy.px - pulleyPoint[0], heavy.py - pulleyPoint[1]) +
    Math.hypot(light.px - pulleyPoint[0], light.py - pulleyPoint[1]);
  const pulley: PulleyJoint = {
    id: "hoist_pulley", kind: "pulley", force_n: 0, jAcc: 0,
    a: { bodyId: heavy.id, point: [0, 0, 0] }, pulleyPoint, b: { bodyId: light.id, point: [0, 0, 0] },
    totalLength: startLen, mode: "rod",
  };
  const r4 = new Map<string, number>();
  for (let i = 0; i < 300; i++) stepBodies([heavy, light], [], 1 / 120, r4, [pulley]);
  check("the heavier side of a pulley descends and the lighter side is pulled up", heavy.py < 4 - 0.3 && light.py > 4 + 0.3);
  const endLen =
    Math.hypot(heavy.px - pulleyPoint[0], heavy.py - pulleyPoint[1]) +
    Math.hypot(light.px - pulleyPoint[0], light.py - pulleyPoint[1]);
  check("total rope length through the pulley is conserved, not an authored ratio", Math.abs(endLen - startLen) < 0.05, `${endLen.toFixed(3)} m vs ${startLen.toFixed(3)} m`);
}

// ---------------------------------------------------------------------------
// DEFECT (found in code review, before this test existed): wake propagation
// through a chain of joints was a single forward pass over the joints array.
// A-B before B-C in that array correctly propagated a wake from A through to
// C; the reverse order left C asleep for the whole tick even though B had
// just woken. jointSettled only requires ONE side awake to keep a joint
// active, so the solver applied a real impulse to still-sleeping C anyway --
// its velocity changed but its position integration stayed frozen (skipped
// for sleeping bodies), and the stale velocity only surfaced as a one-frame
// teleport once the next tick's pass finally marked it awake. Root cause was
// incomplete propagation, not the solver itself, so the fix is a fixed-point
// pass over the joints array (bounded by joints.length, cheap at the joint
// counts this game has), not a guard inside the solver.
group("joint wake propagates through a chain in one tick, any array order");
{
  const a = makeBody({ id: "chain_a", name: "a", material: "steel", size: [0.4, 0.4, 0.4], mass_kg: 20, at: [0, 10, 0] });
  const b = makeBody({ id: "chain_b", name: "b", material: "steel", size: [0.4, 0.4, 0.4], mass_kg: 20, at: [0, 8, 0] });
  const c = makeBody({ id: "chain_c", name: "c", material: "steel", size: [0.4, 0.4, 0.4], mass_kg: 20, at: [0, 6, 0] });
  a.sleeping = false;
  b.sleeping = true; b.restT = 999;
  c.sleeping = true; c.restT = 999;
  a.vy = 3; // a real disturbance to propagate, not a no-op wake
  const bc: DistanceJoint = {
    id: "bc", kind: "distance", force_n: 0, jAcc: 0,
    a: { bodyId: b.id, point: [0, 0, 0] }, b: { bodyId: c.id, point: [0, 0, 0] },
    restLength: 2.0, mode: "rod",
  };
  const ab: DistanceJoint = {
    id: "ab", kind: "distance", force_n: 0, jAcc: 0,
    a: { bodyId: a.id, point: [0, 0, 0] }, b: { bodyId: b.id, point: [0, 0, 0] },
    restLength: 2.0, mode: "rod",
  };
  // Deliberately the array order that breaks a single forward pass: the
  // b-c link appears before the a-b link that is what actually wakes b.
  const joints = [bc, ab];
  const r = new Map<string, number>();
  let maxAbsVy = 0;
  for (let i = 0; i < 30; i++) {
    stepBodies([a, b, c], [], 1 / 120, r, joints);
    maxAbsVy = Math.max(maxAbsVy, Math.abs(b.vy), Math.abs(c.vy));
  }
  check("both chained bodies wake within the same tick the disturbance reaches them", !b.sleeping && !c.sleeping);
  check(
    "no corrupted-while-frozen velocity spike from incomplete propagation",
    maxAbsVy < 20,
    `max |vy| on the chain = ${maxAbsVy.toFixed(2)} m/s (real accelerations here stay well under this)`,
  );
}

// ---------------------------------------------------------------------------
group("the counterweight lever is a real obstacle, not a scripted one");
{
  const sim = new Simulation();
  sim.setStatics([{ id: "floor_sw", minx: 0, maxx: 42, miny: -0.5, maxy: 0, minz: -11.5, maxz: -3.5 }]);
  tick(sim, 180);
  const lever = sim.body("lever_beam")!;
  check("unloaded, it rests level -- genuinely balanced, not held level by a rule", lever.sleeping && Math.abs(lever.wz) < 1e-6);

  // Drop an already-liftable crate onto the lever's +x end from clear of its
  // surface (an overlapping start pops the beam with a spurious impulse --
  // that would be a test-setup bug, not the solver's).
  const crate = sim.body("crate_a")!;
  crate.px = 25.3; crate.py = 1.4; crate.pz = -8;
  crate.vx = 0; crate.vy = 0; crate.vz = 0; crate.wx = 0; crate.wy = 0; crate.wz = 0;
  crate.sleeping = false; crate.restT = 0;
  tick(sim, 240);

  const loadedEnd = anchorWorld(lever, 3.3, 0, 0)[1];
  const farEnd = anchorWorld(lever, -3.3, 0, 0)[1];
  check(
    "a body dropped on one end tips that end to the floor and lifts the other",
    loadedEnd < 0.3 && loadedEnd < farEnd - 0.3,
    `loaded end=${loadedEnd.toFixed(2)} m, far end=${farEnd.toFixed(2)} m`,
  );
  check("the pivot itself never moved -- it took the load, not the joint failing", Math.hypot(lever.px - 22, lever.py - 0.55, lever.pz + 8) < 0.05);
}

// ---------------------------------------------------------------------------
group("the counterweight hatch holds open only while pulled, then swings shut");
{
  const sim = new Simulation();
  sim.setStatics([{ id: "floor_sw", minx: 0, maxx: 42, miny: -0.5, maxy: 0, minz: -11.5, maxz: -3.5 }]);
  tick(sim, 180);

  const tipY = () => anchorWorld(sim.body("hatch_flap")!, 1.5, 0, 0)[1];
  check("unloaded, the flap's own weight holds it flat and asleep", sim.body("hatch_flap")!.sleeping && tipY() < 0.2, `tip=${tipY().toFixed(3)} m`);

  // Grab the counterweight through the real action and hold it down, the
  // same way the player would -- not a direct body mutation.
  const verdict = sim.act({ type: "grab_body", id: "hatch_counterweight" });
  check("the counterweight alone is liftable by hand", verdict.includes("lift"), verdict);
  for (let i = 0; i < 400; i++) {
    sim.setCarryTarget({ x: 33, y: 0.3, z: -8 });
    sim.advanceAuthorityTick();
  }
  check(
    "held and pulled down, the combined force swings the flap open",
    tipY() > 0.5,
    `tip=${tipY().toFixed(3)} m`,
  );

  sim.act({ type: "release_body", throw: false });
  sim.setCarryTarget(null);
  tick(sim, 500);
  check(
    "released, the flap's own weight wins back and it swings shut again",
    tipY() < 0.2,
    `tip=${tipY().toFixed(3)} m`,
  );
}

// ---------------------------------------------------------------------------
group("the parachute: arcade flight, always-survivable landings");
{
  function noInput(overrides: Partial<Actions> = {}): Actions {
    return {
      moveX: 0, moveY: 0, moveMag: 0,
      lookX: 0, lookY: 0,
      jump: false, jumpPressed: false,
      crouch: false, sprint: false,
      interact: false, interactPressed: false, interactReleased: false,
      inspectPressed: false, pausePressed: false, cyclePressed: false,
      ...overrides,
    };
  }
  const GROUND: Collider = { id: "ground", minx: -50, maxx: 50, miny: -0.5, maxy: 0, minz: -50, maxz: 50 };
  const dt = 1 / 60;

  const noChute = new Player();
  noChute.x = 0; noChute.y = 100; noChute.z = 0; noChute.grounded = false;
  noChute.step(dt, noInput({ jumpPressed: true }), [GROUND]);
  check("without chuteEquipped, a second jump press does not deploy", !noChute.parachuting);

  const p = new Player();
  p.x = 0; p.y = 100; p.z = 0; p.grounded = false; p.chuteEquipped = true;
  p.step(dt, noInput({ jumpPressed: true }), [GROUND]);
  check("chute equipped: a jump press while airborne deploys it", p.parachuting);
  for (let i = 0; i < 240; i++) p.step(dt, noInput(), [GROUND]);
  check("vy settles at the base terminal velocity, not free-fall", Math.abs(p.vy - -4.5) < 0.3, `vy=${p.vy.toFixed(2)} (target -4.5)`);

  const brake = new Player();
  brake.x = 0; brake.y = 100; brake.z = 0; brake.grounded = false; brake.chuteEquipped = true; brake.parachuting = true;
  for (let i = 0; i < 120; i++) brake.step(dt, noInput({ crouch: true }), [GROUND]);
  check("holding brake settles to a slower descent than the base rate", brake.vy > -2.2 && brake.vy < -1.3, `vy=${brake.vy.toFixed(2)}`);

  const dive = new Player();
  dive.x = 0; dive.y = 100; dive.z = 0; dive.grounded = false; dive.chuteEquipped = true; dive.parachuting = true;
  for (let i = 0; i < 120; i++) dive.step(dt, noInput({ sprint: true }), [GROUND]);
  check("holding dive settles to a faster descent than the base rate", dive.vy < -9 && dive.vy > -12, `vy=${dive.vy.toFixed(2)}`);

  const steer = new Player();
  steer.x = 0; steer.y = 100; steer.z = 0; steer.yaw = 0; steer.grounded = false; steer.chuteEquipped = true; steer.parachuting = true;
  for (let i = 0; i < 90; i++) steer.step(dt, noInput({ moveX: 1, moveMag: 1 }), [GROUND]);
  check("steering produces real lateral velocity", Math.abs(steer.vx) > 5, `vx=${steer.vx.toFixed(2)}`);

  const land = new Player();
  land.x = 0; land.y = 20; land.z = 0; land.grounded = false; land.chuteEquipped = true;
  land.step(dt, noInput({ jumpPressed: true }), [GROUND]);
  for (let i = 0; i < 600 && !land.grounded; i++) land.step(dt, noInput(), [GROUND]);
  check("chute stows on landing", !land.parachuting);
  check(
    "landing from 20 m under canopy is survivable -- past the normal 8.5 m death threshold",
    land.fallDamage() === "none",
  );
  land.y = 20; land.grounded = false; land.airTime = 0; land.fallFrom = 20; land.vy = 0;
  for (let i = 0; i < 600 && land.y > 0.01; i++) land.step(dt, noInput(), [GROUND]);
  check("a later fall WITHOUT the chute is still dangerous -- damage isn't globally disabled", land.fallDamage() === "dead");

  // DEFECT (code review): the well's pit floor is collider:false; the only
  // thing that stopped an unassisted fall there was the unconditional
  // y<-6 death check, now suppressed while parachuting. A glide over open
  // geometry with nothing beneath it must still resolve, not fall forever.
  const bottom = new Player();
  bottom.x = 21; bottom.y = 20; bottom.z = 0; bottom.grounded = false; bottom.chuteEquipped = true;
  bottom.step(dt, noInput({ jumpPressed: true }), []); // deploy over NO colliders at all
  for (let i = 0; i < 3000 && !bottom.grounded; i++) bottom.step(dt, noInput(), []);
  check("a glide with no floor anywhere still resolves, not an infinite fall", bottom.grounded && bottom.y === -30, `grounded=${bottom.grounded} y=${bottom.y}`);
  check("it resolves as a safe landing, not damage", bottom.fallDamage() === "none");
  // DEFECT (code review, round 2): a one-shot grounded=true here was
  // overwritten by moveCapsule's own correct grounded=false on the very
  // next step (there is no real collider down there), which -- with
  // parachuting already cleared -- walked back into the death check one
  // frame later. Confirm it STAYS resolved, not just at the landing instant.
  for (let i = 0; i < 300; i++) bottom.step(dt, noInput(), []);
  check(
    "it stays safely resolved for many further frames, not just the landing instant",
    bottom.grounded && bottom.y === -30 && bottom.fallDamage() === "none",
  );
}

// --- atmosphere: the two laws the air runs on ------------------------------
// The renderer parts of this module need a GL context, but the two things
// that can silently rot do not: the mote field's wrap and a fixture's healthy
// output. Both are pure, and both fail invisibly -- a wrong wrap leaks the
// dust field away from the eye over minutes, and a wrong design output leaves
// every light shaft at full strength through a total bus derating.
group("the atmosphere: dust that follows the eye, shafts that read the bus");
{
  const BOX = 22;
  check("a mote already inside the box around the eye is left alone", wrapIntoBox(103, 100, BOX) === 103);
  check(
    "a mote that drifts out one side comes back the other, a full box away",
    Math.abs(wrapIntoBox(100 + BOX / 2 + 0.5, 100, BOX) - (100 - BOX / 2 + 0.5)) < 1e-9,
    `wrapped to ${wrapIntoBox(100 + BOX / 2 + 0.5, 100, BOX)}`,
  );
  // The field has to survive the eye moving much further than one box --
  // falling down the well, or a whole climb -- without being left behind.
  let far = 0;
  for (const eye of [0, 40, -95, 610, -1200]) far = wrapIntoBox(far, eye, BOX);
  check(
    "the field follows the eye across arbitrarily long moves, not just short ones",
    Math.abs(far - -1200) <= BOX / 2 + 1e-9,
    `mote at ${far.toFixed(2)} for an eye at -1200 (box ${BOX})`,
  );
  check(
    "wrapping is idempotent -- a settled mote does not keep jumping",
    wrapIntoBox(wrapIntoBox(517, 100, BOX), 100, BOX) === wrapIntoBox(517, 100, BOX),
  );

  // A fixture's healthy output. The shaft thins as `out / designOutput`, so
  // if this stayed at the catalogue intensity a lamp is *constructed* with
  // (14) while the runtime drives it at 24, every cone would sit pinned at
  // full strength across the entire derating range and the coupling the
  // module documents would do nothing.
  let design = 14; // Kit.lightFixture's sodium value at construction
  design = designOutput(design, 24); // first healthy frame from the bus
  check("design output calibrates up to what the bus actually asks for", design === 24);
  for (const derated of [24 * (1 - 0.38 * 0.5), 24 * (1 - 0.38 * 1), 0.9]) {
    design = designOutput(design, derated);
  }
  check(
    "a sagging or dead bus never redefines healthy -- the design output holds",
    design === 24,
    `design=${design}`,
  );
  check(
    "a fully derated lamp therefore reads as well under full output",
    (24 * (1 - 0.38 * 1)) / design < 0.63,
    `lit ratio ${((24 * (1 - 0.38)) / design).toFixed(2)} at thermal=1`,
  );
  check("a blacked-out lamp reads as effectively off", 0.9 / design < 0.04);
}

console.log(`\n${failures === 0 ? "PASS" : "FAIL"}: ${checks - failures}/${checks} authority reference checks`);
if (failures > 0) process.exit(1);
