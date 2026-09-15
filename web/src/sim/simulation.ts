import {
  TRAVERSE_MAX_M,
  TRAVERSE_MIN_M,
  dockShare,
  mechLateral,
  overDock,
  slingCompatible,
  slingRestLength,
} from "./geometry.ts";
import { tickNpcs } from "./npcs.ts";
import {
  AUTHORITY_DT,
  COMMANDS,
  G,
  MECHANICS_DT,
  SUBSTEPS,
  clamp,
  clamp01,
  type Act,
  type Command,
  type WorldState,
} from "./types.ts";
import { createInitialState } from "./world-init.ts";
import {
  evaluateTraversal,
  gallerySag,
  inhabitantCanReachShop,
  liveGalleryCount,
  neckWalkClear,
} from "./missions.ts";
import {
  ensureRubeState,
  pushBallast,
  rubeFinite,
  stepRubeMechanics,
  toggleRubeLatch,
  toggleTransferBrake,
} from "./rube-mechanics.ts";

const kFrameMassKg = 48000.0;
const kFrameBaseStiffnessNpm = 7.5e6;
const kFrameDampingNsPm = 7.2e5;
const kFrameTorsionNmPrad = 2.2e7;
const kFrameTorsionDamping = 1.1e6;
const kYieldDeflectionM = 0.055;
const kGateAreaM2 = 7.5;
const kGateInertiaKgM2 = 9600.0;
const kGateDriveTorqueNm = 6.8e5;
const kGatePressureArmM = 0.42;
const kCableStiffnessNpm = 1.9e6;
const kCableDampingNsPm = 8.0e4;
const kGalleryDeadN = 28000;

function cloneState(state: WorldState): WorldState {
  return structuredClone(state);
}

export class Simulation {
  static readonly kAuthorityDt = AUTHORITY_DT;
  static readonly kMechanicsDt = MECHANICS_DT;
  static readonly kSubsteps = SUBSTEPS;

  private state_: WorldState;
  private commands_: boolean[];
  private lastGood_: WorldState;

  constructor(state?: WorldState) {
    this.state_ = state ? cloneState(state) : createInitialState();
    ensureRubeState(this.state_);
    this.commands_ = COMMANDS.map(() => false);
    this.lastGood_ = cloneState(this.state_);
  }

  setCommand(command: Command, enabled: boolean): void {
    const idx = COMMANDS.indexOf(command);
    this.commands_[idx] = enabled;
    if (command === "CarrierBrake" && enabled) {
      this.state_.freight.brake_engaged = !this.state_.freight.brake_engaged;
      this.push(
        this.state_.freight.brake_engaged
          ? "Carrier brake engaged."
          : "Carrier brake released.",
      );
    } else if (command === "FrameBrace" && enabled) {
      this.state_.frame.brace_connected = true;
      this.state_.frame.brace_stiffness_npm = 4.0e6;
      const brace = this.state_.members.find((m) => m.id === "neck_brace");
      if (brace && !brace.cut) brace.braced = true;
      this.push("Neck brace connected. Stiffness is now a load path.");
    } else if (command === "FrameCutBrace" && enabled) {
      this.state_.frame.brace_connected = false;
      this.state_.frame.brace_stiffness_npm = 0;
      const brace = this.state_.members.find((m) => m.id === "neck_brace");
      if (brace) brace.braced = false;
      this.push("Brace cut. Demand returns to the transfer frame.");
    } else if (command === "GateWedge" && enabled) {
      this.state_.gate.wedged = !this.state_.gate.wedged;
      this.push(this.state_.gate.wedged ? "Gate wedged." : "Gate wedge pulled.");
    }
  }

  active(command: Command): boolean {
    return this.commands_[COMMANDS.indexOf(command)] ?? false;
  }

