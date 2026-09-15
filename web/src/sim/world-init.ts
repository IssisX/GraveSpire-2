import type {
  BreakerState,
  MemberState,
  NpcState,
  WorldState,
} from "./types.ts";

function member(
  partial: Omit<MemberState, "force_n" | "moment_y_nm" | "moment_z_nm" | "torsion_nm" | "sag_m" | "twist_rad" | "damage" | "plastic_set_m"> &
    Partial<Pick<MemberState, "damage" | "plastic_set_m">>,
): MemberState {
  return {
    force_n: 0,
    moment_y_nm: 0,
    moment_z_nm: 0,
    torsion_nm: 0,
    sag_m: 0,
    twist_rad: 0,
    damage: 0,
    plastic_set_m: 0,
    ...partial,
  };
}

function gallerySpan(id: string, x: number): MemberState {
  const az = 12.4;
  const bz = 26.6;
  const length = bz - az;
  return member({
    id,
    name: `Gallery span ${id.slice(-1).toUpperCase()}`,
    district: "LT12",
    role: "gallery_span",
    ax: x,
    ay: 2.15,
    az,
    bx: x,
    by: 2.15,
    bz,
    length_m: length,
    k_npm: 5.0e5,
    yield_sag_m: 0.025,
    cut: false,
    braced: false,
    jacked: false,
  });
}

export function createInitialState(): WorldState {
  const breakers: BreakerState[] = [
    { id: "brk_gen", name: "Process generator", closed: true, tripped: false, load_a: 0, rating_a: 400, thermal: 0 },
    { id: "brk_drive", name: "Drive cabinet", closed: true, tripped: false, load_a: 0, rating_a: 180, thermal: 0 },
    { id: "brk_gate", name: "Gate motor feed", closed: true, tripped: false, load_a: 0, rating_a: 90, thermal: 0 },
    { id: "brk_hab", name: "Hab feed via drive", closed: true, tripped: false, load_a: 0, rating_a: 80, thermal: 0 },
    { id: "brk_shop", name: "Circ Shop local", closed: false, tripped: false, load_a: 0, rating_a: 60, thermal: 0 },
    { id: "brk_west", name: "West bus (reroute)", closed: false, tripped: false, load_a: 0, rating_a: 125, thermal: 0 },
  ];

  const npcs: NpcState[] = [
    {
      id: "rami",
      name: "Rami Okonkwo",
      role: "Crane lead",
      x: 4.6,
      // Pulpit deck top is 1.28 m; the capsule's feet sit 0.33 m above origin.
      y: 0.95,
      z: -7.4,
      yaw: 0.6,
      district: "FS07",
      stuck: null,
      knows: { brake: true, offset: true },
    },
    {
      id: "ilea",
      name: "Ilea Voss",
      role: "Steward",
      x: 74.2,
      y: 0,
      z: -1.8,
      yaw: -1.2,
      district: "SHA",
      stuck: null,
      knows: { occupied_routes: true, hab_power: true },
    },
    {
      id: "chen",
      name: "Chen Park",
      role: "Electrician",
      x: 51.4,
      y: 0,
      z: -5.2,
      yaw: 0.2,
      district: "FS08",
      stuck: null,
      knows: { cooking_feed: true },
    },
    {
      id: "skip",
      name: "Skip Delgado",
      role: "Salvage",
      x: 33.0,
      y: 2.45,
      z: 19.4,
      yaw: -0.4,
      district: "LT12",
      stuck: null,
      knows: { fast_pull: true },
    },
  ];

  const members: MemberState[] = [
    gallerySpan("g12_a", 16),
    gallerySpan("g12_b", 24),
    gallerySpan("g12_c", 32),
    gallerySpan("g12_d", 40),
    gallerySpan("g12_e", 48),
    member({
      id: "neck_brace",
      name: "Neck transfer brace",
      district: "FS08",
      role: "neck_brace",
      ax: 48,
      ay: 1.1,
      az: -2.2,
      bx: 58,
      by: 1.1,
      bz: 2.4,
      length_m: 11.2,
      k_npm: 4.0e6,
      yield_sag_m: 0.03,
      cut: false,
      braced: false,
      jacked: false,
    }),
    member({
      id: "shop_tie",
      name: "Shop service tie",
      district: "SHA",
      role: "shop_tie",
      ax: 66,
      ay: 3.2,
      az: -8,
      bx: 82,
      by: 3.2,
      bz: -8,
      length_m: 16,
      k_npm: 1.2e6,
      yield_sag_m: 0.04,
      cut: false,
      braced: false,
      jacked: false,
    }),
  ];

  return {
    freight: {
      height_m: 2.2,
      lateral_m: -1.8,
      vertical_velocity_mps: 0,
      lateral_velocity_mps: 0,
      payload_kg: 8200,
      cable_tension_n: 0,
      brake_temperature_k: 293.15,
      brake_engaged: true,
      payout_m: 2.2,
      payload_released: false,
      cargo_damaged: false,
      payload_swing_rad: 0,
      payload_swing_velocity_radps: 0,
      hoist_current_a: 0,
    },
    frame: {
      deflection_m: 0,
      twist_rad: 0,
      velocity_mps: 0,
      angular_velocity_radps: 0,
      plastic_set_m: 0,
      damage: 0,
      brace_stiffness_npm: 0,
      brace_connected: false,
    },
    gate: {
      angle_rad: 0,
      angular_velocity_radps: 0,
      pressure_pa: 420000,
      inventory_kg: 310,
      seal_misalignment_m: 0,
      wedged: false,
      vent_open: false,
    },
    members,
    cables: [],
    electrical: {
      breakers,
      process_load_a: 0,
      shop_powered: false,
      bay_lights: true,
      drive_powered: true,
      gate_powered: true,
      carrier_powered: true,
      voltage_shop: 0,
      voltage_process: 480,
      chen_rerouted: false,
      process_isolated: false,
    },
    npcs,
    flags: {
      payload_on_neck: false,
      drive_present: true,
      drive_recovered: false,
      drive_abandoned: false,
      save_used: false,
      act_ended: false,
    },
    events: [
      {
        t: 0,
        text: "Authority online. Freight Spine Bay 07 reports offset load on carrier 07-A.",
      },
    ],
    authority_tick: 0,
    mechanics_step: 0,
    sim_time_s: 0,
  };
}
