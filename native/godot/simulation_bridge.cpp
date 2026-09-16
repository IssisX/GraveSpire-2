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
  static const godot::StringName spire_lift_up("spire_lift_up");
  static const godot::StringName spire_lift_down("spire_lift_down");
  static const godot::StringName sky_ballast_left("sky_ballast_left");
  static const godot::StringName sky_ballast_right("sky_ballast_right");
  static const godot::StringName sky_car_brake("sky_car_brake");
  static const godot::StringName wind_car_brake("wind_car_brake");

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
  } else if (action == spire_lift_up) {
    simulation_.set_command(Command::SpireLiftUp, enabled);
  } else if (action == spire_lift_down) {
    simulation_.set_command(Command::SpireLiftDown, enabled);
  } else if (action == sky_ballast_left) {
    simulation_.set_command(Command::SkyBallastLeft, enabled);
  } else if (action == sky_ballast_right) {
    simulation_.set_command(Command::SkyBallastRight, enabled);
  } else if (action == sky_car_brake) {
    simulation_.set_command(Command::SkyCarBrake, enabled);
  } else if (action == wind_car_brake) {
    simulation_.set_command(Command::WindCarBrake, enabled);
  }
}

godot::Dictionary SimulationBridge::snapshot() const {
  const auto& state = simulation_.state();
  godot::Dictionary out;
  out["authority_tick"] = static_cast<std::int64_t>(state.authority_tick);
  out["carrier_height_m"] = state.freight.height_m;
  out["carrier_lateral_m"] = state.freight.lateral_m;
  out["carrier_vy"] = state.freight.vertical_velocity_mps;
  out["carrier_vx"] = state.freight.lateral_velocity_mps;
  out["payload_kg"] = state.freight.payload_kg;
  out["cable_tension_n"] = state.freight.cable_tension_n;
  out["brake_temperature_k"] = state.freight.brake_temperature_k;
  out["brake_engaged"] = state.freight.brake_engaged;
  out["brake_slipping"] = simulation_.brake_slipping();
  out["brake_hold_n"] = simulation_.brake_hold_capacity_n();
  out["cable_unstretched_m"] = state.freight.cable_unstretched_m;
  out["cable_extension_m"] = simulation_.cable_extension_m();
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
  out["act1_shop_open"] = simulation_.act1_shop_open();
  out["act1_local_competence"] = simulation_.act1_local_competence();

  out["spire_lift_q_m"] = state.spire.lift_q_m;
  out["spire_lift_v_mps"] = state.spire.lift_velocity_mps;
  out["spire_lift_brake_engaged"] = state.spire.lift_brake_engaged;
  out["spire_lift_brake_slipping"] = state.spire.lift_brake_slipping;
  out["spire_bridge_latch_m"] = state.spire.bridge_latch_m;
  out["spire_bridge_angle_rad"] = state.spire.bridge_angle_rad;
  out["spire_bridge_omega_radps"] = state.spire.bridge_angular_velocity_radps;
  out["spire_bridge_walkable"] = simulation_.spire_bridge_walkable();
  out["spire_sky_ballast_x_m"] = state.spire.sky_ballast_x_m;
  out["spire_sky_ballast_loaded"] = simulation_.spire_sky_ballast_loaded();
  out["spire_sky_car_q_m"] = state.spire.sky_car_q_m;
  out["spire_sky_car_v_mps"] = state.spire.sky_car_velocity_mps;
  out["spire_sky_car_brake_engaged"] = state.spire.sky_car_brake_engaged;
  out["spire_sky_car_brake_slipping"] = state.spire.sky_car_brake_slipping;
  out["spire_wind_latch_m"] = state.spire.wind_latch_m;
  out["spire_wind_unlocked"] = simulation_.spire_wind_unlocked();
  out["spire_wind_car_q_m"] = state.spire.wind_car_q_m;
  out["spire_wind_car_v_mps"] = state.spire.wind_car_velocity_mps;
  out["spire_wind_car_brake_engaged"] = state.spire.wind_car_brake_engaged;
  out["spire_wind_car_brake_slipping"] = state.spire.wind_car_brake_slipping;

  out["finite"] = simulation_.finite();
  return out;
}

}  // namespace gravespire
