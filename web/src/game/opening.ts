/**
 * Act I opening and in-play guidance.
 *
 * Bay 07 is the opening of the game, not a tutorial box. The sequence here
 * establishes who the player is, where they are, and what is already going
 * wrong — then hands over control. It does not gate anything: every line below
 * is derived from authoritative world state, and the player is free to ignore
 * all of it and work the bay in whatever order they like.
 */

import type { WorldState } from "@/sim/types.ts";
import { evaluateTraversal, inhabitantCanReachShop, shopStanding } from "@/sim/missions.ts";

export interface IntroBeat {
  kicker: string;
  text: string;
  seconds: number;
  /** Camera pose held during this beat. */
  from: [number, number, number];
  at: [number, number, number];
}

/**
 * Four beats, roughly sixteen seconds, skippable at any time. The bay is live
 * underneath: the carrier is already swinging its offset load while this plays.
 */
export const INTRO_BEATS: IntroBeat[] = [
  {
    kicker: "Freight Spine · Bay 07",
    text: "The bay still runs. Barely.",
    seconds: 3.6,
    from: [8.6, 7.9, 12.6],
    at: [22, 3.4, 0],
  },
  {
    kicker: "Reclamation",
    text: "You are a reclamation specialist. Carrier 07-A is holding eight tonnes over an open well, and the transfer frame it hands loads to is already bent.",
    seconds: 5.4,
    from: [13.4, 6.2, 9.4],
    at: [24, 2.6, 0],
  },
  {
    kicker: "East of the gate",
    text: "G-07 is pressed up and jamming. Past it, the Circ Shop has no power. Ilea's people work out of it anyway.",
    seconds: 4.8,
    from: [22.5, 4.4, 6.6],
    at: [40, 3.0, -1],
  },
  {
    kicker: "Start here",
    text: "Rami Okonkwo is on the pulpit. He knows the brake.",
    seconds: 3.2,
    from: [8.2, 2.9, -3.4],
    at: [4.8, 1.8, -7.2],
  },
];

/** Camera settle from the last intro pose into the player's own eye. */
export const INTRO_HANDOVER_S = 1.5;

export interface IntroFrame {
  beat: IntroBeat;
  index: number;
  /** 0..1 within the current beat. */
  local: number;
  /** True once the beats are done and the camera is settling into the player. */
  handover: number;
}

export function introAt(t: number): IntroFrame | null {
  let acc = 0;
  for (let i = 0; i < INTRO_BEATS.length; i++) {
    const beat = INTRO_BEATS[i]!;
    if (t < acc + beat.seconds) {
      return { beat, index: i, local: (t - acc) / beat.seconds, handover: 0 };
    }
    acc += beat.seconds;
  }
  const last = INTRO_BEATS[INTRO_BEATS.length - 1]!;
  const h = Math.min(1, (t - acc) / INTRO_HANDOVER_S);
  return h >= 1 ? null : { beat: last, index: INTRO_BEATS.length - 1, local: 1, handover: h };
}

export interface Guidance {
  id: string;
  line: string;
  detail: string;
}

/**
 * The single next thing worth doing, with the physical reason attached.
 *
 * This reads world state every time it is called. It is guidance, not a quest
 * step: nothing here is a trigger, and none of it changes what is possible.
 */
