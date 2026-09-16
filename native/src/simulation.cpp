#include "gravespire/simulation.hpp"

#include <algorithm>
#include <cmath>

namespace gravespire {
namespace {

constexpr double kGravity = 9.80665;
constexpr double kFrameMassKg = 48000.0;
constexpr double kFrameBaseStiffnessNpm = 1.08e7;
constexpr double kFrameDampingNsPm = 5.6e5;
constexpr double kFrameTorsionNmPrad = 3.4e7;
constexpr double kFrameTorsionDamping = 2.2e7;
constexpr double kYieldDeflectionM = 0.052;
constexpr double kFailureDeflectionM = 0.24;
constexpr double kPlasticFlow = 0.18;
constexpr double kDamageStiffnessLoss = 0.22;
constexpr double kGateAreaM2 = 7.5;
constexpr double kGateInertiaKgM2 = 9600.0;
constexpr double kGateDriveTorqueNm = 6.8e5;
constexpr double kGatePressureArmM = 0.42;
constexpr double kCableStiffnessNpm = 1.9e6;
constexpr double kCableDampingNsPm = 1.6e5;
constexpr double kJackForceN = -1.5e5;
constexpr double kPayoutMps = 0.35;
constexpr double kBrakeRatedN = 1.5 * Simulation::kRatedPayloadKg * kGravity;
constexpr double kBrakeThermalMassJPerK = 18000.0;
constexpr double kBrakeSlipNsPm = 7.2e4;
constexpr double kHeightMinM = 0.45;
constexpr double kTwoBlockM = 0.55;
constexpr double kCableMinM = 0.45;
constexpr double kCableMaxM = 8.0;

constexpr double kSpireLiftCarKg = 22000.0;
constexpr double kSpireLiftCounterKg = 18000.0;
constexpr double kSpireLiftDriveN = 190000.0;
constexpr double kSpireLiftHoldN = 135000.0;
constexpr double kSpireLiftDamping = 18000.0;
constexpr double kSpireLiftMaxSpeed = 3.5;
constexpr double kSpireLiftContactM = 58.0;

constexpr double kBridgeLatchTravelM = 0.12;
constexpr double kBridgeLatchOverCenterM = 0.035;
constexpr double kBridgeLatchClearM = 0.055;
constexpr double kBridgeLatchK = 1.6e5;
constexpr double kBridgeLatchC = 7.5e3;
constexpr double kBridgeLatchDetentK = 9.0e4;
constexpr double kBridgeMassKg = 48000.0;
constexpr double kBridgeLengthM = 20.0;
constexpr double kBridgeCounterKg = 20000.0;
constexpr double kBridgeCounterArmM = 6.0;
constexpr double kBridgeDamping = 2.8e5;
constexpr double kBridgeInitialRad = 1.28;
constexpr double kBridgeInertia =
    kBridgeMassKg * kBridgeLengthM * kBridgeLengthM / 3.0 +
    kBridgeCounterKg * kBridgeCounterArmM * kBridgeCounterArmM;

constexpr double kSkyCarKg = 18000.0;
constexpr double kSkyCounterBaseKg = 13000.0;
constexpr double kSkyBallastKg = 10000.0;
constexpr double kSkyBallastTravelM = 8.0;
constexpr double kSkyBallastDriveN = 70000.0;
constexpr double kSkyBallastDamping = 12000.0;
constexpr double kSkyBallastMaxSpeed = 1.2;
constexpr double kSkyCarDamping = 10000.0;
constexpr double kSkyCarMaxSpeed = 2.4;
constexpr double kSkyBrakeHoldN = 90000.0;
constexpr double kSkyTopContactM = 68.0;

constexpr double kWindLatchTravelM = 0.12;
constexpr double kWindLatchOverCenterM = 0.035;
constexpr double kWindLatchClearM = 0.055;
constexpr double kWindLatchK = 1.6e5;
constexpr double kWindLatchC = 7.5e3;
constexpr double kWindLatchDetentK = 9.0e4;
constexpr double kWindCarKg = 20000.0;
constexpr double kWindCounterKg = 15000.0;
constexpr double kWindCarDamping = 11000.0;
constexpr double kWindCarMaxSpeed = 3.0;
constexpr double kWindBrakeHoldN = 95000.0;
constexpr double kAirDensityKgM3 = 1.18;
constexpr double kWindMps = 15.5;
constexpr double kWindSailAreaM2 = 520.0;
constexpr double kWindCd = 1.12;

constexpr double kBrakeCooling = 0.035;

double clamp01(double value) {
  return std::clamp(value, 0.0, 1.0);
}

double smooth01(double value) {
  const double x = clamp01(value);
  return x * x * (3.0 - 2.0 * x);
}

}  // namespace

void Simulation::set_command(Command command, bool enabled) {
  commands_.at(static_cast<std::size_t>(command)) = enabled;
  if (command == Command::CarrierBrake && enabled) {
    state_.freight.brake_engaged = !state_.freight.brake_engaged;
  } else if (command == Command::FrameBrace && enabled) {
    state_.frame.brace_connected = true;
    state_.frame.brace_stiffness_npm = 4.0e6;
  } else if (command == Command::FrameCutBrace && enabled) {
    state_.frame.brace_connected = false;
    state_.frame.brace_stiffness_npm = 0.0;
  } else if (command == Command::GateWedge && enabled) {
    state_.gate.wedged = !state_.gate.wedged;
  } else if (command == Command::SkyCarBrake && enabled) {
    state_.spire.sky_car_brake_engaged = !state_.spire.sky_car_brake_engaged;
  } else if (command == Command::WindCarBrake && enabled) {
    state_.spire.wind_car_brake_engaged = !state_.spire.wind_car_brake_engaged;
  }
}

void Simulation::set_payload_kg(double payload_kg) {
  state_.freight.payload_kg = std::clamp(payload_kg, 80.0, 40000.0);
}

bool Simulation::active(Command command) const {
  return commands_.at(static_cast<std::size_t>(command));
}

void Simulation::advance_authority_tick() {
  for (int i = 0; i < kSubsteps; ++i) {
    step_mechanics(kMechanicsDt);
  }
  ++state_.authority_tick;
}

double Simulation::cable_geometry_m() const noexcept {
  return (kWinchDeckM - state_.frame.deflection_m) - state_.freight.height_m;
}

double Simulation::cable_extension_m() const noexcept {
  return cable_geometry_m() - state_.freight.cable_unstretched_m;
}

double Simulation::brake_hold_capacity_n() const noexcept {
  const double thermal = std::clamp(
      1.0 - (state_.freight.brake_temperature_k - 293.15) / 220.0,
      0.12, 1.0);
  return kBrakeRatedN * thermal;
}

bool Simulation::brake_slipping() const noexcept {
  return state_.freight.brake_slipping;
}

void Simulation::step_mechanics(double dt) {
  auto& freight = state_.freight;
  auto& frame = state_.frame;
  auto& gate = state_.gate;

  const double traverse_axis =
      static_cast<double>(active(Command::CarrierRight)) -
      static_cast<double>(active(Command::CarrierLeft));
  freight.lateral_velocity_mps += 1.1 * traverse_axis * dt;
  freight.lateral_velocity_mps *= std::exp(-1.8 * dt);
  freight.lateral_m = std::clamp(
      freight.lateral_m + freight.lateral_velocity_mps * dt, -5.8, 5.8);

  const double geom = cable_geometry_m();
  const double geom_dot =
      -frame.velocity_mps - freight.vertical_velocity_mps;
  const double extension = geom - freight.cable_unstretched_m;
  freight.cable_tension_n = std::max(
      0.0, kCableStiffnessNpm * extension + kCableDampingNsPm * geom_dot);

  const double hold = brake_hold_capacity_n();
  freight.brake_slipping = false;
  if (freight.brake_engaged) {
    if (freight.cable_tension_n > hold) {
      freight.brake_slipping = true;
      const double v_slip =
          (freight.cable_tension_n - hold) / kBrakeSlipNsPm;
      freight.cable_unstretched_m += v_slip * dt;
      freight.brake_temperature_k +=
          freight.cable_tension_n * v_slip * dt / kBrakeThermalMassJPerK;
    }
  } else {
    const double payout_axis =
        static_cast<double>(active(Command::CarrierLower)) -
        static_cast<double>(active(Command::CarrierRaise));
    freight.cable_unstretched_m += payout_axis * kPayoutMps * dt;
  }
  freight.cable_unstretched_m = std::clamp(
      freight.cable_unstretched_m, kCableMinM, kCableMaxM);

  const double geom_after = cable_geometry_m();
  const double extension_after =
      geom_after - freight.cable_unstretched_m;
  freight.cable_tension_n = std::max(
      0.0,
      kCableStiffnessNpm * extension_after + kCableDampingNsPm * geom_dot);

  const double mass = std::max(80.0, freight.payload_kg);
  const double ay =
      (freight.cable_tension_n - mass * kGravity) / mass;
  freight.vertical_velocity_mps += ay * dt;
  freight.height_m += freight.vertical_velocity_mps * dt;
  const double height_max =
      kWinchDeckM - frame.deflection_m - kTwoBlockM;
  if (freight.height_m < kHeightMinM) {
    freight.height_m = kHeightMinM;
    if (freight.vertical_velocity_mps < 0.0) {
      freight.vertical_velocity_mps = 0.0;
    }
  } else if (freight.height_m > height_max) {
    freight.height_m = height_max;
    if (freight.vertical_velocity_mps > 0.0) {
      freight.vertical_velocity_mps = 0.0;
    }
  }

  if (active(Command::GateVent)) {
    const double discharge = std::min(
        gate.inventory_kg,
        (3.8 + 0.000055 * gate.pressure_pa) * dt);
    gate.inventory_kg -= discharge;
    gate.pressure_pa = 420000.0 * gate.inventory_kg / 310.0;
  }

  const double gate_axis =
      static_cast<double>(active(Command::GateOpen)) -
      static_cast<double>(active(Command::GateClose));
  const double pressure_torque =
      gate.pressure_pa * kGateAreaM2 * kGatePressureArmM *
      std::max(0.12, std::cos(gate.angle_rad));
  const double jam_multiplier = gate_jam_multiplier();
  double drive_torque = gate_axis * kGateDriveTorqueNm / jam_multiplier;
  if (gate.wedged) {
    drive_torque = 0.0;
    gate.angular_velocity_radps *= std::exp(-24.0 * dt);
  }
  const double gate_torque = drive_torque - pressure_torque -
      1.1e5 * gate.angular_velocity_radps;
  gate.angular_velocity_radps += gate_torque / kGateInertiaKgM2 * dt;
  gate.angle_rad = std::clamp(
      gate.angle_rad + gate.angular_velocity_radps * dt, 0.0, 1.42);
  if ((gate.angle_rad == 0.0 && gate.angular_velocity_radps < 0.0) ||
      (gate.angle_rad == 1.42 && gate.angular_velocity_radps > 0.0)) {
    gate.angular_velocity_radps = 0.0;
  }

  const double carrier_force = freight.cable_tension_n;
  const double gate_force = gate.pressure_pa * kGateAreaM2;
  const double jack_force = active(Command::FrameJack) ? kJackForceN : 0.0;
  const double stiffness = kFrameBaseStiffnessNpm *
      (1.0 - kDamageStiffnessLoss * frame.damage) + frame.brace_stiffness_npm;
  const double frame_force = 0.42 * carrier_force +
      0.16 * gate_force + jack_force -
      stiffness * (frame.deflection_m - frame.plastic_set_m) -
      kFrameDampingNsPm * frame.velocity_mps;
  frame.velocity_mps += frame_force / kFrameMassKg * dt;
  frame.deflection_m += frame.velocity_mps * dt;

  const double torsion_moment = carrier_force * freight.lateral_m +
      gate_force * 1.65;
  const double torsion_accel =
      (torsion_moment - kFrameTorsionNmPrad * frame.twist_rad -
       kFrameTorsionDamping * frame.angular_velocity_radps) / 8.5e6;
  frame.angular_velocity_radps += torsion_accel * dt;
  frame.twist_rad += frame.angular_velocity_radps * dt;

  const double elastic_deflection =
      frame.deflection_m - frame.plastic_set_m;
  if (std::abs(elastic_deflection) > kYieldDeflectionM) {
    const double excess =
        std::abs(elastic_deflection) - kYieldDeflectionM;
    frame.plastic_set_m +=
        std::copysign(kPlasticFlow * excess * dt, elastic_deflection);
  }
  const double demand = std::max(
      std::abs(frame.deflection_m), 1.7 * std::abs(frame.twist_rad));
  frame.damage = std::max(
      frame.damage,
      clamp01((demand - kYieldDeflectionM) /
              (kFailureDeflectionM - kYieldDeflectionM)));

  gate.seal_misalignment_m =
      0.62 * frame.deflection_m + 0.85 * frame.twist_rad;
  freight.brake_temperature_k +=
      (293.15 - freight.brake_temperature_k) * kBrakeCooling * dt;

  step_spire(dt);
  ++state_.mechanics_step;
}

void Simulation::step_spire(double dt) {
  auto& s = state_.spire;

  const double lift_axis =
      static_cast<double>(active(Command::SpireLiftUp)) -
      static_cast<double>(active(Command::SpireLiftDown));
  const double lift_drive = lift_axis * kSpireLiftDriveN;
  const double lift_gravity = (kSpireLiftCounterKg - kSpireLiftCarKg) * kGravity;
  double lift_force = lift_drive + lift_gravity - kSpireLiftDamping * s.lift_velocity_mps;
  s.lift_brake_engaged = lift_axis == 0.0;
  s.lift_brake_slipping = false;
  if (s.lift_brake_engaged) {
    if (std::abs(lift_force) <= kSpireLiftHoldN) {
      s.lift_velocity_mps *= std::exp(-18.0 * dt);
      lift_force = 0.0;
    } else {
      s.lift_brake_slipping = true;
      lift_force -= std::copysign(kSpireLiftHoldN, lift_force);
      s.lift_brake_temperature_k +=
          std::abs(kSpireLiftHoldN * s.lift_velocity_mps) * dt / 22000.0;
    }
  }

  const double latch_target = std::clamp(
      (s.lift_q_m - kSpireLiftContactM) * 0.12, 0.0, kBridgeLatchTravelM);
  const double latch_target_v =
      s.lift_q_m > kSpireLiftContactM ? s.lift_velocity_mps * 0.12 : 0.0;
  const double latch_contact =
      kBridgeLatchK * (latch_target - s.bridge_latch_m) +
      kBridgeLatchC * (latch_target_v - s.bridge_latch_velocity_mps);
  s.bridge_latch_velocity_mps += latch_contact / 30.0 * dt;
  s.bridge_latch_m += s.bridge_latch_velocity_mps * dt;
  const double bridge_detent_target =
      s.bridge_latch_m >= kBridgeLatchOverCenterM ? kBridgeLatchTravelM : 0.0;
  s.bridge_latch_velocity_mps +=
      kBridgeLatchDetentK * (bridge_detent_target - s.bridge_latch_m) / 30.0 * dt;
  s.bridge_latch_m = std::clamp(s.bridge_latch_m, 0.0, kBridgeLatchTravelM);
  if (latch_contact > 0.0) lift_force -= latch_contact * 0.12;

  const double lift_mass = kSpireLiftCarKg + kSpireLiftCounterKg;
  s.lift_velocity_mps += lift_force / lift_mass * dt;
  s.lift_velocity_mps = std::clamp(
      s.lift_velocity_mps, -kSpireLiftMaxSpeed, kSpireLiftMaxSpeed);
  s.lift_q_m += s.lift_velocity_mps * dt;
  if (s.lift_q_m <= 0.0) {
    s.lift_q_m = 0.0;
    if (s.lift_velocity_mps < 0.0) s.lift_velocity_mps = 0.0;
  } else if (s.lift_q_m >= kSpireLiftTravelM) {
    s.lift_q_m = kSpireLiftTravelM;
    if (s.lift_velocity_mps > 0.0) s.lift_velocity_mps = 0.0;
  }
  s.lift_brake_temperature_k +=
      (293.15 - s.lift_brake_temperature_k) * kBrakeCooling * dt;

  if (s.bridge_latch_m >= kBridgeLatchClearM) {
    const double bridge_gravity =
        -kBridgeMassKg * kGravity * (kBridgeLengthM * 0.5) *
            std::cos(s.bridge_angle_rad) +
        kBridgeCounterKg * kGravity * kBridgeCounterArmM *
            std::cos(s.bridge_angle_rad);
    const double bridge_torque =
        bridge_gravity - kBridgeDamping * s.bridge_angular_velocity_radps;
    s.bridge_angular_velocity_radps += bridge_torque / kBridgeInertia * dt;
    s.bridge_angle_rad += s.bridge_angular_velocity_radps * dt;
  }
  if (s.bridge_angle_rad <= 0.0) {
    s.bridge_angle_rad = 0.0;
    if (s.bridge_angular_velocity_radps < 0.0) s.bridge_angular_velocity_radps = 0.0;
  } else if (s.bridge_angle_rad > kBridgeInitialRad) {
    s.bridge_angle_rad = kBridgeInitialRad;
    if (s.bridge_angular_velocity_radps > 0.0) s.bridge_angular_velocity_radps = 0.0;
  }

  const double ballast_axis =
      static_cast<double>(active(Command::SkyBallastRight)) -
      static_cast<double>(active(Command::SkyBallastLeft));
  const double ballast_force =
      ballast_axis * kSkyBallastDriveN -
      kSkyBallastDamping * s.sky_ballast_velocity_mps;
  s.sky_ballast_velocity_mps += ballast_force / kSkyBallastKg * dt;
  s.sky_ballast_velocity_mps = std::clamp(
      s.sky_ballast_velocity_mps, -kSkyBallastMaxSpeed, kSkyBallastMaxSpeed);
  s.sky_ballast_x_m += s.sky_ballast_velocity_mps * dt;
  if (s.sky_ballast_x_m <= 0.0) {
    s.sky_ballast_x_m = 0.0;
    if (s.sky_ballast_velocity_mps < 0.0) s.sky_ballast_velocity_mps = 0.0;
  } else if (s.sky_ballast_x_m >= kSkyBallastTravelM) {
    s.sky_ballast_x_m = kSkyBallastTravelM;
    if (s.sky_ballast_velocity_mps > 0.0) s.sky_ballast_velocity_mps = 0.0;
  }

  const double support_fraction = smooth01((s.sky_ballast_x_m - 5.0) / 2.0);
  const double sky_counter_kg =
      kSkyCounterBaseKg + support_fraction * kSkyBallastKg;
  double sky_force =
      (sky_counter_kg - kSkyCarKg) * kGravity -
      kSkyCarDamping * s.sky_car_velocity_mps;
  s.sky_car_brake_slipping = false;
  if (s.sky_car_brake_engaged) {
    if (std::abs(sky_force) <= kSkyBrakeHoldN) {
      s.sky_car_velocity_mps *= std::exp(-18.0 * dt);
      sky_force = 0.0;
    } else {
      s.sky_car_brake_slipping = true;
      sky_force -= std::copysign(kSkyBrakeHoldN, sky_force);
    }
  }

  const double wind_latch_target = std::clamp(
      (s.sky_car_q_m - kSkyTopContactM) * 0.12, 0.0, kWindLatchTravelM);
  const double wind_latch_target_v =
      s.sky_car_q_m > kSkyTopContactM ? s.sky_car_velocity_mps * 0.12 : 0.0;
  const double wind_latch_contact =
      kWindLatchK * (wind_latch_target - s.wind_latch_m) +
      kWindLatchC * (wind_latch_target_v - s.wind_latch_velocity_mps);
  s.wind_latch_velocity_mps += wind_latch_contact / 30.0 * dt;
  s.wind_latch_m += s.wind_latch_velocity_mps * dt;
  const double wind_detent_target =
      s.wind_latch_m >= kWindLatchOverCenterM ? kWindLatchTravelM : 0.0;
  s.wind_latch_velocity_mps +=
      kWindLatchDetentK * (wind_detent_target - s.wind_latch_m) / 30.0 * dt;
  s.wind_latch_m = std::clamp(s.wind_latch_m, 0.0, kWindLatchTravelM);
  if (wind_latch_contact > 0.0) sky_force -= wind_latch_contact * 0.12;

  const double sky_mass = kSkyCarKg + sky_counter_kg;
  s.sky_car_velocity_mps += sky_force / sky_mass * dt;
  s.sky_car_velocity_mps = std::clamp(
      s.sky_car_velocity_mps, -kSkyCarMaxSpeed, kSkyCarMaxSpeed);
  s.sky_car_q_m += s.sky_car_velocity_mps * dt;
  if (s.sky_car_q_m <= 0.0) {
    s.sky_car_q_m = 0.0;
    if (s.sky_car_velocity_mps < 0.0) s.sky_car_velocity_mps = 0.0;
  } else if (s.sky_car_q_m >= kSkyCarTravelM) {
    s.sky_car_q_m = kSkyCarTravelM;
    if (s.sky_car_velocity_mps > 0.0) s.sky_car_velocity_mps = 0.0;
  }

  const double q_dyn = 0.5 * kAirDensityKgM3 * kWindMps * kWindMps;
  const double wind_drive_n = q_dyn * kWindSailAreaM2 * kWindCd;
  const bool wind_unlocked = s.wind_latch_m >= kWindLatchClearM;
  double wind_force =
      (wind_unlocked ? wind_drive_n : 0.0) +
      (kWindCounterKg - kWindCarKg) * kGravity -
      kWindCarDamping * s.wind_car_velocity_mps;
  s.wind_car_brake_slipping = false;
  if (s.wind_car_brake_engaged || !wind_unlocked) {
    if (std::abs(wind_force) <= kWindBrakeHoldN || !wind_unlocked) {
      s.wind_car_velocity_mps *= std::exp(-18.0 * dt);
      wind_force = 0.0;
    } else {
      s.wind_car_brake_slipping = true;
      wind_force -= std::copysign(kWindBrakeHoldN, wind_force);
    }
  }
  const double wind_mass = kWindCarKg + kWindCounterKg;
  s.wind_car_velocity_mps += wind_force / wind_mass * dt;
  s.wind_car_velocity_mps = std::clamp(
      s.wind_car_velocity_mps, -kWindCarMaxSpeed, kWindCarMaxSpeed);
  s.wind_car_q_m += s.wind_car_velocity_mps * dt;
  if (s.wind_car_q_m <= 0.0) {
    s.wind_car_q_m = 0.0;
    if (s.wind_car_velocity_mps < 0.0) s.wind_car_velocity_mps = 0.0;
  } else if (s.wind_car_q_m >= kWindCarTravelM) {
    s.wind_car_q_m = kWindCarTravelM;
    if (s.wind_car_velocity_mps > 0.0) s.wind_car_velocity_mps = 0.0;
  }
}

const WorldState& Simulation::state() const noexcept {
  return state_;
}

bool Simulation::finite() const noexcept {
  const auto& s = state_;
  return std::isfinite(s.freight.height_m) &&
      std::isfinite(s.freight.cable_tension_n) &&
      std::isfinite(s.freight.cable_unstretched_m) &&
      std::isfinite(s.frame.deflection_m) &&
      std::isfinite(s.frame.twist_rad) &&
      std::isfinite(s.frame.damage) &&
      std::isfinite(s.gate.angle_rad) &&
      std::isfinite(s.gate.pressure_pa) &&
      std::isfinite(s.spire.lift_q_m) &&
      std::isfinite(s.spire.bridge_latch_m) &&
      std::isfinite(s.spire.bridge_angle_rad) &&
      std::isfinite(s.spire.sky_ballast_x_m) &&
      std::isfinite(s.spire.sky_car_q_m) &&
      std::isfinite(s.spire.wind_latch_m) &&
      std::isfinite(s.spire.wind_car_q_m) &&
      std::abs(s.frame.deflection_m) < 2.5 &&
      std::abs(s.frame.plastic_set_m) < 2.5;
}

double Simulation::gate_jam_multiplier() const noexcept {
  return 1.0 + 24.0 * std::abs(state_.gate.seal_misalignment_m);
}

bool Simulation::gallery_passable() const noexcept {
  return state_.gate.angle_rad > 0.95 && !state_.gate.wedged;
}

bool Simulation::neck_walk_clear() const noexcept {
  return std::abs(state_.gate.seal_misalignment_m) < 0.018 ||
      state_.frame.brace_connected;
}

bool Simulation::carrier_at_recv() const noexcept {
  return state_.freight.lateral_m > 4.4 &&
      state_.freight.height_m > 1.85 &&
      state_.freight.height_m < 3.15;
}

bool Simulation::act1_shop_open() const noexcept {
  return gallery_passable() && neck_walk_clear();
}

bool Simulation::act1_local_competence() const noexcept {
  return act1_shop_open() && carrier_at_recv();
}

bool Simulation::spire_bridge_walkable() const noexcept {
  return state_.spire.bridge_latch_m >= kBridgeLatchClearM &&
      state_.spire.bridge_angle_rad < 0.08;
}

bool Simulation::spire_sky_ballast_loaded() const noexcept {
  return state_.spire.sky_ballast_x_m > 6.5;
}

bool Simulation::spire_wind_unlocked() const noexcept {
  return state_.spire.wind_latch_m >= kWindLatchClearM;
}

}  // namespace gravespire