  act(action: Act): string {
    const s = this.state_;
    switch (action.type) {
      case "cut_member": {
        const m = s.members.find((x) => x.id === action.id);
        if (!m || m.cut) return "Nothing to cut.";
        m.cut = true;
        m.force_n = 0;
        this.push(`Cut ${m.name}. Remaining members take the load.`);
        return `Cut ${m.name}.`;
      }
      case "brace_member": {
        const m = s.members.find((x) => x.id === action.id);
        if (!m || m.cut) return "No member.";
        m.braced = true;
        if (m.id === "neck_brace") {
          s.frame.brace_connected = true;
          s.frame.brace_stiffness_npm = 4.0e6;
        }
        this.push(`Brace installed on ${m.name}.`);
        return `Braced ${m.name}.`;
      }
      case "jack_member": {
        const m = s.members.find((x) => x.id === action.id);
        if (!m || m.cut) return "No member.";
        m.jacked = action.on;
        this.push(action.on ? `Jack taking load on ${m.name}.` : `Jack released on ${m.name}.`);
        return action.on ? "Jack on." : "Jack off.";
      }
      case "toggle_breaker": {
        const b = s.electrical.breakers.find((x) => x.id === action.id);
        if (!b) return "No breaker.";
        if (b.tripped && !b.closed) {
          b.tripped = false;
          b.thermal = 0;
        }
        b.closed = !b.closed;
        this.push(`${b.name} ${b.closed ? "closed" : "open"}.`);
        return `${b.name} ${b.closed ? "closed" : "open"}.`;
      }
      case "carrier_release": {
        if (s.freight.payload_released) return "Payload already released.";
        const docked = overDock(s.freight);
        if (!docked && s.freight.height_m > 3.2 && Math.abs(s.freight.lateral_m - 16) > 3) {
          return "Not over the neck deck.";
        }
        if (!docked) return "Not over the neck deck.";
        if (Math.abs(s.freight.vertical_velocity_mps) > 0.45) {
          s.freight.cargo_damaged = true;
          this.push("Release from height. Cargo took the hit.");
        }
        if (!s.freight.brake_engaged) {
          this.push("Released without brake. Deck took an impulse.");
        }
        s.freight.payload_released = true;
        s.freight.payload_kg = 420;
        if (
          s.freight.brake_engaged &&
          Math.abs(s.freight.vertical_velocity_mps) < 0.4 &&
          Math.abs(s.gate.seal_misalignment_m) < 0.05
        ) {
          s.flags.payload_on_neck = true;
          this.push("Payload is on the neck deck. Brake is holding.");
        } else {
          s.flags.payload_on_neck = true;
          this.push("Payload is on the deck. Alignment or brake is outside the declared dock.");
        }
        return "Released.";
      }
      case "chen_reroute": {
        if (s.electrical.chen_rerouted) return "West bus already feeding hab.";
        const genOpen = !this.breaker("brk_gen")?.closed;
        const driveOpen = !this.breaker("brk_drive")?.closed;
        if (!genOpen && !driveOpen) {
          return "Isolate the cooking feed or open the drive cabinet first. Chen will not parallel a live fault.";
        }
        s.electrical.chen_rerouted = true;
        const west = this.breaker("brk_west");
        if (west) west.closed = true;
        this.push("Chen closed the west bus. Hab is no longer a parasite on the drive cabinet.");
        return "West bus closed.";
      }
      case "recover_drive": {
        if (!s.flags.drive_present) return "Drive is not here.";
        if (s.gate.pressure_pa > 90000 && this.breaker("brk_gen")?.closed) {
          return "Drive cabinet is still a pressurized, live island. Vent or isolate.";
        }
        if (Math.abs(s.gate.seal_misalignment_m) > 0.04 && !s.frame.brace_connected) {
          return "Housing is too far out of alignment to unbolt. Brace, jack, or unload the frame.";
        }
        const walk = evaluateTraversal(s);
        const access =
          (walk.find((e) => e.id === "neck_main")?.valid ?? false) ||
          (walk.find((e) => e.id === "gallery_to_neck")?.valid ?? false);
        if (!access) return "No maintenance walk to the housing.";
        s.flags.drive_present = false;
        s.flags.drive_recovered = true;
        const driveBrk = this.breaker("brk_drive");
        if (driveBrk) driveBrk.closed = false;
        this.push("Drive recovered. It still functions. What it was doing does not.");
        return "Drive recovered.";
      }
      case "abandon_drive": {
        if (!s.flags.drive_present) return "Nothing to yank.";
        s.flags.drive_present = false;
        s.flags.drive_abandoned = true;
        s.frame.damage = Math.max(s.frame.damage, 0.22);
        s.frame.plastic_set_m += 0.008;
        const driveBrk = this.breaker("brk_drive");
        if (driveBrk) driveBrk.closed = false;
        const hab = this.breaker("brk_hab");
        if (hab) hab.closed = false;
        this.push("Fast pull. Drive is scrap geometry. Neck feed is gone.");
        return "Drive abandoned.";
      }
      case "sling": {
        if (s.cables.some((c) => c.id === "sling")) {
          return "A working sling is already on. Clear it first.";
        }
        if (!slingCompatible(action.a, action.b)) {
          return "Those attachments are not a load path. Carrier, dock, frame, or a live member.";
        }
        const rest = slingRestLength(s, action.a, action.b);
        if (rest == null) return "No geometry for that sling.";
        s.cables.push({
          id: "sling",
          a: action.a,
          b: action.b,
          rest_length_m: rest,
          tension_n: 0,
          slack: true,
        });
        this.push(`Sling committed ${action.a} → ${action.b}. Tension-only from this pose.`);
        return "Sling committed.";
      }
      case "clear_sling": {
        s.cables = s.cables.filter((c) => c.id !== "sling");
        this.push("Sling cleared.");
        return "Sling cleared.";
      }
      case "rube_push_ballast": {
        const msg = pushBallast(ensureRubeState(s), action.direction);
        this.push(msg);
        return msg;
      }
      case "rube_toggle_latch": {
        const msg = toggleRubeLatch(ensureRubeState(s));
        this.push(msg);
        return msg;
      }
      case "rube_toggle_transfer_brake": {
        const msg = toggleTransferBrake(ensureRubeState(s));
        this.push(msg);
        return msg;
      }
      case "mark_save_used": {
        s.flags.save_used = true;
        return "Bench used.";
      }
      case "end_act": {
        if (!s.flags.drive_recovered && !s.flags.drive_abandoned) {
          return "The drive is still a choice.";
        }
        s.flags.act_ended = true;
        this.push("Act I closed. The building was not reset.");
        return "Ended.";
      }
      default:
        return "Unknown action.";
    }
  }

