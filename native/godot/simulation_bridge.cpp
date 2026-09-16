#include "simulation_bridge.hpp"

#include <godot_cpp/core/class_db.hpp>

namespace gravespire {

void SimulationBridge::_bind_methods() {
  godot::ClassDB::bind_method(
      godot::D_METHOD("set_action", "action", "active"),
      &SimulationBridge::set_action);
  godot::ClassDB::bind_method(
      godot::D_METHOD("snapshot"), &SimulationBridge::snapshot);
}

void SimulationBridge::_physics_process(double delta) {
  accumulator_ += delta;
  while (accumulator_ >= Simulation::kAuthorityDt) {
    simulation_.advance_authority_tick();
    accumulator_ -= Simulation::kAuthorityDt;
  }
}

void SimulationBridge::set_action(
    const godot::StringName& action, bool enabled) {
  static const godot::StringName carrier_raise("carrier_raise");
  static const godot::StringName carrier_lower("carrier_lower");
  static const godot::StringName carrier_left("carrier_left");
  static const godot::StringName carrier_right("carrier_right");
  static const godot::StringName carrier_brake("carrier_brake");
  static const godot::StringName frame_jack("frame_jack");
  static const godot::StringName frame_brace("frame_brace");
  static const godot::StringName frame_cut_brace("frame_cut_brace");
  static const godot::StringName gate_vent("gate_vent");
  static const godot::StringName gate_open("gate_open");
  static const godot::StringName gate_close("gate_close");
  static const godot::StringName gate_wedge("gate_wedge");

  if (action == carrier_raise) {
    simulation_.set_command(Command::CarrierRaise, enabled);
  } else if (action == carrier_lower) {
    simulation_.set_command(Command::CarrierLower, enabled);
  } else if (action == carrier_left) {
    simulation_.set_command(Command::CarrierLeft, enabled);
  } else if (action == carrier_right) {
    simulation_.set_command(Command::CarrierRight, enabled);
  } else if (action == carrier_brake) {
    simulation_.set_command(Command::CarrierBrake, enabled);
  } else if (action == frame_jack) {
    simulation_.set_command(Command::FrameJack, enabled);
  } else if (action == frame_brace) {
    simulation_.set_command(Command::FrameBrace, enabled);
  } else if (action == frame_cut_brace) {
    simulation_.set_command(Command::FrameCutBrace, enabled);
  } else if (action == gate_vent) {
    simulation_.set_command(Command::GateVent, enabled);
  } else if (action == gate_open) {
    simulation_.set_command(Command::GateOpen, enabled);
  } else if (action == gate_close) {
    simulation_.set_command(Command::GateClose, enabled);
  } else if (action == gate_wedge) {
    simulation_.set_command(Command::GateWedge, enabled);
  }
}

godot::Dictionary SimulationBridge::snapshot() const {
  const auto& state = simulation_.state();
  godot::Dictionary out;
  out["authority_tick"] = static_cast<std::int64_t>(
      state.authority_tick);
  out["carrier_height_m"] = state.freight.height_m;
  out["carrier_lateral_m"] = state.freight.lateral_m;
  out["carrier_vy"] = state.freight.vertical_velocity_mps;
  out["carrier_vx"] = state.freight.lateral_velocity_mps;
  out["payload_kg"] = state.freight.payload_kg;
  out["cable_tension_n"] = state.freight.cable_tension_n;
  out["brake_temperature_k"] =
      state.freight.brake_temperature_k;
  out["brake_engaged"] = state.freight.brake_engaged;
  out["frame_deflection_m"] = state.frame.deflection_m;
  out["frame_twist_rad"] = state.frame.twist_rad;
  out["frame_plastic_set_m"] = state.frame.plastic_set_m;
  out["frame_damage"] = state.frame.damage;
  out["brace_connected"] = state.frame.brace_connected;
  out["gate_angle_rad"] = state.gate.angle_rad;
  out["gate_pressure_pa"] = state.gate.pressure_pa;
  out["gate_inventory_kg"] = state.gate.inventory_kg;
  out["gate_misalignment_m"] = state.gate.seal_misalignment_m;
  out["gate_wedged"] = state.gate.wedged;
  out["gate_jam"] = simulation_.gate_jam_multiplier();
  out["gallery_passable"] = simulation_.gallery_passable();
  out["neck_walk_clear"] = simulation_.neck_walk_clear();
  out["carrier_at_recv"] = simulation_.carrier_at_recv();
  out["finite"] = simulation_.finite();
  return out;
}

}  // namespace gravespire
