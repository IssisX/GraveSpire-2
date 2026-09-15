/** Declared Act I reduction. Not GDD §7 / §16. */
export const MODEL_CLASS =
  "Act I reduced: lumped freight/frame/gate coupling + declared elastic members + tension-only cables + finite motors/brakes/pressure + persistent plastic set + one shared generalized-coordinate mechanical network spanning MC-01 lever/ballast/lift/rope, MC-02 rocker/pawl/counterweight/carriage, MC-03 bridge release/bridge, MC-04 spring shuttle, MC-05 bascule/65 t travelling ballast/transfer table, MC-06 momentum rotor/radial bridge/drop weight, MC-07 counterbalanced vertical freight pair/tilting cradle, and MC-08 torsion annulus/eccentric ballast/helical lift. Legacy MC-01 fields are compatibility projections only, not solver authority. Not co-rotational FEM, not general 6-DOF contact, not fracture-energy, not Craig–Bampton.";

export const AUTHORITY_DT = 1 / 30;
export const MECHANICS_DT = 1 / 120;
export const SUBSTEPS = 4;
export const G = 9.80665;

export type DistrictId = "FS07" | "FS08" | "SHA" | "LT12" | "MC01" | "MC02" | "MC03" | "MC04" | "MC05" | "MC06" | "MC07" | "MC08";

export const DISTRICT_META: Record<
  DistrictId,
  { id: DistrictId; name: string; short: string }
> = {
  FS07: { id: "FS07", name: "Freight Spine Bay 07", short: "FS-07" },
  FS08: { id: "FS08", name: "Transfer Neck", short: "FS-08" },
  SHA: { id: "SHA", name: "Circ Shop — Hab Band A", short: "SH-A" },
  LT12: { id: "LT12", name: "Gallery 12", short: "LT-12" },
  MC01: { id: "MC01", name: "Mechanical Cascade 01", short: "MC-01" },
  MC02: { id: "MC02", name: "Gravity Transfer", short: "MC-02" },
  MC03: { id: "MC03", name: "Gravity Bridge", short: "MC-03" },
  MC04: { id: "MC04", name: "Spring Shuttle", short: "MC-04" },
  MC05: { id: "MC05", name: "Bascule Exchange", short: "MC-05" },
  MC06: { id: "MC06", name: "Momentum Rotunda", short: "MC-06" },
  MC07: { id: "MC07", name: "Counterbalanced Throat", short: "MC-07" },
  MC08: { id: "MC08", name: "Torsion Stack", short: "MC-08" },
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
  "BasculeTableEast",
  "BasculeTableWest",
  "BasculeBallastIn",
  "BasculeBallastOut",
  "BasculeBrake",
  "RotorBridgeIn",
  "RotorBridgeOut",
  "RotorBrake",
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
  | { type: "rube_push_ballast"; direction: -1 | 1 }
  | { type: "rube_toggle_latch" }
  | { type: "rube_toggle_transfer_brake" }
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

/** Compatibility/read-model projection of MC-01 lever state. Network DOF is authoritative. */
export interface RubeLeverState {
  angle_rad: number;
  omega_radps: number;
  mass_kg: number;
  inertia_kgm2: number;
  net_torque_nm: number;
  /** Constraint topology state; not a duplicate mechanical coordinate. */
  latch_engaged: boolean;
  latch_angle_rad: number;
}

/** Compatibility/read-model projection of MC-01 ballast state. Network DOF is authoritative. */
export interface RubeBallastState {
  mass_kg: number;
  s_m: number;
  velocity_mps: number;
}

/** Compatibility/read-model projection of MC-01 lift state. Network DOF is authoritative. */
export interface RubeLiftState {
  mass_kg: number;
  y_m: number;
  velocity_mps: number;
}

/** Compatibility/read-model projection of MC-01 rope state. Network cable is authoritative. */
export interface RubeRopeState {
  rest_length_m: number;
  length_m: number;
  tension_n: number;
  slack: boolean;
  rated_tension_n: number;
}

export interface RubeEnergyState {
  kinetic_j: number;
  potential_j: number;
  dissipated_j: number;
}

export interface MechanicalDofState {
  id: string;
  kind: "linear" | "rotary";
  q: number;
  v: number;
  /** kg for linear DOF, kg·m² for rotary DOF. */
  inertia_si: number;
  /** N·s/m for linear DOF, N·m·s/rad for rotary DOF. */
  damping_si: number;
  min_q: number;
  max_q: number;
  stop_restitution: number;
}

export interface MechanicalCableTerm {
  dof_id: string;
  /** dl/dq: dimensionless for linear q, metres/radian for rotary q. */
  gradient_m_per_q: number;
}

export interface MechanicalCableState {
  id: string;
  base_length_m: number;
  rest_length_m: number;
  length_m: number;
  stiffness_npm: number;
  damping_ns_pm: number;
  tension_n: number;
  slack: boolean;
  terms: MechanicalCableTerm[];
}

export interface MechanicalNetworkState {
  /** Sole q/v authority for the linked reduced mechanisms. */
  dofs: MechanicalDofState[];
  /** Sole routed tension authority for linked reduced mechanisms. */
  cables: MechanicalCableState[];
  dissipated_j: number;
}

export interface LinkedCascadeState {
  network: MechanicalNetworkState;
  /** Constraint/control state around the shared network, never duplicate q/v. */
  transfer_brake_engaged: boolean;
  transfer_brake_capacity_n: number;
  entry_contact_n: number;
  entry_pawl_reaction_n: number;
  transfer_brake_reaction_n: number;
  bridge_contact_n: number;
  bridge_pawl_reaction_nm: number;
  kinetic_j: number;
  potential_j: number;
}

export interface RubeState {
  /** Read-model compatibility projections for existing UI/save consumers. */
  lever: RubeLeverState;
  ballast: RubeBallastState;
  lift: RubeLiftState;
  rope: RubeRopeState;
  energy: RubeEnergyState;
  /** Shared solver authority. Added/upgraded lazily for older saves. */
  chain?: LinkedCascadeState;
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
  /** Added lazily for compatibility with pre-cascade saves. */
  rube?: RubeState;
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
  if (z <= -25 && x >= 184) return "MC08";
  if (z <= -25 && x >= 169) return "MC07";
  if (z <= -25 && x >= 150) return "MC06";
  if (z <= -25 && x >= 116) return "MC05";
  if (z <= -25 && x >= 98) return "MC04";
  if (z <= -25 && x >= 86) return "MC03";
  if (z <= -25 && x >= 67) return "MC02";
  if (z <= -20 && x >= 46 && x < 67) return "MC01";
  if (z >= 11) return "LT12";
  if (x >= 64) return "SHA";
  if (x >= 42) return "FS08";
  return "FS07";
}