  advanceAuthorityTick(): void {
    const before = cloneState(this.state_);
    for (let i = 0; i < SUBSTEPS; i++) {
      this.stepMechanics(MECHANICS_DT);
    }
    this.state_.authority_tick += 1;
    this.state_.sim_time_s = this.state_.authority_tick * AUTHORITY_DT;
    this.commitElectrical();
    this.commitMembers();
    this.commitDock();
    this.updateNpcs();
    if (!this.finite()) {
      this.state_ = cloneState(this.lastGood_);
      this.push("Solver rejected a non-finite step. Last valid state retained. This is not a collapse.");
      return;
    }
    this.lastGood_ = cloneState(this.state_);
    void before;
  }

  private stepMechanics(dt: number): void {
    const freight = this.state_.freight;
    const frame = this.state_.frame;
    const gate = this.state_.gate;
    const elec = this.state_.electrical;

    const liftAxis =
      Number(this.active("CarrierRaise")) - Number(this.active("CarrierLower"));
    const traverseAxis =
      Number(this.active("CarrierRight")) - Number(this.active("CarrierLeft"));

    const power = elec.carrier_powered ? 1 : 0.12;
    const liftAccel = 1.35 * liftAxis * power;
    freight.vertical_velocity_mps += liftAccel * dt;
    freight.lateral_velocity_mps += 2.35 * traverseAxis * power * dt;

    if (freight.brake_engaged && liftAxis === 0) {
      const before = freight.vertical_velocity_mps;
      freight.vertical_velocity_mps *= Math.exp(-9.0 * dt);
      const dissipated =
        0.5 *
        freight.payload_kg *
        (before * before - freight.vertical_velocity_mps * freight.vertical_velocity_mps);
      freight.brake_temperature_k += Math.max(0, dissipated) / 18000.0;
    }
    freight.lateral_velocity_mps *= Math.exp(-1.8 * dt);
    freight.height_m = clamp(freight.height_m + freight.vertical_velocity_mps * dt, 0.45, 7.6);
    freight.lateral_m = clamp(freight.lateral_m + freight.lateral_velocity_mps * dt, TRAVERSE_MIN_M, TRAVERSE_MAX_M);
    freight.payout_m = freight.height_m;

    const elasticLen = frame.deflection_m - frame.plastic_set_m;
    const cableExtension = Math.max(0, 0.018 + 0.12 * elasticLen);
    freight.cable_tension_n = Math.max(
      0,
      freight.payload_kg * (G + liftAccel) +
        kCableStiffnessNpm * cableExtension +
        kCableDampingNsPm * frame.velocity_mps,
    );

    if (this.active("GateVent")) {
      const discharge = Math.min(gate.inventory_kg, (0.9 + 0.000012 * gate.pressure_pa) * dt);
      gate.inventory_kg -= discharge;
      gate.pressure_pa = 420000.0 * gate.inventory_kg / 310.0;
    }

    const gateAxis = Number(this.active("GateOpen")) - Number(this.active("GateClose"));
    const pressureTorque =
      gate.pressure_pa * kGateAreaM2 * kGatePressureArmM * Math.max(0.12, Math.cos(gate.angle_rad));
    const misalignment = Math.abs(gate.seal_misalignment_m);
    const jamMultiplier = 1.0 + 24.0 * misalignment;
    const voltage = elec.gate_powered ? clamp(elec.voltage_process / 480, 0.15, 1.15) : 0;
    let driveTorque = (gateAxis * kGateDriveTorqueNm * voltage) / jamMultiplier;
    if (gate.wedged) {
      driveTorque = 0;
      gate.angular_velocity_radps *= Math.exp(-24.0 * dt);
    }
    const gateTorque = driveTorque - pressureTorque - 1.1e5 * gate.angular_velocity_radps;
    gate.angular_velocity_radps += (gateTorque / kGateInertiaKgM2) * dt;
    gate.angle_rad = clamp(gate.angle_rad + gate.angular_velocity_radps * dt, 0.0, 1.42);
    if (
      (gate.angle_rad === 0.0 && gate.angular_velocity_radps < 0.0) ||
      (gate.angle_rad === 1.42 && gate.angular_velocity_radps > 0.0)
    ) {
      gate.angular_velocity_radps = 0.0;
    }

    const sling = this.state_.cables.find((c) => c.id === "sling");
    let slingForce = 0;
    if (sling) {
      const stretch = Math.max(0, frame.deflection_m - sling.rest_length_m * 0.002);
      sling.tension_n = stretch * 1.4e6;
      sling.slack = sling.tension_n < 80;
      slingForce = sling.slack ? 0 : sling.tension_n;
    }

    const carrierForce = freight.cable_tension_n;
    const gateForce = gate.pressure_pa * kGateAreaM2;
    const jackForce = this.active("FrameJack") ? -7.5e5 : 0.0;
    const lever = mechLateral(freight.lateral_m);
    const offsetFactor = 1 + 0.4 * Math.abs(lever);
    const ontoNeck = dockShare(freight.lateral_m);
    const stiffness =
      kFrameBaseStiffnessNpm * (1.0 - 0.28 * frame.damage) + frame.brace_stiffness_npm;
    const frameForce =
      (0.42 + 0.28 * ontoNeck) * offsetFactor * carrierForce +
      0.09 * gateForce +
      jackForce -
      slingForce * 0.35 -
      stiffness * (frame.deflection_m - frame.plastic_set_m) -
      kFrameDampingNsPm * frame.velocity_mps;
    frame.velocity_mps += (frameForce / kFrameMassKg) * dt;
    frame.deflection_m += frame.velocity_mps * dt;

    const torsionMoment = carrierForce * lever + gateForce * 1.65;
    const torsionAccel =
      (torsionMoment - kFrameTorsionNmPrad * frame.twist_rad - kFrameTorsionDamping * frame.angular_velocity_radps) /
      8.5e6;
    frame.angular_velocity_radps += torsionAccel * dt;
    frame.twist_rad += frame.angular_velocity_radps * dt;

    const elasticDeflection = frame.deflection_m - frame.plastic_set_m;
    if (Math.abs(elasticDeflection) > kYieldDeflectionM) {
      frame.plastic_set_m =
        frame.deflection_m - Math.sign(elasticDeflection) * kYieldDeflectionM;
    }
    const nextDamage = clamp01(Math.abs(frame.plastic_set_m) / 0.12);
    if (nextDamage > frame.damage + 0.08 && frame.damage < 0.08) {
      this.push("Transfer frame yielded. Permanent set will survive unload.");
    }
    frame.damage = Math.max(frame.damage, nextDamage);

    gate.seal_misalignment_m = 0.62 * frame.deflection_m + 0.85 * frame.twist_rad;
    freight.brake_temperature_k += (293.15 - freight.brake_temperature_k) * 0.035 * dt;

    stepRubeMechanics(ensureRubeState(this.state_), dt);
    this.state_.mechanics_step += 1;
  }

