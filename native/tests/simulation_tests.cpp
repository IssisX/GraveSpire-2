#include "gravespire/simulation.hpp"

#include <cmath>
#include <cstdlib>
#include <iostream>

namespace {

using gravespire::Command;
using gravespire::Simulation;

void require(bool condition, const char* message) {
  if (!condition) {
    std::cerr << "FAIL: " << message << '\n';
    std::exit(EXIT_FAILURE);
  }
}

void run_ticks(Simulation& simulation, int count) {
  for (int i = 0; i < count; ++i) {
    simulation.advance_authority_tick();
  }
}

}  // namespace

int main() {
  Simulation loaded;
  loaded.set_command(Command::CarrierRight, true);
  run_ticks(loaded, 90);
  loaded.set_command(Command::CarrierRight, false);
  require(loaded.state().frame.twist_rad > 0.0,
          "off-axis freight load must twist the transfer frame");
  require(std::abs(loaded.state().gate.seal_misalignment_m) > 0.001,
          "frame deformation must misalign the pressure gate");

  Simulation vented;
  Simulation pressurized;
  vented.set_command(Command::GateVent, true);
  run_ticks(vented, 180);
  run_ticks(pressurized, 180);
  vented.set_command(Command::GateVent, false);
  require(vented.state().gate.pressure_pa <
              pressurized.state().gate.pressure_pa,
          "venting must reduce authoritative pressure inventory");
  require(std::abs(vented.state().frame.deflection_m) <
              std::abs(pressurized.state().frame.deflection_m),
          "reduced gate pressure must unload the shared frame");

  Simulation yielded;
  yielded.set_command(Command::CarrierRight, true);
  yielded.set_command(Command::GateClose, true);
  run_ticks(yielded, 600);
  yielded.set_command(Command::CarrierRight, false);
  yielded.set_command(Command::GateClose, false);
  yielded.set_command(Command::GateVent, true);
  yielded.set_command(Command::FrameJack, true);
  run_ticks(yielded, 360);
  require(std::abs(yielded.state().frame.plastic_set_m) > 0.0001,
          "over-yield loading must preserve permanent set");
  require(yielded.state().frame.damage > 0.0,
          "damage history must be monotone after over-yield loading");
  require(yielded.finite(), "committed state must remain finite");

  Simulation a;
  Simulation b;
  a.set_command(Command::FrameBrace, true);
  b.set_command(Command::FrameBrace, true);
  run_ticks(a, 240);
  run_ticks(b, 240);
  require(a.state().mechanics_step == 4 * a.state().authority_tick,
          "authority tick must commit exactly four mechanics steps");
  require(a.state().frame.deflection_m == b.state().frame.deflection_m,
          "identical command streams must reproduce authoritative state");

  std::cout << "PASS: coupled freight/frame/gate reference cases\n";
  return EXIT_SUCCESS;
}
