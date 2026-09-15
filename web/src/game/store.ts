import { create } from "zustand";
import type { InspectReading, ObjectiveStatus, SimEvent } from "@/sim/types.ts";
import { MODEL_CLASS } from "@/sim/types.ts";
import type { CtxAction, LookInfo } from "./context.ts";
import type { OpeningBeat } from "./opening.ts";
import type { OperateKind } from "./operate.ts";

export type Phase = "title" | "opening" | "playing" | "paused" | "dialogue" | "ending" | "dead";

export interface DialogueView {
  npcId: string;
  name: string;
  role: string;
  text: string;
  options: { id: string; label: string }[];
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
  height_m: number;
  lateral_m: number;
}

export interface GameUI {
  phase: Phase;
  look: LookInfo | null;
  action: LookInfo | null;
  primary: CtxAction | null;
  secondary: CtxAction | null;
  choices: CtxAction[];
  selectorOpen: boolean;
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
  operateKind: OperateKind | null;
  message: string | null;
  warning: string | null;
  touch: boolean;
  ready: boolean;
  ending: { title: string; body: string; freight: string; power: string; people: string } | null;
  modelClass: string;
  settingsOpen: boolean;
  opening: OpeningBeat | null;
  openingIndex: number;
  hint: string | null;
  hasSave: boolean;
}

const empty: GameUI = {
  phase: "title",
  look: null,
  action: null,
  primary: null,
  secondary: null,
  choices: [],
  selectorOpen: false,
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
  operateKind: null,
  message: null,
  warning: null,
  touch: false,
  ready: false,
  ending: null,
  modelClass: MODEL_CLASS,
  settingsOpen: false,
  opening: null,
  openingIndex: 0,
  hint: null,
  hasSave: false,
};

export const useGame = create<
  GameUI & {
    patch: (p: Partial<GameUI>) => void;
  }
>((set) => ({
  ...empty,
  patch: (p) => set(p),
}));