  private commitMembers(): void {
    const live = this.state_.members.filter((m) => m.role === "gallery_span" && !m.cut);
    const weights = live.map((m) => {
      const k = m.k_npm * (m.braced ? 1.7 : 1) * (m.jacked ? 1.3 : 1) * (1 - 0.75 * m.damage);
      return Math.max(k, 1);
    });
    const sumK = weights.reduce((a, b) => a + b, 0);
    const extra = this.state_.flags.payload_on_neck ? 6000 : 0;
    const total = kGalleryDeadN + extra;
    live.forEach((m, i) => {
      const k = weights[i]!;
      const F = total * (k / sumK);
      m.force_n = F;
      const elastic = F / k;
      if (elastic > m.yield_sag_m) {
        m.plastic_set_m = Math.max(m.plastic_set_m, elastic - m.yield_sag_m);
      }
      m.sag_m = Math.max(elastic, m.plastic_set_m);
      m.moment_y_nm = F * (m.length_m / 8);
      m.moment_z_nm = F * 0.12;
      m.torsion_nm = F * 0.35;
      m.twist_rad = m.torsion_nm / (2.8e6);
      m.damage = Math.max(m.damage, clamp01((m.sag_m - m.yield_sag_m) / 0.16));
    });
    for (const m of this.state_.members) {
      if (m.role !== "gallery_span") {
        if (m.cut) {
          m.force_n = 0;
          continue;
        }
        const k = m.k_npm * (m.braced ? 1.65 : 1) * (m.jacked ? 1.25 : 1);
        const share =
          m.role === "neck_brace"
            ? 0.18 * this.state_.freight.cable_tension_n + this.state_.gate.pressure_pa * 0.002
            : 4200;
        m.force_n = share;
        const elastic = share / k;
        if (elastic > m.yield_sag_m) {
          m.plastic_set_m = Math.max(m.plastic_set_m, elastic - m.yield_sag_m);
        }
        m.sag_m = Math.max(elastic, m.plastic_set_m);
        m.moment_y_nm = share * 0.4;
        m.moment_z_nm = share * 0.18;
        m.torsion_nm = share * (m.role === "neck_brace" ? this.state_.freight.lateral_m * 0.2 : 0.1);
        m.twist_rad = m.torsion_nm / 3.2e6;
        m.damage = Math.max(m.damage, clamp01((m.sag_m - m.yield_sag_m) / 0.18));
      }
    }
  }

