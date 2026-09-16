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
};

struct FreightState {
  double height_m{2.2};
  double lateral_m{-1.8};
  double vertical_velocity_mps{0.0};
  double lateral_velocity_mps{0.0};
  double payload_kg{8200.0};
  double cable_tension_n{0.0};
  double brake_temperature_k{293.15};
  bool brake_engaged{true};
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

struct WorldState {
  FreightState freight{};
  FrameState frame{};
  GateState gate{};
  std::uint64_t authority_tick{0};
  std::uint64_t mechanics_step{0};
};

class Simulation final {
 public:
  static constexpr double kAuthorityDt = 1.0 / 30.0;
  static constexpr double kMechanicsDt = 1.0 / 120.0;
  static constexpr int kSubsteps = 4;

  Simulation() = default;

  void set_command(Command command, bool active);
  void advance_authority_tick();
  [[nodiscard]] const WorldState& state() const noexcept;
  [[nodiscard]] bool finite() const noexcept;

  // Derived from committed physical state — not independent flags.
  [[nodiscard]] bool gallery_passable() const noexcept;
  [[nodiscard]] bool neck_walk_clear() const noexcept;
  [[nodiscard]] bool carrier_at_recv() const noexcept;
  [[nodiscard]] double gate_jam_multiplier() const noexcept;

 private:
  void step_mechanics(double dt);
  [[nodiscard]] bool active(Command command) const;

  WorldState state_{};
  std::array<bool, 12> commands_{};
};

}  // namespace gravespire
