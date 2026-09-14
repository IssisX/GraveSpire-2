#pragma once

#include "gravespire/simulation.hpp"

#include <godot_cpp/classes/node.hpp>
#include <godot_cpp/variant/dictionary.hpp>
#include <godot_cpp/variant/string_name.hpp>

namespace gravespire {

class SimulationBridge final : public godot::Node {
  GDCLASS(SimulationBridge, godot::Node)

 public:
  void _physics_process(double delta) override;
  void set_action(const godot::StringName& action, bool active);
  [[nodiscard]] godot::Dictionary snapshot() const;

 protected:
  static void _bind_methods();

 private:
  Simulation simulation_{};
  double accumulator_{0.0};
};

}  // namespace gravespire