  private commitElectrical(): void {
    const e = this.state_.electrical;
    const br = (id: string) => this.breaker(id);
    const gen = Boolean(br("brk_gen")?.closed) && !br("brk_gen")?.tripped;
    e.process_isolated = !gen;
    const processBus = gen;
    const driveCab =
      processBus &&
      Boolean(br("brk_drive")?.closed) &&
      this.state_.flags.drive_present &&
      !br("brk_drive")?.tripped;
    const gateFeed = processBus && Boolean(br("brk_gate")?.closed);
    const habViaDrive = driveCab && Boolean(br("brk_hab")?.closed);
    const habWest = e.chen_rerouted && processBus && Boolean(br("brk_west")?.closed);
    const hab = habViaDrive || habWest || (e.chen_rerouted && !e.process_isolated && Boolean(br("brk_west")?.closed));
    const shop = hab && Boolean(br("brk_shop")?.closed) && !br("brk_shop")?.tripped;

    e.carrier_powered = processBus;
    e.drive_powered = driveCab;
    e.gate_powered = gateFeed;
    e.bay_lights = processBus || hab;
    e.shop_powered = Boolean(shop);
    e.voltage_process = processBus ? 480 : 0;
    e.voltage_shop = shop ? (habWest && !habViaDrive ? 452 : 480) : 0;

    const bGen = br("brk_gen");
    if (bGen) bGen.load_a = processBus ? 210 + (driveCab ? 70 : 0) + (shop ? 28 : 0) : 0;
    const bDrive = br("brk_drive");
    if (bDrive) bDrive.load_a = driveCab ? 74 : 0;
    const bShop = br("brk_shop");
    if (bShop) bShop.load_a = shop ? 31 : 0;
  }

