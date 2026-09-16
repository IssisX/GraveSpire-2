import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Collider } from "./collision.ts";
import type { Actions } from "./input.ts";
import { Player } from "./player.ts";
import { RETURN_BRACES, RETURN_LADDERS, RETURN_TIERS } from "./recovery-layout.ts";

const DT = 1 / 60;

function actions(overrides: Partial<Actions> = {}): Actions {
  return {
    moveX: 0, moveY: 0, lookX: 0, lookY: 0, lookSens: 0.0022, invertY: false, autoSprint: false,
    jump: false, jumpPressed: false, crouch: false, sprint: false, interact: false, interactPressed: false,
    interactHold: false, inspect: false, selector: false, pausePressed: false, operateRaise: false,
    operateLower: false, operateLeft: false, operateRight: false, operateBrake: false, operateVent: false,
    operateOpen: false, operateClose: false,
    ...overrides,
  };
}

const box = (id: string, minx: number, maxx: number, miny: number, maxy: number, minz: number, maxz: number): Collider => ({
  id, minx, maxx, miny, maxy, minz, maxz,
});

function stepFor(player: Player, seconds: number, input: Actions, colliders: Collider[]) {
  for (let i = 0; i < Math.ceil(seconds / DT); i++) player.step(DT, input, colliders);
}

describe("physical return and recovery ecology", () => {
  it("has exposed MC-01→12 bands with deliberate ladder and brace discontinuities", () => {
    assert.equal(RETURN_TIERS[0]?.mc, "MC-12");
    assert.equal(RETURN_TIERS.at(-1)?.mc, "MC-01");
    assert.equal(new Set(RETURN_TIERS.map((tier) => tier.mc)).size, 12);
    assert.equal(RETURN_TIERS.some((tier) => tier.mc === "MC-13"), false);
    assert.ok(RETURN_TIERS.every((tier, i) => i === 0 || (RETURN_TIERS[i - 1]?.y ?? 0) > tier.y));
    assert.ok(RETURN_LADDERS.length < RETURN_TIERS.length, "ladders must not form a continuous return staircase");
    assert.ok(RETURN_BRACES.every((brace) => brace.segments >= 7), "brace segments retain physical gaps");
  });

  it("proves a representative ascent on a real maintenance ladder", () => {
    const player = new Player();
    player.x = 0.61;
    player.y = 0.20;
    player.z = 0;
    player.yaw = -Math.PI / 2;
    player.grounded = false;
    const ladder: Collider = {
      ...box("maintenance_ladder", 1.0, 1.18, 0, 5.0, -0.46, 0.46),
      climbable: { normalX: -1, normalZ: 0 },
    };
    player.step(DT, actions({ jumpPressed: true, moveY: 1 }), [ladder]);
    assert.equal(player.parkourMode, "ladder");
    stepFor(player, 0.9, actions({ moveY: 1 }), [ladder]);
    assert.equal(player.parkourMode, "ladder");
    assert.ok(player.y > 2.2, "ascent is driven by the climbable collider, not a waypoint");
  });

  it("preserves a running precision jump and carries a moving ledge catch", () => {
    const player = new Player();
    player.x = 0;
    player.y = 0;
    player.z = 0;
    player.yaw = -Math.PI / 2;
    player.grounded = true;
    player.groundedId = "runway";
    player.vx = 5.65;
    const runway = box("runway", -12, 12, -0.28, 0, -2, 2);
    player.step(DT, actions({ moveY: 1, sprint: true, jumpPressed: true }), [runway]);
    assert.equal(player.grounded, false);
    stepFor(player, 0.14, actions({ moveY: 1 }), [runway]);
    assert.ok(player.vx > 4.5, "precision jump retains real approach momentum");

    const catcher = { ...box("moving_catcher", player.x + 0.42, player.x + 4.5, 1.42, 1.62, -1, 1), surfaceVx: 2.4 };
    player.y = 0;
    player.vy = -3;
    player.grounded = false;
    player.yaw = -Math.PI / 2;
    player.step(DT, actions({ moveY: 1 }), [catcher]);
    assert.equal(player.parkourMode, "hang");
    const caughtX = player.x;
    player.step(DT, actions(), [catcher]);
    assert.ok(player.x > caughtX + 0.02, "the ledge catch inherits the actual carrier velocity");
  });

  it("lets an angular machine support catch, carry, and throw through its real surface velocity", () => {
    const player = new Player();
    player.x = 4;
    player.y = 1.2;
    player.z = 0;
    player.grounded = true;
    player.groundedId = "swinging_arm";
    const arm: Collider = {
      ...box("swinging_arm", 0, 6, 1.0, 1.2, -0.65, 0.65),
      surfaceAngularZ: 1.3,
      surfacePivotX: 0,
      surfacePivotY: 0,
    };
    player.step(DT, actions({ jumpPressed: true }), [arm]);
    assert.equal(player.grounded, false);
    assert.ok(player.vy > 8.2, "jump inherits the arm's upward tangential velocity");
    assert.ok(player.vx < -1.1, "the arm also carries horizontal tangential velocity");
  });

  it("proves parachute re-entry onto a lower moving carrier under crosswind", () => {
    const player = new Player();
    player.x = 0;
    player.y = 94;
    player.z = 0;
    player.yaw = -Math.PI / 2;
    player.vy = -12;
    player.airTime = 0.75;
    player.fallFrom = 94;
    player.grounded = false;
    const carrier = { ...box("lower_moving_carrier", -90, 90, 73.6, 73.9, -36, 36), surfaceVx: 1.2 };
    player.step(DT, actions({ jumpPressed: true, moveY: 1 }), [carrier]);
    assert.equal(player.parachuteDeployed, true);
    assert.ok(player.windAccel > 0, "high-altitude steering reads crosswind before re-entry");
    for (let i = 0; i < 720 && !player.grounded; i++) player.step(DT, actions({ moveY: -0.35 }), [carrier]);
    assert.equal(player.groundedId, "lower_moving_carrier");
    const landedX = player.x;
    // Isolate the carrier contribution after touchdown: the chute's prior
    // crosswind velocity is not a substitute for the support's real motion.
    player.vx = 0;
    player.vz = 0;
    player.step(DT, actions(), [carrier]);
    assert.ok(player.x > landedX, "re-entry continues from the carrier physics state");
  });
});
