/**
 * Contextual action catalog.
 *
 * The mechanical vocabulary of GRAVESPIRE is unchanged — inspect, isolate,
 * sling, brace, jack, cut, operate, talk all still exist. What changed is the
 * routing: the world decides which of them are meaningful on the thing in front
 * of the player, instead of the player pre-selecting a tool from a rail.
 *
 * Rigging stays deliberately multi-stage (attach A -> compatible B -> commit),
 * because that sequence carries real physical meaning.
 */

import type { WorldState } from "@/sim/types.ts";
import type { Interactable } from "./context.ts";
import type { MachineKind } from "./machine.ts";

export type ActionKind =
  | "talk"
  | "inspect"
  | "operate"
  | "breaker"
  | "sling_attach"
  | "sling_commit"
  | "sling_clear"
  | "brace"
  | "jack_on"
  | "jack_off"
  | "cut"
  | "bench_save"
  | "recover_drive";

export interface ActionOption {
  kind: ActionKind;
  /** Verb line as shown in the prompt, e.g. "Operate Carrier 07-A". */
  label: string;
  targetId: string;
  /** Higher sorts first. The first entry is what a tap performs. */
  weight: number;
  /** Slow work held down over time rather than committed instantly. */
  work?: { kind: "cut" | "brace"; seconds: number };
  /** Machine mode this action opens. */
  machine?: MachineKind;
  /** Present when the action exists but the world currently refuses it. */
  refused?: string;
}

export interface ActionContextState {
  /** First attachment already chosen for a rigging sequence. */
  slingA: string | null;
  slingALabel: string | null;
}

/** Objects that can carry a rated line. Not everything is a rigging point. */
const RIGGABLE = new Set([
  "carrier",
  "cable",
  "frame",
  "neck_brace",
  "drive",
  "dock",
  "g12_a",
  "g12_b",
  "g12_c",
  "g12_d",
  "g12_e",
]);

/** Members the player may slow-cut. Declared, not "any mesh". */
const CUTTABLE = new Set(["g12_a", "g12_b", "g12_c", "g12_d", "g12_e", "neck_brace"]);

const BREAKER_FOR: Record<string, string> = {
  brk_gen: "brk_gen",
  brk_drive: "brk_drive",
  brk_gate: "brk_gate",
  brk_hab: "brk_hab",
  brk_shop: "brk_shop",
  brk_west: "brk_west",
  board: "brk_shop",
};

function breakerLabel(state: WorldState, id: string): string {
  const b = state.electrical.breakers.find((x) => x.id === id);
  if (!b) return "breaker";
  if (b.tripped) return `Reset ${b.name}`;
  return `${b.closed ? "Open" : "Close"} ${b.name}`;
}

/**
 * Every action the world offers on this object right now, best first.
 * An empty list means the object is scenery from where the player stands.
 */
