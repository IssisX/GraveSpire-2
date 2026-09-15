import type { WorldState } from "@/sim/types.ts";

export function npcMutter(state: WorldState, npcId: string, dist: number): string | null {
  if (dist > 5.4 || dist < 0.35) return null;
  const n = state.npcs.find((x) => x.id === npcId);
  if (!n) return null;
  if (npcId === "rami") {
    if (state.freight.brake_temperature_k > 400) return "Heat is friction. You're slipping that drum.";
    if (state.flags.payload_on_neck) return "Load's on the neck. Don't lie to me with a green lamp.";
    if (Math.abs(state.freight.lateral_m - 16) > 6) return "That load is still in the well. Dock is east, on the apron.";
    return "Pendant's on the pulpit. The hanging crate is not a remote.";
  }
  if (npcId === "chen") {
    if (state.electrical.chen_rerouted) return "West is in. Don't parallel the old drawing.";
    if (!state.electrical.process_isolated) return "Isolate gen or the drive cabinet. I will not close west live.";
    return "Island is open. Close west on a bus that actually exists.";
  }
  if (npcId === "ilea") {
    if (state.electrical.shop_powered) return "Shop's an island. Occupied routes stay occupied.";
    return "This shop is supposed to be the return. It has no power.";
  }
  if (npcId === "skip") {
    if (n.stuck) return "I'm not walking that. That's a hole, not a shortcut.";
    if (state.flags.drive_present) return "Drive's sitting on a bent transfer. Fast or slow — pick.";
    return "It's gone. You want a conscience, talk to Ilea.";
  }
  return null;
}
