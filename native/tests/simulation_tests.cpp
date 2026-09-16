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
  require(std::abs(loaded.state().frame.deflection_m) < 0.35,
          "inhabited bay deflections must stay in structural scale");

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

  Simulation jammed;
  jammed.set_command(Command::GateOpen, true);
  run_ticks(jammed, 240);
  jammed.set_command(Command::GateOpen, false);
  require(jammed.state().gate.angle_rad < 0.12,
          "pressurized isolation gate must refuse a direct open");
  require(!jammed.gallery_passable(),
          "closed pressurized gate must not evaluate as a walkable gallery");

  Simulation chain;
  chain.set_command(Command::CarrierRight, true);
  run_ticks(chain, 80);
  chain.set_command(Command::CarrierRight, false);
  chain.set_command(Command::GateVent, true);
  chain.set_command(Command::FrameJack, true);
  chain.set_command(Command::FrameBrace, true);
  run_ticks(chain, 720);
  chain.set_command(Command::GateVent, false);
  chain.set_command(Command::FrameJack, false);
  chain.set_command(Command::GateOpen, true);
  run_ticks(chain, 240);
  require(chain.state().gate.pressure_pa < 80000.0,
          "venting must drop gate pressure before the leaf can rotate");
  require(chain.state().gate.angle_rad > 0.95,
          "vent + jack/brace must let finite gate torque open the leaf");
  require(chain.gallery_passable(),
          "opened gate must make the east gallery physically passable");
  require(chain.neck_walk_clear(),
          "brace or reduced misalignment must clear the neck walk");
  require(chain.finite(), "causal chain must remain finite");

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
  require(std::abs(yielded.state().frame.deflection_m) < 0.8,
          "plastic set must not run away into uninhabitable geometry");

  Simulation dock;
  dock.set_command(Command::CarrierBrake, true);
  dock.set_command(Command::CarrierBrake, false);
  dock.set_command(Command::CarrierRight, true);
  run_ticks(dock, 360);
  dock.set_command(Command::CarrierRight, false);
  dock.set_command(Command::CarrierBrake, true);
  dock.set_command(Command::CarrierBrake, false);
  require(dock.state().freight.lateral_m > 4.4,
          "sustained traverse must reach the receiving envelope");
  require(dock.carrier_at_recv(),
          "recv dock is a physical envelope of height and lateral state");

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

  const double h_rated = Simulation{}.state().freight.height_m;
  const double L_rated = Simulation{}.state().freight.cable_unstretched_m;

  Simulation hold;
  run_ticks(hold, 60);
  const double h_settled = hold.state().freight.height_m;
  require(!hold.brake_slipping(),
          "rated payload must remain inside brake holding capacity after settle");
  require(hold.state().freight.cable_tension_n > 1.0e4,
          "suspended rated payload must keep the cable in tension");
  require(hold.brake_hold_capacity_n() > hold.state().freight.cable_tension_n,
          "hold capacity at ~293 K must exceed rated hanging tension");
  run_ticks(hold, 120);
  require(std::abs(hold.state().freight.height_m - h_settled) < 0.03,
          "engaged hoist brake must hold rated payload; carrier may follow frame set");
  require(hold.state().freight.height_m > 1.85 &&
              hold.state().freight.height_m < 3.15,
          "held rated hang must remain inside the recv height envelope");
  require(!hold.brake_slipping(), "holding brake must not creep-slip at rated load");

  Simulation locked;
  locked.set_command(Command::CarrierRaise, true);
  run_ticks(locked, 90);
  require(std::abs(locked.state().freight.cable_unstretched_m - L_rated) < 0.01,
          "raise must not pay the winch in while the hoist brake is holding");

  Simulation hoist;
  hoist.set_command(Command::CarrierBrake, true);
  hoist.set_command(Command::CarrierRaise, true);
  run_ticks(hoist, 90);
  require(hoist.state().freight.cable_unstretched_m < L_rated - 0.2,
          "released brake must let raise shorten unstretched length");
  require(hoist.state().freight.height_m > h_rated + 0.08,
          "shortening the cable must lift the carrier; payout is not teleport");

  Simulation payout;
  const double L_pay0 = payout.state().freight.cable_unstretched_m;
  const double h_pay0 = payout.state().freight.height_m;
  payout.set_command(Command::CarrierBrake, true);
  payout.set_command(Command::CarrierLower, true);
  payout.advance_authority_tick();
  const double dL =
      payout.state().freight.cable_unstretched_m - L_pay0;
  const double dh =
      std::abs(payout.state().freight.height_m - h_pay0);
  require(dL > 0.002, "lower must increase unstretched length");
  require(dh < 0.6 * dL,
          "winch payout must not teleport the load in the same step");

  Simulation slack;
  slack.set_command(Command::CarrierBrake, true);
  slack.set_command(Command::CarrierLower, true);
  run_ticks(slack, 480);
  require(slack.state().freight.cable_tension_n < 50.0,
          "paid-out slack cable must go slack (tension-only, no push)");
  require(slack.state().freight.height_m < 0.6,
          "slack carrier must fall to the lower stop");
  require(slack.cable_extension_m() < 0.0,
          "geometry shorter than unstretched length is slack, not compression");

  Simulation slip;
  slip.set_payload_kg(18000.0);
  run_ticks(slip, 12);
  require(slip.brake_slipping(),
          "overload above rated holding capacity must slip the hoist brake");
  require(slip.state().freight.height_m < h_rated - 0.04,
          "brake slip must pay out and lower the load");
  require(slip.state().freight.brake_temperature_k > 293.4,
          "frictional slip work must heat the brake");
  require(slip.state().freight.cable_unstretched_m > L_rated + 0.02,
          "slip increases unstretched length; it does not teleport height");

  Simulation competence;
  require(!competence.act1_local_competence(),
          "cold bay is not local competence");
  competence.set_command(Command::CarrierRight, true);
  run_ticks(competence, 80);
  competence.set_command(Command::CarrierRight, false);
  competence.set_command(Command::GateVent, true);
  competence.set_command(Command::FrameJack, true);
  competence.set_command(Command::FrameBrace, true);
  run_ticks(competence, 720);
  competence.set_command(Command::GateVent, false);
  competence.set_command(Command::FrameJack, false);
  competence.set_command(Command::GateOpen, true);
  run_ticks(competence, 240);
  require(competence.act1_shop_open(),
          "vent+jack+brace+open is the shop route, derived from geometry");
  competence.set_command(Command::CarrierRight, true);
  run_ticks(competence, 280);
  competence.set_command(Command::CarrierRight, false);
  require(competence.carrier_at_recv(),
          "traverse after the shop route still reaches the recv envelope");
  require(competence.act1_local_competence(),
          "local competence is recv envelope plus a physically open shop route");
  require(competence.finite(), "competence sequence must remain finite");

  std::cout << "PASS: coupled freight/frame/gate reference cases\n";
  return EXIT_SUCCESS;
}
