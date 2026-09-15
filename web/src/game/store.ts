import { create } from "zustand";
import type { InspectReading, ObjectiveStatus, SimEvent } from "@/sim/types.ts";
import { MODEL_CLASS } from "@/sim/types.ts";
import type { ActionOption } from "./actions.ts";
import type { InteractKind } from "./context.ts";
import type { MachineKind, Readout } from "./machine.ts";
import type { Guidance, WorldWarning } from "./opening.ts";
import { DEFAULT_SETTINGS, type Settings } from "./settings.ts";

export type Phase =
  | "boot"
  | "menu"
  | "intro"
  | "playing"
  | "paused"
  | "settings"
  | "dialogue"
  | "ending"
  | "dead";

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
  kind: InteractKind;
}

/** One machine control as the HUD needs to draw it. */
export interface MachineControlView {
  id: string;
  label: string;
  mode: "hold" | "toggle" | "pulse";
  keyLabel: string;
  engaged: boolean;
  refused: string | null;
}

export interface MachineView {
  kind: MachineKind;
  title: string;
  subtitle: string;
  controls: MachineControlView[];
  readouts: Readout[];
}

export interface IntroView {
  kicker: string;
  text: string;
  index: number;
  total: number;
}

export interface GameUI {
  phase: Phase;
  /** Phase to return to when the settings screen closes. */
  settingsReturn: Phase;

  look: LookTarget | null;
  /** The dominant action a tap performs right now. */
  action: ActionOption | null;
  /** Every eligible action on the current action target, best first. */
  actionOptions: ActionOption[];
  selectorOpen: boolean;
  /** Something is in view but physically out of reach from here. */
  outOfReach: { label: string; need: number; dist: number } | null;

  machine: MachineView | null;
  inspect: InspectReading | null;
  inspectOpen: boolean;

  objectives: ObjectiveStatus[];
  guidance: Guidance | null;
  warnings: WorldWarning[];
  events: SimEvent[];
  dialogue: DialogueView | null;
  intro: IntroView | null;

  prompt: string;
  work: { label: string; progress: number } | null;
  slingA: string | null;
  message: string | null;

  touch: boolean;
  ready: boolean;
  hasSave: boolean;
  settings: Settings;
  ending: { title: string; body: string; freight: string; power: string; people: string } | null;
  modelClass: string;
}

const empty: GameUI = {
  phase: "boot",
  settingsReturn: "menu",
  look: null,
  action: null,
  actionOptions: [],
  selectorOpen: false,
  outOfReach: null,
  machine: null,
  inspect: null,
  inspectOpen: false,
  objectives: [],
  guidance: null,
  warnings: [],
  events: [],
  dialogue: null,
  intro: null,
  prompt: "",
  work: null,
  slingA: null,
  message: null,
  touch: false,
  ready: false,
  hasSave: false,
  settings: { ...DEFAULT_SETTINGS },
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