export function currentGuidance(state: WorldState, metRami: boolean): Guidance | null {
  const gen = state.electrical.breakers.find((b) => b.id === "brk_gen");
  const busTight = Boolean(gen && gen.closed && !gen.tripped && gen.load_a > gen.rating_a * 0.92);

  if (state.flags.act_ended) return null;

  if (!metRami && !state.flags.payload_on_neck) {
    return {
      id: "meet",
      line: "Find Rami on the carrier pulpit",
      detail: "He is standing at the console on the west side of the well.",
    };
  }

  if (!state.flags.payload_on_neck) {
    if (gen?.tripped) {
      return {
        id: "dock",
        line: "Restore the process island",
        detail: "The generator breaker tripped. Reset it at the process board, then shed a feeder before you hoist again.",
      };
    }
    if (Math.abs(state.gate.seal_misalignment_m) > 0.05) {
      return {
        id: "dock",
        line: "Put the live load on the transfer deck",
        detail:
          "G-07 is pressurised, and that pressure is twisting the transfer frame past the dock tolerance. Vent it and the frame comes back.",
      };
    }
    if (busTight) {
      return {
        id: "dock",
        line: "Put the live load on the transfer deck",
        detail: `Process bus is at ${gen!.load_a.toFixed(0)} A against ${gen!.rating_a.toFixed(0)} A. Holding this load off the brake will trip it. Shed a feeder first.`,
      };
    }
    return {
      id: "dock",
      line: "Put the live load on the transfer deck",
      detail: "Traverse east past the well, let the swing die, set the brake, then release.",
    };
  }

  const walk = evaluateTraversal(state);
  const walkOpen = walk.find((e) => e.id === "neck_main")?.valid ?? false;
  if (!walkOpen) {
    return {
      id: "walk",
      line: "Open the maintenance walk to the drive",
      detail: `The transfer deck is ${(Math.abs(state.gate.seal_misalignment_m) * 1000).toFixed(0)} mm out of alignment. Take load off it, connect the neck brace, or jack it — three different ways to change the load path.`,
    };
  }

  if (!shopStanding(state)) {
    if (!state.electrical.shop_powered) {
      return {
        id: "shop",
        line: "Stand up the Circ Shop",
        detail: state.electrical.chen_rerouted
          ? "The west bus is in. Close the shop breaker on it."
          : "The shop needs a live island. Chen will not parallel the cooking feed — isolate it, then he closes west.",
      };
    }
    if (!inhabitantCanReachShop(state)) {
      return {
        id: "shop",
        line: "Keep a route into the shop",
        detail: "It has power, but nobody who needs it can walk there. Ilea will not send anyone onto a sagging span.",
      };
    }
    return { id: "shop", line: "Write a snapshot at the shop bench", detail: "A live bench is where this Act saves." };
  }

  if (!state.flags.drive_recovered && !state.flags.drive_abandoned) {
    return {
      id: "drive",
      line: "Settle the transfer drive",
      detail: "Recover it intact, or take Skip's fast pull and accept what that costs the neck. Both are endings.",
    };
  }

  return { id: "end", line: "Close Act I when you are ready", detail: "Pause · Close Act I. The building stays as you left it." };
}

export interface WorldWarning {
  id: string;
  text: string;
  severity: "warn" | "critical";
}

/**
 * Exceptional conditions only.
 *
 * Ordinary telemetry belongs in inspection and in the machine panels. This is
 * the short list that is worth taking the player's eyes off the world for.
 */
export function activeWarnings(state: WorldState): WorldWarning[] {
  const out: WorldWarning[] = [];
  const gen = state.electrical.breakers.find((b) => b.id === "brk_gen");

  if (gen?.tripped) {
    out.push({ id: "gen_trip", text: "Process island dark — generator breaker tripped", severity: "critical" });
  } else if (gen && gen.closed && gen.thermal > 0.12) {
    out.push({
      id: "gen_thermal",
      text: `Process bus ${gen.load_a.toFixed(0)} A / ${gen.rating_a.toFixed(0)} A — tripping in ${Math.max(
        1,
        Math.round(((1 - gen.thermal) * 7.0) / Math.max(0.01, (gen.load_a / gen.rating_a) ** 2 - 1)),
      )} s`,
      severity: "critical",
    });
  } else if (gen && gen.closed && gen.load_a > gen.rating_a * 0.93) {
    out.push({
      id: "gen_near",
      text: `Process bus near rating — ${gen.load_a.toFixed(0)} A / ${gen.rating_a.toFixed(0)} A`,
      severity: "warn",
    });
  }

  if (state.freight.brake_temperature_k > 420) {
    out.push({
      id: "brake_hot",
      text: `Drum brake ${state.freight.brake_temperature_k.toFixed(0)} K — it is slipping`,
      severity: "critical",
    });
  }
  if (!state.freight.payload_released && Math.abs(state.freight.payload_swing_rad) > 0.08) {
    out.push({ id: "swing", text: "Load is swinging — the frame feels every degree", severity: "warn" });
  }
  if (state.frame.plastic_set_m > 0.004) {
    out.push({
      id: "set",
      text: `Transfer frame carries ${(state.frame.plastic_set_m * 1000).toFixed(1)} mm of permanent set`,
      severity: "warn",
    });
  }
  const liveSpans = state.members.filter((m) => m.role === "gallery_span" && !m.cut).length;
  if (liveSpans > 0 && liveSpans <= 2) {
    out.push({ id: "gallery", text: `Gallery 12 is down to ${liveSpans} live spans`, severity: "warn" });
  }
  if (state.gate.vent_open && state.gate.pressure_pa > 40000) {
    out.push({ id: "vent", text: "G-07 vent valve is open and discharging", severity: "warn" });
  }
  return out;
}
