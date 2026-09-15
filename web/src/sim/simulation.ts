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

const kFrameMassKg = 48000.0;
const kFrameBaseStiffnessNpm = 7.5e6;
const kFrameDampingNsPm = 7.2e5;
const kFrameTorsionNmPrad = 2.2e7;
const kFrameTorsionDamping = 1.1e6;
const kYieldDeflectionM = 0.055;
/**
 * Isotropic hardening: accumulated permanent set raises the elastic limit, so
 * plastic flow arrests at a finite deflection instead of running away. Without
 * it the section is ideally plastic and any demand above the plastic limit
 * grows the set without bound.
 */
const kFrameHardening = 0.8;
/**
 * Declared limit state for the transfer frame. Beyond this the Act I reduction
 * has nothing meaningful left to say, so the configuration is held and reported
 * rather than integrated into nonsense. This is a declared boundary, not a
 * fracture model.
 */
const kFailureDeflectionM = 0.24;
const kGateAreaM2 = 7.5;
const kGateInertiaKgM2 = 9600.0;
const kGateDriveTorqueNm = 6.8e5;
const kGatePressureArmM = 0.42;
const kCableStiffnessNpm = 1.9e6;
const kCableDampingNsPm = 8.0e4;
const kGalleryDeadN = 28000;

/**
 * Hoist drive — declared reduced DC model.
 *
 *   i = (V - k_e * omega) / R, limited by the drive's current limit
 *   F_rope = k_t_line * i
 *
 * The drive therefore has a finite capacity: it cannot lift an arbitrary mass,
 * its current rises as it slows toward stall, and a released brake with no
 * command lets the load back-drive the mechanism against gearbox drag rather
 * than hanging in mid-air. This is a machine abstraction, not a full motor
 * topology, and it is not the GDD Sec.8 electromechanical contract.
 */
const kHoistOmegaPerMps = 11.0;
const kHoistBackEmf = 17.5;
const kHoistResistanceOhm = 3.1;
const kHoistCurrentLimitA = 190.0;
const kHoistForcePerAmpN = 620.0;
const kHoistGearboxDragNsPm = 5.2e3;
/** Drum, gearbox and rope inertia referred to the rope, kg. */
const kHoistReflectedInertiaKg = 9000.0;
/** Rope force the fail-safe drum brake can hold before it slips, N. */
const kBrakeHoldingForceN = 1.45e5;

/** Load pendulum under the carrier. Short sling, so it settles quickly. */
const kSlingLengthM = 1.35;
const kSwingDampingRatio = 0.1;

/** Traverse drive: finite too, and it draws current while it runs. */
const kTraverseAccelMps2 = 1.1;
const kTraverseCurrentA = 28.0;

/** Process island demand that is not the carrier, A. */
const kProcessBaseLoadA = 115.0;
const kBayLightLoadA = 85.0;
const kGateMotorLoadA = 45.0;
const kDriveCabinetLoadA = 74.0;
const kHabLoadA = 55.0;
const kShopLoadA = 31.0;

