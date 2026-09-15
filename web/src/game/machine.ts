/**
 * Machine interaction modes.
 *
 * A freight carrier genuinely needs more verbs than a door. Those verbs live
 * here, and they exist on screen only while the player is deliberately
 * operating that machine. Leaving the mode returns the player to the sparse
 * traversal controls.
 *
 * Every control in this file maps onto a real authority command or action.
 * Nothing here bypasses motor capacity, braking, pressure, or structural
 * consequence: the buttons request, the simulation decides.
 */

import type { Act, Command, WorldState } from "@/sim/types.ts";

export type MachineKind = "carrier" | "gate" | "frame";

export interface MachineControl {
  id: string;
  label: string;
  /** hold = command true while pressed; toggle/pulse = one committed edge. */
  mode: "hold" | "toggle" | "pulse";
  command?: Command;
  act?: Act;
  /** For latching controls: the action that puts the device back to off. */
  offAct?: Act;
  /** Keyboard binding accepted and displayed while this mode is open. */
  key: string;
  keyLabel: string;
  /** Returns a reason string when the machine currently refuses this control. */
  refuse?: (s: WorldState) => string | null;
  /** Rendered as engaged when true. */
  engaged?: (s: WorldState) => boolean;
}

export interface Readout {
  label: string;
  value: string;
  /** Marks a reading that is a safety-relevant exception right now. */
  alert?: boolean;
}

export interface MachineDef {
  kind: MachineKind;
  title: string;
  subtitle: string;
  controls: MachineControl[];
  readouts: (s: WorldState) => Readout[];
}

function n(v: number, d = 1): string {
  return v.toFixed(d);
}

export const MACHINES: Record<MachineKind, MachineDef> = {
  carrier: {
    kind: "carrier",
    title: "Carrier 07-A",
    subtitle: "Hoist · traverse · brake",
    controls: [
      {
        id: "raise",
        label: "Raise",
        mode: "hold",
        command: "CarrierRaise",
        key: "KeyR",
        keyLabel: "R",
        refuse: (s) =>
          s.freight.brake_engaged ? "Brake is holding the drum. Release it to move the load." : null,
      },
      {
        id: "lower",
        label: "Lower",
        mode: "hold",
        command: "CarrierLower",
        key: "KeyF",
        keyLabel: "F",
        refuse: (s) =>
          s.freight.brake_engaged ? "Brake is holding the drum. Release it to move the load." : null,
      },
      { id: "west", label: "Traverse ←", mode: "hold", command: "CarrierLeft", key: "KeyZ", keyLabel: "Z" },
      { id: "east", label: "Traverse →", mode: "hold", command: "CarrierRight", key: "KeyX", keyLabel: "X" },
      {
        id: "brake",
        label: "Brake",
        mode: "toggle",
        command: "CarrierBrake",
        key: "KeyB",
        keyLabel: "B",
        engaged: (s) => s.freight.brake_engaged,
      },
      {
        id: "release",
        label: "Release load",
        mode: "pulse",
        act: { type: "carrier_release" },
        key: "KeyV",
        keyLabel: "V",
        refuse: (s) => (s.freight.payload_released ? "Load is already off the hook." : null),
      },
    ],
    readouts: (s) => [
      { label: "Hoist height", value: `${n(s.freight.height_m, 2)} m` },
      { label: "Traverse", value: `${n(s.freight.lateral_m, 2)} m` },
      { label: "Rope tension", value: `${n(s.freight.cable_tension_n / 1000, 1)} kN` },
      {
        label: "Brake",
        value: s.freight.brake_engaged ? `holding · ${n(s.freight.brake_temperature_k, 0)} K` : "released",
        alert: s.freight.brake_temperature_k > 420,
      },
      {
        label: "Load swing",
        value: `${n((s.freight.payload_swing_rad * 180) / Math.PI, 1)}°`,
        alert: Math.abs(s.freight.payload_swing_rad) > 0.06,
      },
      {
        label: "Supply",
        value: s.electrical.carrier_powered ? `${n(s.electrical.voltage_process, 0)} V` : "dead bus",
        alert: !s.electrical.carrier_powered,
      },
    ],
  },

  gate: {
    kind: "gate",
    title: "Isolation gate G-07",
    subtitle: "Open · close · vent",
    controls: [
      {
        id: "open",
        label: "Open",
        mode: "hold",
        command: "GateOpen",
        key: "KeyG",
        keyLabel: "G",
        refuse: (s) =>
          s.gate.wedged
            ? "Wedge is in. Pull it before driving the leaf."
            : !s.electrical.gate_powered
              ? "Gate motor feed is open. No torque available."
              : null,
      },
      {
        id: "close",
        label: "Close",
        mode: "hold",
        command: "GateClose",
        key: "KeyT",
        keyLabel: "T",
        refuse: (s) => (s.gate.wedged ? "Wedge is in." : !s.electrical.gate_powered ? "No motor feed." : null),
      },
      {
        // A vent valve is a latched position, not a button someone leans on.
        // It keeps discharging after the operator walks away.
        id: "vent",
        label: "Vent valve",
        mode: "toggle",
        command: "GateVent",
        offAct: { type: "vent_close" },
        key: "KeyV",
        keyLabel: "V",
        engaged: (s) => s.gate.vent_open,
        refuse: (s) => (s.gate.inventory_kg <= 0.5 && !s.gate.vent_open ? "Vessel is empty." : null),
      },
      {
        id: "wedge",
        label: "Wedge",
        mode: "toggle",
        command: "GateWedge",
        key: "KeyB",
        keyLabel: "B",
        engaged: (s) => s.gate.wedged,
      },
    ],
    readouts: (s) => [
      { label: "Leaf angle", value: `${n((s.gate.angle_rad * 180) / Math.PI, 1)}°` },
      {
        label: "Pressure",
        value: `${n(s.gate.pressure_pa / 1000, 0)} kPa`,
        alert: s.gate.pressure_pa > 200000,
      },
      { label: "Inventory", value: `${n(s.gate.inventory_kg, 0)} kg` },
      { label: "Vent valve", value: s.gate.vent_open ? "OPEN · discharging" : "shut", alert: s.gate.vent_open },
      {
        label: "Seal misalign",
        value: `${n(s.gate.seal_misalignment_m * 1000, 1)} mm`,
        alert: Math.abs(s.gate.seal_misalignment_m) > 0.02,
      },
      {
        label: "Motor feed",
        value: s.electrical.gate_powered ? "live" : "open",
        alert: !s.electrical.gate_powered,
      },
    ],
  },

  frame: {
    kind: "frame",
    title: "Load-transfer frame",
    subtitle: "Jack · brace · release",
    controls: [
      { id: "jack", label: "Jack", mode: "hold", command: "FrameJack", key: "KeyR", keyLabel: "R" },
      {
        id: "brace",
        label: "Connect brace",
        mode: "pulse",
        command: "FrameBrace",
        key: "KeyB",
        keyLabel: "B",
        refuse: (s) => (s.frame.brace_connected ? "Brace is already in the load path." : null),
        engaged: (s) => s.frame.brace_connected,
      },
      {
        id: "cut",
        label: "Cut brace",
        mode: "pulse",
        command: "FrameCutBrace",
        key: "KeyT",
        keyLabel: "T",
        refuse: (s) => (s.frame.brace_connected ? null : "No brace in the path."),
      },
    ],
    readouts: (s) => [
      { label: "Deflection", value: `${n(s.frame.deflection_m * 1000, 1)} mm` },
      { label: "Twist", value: `${n((s.frame.twist_rad * 180) / Math.PI, 2)}°` },
      {
        label: "Permanent set",
        value: `${n(s.frame.plastic_set_m * 1000, 1)} mm`,
        alert: s.frame.plastic_set_m > 0.0005,
      },
      { label: "Brace", value: s.frame.brace_connected ? "in path" : "open" },
      {
        label: "Gate seal",
        value: `${n(s.gate.seal_misalignment_m * 1000, 1)} mm`,
        alert: Math.abs(s.gate.seal_misalignment_m) > 0.02,
      },
    ],
  },
};

