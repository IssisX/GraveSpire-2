/** Declared Act I reduction. Not GDD §7 / §16. */
export const MODEL_CLASS =
  "Act I reduced: lumped 3-body coupling cell (freight + frame + gate) + declared elastic members (axial, biaxial bending, torsion) + tension-only cables + finite motors/brakes/pressure + persistent plastic set. Not co-rotational FEM, not fracture-energy, not Craig–Bampton.";

export const AUTHORITY_DT = 1 / 30;
export const MECHANICS_DT = 1 / 120;
export const SUBSTEPS = 4;
export const G = 9.80665;

export type DistrictId = "FS07" | "FS08" | "SHA" | "LT12";

export const DISTRICT_META: Record<
  DistrictId,
  { id: DistrictId; name: string; short: string }
> = {
  FS07: { id: "FS07", name: "Freight Spine Bay 07", short: "FS-07" },
  FS08: { id: "FS08", name: "Transfer Neck", short: "FS-08" },
  SHA: { id: "SHA", name: "Circ Shop — Hab Band A", short: "SH-A" },
  LT12: { id: "LT12", name: "Gallery 12", short: "LT-12" },
};

export const COMMANDS = [
  "CarrierRaise",
  "CarrierLower",
  "CarrierLeft",
  "CarrierRight",
  "CarrierBrake",
  "FrameJack",
  "FrameBrace",
  "FrameCutBrace",
  "GateVent",
  "GateOpen",
  "GateClose",
  "GateWedge",
] as const;

export type Command = (typeof COMMANDS)[number];

export type Act =
  | { type: "cut_member"; id: string }
  | { type: "brace_member"; id: string }
  | { type: "jack_member"; id: string; on: boolean }
  | { type: "toggle_breaker"; id: string }
  | { type: "carrier_release" }
  | { type: "chen_reroute" }
  | { type: "recover_drive" }
  | { type: "abandon_drive" }
  | { type: "sling"; a: string; b: string }
  | { type: "clear_sling" }
  | { type: "mark_save_used" }
  | { type: "end_act" };

export interface FreightState {
  height_m: number;
  lateral_m: number;
  vertical_velocity_mps: number;
  lateral_velocity_mps: number;
  payload_kg: number;
  cable_tension_n: number;
  brake_temperature_k: number;
  brake_engaged: boolean;
  payout_m: number;
  payload_released: boolean;
  cargo_damaged: boolean;
}

export interface FrameState {
  deflection_m: number;
  twist_rad: number;
  velocity_mps: number;
  angular_velocity_radps: number;
  plastic_set_m: number;
  damage: number;
  brace_stiffness_npm: number;
  brace_connected: boolean;
}

export interface GateState {
  angle_rad: number;
  angular_velocity_radps: number;
  pressure_pa: number;
  inventory_kg: number;
  seal_misalignment_m: number;
  wedged: boolean;
}

export interface MemberState {
  id: string;
  name: string;
  district: DistrictId;
  role: "gallery_span" | "neck_brace" | "shop_tie";
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  length_m: number;
  k_npm: number;
  yield_sag_m: number;
  plastic_set_m: number;
  force_n: number;
  moment_y_nm: number;
  moment_z_nm: number;
  torsion_nm: number;
  sag_m: number;
  twist_rad: number;
  damage: number;
  cut: boolean;
  braced: boolean;
  jacked: boolean;
}

export interface CableState {
  id: string;
  a: string;
  b: string;
  rest_length_m: number;
  tension_n: number;
  slack: boolean;
}

export interface BreakerState {
  id: string;
  name: string;
  closed: boolean;
  tripped: boolean;
  load_a: number;
  rating_a: number;
  thermal: number;
}

export interface ElectricalState {
  breakers: BreakerState[];
  shop_powered: boolean;
  bay_lights: boolean;
  drive_powered: boolean;
  gate_powered: boolean;
  carrier_powered: boolean;
  voltage_shop: number;
  voltage_process: number;
  chen_rerouted: boolean;
  process_isolated: boolean;
}

export interface NpcState {
  id: string;
  name: string;
  role: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  district: DistrictId;
  stuck: string | null;
  knows: Record<string, boolean>;
}

export interface TraversalEdge {
  id: string;
  from: string;
  to: string;
  kind: "walk" | "stairs" | "climb";
  valid: boolean;
  npc_safe: boolean;
  reason: string | null;
}

export interface Flags {
  payload_on_neck: boolean;
  drive_present: boolean;
  drive_recovered: boolean;
  drive_abandoned: boolean;
  save_used: boolean;
  act_ended: boolean;
}

export interface SimEvent {
  t: number;
  text: string;
}

export interface WorldState {
  freight: FreightState;
  frame: FrameState;
  gate: GateState;
  members: MemberState[];
  cables: CableState[];
  electrical: ElectricalState;
  npcs: NpcState[];
  flags: Flags;
  events: SimEvent[];
  authority_tick: number;
  mechanics_step: number;
  sim_time_s: number;
}

export interface InspectLine {
  label: string;
  value: string;
  unit: string;
  source: "measured" | "estimated";
  confidence: number;
}

export interface InspectReading {
  id: string;
  title: string;
  district: DistrictId | "SYS";
  lines: InspectLine[];
  warning?: string;
}

export interface ObjectiveStatus {
  id: string;
  title: string;
  done: boolean;
  note: string;
}

export function clamp(v: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, v));
}

export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

export function districtAt(x: number, z: number): DistrictId {
  if (z >= 11) return "LT12";
  if (x >= 64) return "SHA";
  if (x >= 42) return "FS08";
  return "FS07";
}
