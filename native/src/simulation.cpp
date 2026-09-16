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

double clamp01(double value) {
  return std::clamp(value, 0.0, 1.0);
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
      (293.15 - freight.brake_temperature_k) * 0.035 * dt;
  ++state_.mechanics_step;
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

}  // namespace gravespire
