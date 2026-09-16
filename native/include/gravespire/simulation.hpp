#pragma once

#include <array>
#include <cstdint>

namespace gravespire {

enum class Command : std::uint8_t {
  CarrierRaise,
  CarrierLower,
  CarrierLeft,
  CarrierRight,
  CarrierBrake,
  FrameJack,
  FrameBrace,
  FrameCutBrace,
  GateVent,
  GateOpen,
  GateClose,
  GateWedge,
  SpireLiftUp,
  SpireLiftDown,
  SkyBallastLeft,
  SkyBallastRight,
  SkyCarBrake,
  WindCarBrake,
  Count,
};

struct FreightState {
  double height_m{2.2};
  double lateral_m{-1.8};
  double vertical_velocity_mps{0.0};
  double lateral_velocity_mps{0.0};
  double payload_kg{8200.0};
  double cable_unstretched_m{3.907681};
  double cable_tension_n{0.0};
  double brake_temperature_k{293.15};
  bool brake_engaged{true};
  bool brake_slipping{false};
};

struct FrameState {
  double deflection_m{0.0};
  double twist_rad{0.0};
  double velocity_mps{0.0};
  double angular_velocity_radps{0.0};
  double plastic_set_m{0.0};
  double damage{0.0};
  double brace_stiffness_npm{0.0};
  bool brace_connected{false};
};

struct GateState {
  double angle_rad{0.0};
  double angular_velocity_radps{0.0};
  double pressure_pa{420000.0};
  double inventory_kg{310.0};
  double seal_misalignment_m{0.0};
  bool wedged{false};
};

struct SpireState {
  // Exterior traction hoist: a single reduced coordinate for car + counterweight.
  double lift_q_m{0.0};
  double lift_velocity_mps{0.0};
  double lift_brake_temperature_k{293.15};
  bool lift_brake_engaged{true};
  bool lift_brake_slipping{false};

  // Lift arrival physically retracts this over-centre bridge latch.
  double bridge_latch_m{0.0};
  double bridge_latch_velocity_mps{0.0};
  double bridge_angle_rad{1.28};
  double bridge_angular_velocity_radps{0.0};

  // A finite-speed ballast trolley changes the sky-car counterweight load.
  double sky_ballast_x_m{0.0};
  double sky_ballast_velocity_mps{0.0};
  double sky_car_q_m{0.0};
  double sky_car_velocity_mps{0.0};
  bool sky_car_brake_engaged{true};
  bool sky_car_brake_slipping{false};

  // Sky-car arrival clears the wind-hoist latch; wind then supplies finite work.
  double wind_latch_m{0.0};
  double wind_latch_velocity_mps{0.0};
  double wind_car_q_m{0.0};
  double wind_car_velocity_mps{0.0};
  bool wind_car_brake_engaged{true};
  bool wind_car_brake_slipping{false};
};

struct WorldState {
  FreightState freight{};
  FrameState frame{};
  GateState gate{};
  SpireState spire{};
  std::uint64_t authority_tick{0};
  std::uint64_t mechanics_step{0};
};

class Simulation final {
 public:
  static constexpr double kAuthorityDt = 1.0 / 30.0;
  static constexpr double kMechanicsDt = 1.0 / 120.0;
  static constexpr int kSubsteps = 4;
  static constexpr double kWinchDeckM = 6.15;
  static constexpr double kRatedPayloadKg = 8200.0;

  static constexpr double kSpireLiftTravelM = 60.0;
  static constexpr double kSkyCarTravelM = 70.0;
  static constexpr double kWindCarTravelM = 100.0;

  Simulation() = default;

  void set_command(Command command, bool active);
  void set_payload_kg(double payload_kg);
  void advance_authority_tick();
  [[nodiscard]] const WorldState& state() const noexcept;
  [[nodiscard]] bool finite() const noexcept;

  // Derived from committed physical state — not independent mission flags.
  [[nodiscard]] bool gallery_passable() const noexcept;
  [[nodiscard]] bool neck_walk_clear() const noexcept;
  [[nodiscard]] bool carrier_at_recv() const noexcept;
  [[nodiscard]] bool act1_shop_open() const noexcept;
  [[nodiscard]] bool act1_local_competence() const noexcept;
  [[nodiscard]] double gate_jam_multiplier() const noexcept;
  [[nodiscard]] double brake_hold_capacity_n() const noexcept;
  [[nodiscard]] double cable_geometry_m() const noexcept;
  [[nodiscard]] double cable_extension_m() const noexcept;
  [[nodiscard]] bool brake_slipping() const noexcept;

  [[nodiscard]] bool spire_bridge_walkable() const noexcept;
  [[nodiscard]] bool spire_sky_ballast_loaded() const noexcept;
  [[nodiscard]] bool spire_wind_unlocked() const noexcept;

 private:
  void step_mechanics(double dt);
  void step_spire(double dt);
  [[nodiscard]] bool active(Command command) const;

  WorldState state_{};
  std::array<bool, static_cast<std::size_t>(Command::Count)> commands_{};
};

}  // namespace gravespire
