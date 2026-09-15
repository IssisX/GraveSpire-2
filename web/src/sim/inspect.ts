import { DISTRICT_META, districtAt, type DistrictId, type InspectReading, type WorldState } from "./types.ts";
import { gallerySag, liveGalleryCount } from "./missions.ts";

function n(v: number, digits = 1): string {
  return v.toFixed(digits);
}

export function inspectTarget(state: WorldState, id: string): InspectReading | null {
  const f = state.freight;
  const fr = state.frame;
  const g = state.gate;
  switch (id) {
    case "carrier":
      return {
        id,
        title: "Carrier 07-A",
        district: "FS07",
        lines: [
          { label: "Height", value: n(f.height_m, 2), unit: "m", source: "measured", confidence: 0.97 },
          { label: "Traverse", value: n(f.lateral_m, 2), unit: "m", source: "measured", confidence: 0.97 },
          { label: "Payload", value: n(f.payload_kg, 0), unit: "kg", source: "estimated", confidence: 0.72 },
          { label: "Hoist payout", value: n(f.payout_m, 2), unit: "m", source: "measured", confidence: 0.95 },
          { label: "Brake", value: f.brake_engaged ? "holding" : "released", unit: "", source: "measured", confidence: 0.99 },
          { label: "Brake temp", value: n(f.brake_temperature_k, 1), unit: "K", source: "measured", confidence: 0.88 },
          { label: "Load swing", value: n((f.payload_swing_rad * 180) / Math.PI, 2), unit: "deg", source: "estimated", confidence: 0.6 },
          { label: "Hoist current", value: n(f.hoist_current_a, 0), unit: "A", source: "measured", confidence: 0.9 },
        ],
        warning:
          f.brake_temperature_k > 420
            ? "Brake is cooking. Frictional work is heat."
            : !f.brake_engaged && f.hoist_current_a > 60
              ? "The drive is holding this load electrically. That current is on the process bus for as long as the brake is off."
              : Math.abs(f.payload_swing_rad) > 0.06
                ? "The load is swinging. That offset is moving, and the transfer frame feels every degree of it."
                : undefined,
      };
    case "cable":
      return {
        id,
        title: "Hoist rope 07-A",
        district: "FS07",
        lines: [
          { label: "Tension", value: n(f.cable_tension_n / 1000, 1), unit: "kN", source: "estimated", confidence: 0.64 },
          { label: "Payout", value: n(f.payout_m, 2), unit: "m", source: "measured", confidence: 0.95 },
          { label: "Regime", value: f.cable_tension_n > 50 ? "tension" : "slack", unit: "", source: "estimated", confidence: 0.8 },
        ],
        warning: "Tension is an estimate from payload, geometry, and winch current. Not a load cell.",
      };
    case "frame":
      return {
        id,
        title: "Load-transfer frame",
        district: "FS08",
        lines: [
          { label: "Deflection", value: n(fr.deflection_m * 1000, 1), unit: "mm", source: "estimated", confidence: 0.7 },
          { label: "Twist", value: n((fr.twist_rad * 180) / Math.PI, 2), unit: "deg", source: "estimated", confidence: 0.68 },
          { label: "Plastic set", value: n(fr.plastic_set_m * 1000, 1), unit: "mm", source: "estimated", confidence: 0.62 },
          { label: "Brace", value: fr.brace_connected ? "in path" : "open", unit: "", source: "measured", confidence: 0.99 },
        ],
        warning:
          fr.plastic_set_m > 0.0005
            ? "Unloading will not erase this set. Repair is a different job."
            : "This is not a health bar. Set, slip, and elastic bend are different states.",
      };
    case "gate":
      return {
        id,
        title: "Isolation gate G-07",
        district: "FS07",
        lines: [
          { label: "Angle", value: n((g.angle_rad * 180) / Math.PI, 1), unit: "deg", source: "measured", confidence: 0.96 },
          { label: "Pressure", value: n(g.pressure_pa / 1000, 0), unit: "kPa", source: "measured", confidence: 0.93 },
          { label: "Inventory", value: n(g.inventory_kg, 0), unit: "kg", source: "estimated", confidence: 0.71 },
          { label: "Seal misalign", value: n(g.seal_misalignment_m * 1000, 1), unit: "mm", source: "estimated", confidence: 0.66 },
          { label: "Wedge", value: g.wedged ? "in" : "out", unit: "", source: "measured", confidence: 0.99 },
        ],
        warning:
          Math.abs(g.seal_misalignment_m) > 0.02
            ? "Frame twist is jamming the seal. This is not a door with a longer timer."
            : g.pressure_pa > 200000
              ? "Pressure on the leaf is generating real torque. Vent or isolate before you fight it."
              : undefined,
      };
    case "drive":
      return {
        id,
        title: "Transfer drive housing",
        district: "FS08",
        lines: [
          { label: "Present", value: state.flags.drive_present ? "mounted" : "gone", unit: "", source: "measured", confidence: 1 },
          { label: "Feed", value: state.electrical.drive_powered ? "live" : "dead island", unit: "", source: "measured", confidence: 0.9 },
          { label: "Alignment", value: n(Math.abs(g.seal_misalignment_m) * 1000, 1), unit: "mm", source: "estimated", confidence: 0.6 },
          {
            label: "Function",
            value: state.flags.drive_present && Math.abs(g.seal_misalignment_m) < 0.03 ? "serviceable" : "not a pull",
            unit: "",
            source: "estimated",
            confidence: 0.55,
          },
        ],
        warning: state.flags.drive_present
          ? "Removing it changes freight capacity and the hab feed that runs through this cabinet."
          : undefined,
      };
    case "board":
    case "brk_gen":
    case "brk_drive":
    case "brk_shop":
    case "brk_west":
    case "brk_hab":
    case "brk_gate": {
      const gen = state.electrical.breakers.find((b) => b.id === "brk_gen");
      const genOver = Boolean(gen && gen.closed && !gen.tripped && gen.load_a > gen.rating_a);
      const lines = state.electrical.breakers.map((b) => ({
        label: b.name,
        value: b.tripped
          ? "TRIPPED"
          : b.closed
            ? `closed ${n(b.load_a, 0)}/${n(b.rating_a, 0)}`
            : "open",
        unit: b.closed && !b.tripped ? "A" : "",
        source: "measured" as const,
        confidence: 0.95,
      }));
      return {
        id: "board",
        title: "Distribution — Circ Shop / process",
        district: id === "board" ? "SHA" : "FS08",
        lines: [
          ...lines,
          {
            label: "Shop bus",
            value: n(state.electrical.voltage_shop, 0),
            unit: "V",
            source: "measured",
            confidence: 0.94,
          },
          {
            label: "West reroute",
            value: state.electrical.chen_rerouted ? "in" : "not made",
            unit: "",
            source: "measured",
            confidence: 1,
          },
          {
            label: "Process demand",
            value: `${n(state.electrical.process_load_a, 0)} / ${n(gen?.rating_a ?? 400, 0)}`,
            unit: "A",
            source: "measured",
            confidence: 0.92,
          },
          {
            label: "Gen thermal",
            value: `${n((gen?.thermal ?? 0) * 100, 0)}`,
            unit: "%",
            source: "estimated",
            confidence: 0.7,
          },
        ],
        warning: genOver
          ? "Process generator breaker is over rating. Thermal memory is running. Shed a feeder or the island goes dark."
          : "Disconnected islands are explicit. There is no numerical leakage keeping a dark shop faintly on.",
      };
    }
    case "dock":
      return {
        id,
        title: "Neck receiving deck",
        district: "FS08",
        lines: [
          { label: "Payload on deck", value: state.flags.payload_on_neck ? "yes" : "no", unit: "", source: "measured", confidence: 0.9 },
          { label: "Brake", value: f.brake_engaged ? "holding" : "released", unit: "", source: "measured", confidence: 0.99 },
          { label: "Alignment", value: n(Math.abs(g.seal_misalignment_m) * 1000, 1), unit: "mm", source: "estimated", confidence: 0.66 },
        ],
      };
    case "save_bench":
      return {
        id,
        title: "Circ Shop bench",
        district: "SHA",
        lines: [
          { label: "Power", value: state.electrical.shop_powered ? "live island" : "dead", unit: "", source: "measured", confidence: 0.95 },
          { label: "Save", value: state.flags.save_used ? "written here" : "available if powered", unit: "", source: "measured", confidence: 1 },
        ],
      };
    default: {
      const body = state.bodies.find((x) => x.id === id);
      if (body) {
        const weightN = body.mass_kg * 9.80665;
        const speed = Math.hypot(body.vx, body.vy, body.vz);
        return {
          id,
          title: body.name,
          district: districtAt(body.px, body.pz),
          lines: [
            { label: "Mass", value: n(body.mass_kg, 0), unit: "kg", source: "measured", confidence: 0.98 },
            { label: "Weight", value: n(weightN / 1000, 2), unit: "kN", source: "measured", confidence: 0.98 },
            { label: "Material", value: body.material, unit: "", source: "measured", confidence: 1 },
            {
              label: "State",
              value: body.attached === "hook" ? "on the hook" : body.attached === "player" ? "in hand" : body.sleeping ? "at rest" : "moving",
              unit: "",
              source: "measured",
              confidence: 0.99,
            },
            { label: "Speed", value: n(speed, 2), unit: "m/s", source: "measured", confidence: 0.9 },
          ],
          warning:
            weightN > 900
              ? "Too heavy to lift or drag by hand. Rig it to the hook, or find it leverage."
              : weightN * 0.42 > 900
                ? "Too heavy to lift. It will drag."
                : "Light enough to carry.",
        };
      }
      const m = state.members.find((x) => x.id === id);
      if (m) {
        return {
          id,
          title: m.name,
          district: m.district,
          lines: [
            { label: "Axial", value: n(m.force_n / 1000, 1), unit: "kN", source: "estimated", confidence: 0.6 },
            { label: "My", value: n(m.moment_y_nm / 1000, 1), unit: "kN·m", source: "estimated", confidence: 0.55 },
            { label: "Mz", value: n(m.moment_z_nm / 1000, 1), unit: "kN·m", source: "estimated", confidence: 0.55 },
            { label: "Torsion", value: n(m.torsion_nm / 1000, 1), unit: "kN·m", source: "estimated", confidence: 0.5 },
            { label: "Sag", value: n(m.sag_m * 1000, 1), unit: "mm", source: "estimated", confidence: 0.62 },
            { label: "Plastic set", value: n(m.plastic_set_m * 1000, 1), unit: "mm", source: "estimated", confidence: 0.58 },
            { label: "State", value: m.cut ? "cut" : m.braced ? "braced" : m.jacked ? "jacked" : "in path", unit: "", source: "measured", confidence: 0.99 },
          ],
          warning: m.cut
            ? `Live gallery spans: ${liveGalleryCount(state)}. Sag ${n(gallerySag(state) * 1000, 0)} mm.`
            : "Cutting a loaded span redistributes demand. It does not delete the floor's job.",
        };
      }
      return {
        id,
        title: id,
        district: "SYS",
        lines: [{ label: "Note", value: "No authority object", unit: "", source: "estimated", confidence: 0.2 }],
      };
    }
  }
}

export function locationLabel(district: DistrictId): string {
  return DISTRICT_META[district].name;
}
