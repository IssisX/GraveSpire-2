#include "gravespire/simulation.hpp"

#include <algorithm>
#include <cmath>

namespace gravespire {
namespace {

constexpr double kGravity = 9.80665;
constexpr double kFrameMassKg = 48000.0;
constexpr double kFrameBaseStiffnessNpm = 7.5e6;
constexpr double kFrameDampingNsPm = 3.4e5;
constexpr double kFrameTorsionNmPrad = 2.2e7;
constexpr double kFrameTorsionDamping = 7.0e5;
constexpr double kYieldDeflectionM = 0.052;
constexpr double kFailureDeflectionM = 0.24;
constexpr double kGateAreaM2 = 7.5;
constexpr double kGateInertiaKgM2 = 9600.0;
constexpr double kGateDriveTorqueNm = 6.8e5;
constexpr double kGatePressureArmM = 0.42;
constexpr double kCableStiffnessNpm = 1.9e6;
constexpr double kCableDampingNsPm = 8.0e4;

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

bool Simulation::active(Command command) const {
  return commands_.at(static_cast<std::size_t>(command));
}

void Simulation::advance_authority_tick() {
  for (int i = 0; i < kSubsteps; ++i) {
    step_mechanics(kMechanicsDt);
  }
  ++state_.authority_tick;
}

void Simulation::step_mechanics(double dt) {
  auto& freight = state_.freight;
  auto& frame = state_.frame;
  auto& gate = state_.gate;

  const double lift_axis =
      static_cast<double>(active(Command::CarrierRaise)) -
      static_cast<double>(active(Command::CarrierLower));
  const double traverse_axis =
      static_cast<double>(active(Command::CarrierRight)) -
      static_cast<double>(active(Command::CarrierLeft));

  const double lift_accel = 1.35 * lift_axis;
  freight.vertical_velocity_mps += lift_accel * dt;
  freight.lateral_velocity_mps += 1.1 * traverse_axis * dt;

  if (freight.brake_engaged && lift_axis == 0.0) {
    const double before = freight.vertical_velocity_mps;
    freight.vertical_velocity_mps *= std::exp(-9.0 * dt);
    const double dissipated = 0.5 * freight.payload_kg *
        (before * before - freight.vertical_velocity_mps *
         freight.vertical_velocity_mps);
    freight.brake_temperature_k += std::max(0.0, dissipated) / 18000.0;
  }
  freight.lateral_velocity_mps *= std::exp(-1.8 * dt);
  freight.height_m = std::clamp(
      freight.height_m + freight.vertical_velocity_mps * dt,
      0.45, 7.6);
  freight.lateral_m = std::clamp(
      freight.lateral_m + freight.lateral_velocity_mps * dt,
      -5.8, 5.8);

  const double cable_extension = std::max(
      0.0, frame.deflection_m - frame.plastic_set_m + 0.018);
  freight.cable_tension_n = std::max(
      0.0,
      freight.payload_kg * (kGravity + lift_accel) +
      kCableStiffnessNpm * cable_extension +
      kCableDampingNsPm * frame.velocity_mps);

  if (active(Command::GateVent)) {
    const double discharge = std::min(
        gate.inventory_kg, (0.9 + 0.000012 * gate.pressure_pa) * dt);
    gate.inventory_kg -= discharge;
    gate.pressure_pa = 420000.0 * gate.inventory_kg / 310.0;
  }

  const double gate_axis =
      static_cast<double>(active(Command::GateOpen)) -
      static_cast<double>(active(Command::GateClose));
  const double pressure_torque =
      gate.pressure_pa * kGateAreaM2 * kGatePressureArmM *
      std::max(0.12, std::cos(gate.angle_rad));
  const double misalignment = std::abs(gate.seal_misalignment_m);
  const double jam_multiplier = 1.0 + 24.0 * misalignment;
  double drive_torque = gate_axis * kGateDriveTorqueNm / jam_multiplier;
  if (gate.wedged) {
    drive_torque = 0.0;
    gate.angular_velocity_radps *= std::exp(-24.0 * dt);
  }
  const double gate_torque = drive_torque - pressure_torque -
      1.1e5 * gate.angular_velocity_radps;
  gate.angular_velocity_radps += gate_torque / kGateInertiaKgM2 * dt;
  gate.angle_rad = std::clamp(
      gate.angle_rad + gate.angular_velocity_radps * dt,
      0.0, 1.42);
  if ((gate.angle_rad == 0.0 && gate.angular_velocity_radps < 0.0) ||
      (gate.angle_rad == 1.42 && gate.angular_velocity_radps > 0.0)) {
    gate.angular_velocity_radps = 0.0;
  }

  const double carrier_force = freight.cable_tension_n;
  const double gate_force = gate.pressure_pa * kGateAreaM2;
  const double jack_force = active(Command::FrameJack) ? -7.5e5 : 0.0;
  const double stiffness = kFrameBaseStiffnessNpm *
      (1.0 - 0.82 * frame.damage) + frame.brace_stiffness_npm;
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
    frame.plastic_set_m += std::copysign(0.24 * excess, elastic_deflection);
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
      std::isfinite(s.frame.deflection_m) &&
      std::isfinite(s.frame.twist_rad) &&
      std::isfinite(s.frame.damage) &&
      std::isfinite(s.gate.angle_rad) &&
      std::isfinite(s.gate.pressure_pa);
}

}  // namespace gravespire