  private commitDock(): void {
    const f = this.state_.freight;
    if (this.state_.flags.payload_on_neck) return;
    if (f.payload_released) return;
    if (
      overDock(f) &&
      f.brake_engaged &&
      Math.abs(f.vertical_velocity_mps) < 0.12
    ) {
      this.state_.flags.payload_on_neck = true;
      this.push("Carrier is holding over the neck deck. Brake is real. Alignment is inside tolerance.");
    }
  }

  private updateNpcs(): void {
    tickNpcs(this.state_);
    void liveGalleryCount;
    void gallerySag;
    void neckWalkClear;
    void inhabitantCanReachShop;
    void evaluateTraversal;
  }

  private breaker(id: string) {
    return this.state_.electrical.breakers.find((b) => b.id === id);
  }

  private push(text: string): void {
    const events = this.state_.events;
    if (events[events.length - 1]?.text === text) return;
    events.push({ t: this.state_.sim_time_s, text });
    if (events.length > 40) events.splice(0, events.length - 40);
  }

  state(): WorldState {
    return this.state_;
  }

  replaceState(state: WorldState): void {
    this.state_ = cloneState(state);
    ensureRubeState(this.state_);
    this.lastGood_ = cloneState(this.state_);
  }

  finite(): boolean {
    const s = this.state_;
    return (
      Number.isFinite(s.freight.height_m) &&
      Number.isFinite(s.freight.cable_tension_n) &&
      Number.isFinite(s.frame.deflection_m) &&
      Number.isFinite(s.frame.twist_rad) &&
      Number.isFinite(s.frame.damage) &&
      Number.isFinite(s.gate.angle_rad) &&
      Number.isFinite(s.gate.pressure_pa) &&
      rubeFinite(ensureRubeState(s))
    );
  }
}
