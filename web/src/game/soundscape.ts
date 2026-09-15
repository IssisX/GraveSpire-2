import type { WorldState } from "@/sim/types.ts";
import type { GameAudio } from "./audio.ts";

/** Presentation only. Drives beds from authority; never writes sim. */
export function tickSoundscape(audio: GameAudio, state: WorldState, operating: boolean) {
  const f = state.freight;
  const moving =
    Math.abs(f.vertical_velocity_mps) + Math.abs(f.lateral_velocity_mps);
  const hoistOn = state.electrical.carrier_powered && (moving > 0.04 || operating);
  audio.setMotor(Math.min(1, moving / 2.2), hoistOn);

  const strain = Math.min(1, Math.abs(state.frame.twist_rad) / 0.04 + state.frame.deflection_m / 0.14);
  audio.setStrain(strain);

  const venting = state.gate.pressure_pa < 180000 || state.gate.inventory_kg < 250;
  audio.setSteam(venting ? Math.min(1, 0.25 + (420000 - state.gate.pressure_pa) / 420000) : 0);

  audio.setBuzz(state.electrical.voltage_process > 40 ? 0.35 : state.electrical.voltage_shop > 40 ? 0.18 : 0);

  const gateMove = Math.min(1, Math.abs(state.gate.angular_velocity_radps) / 0.35);
  audio.setGate(gateMove);

  const brake = f.brake_engaged ? (f.brake_temperature_k > 380 ? 0.7 : 0.22) : 0;
  audio.setBrake(brake);
}
