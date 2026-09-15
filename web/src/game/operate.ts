import type { Simulation } from "@/sim/simulation.ts";
import type { Command } from "@/sim/types.ts";
import type { Actions } from "./input.ts";

export type OperateKind = "carrier" | "gate" | "frame";

export function operateKind(id: string | null): OperateKind | null {
  if (!id) return null;
  if (id === "pendant" || id === "carrier" || id === "cable") return "carrier";
  if (id === "gate") return "gate";
  if (id === "frame" || id === "neck_brace") return "frame";
  return null;
}

export function operateStationId(kind: OperateKind | null): string | null {
  if (kind === "carrier") return "pendant";
  if (kind === "gate") return "gate";
  if (kind === "frame") return "frame";
  return null;
}

export function operateHint(kind: OperateKind | null, touch: boolean): string {
  if (kind === "carrier") {
    return touch ? "Raise / lower / traverse / brake — local to this pendant." : "R raise  F lower  Z/X traverse  B brake";
  }
  if (kind === "gate") {
    return touch ? "Open / close / vent — leaf torque is real." : "G open  T close  V vent";
  }
  if (kind === "frame") {
    return touch ? "Jack takes load. Brace is a separate path." : "R jack  ·  Brace is a contextual action";
  }
  return "";
}

/** Issues real simulation commands. Never bypasses power, torque, brake, or pressure. */
export function applyOperate(
  sim: Simulation,
  id: string | null,
  actions: Actions,
  last: Record<string, boolean>,
) {
  const kind = operateKind(id);
  const hold = (cmd: Command, on: boolean) => {
    if (last[cmd] === on) return;
    last[cmd] = on;
    sim.setCommand(cmd, on);
  };
  hold("CarrierRaise", kind === "carrier" && actions.operateRaise);
  hold("CarrierLower", kind === "carrier" && actions.operateLower);
  hold("CarrierLeft", kind === "carrier" && actions.operateLeft);
  hold("CarrierRight", kind === "carrier" && actions.operateRight);
  if (kind === "carrier" && actions.operateBrake && !last.brakePulse) {
    last.brakePulse = true;
    sim.setCommand("CarrierBrake", true);
    sim.setCommand("CarrierBrake", false);
  }
  if (!actions.operateBrake) last.brakePulse = false;
  hold("GateVent", kind === "gate" && actions.operateVent);
  hold("GateOpen", kind === "gate" && actions.operateOpen);
  hold("GateClose", kind === "gate" && actions.operateClose);
  hold("FrameJack", kind === "frame" && actions.operateRaise);
}
