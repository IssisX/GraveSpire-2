import { create } from "zustand";
import type { InspectReading, ObjectiveStatus, SimEvent } from "@/sim/types.ts";
import { MODEL_CLASS } from "@/sim/types.ts";

export type Tool =
  | "inspect"
  | "operate"
  | "isolate"
  | "sling"
  | "brace"
  | "jack"
  | "cut"
  | "talk";

export const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: "inspect", label: "Inspect", hint: "Readings with units and provenance" },
  { id: "operate", label: "Operate", hint: "Raise / lower / drive / brake / open" },
  { id: "isolate", label: "Isolate", hint: "Breakers, valves, process feed" },
  { id: "sling", label: "Sling", hint: "Two attachments, then commit" },
  { id: "brace", label: "Brace", hint: "Install a real constraint" },
  { id: "jack", label: "Jack", hint: "Take load, do not delete it" },
  { id: "cut", label: "Cut", hint: "Slow. Declared members only" },
  { id: "talk", label: "Talk", hint: "They do not orbit you" },
];

export type Phase = "title" | "playing" | "paused" | "dialogue" | "ending" | "dead";

export interface DialogueView {
  npcId: string;
  name: string;
  role: string;
  text: string;
  options: { id: string; label: string }[];
}

export interface LookTarget {
  id: string;
  label: string;
  dist: number;
  kind: "machine" | "member" | "npc" | "board" | "bench" | "world";
}

export interface HudSnap {
  tension_kn: number;
  deflection_mm: number;
  twist_deg: number;
  set_mm: number;
  pressure_kpa: number;
  misalign_mm: number;
  brake: boolean;
  brake_k: number;
  shop_v: number;
  tick: number;
  time_s: number;
  district: string;
  districtShort: string;
  carrierPower: boolean;
  gateOpen: boolean;
}

export interface GameUI {
  phase: Phase;
  tool: Tool;
  toolWheel: boolean;
  look: LookTarget | null;
  inspect: InspectReading | null;
  inspectOpen: boolean;
  objectives: ObjectiveStatus[];
  events: SimEvent[];
  dialogue: DialogueView | null;
  prompt: string;
  work: { label: string; progress: number } | null;
  snap: HudSnap | null;
  slingA: string | null;
  operateId: string | null;
  message: string | null;
  touch: boolean;
  ready: boolean;
  ending: { title: string; body: string; freight: string; power: string; people: string } | null;
  modelClass: string;
}

const empty: GameUI = {
  phase: "title",
  tool: "inspect",
  toolWheel: false,
  look: null,
  inspect: null,
  inspectOpen: false,
  objectives: [],
  events: [],
  dialogue: null,
  prompt: "",
  work: null,
  snap: null,
  slingA: null,
  operateId: null,
  message: null,
  touch: false,
  ready: false,
  ending: null,
  modelClass: MODEL_CLASS,
};

export const useGame = create<
  GameUI & {
    patch: (p: Partial<GameUI>) => void;
  }
>((set) => ({
  ...empty,
  patch: (p) => set(p),
}));