export function actionsFor(
  state: WorldState,
  it: Interactable,
  ctx: ActionContextState,
): ActionOption[] {
  const out: ActionOption[] = [];
  const id = it.id;

  // ---- people ------------------------------------------------------------
  if (it.kind === "npc") {
    out.push({ kind: "talk", label: `Talk to ${it.label.split(" ")[0]}`, targetId: id, weight: 100 });
    out.push({ kind: "inspect", label: `Inspect ${it.label}`, targetId: id, weight: 8 });
    return sort(out);
  }

  // ---- machine control stations -------------------------------------------
  if (id === "pulpit") {
    out.push({
      kind: "operate",
      label: "Operate Carrier 07-A",
      targetId: "carrier",
      weight: 100,
      machine: "carrier",
      refused: state.electrical.carrier_powered ? undefined : "Process bus is dead. The pulpit has no control power.",
    });
    out.push({ kind: "inspect", label: "Inspect Carrier 07-A", targetId: "carrier", weight: 12 });
    return sort(out);
  }

  if (id === "gate") {
    out.push({ kind: "operate", label: "Operate Gate G-07", targetId: "gate", weight: 100, machine: "gate" });
    out.push({ kind: "inspect", label: "Inspect Gate G-07", targetId: "gate", weight: 20 });
    return sort(out);
  }

  if (id === "frame") {
    out.push({
      kind: "operate",
      label: "Operate frame jacks",
      targetId: "frame",
      weight: 100,
      machine: "frame",
    });
    out.push({ kind: "inspect", label: "Inspect transfer frame", targetId: "frame", weight: 20 });
    pushRigging(out, state, ctx, it);
    return sort(out);
  }

  // ---- electrical ---------------------------------------------------------
  const brk = BREAKER_FOR[id];
  if (brk) {
    out.push({ kind: "breaker", label: breakerLabel(state, brk), targetId: brk, weight: 100 });
    out.push({ kind: "inspect", label: "Inspect distribution board", targetId: "board", weight: 30 });
    return sort(out);
  }

  // ---- bench --------------------------------------------------------------
  if (it.kind === "bench") {
    out.push({
      kind: "bench_save",
      label: "Use Circ Shop bench",
      targetId: id,
      weight: 100,
      refused: state.electrical.shop_powered ? undefined : "Bench is dead. The shop is not a live island yet.",
    });
    out.push({ kind: "inspect", label: "Inspect bench", targetId: id, weight: 20 });
    return sort(out);
  }

  // ---- the drive ----------------------------------------------------------
  if (id === "drive") {
    if (state.flags.drive_present) {
      out.push({ kind: "recover_drive", label: "Recover transfer drive", targetId: id, weight: 90 });
    }
    out.push({ kind: "inspect", label: "Inspect drive housing", targetId: id, weight: 40 });
    pushRigging(out, state, ctx, it);
    return sort(out);
  }

  // ---- structure ----------------------------------------------------------
  const member = state.members.find((m) => m.id === id);
  if (member) {
    out.push({ kind: "inspect", label: `Inspect ${member.name}`, targetId: id, weight: 55 });
    if (!member.cut) {
      if (!member.braced) {
        out.push({
          kind: "brace",
          label: `Brace ${member.name}`,
          targetId: id,
          weight: 48,
          work: { kind: "brace", seconds: 2.2 },
        });
      }
      out.push({
        kind: member.jacked ? "jack_off" : "jack_on",
        label: member.jacked ? "Release jack" : `Jack ${member.name}`,
        targetId: id,
        weight: 42,
      });
      if (CUTTABLE.has(id)) {
        out.push({
          kind: "cut",
          label: `Cut ${member.name}`,
          targetId: id,
          weight: 18,
          work: { kind: "cut", seconds: 3.6 },
        });
      }
    }
    pushRigging(out, state, ctx, it);
    return sort(out);
  }

  // ---- everything else the world declared as touchable --------------------
  out.push({ kind: "inspect", label: `Inspect ${it.label}`, targetId: id, weight: 50 });
  pushRigging(out, state, ctx, it);
  return sort(out);
}

function pushRigging(
  out: ActionOption[],
  state: WorldState,
  ctx: ActionContextState,
  it: Interactable,
): void {
  if (!RIGGABLE.has(it.id)) return;
  const rigged = state.cables.find((c) => c.id === "sling");
  if (rigged) {
    if (rigged.a === it.id || rigged.b === it.id) {
      out.push({ kind: "sling_clear", label: "Clear working sling", targetId: it.id, weight: 34 });
    }
    return;
  }
  if (!ctx.slingA) {
    out.push({ kind: "sling_attach", label: `Attach sling to ${it.label}`, targetId: it.id, weight: 30 });
  } else if (ctx.slingA !== it.id) {
    out.push({
      kind: "sling_commit",
      label: `Rig ${ctx.slingALabel ?? "sling"} → ${it.label}`,
      targetId: it.id,
      weight: 96,
    });
  } else {
    out.push({ kind: "sling_clear", label: "Cancel sling", targetId: it.id, weight: 30 });
  }
}

function sort(list: ActionOption[]): ActionOption[] {
  return list.sort((a, b) => b.weight - a.weight);
}