/** Inverse-time protection: seconds of sustained 2x overload before tripping. */
const kBreakerTripTauS = 7.0;
/** Seconds for thermal memory to bleed off from a full trip threshold. */
const kBreakerCoolTauS = 28.0;

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
    this.commands_ = COMMANDS.map(() => false);
    if (state) {
      this.state_ = cloneState(state);
    } else {
      this.state_ = createInitialState();
      this.settleInitialState();
    }
    this.lastGood_ = cloneState(this.state_);
  }

  /**
   * Bring a fresh world to its resting condition before play starts.
   *
   * Bay 07 has been carrying this load and this vessel pressure for a long
   * time. Starting every coupled body at zero displacement and letting it ring
   * into place would be a startup artifact, and its overshoot would write
   * permanent set the structure never actually took. Settle, then restore the
   * declared pre-existing damage state and the clock.
   */
  private settleInitialState(): void {
    const declaredSet = this.state_.frame.plastic_set_m;
    const declaredDamage = this.state_.frame.damage;
    const declaredMemberState = this.state_.members.map((m) => ({
      id: m.id,
      plastic_set_m: m.plastic_set_m,
      damage: m.damage,
    }));
    for (let i = 0; i < 900; i++) {
      for (let k = 0; k < SUBSTEPS; k++) this.stepMechanics(MECHANICS_DT);
      this.commitMembers();
    }
    this.commitElectrical();
    this.state_.frame.plastic_set_m = declaredSet;
    this.state_.frame.damage = declaredDamage;
    for (const d of declaredMemberState) {
      const m = this.state_.members.find((x) => x.id === d.id);
      if (!m) continue;
      m.plastic_set_m = d.plastic_set_m;
      m.damage = d.damage;
    }
    this.state_.frame.velocity_mps = 0;
    this.state_.frame.angular_velocity_radps = 0;
    this.state_.freight.vertical_velocity_mps = 0;
    this.state_.freight.lateral_velocity_mps = 0;
    this.state_.freight.payload_swing_rad = 0;
    this.state_.freight.payload_swing_velocity_radps = 0;
    this.state_.freight.brake_temperature_k = 293.15;
    this.state_.mechanics_step = 0;
    for (const b of this.state_.electrical.breakers) b.thermal = 0;
  }

  setCommand(command: Command, enabled: boolean): void {
    const idx = COMMANDS.indexOf(command);
    this.commands_[idx] = enabled;
    if (command === "CarrierBrake" && enabled) {
      const f = this.state_.freight;
      if (f.brake_engaged && !this.state_.electrical.carrier_powered) {
        // Fail-safe design: the drum brake is held off by control power. With a
        // dead bus it cannot be released at all.
        this.push("Brake will not release. It is held off by control power, and the bus is dead.");
        return;
      }
      f.brake_engaged = !f.brake_engaged;
      this.push(f.brake_engaged ? "Carrier brake engaged." : "Carrier brake released.");
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
    } else if (command === "GateVent" && enabled) {
      // Edge on the vent command latches the valve; releasing the control does
      // not shut it. Closing it is a second, deliberate command.
      this.state_.gate.vent_open = true;
      this.push("Vent valve open. Inventory is discharging.");
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
        const overDock =
          s.freight.lateral_m > 4.15 &&
          s.freight.height_m > 2.05 &&
          s.freight.height_m < 2.7;
        if (!overDock) return "Not over the neck deck.";
        if (Math.abs(s.freight.vertical_velocity_mps) > 0.45) {
          s.freight.cargo_damaged = true;
          this.push("Release from height. Cargo took the hit.");
        }
        if (Math.abs(s.freight.payload_swing_rad) > 0.09) {
          s.freight.cargo_damaged = true;
          this.push("Released while the load was still swinging. It landed off-station and took the corner.");
        }
        if (!s.freight.brake_engaged) {
          this.push("Released without brake. Deck took an impulse.");
        }
        s.freight.payload_released = true;
        s.freight.payload_kg = 420;
        if (
          s.freight.brake_engaged &&
          Math.abs(s.freight.vertical_velocity_mps) < 0.4 &&
          Math.abs(s.freight.payload_swing_rad) < 0.05 &&
          Math.abs(s.gate.seal_misalignment_m) < 0.05
        ) {
          s.flags.payload_on_neck = true;
          this.push("Payload is on the neck deck. Brake is holding.");
        } else if (overDock) {
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
        if (!(walk.find((e) => e.id === "neck_main")?.valid ?? false)) {
          return "No maintenance walk to the housing. The transfer deck is still out of alignment — brace it, jack it, or take the load off it.";
        }
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
        s.cables.push({
          id: "sling",
          a: action.a,
          b: action.b,
          rest_length_m: 6.4,
          tension_n: 0,
          slack: true,
        });
        this.push(`Sling committed ${action.a} → ${action.b}. Tension-only.`);
        return "Sling committed.";
      }
      case "vent_close": {
        if (!s.gate.vent_open) return "Vent valve is already shut.";
        s.gate.vent_open = false;
        this.push("Vent valve shut. Whatever inventory is left stays in the vessel.");
        return "Vent shut.";
      }
      case "clear_sling": {
        s.cables = s.cables.filter((c) => c.id !== "sling");
        this.push("Sling cleared.");
        return "Sling cleared.";
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

    const powered = elec.carrier_powered;
    const mEff = freight.payload_kg + kHoistReflectedInertiaKg;
    const weightForce = freight.payload_kg * G;

    // --- hoist drive: speed-regulated, current-limited, gravity feedforward --
    // A zero command asks the drive to hold, and holding costs real current.
    // It is not an infinite-force constraint: beyond the current limit the load
    // wins and the rope pays out.
    let current = 0;
    if (powered && !freight.brake_engaged) {
      const targetSpeed = liftAxis * 0.45;
      const feedForward = weightForce / kHoistForcePerAmpN;
      const demand = feedForward + 200.0 * (targetSpeed - freight.vertical_velocity_mps);
      current = clamp(demand, -kHoistCurrentLimitA, kHoistCurrentLimitA);
      // Back-EMF caps what the supply can actually push at speed.
      const omega = freight.vertical_velocity_mps * kHoistOmegaPerMps;
      const ceiling = (clamp(elec.voltage_process, 0, 520) - kHoistBackEmf * omega) / kHoistResistanceOhm;
      const floor = (-clamp(elec.voltage_process, 0, 520) - kHoistBackEmf * omega) / kHoistResistanceOhm;
      current = clamp(current, Math.min(floor, 0), Math.max(ceiling, 0));
    }
    freight.hoist_current_a = Math.abs(current);
    const motorForce = kHoistForcePerAmpN * current;
    const dragForce = -kHoistGearboxDragNsPm * freight.vertical_velocity_mps;

    if (freight.brake_engaged) {
      // Fail-safe drum brake: holds until rope force exceeds its capacity.
      const demand = Math.abs(weightForce - motorForce);
      if (demand <= kBrakeHoldingForceN) {
        const before = freight.vertical_velocity_mps;
        freight.vertical_velocity_mps *= Math.exp(-9.0 * dt);
        const dissipated =
          0.5 * mEff * (before * before - freight.vertical_velocity_mps * freight.vertical_velocity_mps);
        freight.brake_temperature_k += Math.max(0, dissipated) / 18000.0;
      } else {
        const slip = Math.sign(motorForce - weightForce) * kBrakeHoldingForceN;
        freight.vertical_velocity_mps += ((motorForce - weightForce + dragForce + slip) / mEff) * dt;
        freight.brake_temperature_k += (Math.abs(slip * freight.vertical_velocity_mps) * dt) / 9000.0;
      }
    } else {
      freight.vertical_velocity_mps += ((motorForce - weightForce + dragForce) / mEff) * dt;
    }

    // --- traverse ------------------------------------------------------------
    const lateralVelBefore = freight.lateral_velocity_mps;
    freight.lateral_velocity_mps += kTraverseAccelMps2 * traverseAxis * (powered ? 1 : 0) * dt;
    freight.lateral_velocity_mps *= Math.exp(-1.8 * dt);

    freight.height_m = clamp(freight.height_m + freight.vertical_velocity_mps * dt, 0.45, 7.6);
    if (freight.height_m <= 0.45 && freight.vertical_velocity_mps < 0) freight.vertical_velocity_mps = 0;
    if (freight.height_m >= 7.6 && freight.vertical_velocity_mps > 0) freight.vertical_velocity_mps = 0;

    freight.lateral_m = clamp(freight.lateral_m + freight.lateral_velocity_mps * dt, -5.8, 5.8);
    if (freight.lateral_m <= -5.8 || freight.lateral_m >= 5.8) freight.lateral_velocity_mps = 0;
    freight.payout_m = freight.height_m;

    // --- suspended load pendulum --------------------------------------------
    // A traverse start or stop swings the load; the swing is a real offset that
    // the transfer frame feels, not a decoration on the mesh.
    if (!freight.payload_released) {
      const accelLat = clamp((freight.lateral_velocity_mps - lateralVelBefore) / dt, -12, 12);
      const omegaN = Math.sqrt(G / kSlingLengthM);
      const theta = freight.payload_swing_rad;
      const alpha =
        -(G / kSlingLengthM) * Math.sin(theta) -
        (accelLat / kSlingLengthM) * Math.cos(theta) -
        2 * kSwingDampingRatio * omegaN * freight.payload_swing_velocity_radps;
      freight.payload_swing_velocity_radps += alpha * dt;
      freight.payload_swing_rad = clamp(theta + freight.payload_swing_velocity_radps * dt, -0.6, 0.6);
    } else {
      freight.payload_swing_velocity_radps *= Math.exp(-6 * dt);
      freight.payload_swing_rad *= Math.exp(-6 * dt);
    }

    const elasticLen = frame.deflection_m - frame.plastic_set_m;
    const cableExtension = Math.max(0, 0.018 + 0.12 * elasticLen);
    // Rope force is whatever is actually transmitted: the drum brake holding
    // static weight, or the drive's rope force when the brake is off.
    const ropeForce = freight.brake_engaged ? weightForce : Math.max(0, motorForce);
    freight.cable_tension_n = Math.max(
      0,
      ropeForce + kCableStiffnessNpm * cableExtension + kCableDampingNsPm * frame.velocity_mps,
    );

    // The vent valve is a latched position, not a button someone has to lean on.
    if (gate.vent_open || this.active("GateVent")) {
      const discharge = Math.min(gate.inventory_kg, (1.7 + 0.000023 * gate.pressure_pa) * dt);
      gate.inventory_kg = Math.max(0, gate.inventory_kg - discharge);
      gate.pressure_pa = (420000.0 * gate.inventory_kg) / 310.0;
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
    // The load's true lateral station is the trolley plus its swing. A swinging
    // load is a moving eccentricity, not a decoration.
    const effectiveOffsetM =
      freight.lateral_m + (freight.payload_released ? 0 : kSlingLengthM * Math.sin(freight.payload_swing_rad));
    const offsetFactor = 1 + 0.4 * Math.abs(effectiveOffsetM);
    const stiffness =
      kFrameBaseStiffnessNpm * (1.0 - 0.28 * frame.damage) + frame.brace_stiffness_npm;
    const frameForce =
      0.42 * offsetFactor * carrierForce +
      0.09 * gateForce +
      jackForce -
      slingForce * 0.35 -
      stiffness * (frame.deflection_m - frame.plastic_set_m) -
      kFrameDampingNsPm * frame.velocity_mps;
    frame.velocity_mps += (frameForce / kFrameMassKg) * dt;
    frame.deflection_m += frame.velocity_mps * dt;

    const torsionMoment = carrierForce * effectiveOffsetM + gateForce * 1.65;
    const torsionAccel =
      (torsionMoment - kFrameTorsionNmPrad * frame.twist_rad - kFrameTorsionDamping * frame.angular_velocity_radps) /
      8.5e6;
    frame.angular_velocity_radps += torsionAccel * dt;
    frame.twist_rad += frame.angular_velocity_radps * dt;

    const elasticDeflection = frame.deflection_m - frame.plastic_set_m;
    const elasticLimit = kYieldDeflectionM + kFrameHardening * Math.abs(frame.plastic_set_m);
    if (Math.abs(elasticDeflection) > elasticLimit) {
      frame.plastic_set_m = frame.deflection_m - Math.sign(elasticDeflection) * elasticLimit;
    }
    if (Math.abs(frame.deflection_m) >= kFailureDeflectionM) {
      // Declared limit reached. Hold the configuration; do not keep integrating.
      frame.deflection_m = Math.sign(frame.deflection_m) * kFailureDeflectionM;
      frame.velocity_mps = 0;
      frame.plastic_set_m =
        frame.deflection_m - Math.sign(elasticDeflection || 1) * elasticLimit;
      this.push(
        "Transfer frame reached its declared limit deflection. The Act I model holds it there; it does not pretend to fracture.",
      );
    }
    const nextDamage = clamp01(Math.abs(frame.plastic_set_m) / 0.12);
    if (nextDamage > frame.damage + 0.08 && frame.damage < 0.08) {
      this.push("Transfer frame yielded. Permanent set will survive unload.");
    }
    frame.damage = Math.max(frame.damage, nextDamage);

    gate.seal_misalignment_m = 0.62 * frame.deflection_m + 0.85 * frame.twist_rad;
    freight.brake_temperature_k += (293.15 - freight.brake_temperature_k) * 0.035 * dt;
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
    const f = this.state_.freight;
    const br = (id: string) => this.breaker(id);
    const live = (id: string) => {
      const b = br(id);
      return Boolean(b?.closed) && !b?.tripped;
    };

    const processBus = live("brk_gen");
    e.process_isolated = !processBus;
    const driveCab = processBus && live("brk_drive") && this.state_.flags.drive_present;
    const gateFeed = processBus && live("brk_gate");
    const habViaDrive = driveCab && live("brk_hab");
    const habWest = processBus && e.chen_rerouted && live("brk_west");
    const hab = habViaDrive || habWest;
    const shop = hab && live("brk_shop");

    const wasPowered = e.carrier_powered;
    e.carrier_powered = processBus;
    e.drive_powered = driveCab;
    e.gate_powered = gateFeed;
    e.bay_lights = processBus || hab;
    e.shop_powered = Boolean(shop);
    e.voltage_process = processBus ? 480 : 0;
    e.voltage_shop = shop ? (habWest && !habViaDrive ? 452 : 480) : 0;

    // Fail-safe drum brake: losing control power sets the brake. The load stops
    // where it is instead of running away. This is a property of this mechanism.
    if (wasPowered && !processBus && !f.brake_engaged) {
      f.brake_engaged = true;
      this.push("Control power lost. Fail-safe drum brake set. The load is held, not dropped.");
    }

    // ---- demand ------------------------------------------------------------
    // The hoist is a real consumer: holding a load off the brake costs current,
    // and the process bus has a finite rating.
    const traverseRunning = this.active("CarrierLeft") || this.active("CarrierRight");
    const gateRunning = this.active("GateOpen") || this.active("GateClose");
    const carrierDemand =
      (processBus ? f.hoist_current_a : 0) + (processBus && traverseRunning ? kTraverseCurrentA : 0);

    const processLoad = processBus
      ? kProcessBaseLoadA +
        (e.bay_lights ? kBayLightLoadA : 0) +
        (gateFeed && gateRunning ? kGateMotorLoadA : 0) +
        (driveCab ? kDriveCabinetLoadA : 0) +
        (hab ? kHabLoadA : 0) +
        (shop ? kShopLoadA : 0) +
        carrierDemand
      : 0;
    e.process_load_a = processLoad;

    const bGen = br("brk_gen");
    if (bGen) bGen.load_a = processLoad;
    const bDrive = br("brk_drive");
    if (bDrive) bDrive.load_a = driveCab ? kDriveCabinetLoadA + (habViaDrive ? kHabLoadA : 0) : 0;
    const bGate = br("brk_gate");
    if (bGate) bGate.load_a = gateFeed && gateRunning ? kGateMotorLoadA : 0;
    const bHab = br("brk_hab");
    if (bHab) bHab.load_a = habViaDrive ? kHabLoadA : 0;
    const bWest = br("brk_west");
    if (bWest) bWest.load_a = habWest ? kHabLoadA + (shop ? kShopLoadA : 0) : 0;
    const bShop = br("brk_shop");
    if (bShop) bShop.load_a = shop ? kShopLoadA : 0;

    this.commitProtection();
  }

  /**
   * Inverse-time overcurrent protection with thermal memory.
   *
   * A brief inrush and a sustained overload are not the same event: thermal
   * state accumulates with the square of the overload and bleeds off when the
   * device is back inside its rating.
   */
  private commitProtection(): void {
    const dt = AUTHORITY_DT;
    for (const b of this.state_.electrical.breakers) {
      if (!b.closed) {
        b.thermal = Math.max(0, b.thermal - dt / kBreakerCoolTauS);
        continue;
      }
      if (b.tripped) continue;
      const ratio = b.rating_a > 0 ? b.load_a / b.rating_a : 0;
      if (ratio > 1.02) {
        b.thermal = clamp01(b.thermal + ((ratio * ratio - 1) * dt) / kBreakerTripTauS);
        if (b.thermal >= 1) {
          b.tripped = true;
          // Tripping opens the contacts. The handle sits in the tripped
          // position until someone resets it at the board.
          b.closed = false;
          b.thermal = 1;
          this.push(
            `${b.name} tripped on sustained overload: ${b.load_a.toFixed(0)} A against a ${b.rating_a.toFixed(0)} A rating.`,
          );
        }
      } else {
        b.thermal = Math.max(0, b.thermal - dt / kBreakerCoolTauS);
      }
    }
  }

  /**
   * Report a clean hold over the receiving deck.
   *
   * This does not put the load down. The payload is on the deck when the player
   * releases it, and only then does its weight leave the rope and enter the
   * structure. Holding is the condition that makes a clean release possible.
   */
  private commitDock(): void {
    const f = this.state_.freight;
    if (this.state_.flags.payload_on_neck || f.payload_released) return;
    const over =
      f.lateral_m > 4.2 &&
      f.height_m > 2.1 &&
      f.height_m < 2.55 &&
      f.brake_engaged &&
      Math.abs(f.vertical_velocity_mps) < 0.12 &&
      Math.abs(f.payload_swing_rad) < 0.035;
    if (over) {
      this.push("Holding over the receiving deck. Brake is real, swing is dead, station is inside tolerance. Release when ready.");
    }
  }

  private updateNpcs(): void {
    const walk = evaluateTraversal(this.state_);
    const gallery = walk.find((e) => e.id === "gallery_span");
    const skip = this.state_.npcs.find((n) => n.id === "skip");
    if (skip) {
      skip.stuck = gallery && !gallery.npc_safe ? gallery.reason : null;
    }
    const chen = this.state_.npcs.find((n) => n.id === "chen");
    if (chen && inhabitantCanReachShop(this.state_) && this.state_.electrical.shop_powered) {
      chen.x += (78.4 - chen.x) * 0.004;
      chen.z += (3.1 - chen.z) * 0.004;
      chen.district = chen.x > 64 ? "SHA" : "FS08";
    }
    const rami = this.state_.npcs.find((n) => n.id === "rami");
    if (rami && this.state_.flags.payload_on_neck) {
      rami.knows["docked"] = true;
    }
    void liveGalleryCount;
    void gallerySag;
    void neckWalkClear;
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
    this.lastGood_ = cloneState(state);
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
      Number.isFinite(s.gate.pressure_pa)
    );
  }
}