export interface MachineSession {
  kind: MachineKind;
  /** Interactable id of the station the player is standing at. */
  stationId: string;
  /** Held control ids this frame. */
  held: Set<string>;
}

/**
 * Owns which machine is being operated and which of its hold-controls are
 * currently pressed. Commands are pushed to the simulation once per frame so a
 * stale hold can never survive leaving the mode.
 */
export class MachineOperator {
  private session: MachineSession | null = null;
  private applied = new Map<Command, boolean>();

  get active(): MachineSession | null {
    return this.session;
  }

  get def(): MachineDef | null {
    return this.session ? MACHINES[this.session.kind] : null;
  }

  enter(kind: MachineKind, stationId: string): void {
    this.session = { kind, stationId, held: new Set() };
  }

  exit(): void {
    if (this.session) this.session.held.clear();
    this.session = null;
  }

  setHold(controlId: string, on: boolean): void {
    if (!this.session) return;
    if (on) this.session.held.add(controlId);
    else this.session.held.delete(controlId);
  }

  clearHolds(): void {
    this.session?.held.clear();
  }

  isHeld(controlId: string): boolean {
    return this.session?.held.has(controlId) ?? false;
  }

  /**
   * Push hold-control state into the simulation. Called every frame, including
   * frames with no session, so exiting a mode always releases every command.
   */
  applyHolds(
    state: WorldState,
    setCommand: (c: Command, on: boolean) => void,
  ): void {
    const wanted = new Map<Command, boolean>();
    const def = this.def;
    if (def && this.session) {
      for (const c of def.controls) {
        if (c.mode !== "hold" || !c.command) continue;
        const refused = c.refuse?.(state) ?? null;
        wanted.set(c.command, this.session.held.has(c.id) && !refused);
      }
    }
    // Any command previously driven by a mode that is no longer wanted goes false.
    for (const [cmd, was] of this.applied) {
      if (!wanted.has(cmd) && was) setCommand(cmd, false);
    }
    for (const [cmd, on] of wanted) {
      if (this.applied.get(cmd) !== on) setCommand(cmd, on);
    }
    this.applied = wanted;
  }
}
