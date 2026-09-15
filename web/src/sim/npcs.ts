import type { NpcState, WorldState } from "./types.ts";
import { evaluateTraversal, inhabitantCanReachShop } from "./missions.ts";

function walkToward(n: NpcState, x: number, y: number, z: number, rate: number) {
  n.x += (x - n.x) * rate;
  n.y += (y - n.y) * rate;
  n.z += (z - n.z) * rate;
}

/** Authority of where people stand. Presentation look-at is separate. */
export function tickNpcs(state: WorldState): void {
  const walk = evaluateTraversal(state);
  const gallery = walk.find((e) => e.id === "gallery_span");
  const strain = Math.abs(state.frame.twist_rad) + state.frame.deflection_m * 0.4;
  const hot = state.freight.brake_temperature_k > 380;

  const rami = state.npcs.find((n) => n.id === "rami");
  if (rami) {
    if (state.flags.payload_on_neck) rami.knows["docked"] = true;
    if (hot) rami.knows["heat"] = true;
    if (strain > 0.02) {
      walkToward(rami, 9.35, 0, -2.55, 0.02);
      rami.yaw = -1.2;
    } else {
      walkToward(rami, 4.6, 1.15, -7.4, 0.018);
      rami.yaw = 0.6;
    }
  }

  const chen = state.npcs.find((n) => n.id === "chen");
  if (chen) {
    const isolated = state.electrical.process_isolated || !state.electrical.breakers.find((b) => b.id === "brk_gen")?.closed;
    if (state.electrical.shop_powered && inhabitantCanReachShop(state)) {
      walkToward(chen, 78.4, 0, 3.1, 0.01);
      chen.district = chen.x > 64 ? "SHA" : "FS08";
      chen.yaw = -0.4;
    } else if (isolated && !state.electrical.chen_rerouted) {
      walkToward(chen, 38.55, 0, -8.05, 0.016);
      chen.district = "FS07";
      chen.yaw = 1.55;
    } else {
      walkToward(chen, 38.7, 0, -7.4, 0.012);
      chen.district = chen.x > 42 ? "FS08" : "FS07";
      chen.yaw = 0.2;
    }
  }

  const skip = state.npcs.find((n) => n.id === "skip");
  if (skip) {
    skip.stuck = gallery && !gallery.npc_safe ? gallery.reason : null;
    if (!skip.stuck) {
      const t = state.sim_time_s;
      const x = 24 + Math.sin(t * 0.07) * 10;
      walkToward(skip, x, 2.45, 19.4, 0.02);
      skip.yaw = Math.sin(t * 0.07) > 0 ? 1.57 : -1.57;
    }
  }

  const ilea = state.npcs.find((n) => n.id === "ilea");
  if (ilea) {
    if (!state.electrical.shop_powered) {
      walkToward(ilea, 84.4, 0, 2.15, 0.012);
      ilea.yaw = 1.55;
    } else {
      walkToward(ilea, 74.2, 0, -1.8, 0.01);
      ilea.yaw = -1.2;
    }
  }
}
