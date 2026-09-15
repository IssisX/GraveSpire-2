import { overDock, slingCompatible } from "../sim/geometry.ts";
import type { Interactable } from "./level.ts";
import type { Collider } from "./collision.ts";
import type { WorldState } from "../sim/types.ts";
import { inspectTarget } from "../sim/inspect.ts";
import type { Simulation } from "../sim/simulation.ts";
import type { GameAudio } from "./audio.ts";
import { DIALOGUE } from "./dialogue.ts";

export type CtxCommit =
  | "talk"
  | "inspect"
  | "operate"
  | "toggle"
  | "bench"
  | "sling"
  | "sling2"
  | "cut"
  | "brace"
  | "jack"
  | "release"
  | "recover"
  | "vent"
  | "wedge"
  | "reroute"
  | "clear-sling"
  | "cascade-push-out"
  | "cascade-push-in"
  | "cascade-latch"
  | "exit-operate"
  | "jump"
  | "mantle";

export type CtxAction = {
  id: string;
  verb: string;
  noun: string;
  prompt: string;
  targetId: string;
  kind: Interactable["kind"];
  commit: CtxCommit;
  dist: number;
  priority: number;
};

export type LookInfo = {
  id: string;
  label: string;
  dist: number;
  kind: Interactable["kind"];
};

export type CtxFrame = {
  look: LookInfo | null;
  action: LookInfo | null;
  primary: CtxAction | null;
  secondary: CtxAction | null;
  choices: CtxAction[];
  mantle: boolean;
};

const LOOK_RANGE: Record<Interactable["kind"], number> = {
  machine: 18,
  npc: 7.5,
  member: 9,
  board: 7,
  bench: 7,
  world: 10,
};

const ACTION_RANGE: Record<string, number> = {
  npc: 2.7,
  board: 2.35,
  bench: 2.35,
  pendant: 2.55,
  gate: 3.2,
  frame: 3.4,
  neck_brace: 2.9,
  member: 2.7,
  drive: 2.55,
  dock: 3.1,
  cascade_ballast: 2.65,
  cascade_latch: 2.45,
  cascade_lever: 3.0,
  cascade_lift: 3.1,
  cascade_pulley: 3.0,
  machine: 3.0,
  world: 3.0,
};

function rangeFor(it: Interactable): number {
  return ACTION_RANGE[it.id] ?? ACTION_RANGE[it.kind] ?? 2.6;
}

function losBlocked(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  colliders: Collider[],
  ignore: Set<string>,
): boolean {
  const steps = 5;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    const z = az + (bz - az) * t;
    for (const c of colliders) {
      if (c.disabled || ignore.has(c.id)) continue;
      if (c.id === "rail" || c.id.startsWith("stair")) continue;
      // These are the mechanism surfaces themselves; surrounding hall geometry still occludes.
      if (c.id.startsWith("cascade_lever_") || c.id === "cascade_ballast_body" || c.id === "cascade_lift_platform") continue;
      if (x > c.minx && x < c.maxx && y > c.miny && y < c.maxy && z > c.minz && z < c.maxz) return true;
    }
  }
  return false;
}

function score(dist: number, maxd: number, align: number, sticky: boolean): number {
  const reach = 1 - dist / maxd;
  return align * 1.6 + reach + (sticky ? 0.55 : 0);
}

export function worldWarning(state: WorldState): string | null {
  const rube = state.rube;
  if (rube && rube.rope.tension_n > rube.rope.rated_tension_n * 0.9) {
    return "MC-01 transfer rope is above 90% rated tension.";
  }
  if (state.freight.brake_temperature_k > 420) return "Brake is cooking. Heat is friction.";
  if (state.gate.wedged) return "G-07 is wedged. The leaf will not take a clean command.";
  if (Math.abs(state.gate.seal_misalignment_m) > 0.028 && state.gate.angle_rad < 0.4) {
    return "Frame twist is jamming the gate seal.";
  }
  const live = state.members.filter((m) => m.role === "gallery_span" && !m.cut);
  const sag = live.reduce((a, m) => Math.max(a, m.sag_m), 0);
  if (live.length < 3 && sag > 0.06) return "Gallery sag is past an occupied-route estimate.";
  if (state.frame.plastic_set_m > 0.004) return "Transfer frame has taken a plastic set.";
  return null;
}

export function resolveContext(args: {
  px: number;
  py: number;
  pz: number;
  eye: number;
  yaw: number;
  pitch: number;
  interactables: Interactable[];
  colliders: Collider[];
  state: WorldState;
  prevActionId: string | null;
  operateId: string | null;
  slingA: string | null;
  mantle: boolean;
  grounded: boolean;
  speed: number;
}): CtxFrame {
  const originY = args.py + args.eye;
  const dirX = -Math.sin(args.yaw) * Math.cos(args.pitch);
  const dirY = Math.sin(args.pitch);
  const dirZ = -Math.cos(args.yaw) * Math.cos(args.pitch);
  const ignore = new Set(["rail", "bay_floor", "neck_floor"]);

  let look: LookInfo | null = null;
  let lookScore = -1;
  let actionHit: { it: Interactable; dist: number; align: number } | null = null;
  let actionScore = -1;

  for (const it of args.interactables) {
    const dx = it.x - args.px;
    const dy = it.y - originY;
    const dz = it.z - args.pz;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.15) continue;
    const nd = dist || 1;
    const align = (dx / nd) * dirX + (dy / nd) * dirY + (dz / nd) * dirZ;

    const lookMax = LOOK_RANGE[it.kind];
    if (dist <= lookMax && align > 0.42) {
      const sc = score(dist, lookMax, align, it.id === args.prevActionId);
      if (sc > lookScore) {
        lookScore = sc;
        look = { id: it.id, label: it.label, dist, kind: it.kind };
      }
    }

    const actMax = rangeFor(it);
    const sticky = args.prevActionId === it.id;
    const minAlign = sticky ? 0.18 : 0.48;
    const maxd = sticky ? actMax * 1.35 : actMax;
    if (dist > maxd || align < minAlign) continue;
    if (losBlocked(args.px, originY, args.pz, it.x, it.y, it.z, args.colliders, ignore)) continue;
    const sc = score(dist, maxd, align, sticky);
    if (sc > actionScore) {
      actionScore = sc;
      actionHit = { it, dist, align };
    }
  }

  const choices: CtxAction[] = [];
  const push = (a: Omit<CtxAction, "prompt">) => {
    choices.push({ ...a, prompt: `ACTION · ${a.verb} ${a.noun}`.replace(/\s+/g, " ").trim() });
  };

  if (args.operateId) {
    push({
      id: "exit-operate",
      verb: "Step off",
      noun: "controls",
      targetId: args.operateId,
      kind: "machine",
      commit: "exit-operate",
      dist: 0,
      priority: 40,
    });
    if (
      (args.operateId === "pendant" || args.operateId === "carrier") &&
      overDock(args.state.freight) &&
      !args.state.freight.payload_released
    ) {
      push({
        id: "release",
        verb: "Release",
        noun: "payload",
        targetId: "carrier",
        kind: "machine",
        commit: "release",
        dist: 0,
        priority: 88,
      });
    }
  }

  if (actionHit) {
    const it = actionHit.it;
    const dist = actionHit.dist;
    const s = args.state;

    if (it.id === "cascade_ballast" && s.rube) {
      if (s.rube.ballast.s_m < 3.62) {
        push({
          id: "cascade:push-out",
          verb: "Shove",
          noun: "ballast outboard",
          targetId: it.id,
          kind: "machine",
          commit: "cascade-push-out",
          dist,
          priority: 86,
        });
      }
      if (s.rube.ballast.s_m > -3.62) {
        push({
          id: "cascade:push-in",
          verb: "Shove",
          noun: "ballast inboard",
          targetId: it.id,
          kind: "machine",
          commit: "cascade-push-in",
          dist,
          priority: 62,
        });
      }
    } else if (it.id === "cascade_latch" && s.rube) {
      push({
        id: "cascade:latch",
        verb: s.rube.lever.latch_engaged ? "Release" : "Catch",
        noun: "pivot latch",
        targetId: it.id,
        kind: "machine",
        commit: "cascade-latch",
        dist,
        priority: 84,
      });
    } else if (it.kind === "npc" && DIALOGUE[it.id]) {
      push({
        id: `talk:${it.id}`,
        verb: "Talk to",
        noun: it.label,
        targetId: it.id,
        kind: "npc",
        commit: "talk",
        dist,
        priority: 92,
      });
    }

    if (it.id === "pendant" && args.operateId !== "pendant") {
      push({
        id: "operate:pendant",
        verb: "Operate",
        noun: "Carrier 07-A",
        targetId: "pendant",
        kind: "machine",
        commit: "operate",
        dist,
        priority: s.electrical.carrier_powered ? 86 : 50,
      });
    } else if (it.id === "gate" && args.operateId !== "gate") {
      push({
        id: "operate:gate",
        verb: "Operate",
        noun: "Gate G-07",
        targetId: "gate",
        kind: "machine",
        commit: "operate",
        dist,
        priority: s.electrical.gate_powered ? 84 : 48,
      });
      if (s.gate.pressure_pa > 180000) {
        push({
          id: "vent:gate",
          verb: "Vent",
          noun: "Gate G-07",
          targetId: "gate",
          kind: "machine",
          commit: "vent",
          dist,
          priority: 70,
        });
      }
    } else if (it.id === "frame" || it.id === "neck_brace") {
      if (!s.frame.brace_connected && !s.members.find((m) => m.id === "neck_brace")?.braced) {
        push({
          id: "brace:neck",
          verb: "Brace",
          noun: "transfer neck",
          targetId: "neck_brace",
          kind: "member",
          commit: "brace",
          dist,
          priority: 74,
        });
      }
      if (!s.members.find((m) => m.id === "neck_brace")?.jacked) {
        push({
          id: "jack:neck",
          verb: "Jack",
          noun: "transfer neck",
          targetId: "neck_brace",
          kind: "member",
          commit: "jack",
          dist,
          priority: 68,
        });
      }
    } else if (it.kind === "member") {
      const mem = s.members.find((m) => m.id === it.id);
      if (mem && !mem.cut) {
        if (!mem.braced) {
          push({
            id: `brace:${it.id}`,
            verb: "Brace",
            noun: it.label,
            targetId: it.id,
            kind: "member",
            commit: "brace",
            dist,
            priority: 66,
          });
        }
        if (!mem.jacked) {
          push({
            id: `jack:${it.id}`,
            verb: "Jack",
            noun: it.label,
            targetId: it.id,
            kind: "member",
            commit: "jack",
            dist,
            priority: 60,
          });
        }
        push({
          id: `cut:${it.id}`,
          verb: "Cut",
          noun: it.label,
          targetId: it.id,
          kind: "member",
          commit: "cut",
          dist,
          priority: 44,
        });
      }
    } else if (it.kind === "board" || it.id.startsWith("brk_")) {
      push({
        id: `toggle:${it.id}`,
        verb: "Toggle",
        noun: it.label.replace(/ breaker$/i, ""),
        targetId: it.id === "board" ? "brk_shop" : it.id,
        kind: "board",
        commit: "toggle",
        dist,
        priority: 80,
      });
    } else if (it.kind === "bench") {
      push({
        id: "bench",
        verb: s.electrical.shop_powered ? "Use" : "Inspect",
        noun: "bench",
        targetId: it.id,
        kind: "bench",
        commit: s.electrical.shop_powered ? "bench" : "inspect",
        dist,
        priority: 76,
      });
    } else if (it.id === "drive" && s.flags.drive_present && !s.flags.drive_recovered && !s.flags.drive_abandoned) {
      push({
        id: "recover",
        verb: "Recover",
        noun: "drive",
        targetId: "drive",
        kind: "machine",
        commit: "recover",
        dist,
        priority: 72,
      });
    } else if (it.id === "dock" || it.id === "carrier") {
      if (!s.freight.payload_released && overDock(s.freight)) {
        push({
          id: "release",
          verb: "Release",
          noun: "payload",
          targetId: "carrier",
          kind: "machine",
          commit: "release",
          dist,
          priority: 73,
        });
      }
    }

    if (it.id === "gate") {
      push({
        id: "wedge:gate",
        verb: s.gate.wedged ? "Pull" : "Set",
        noun: "wedge",
        targetId: "gate",
        kind: "machine",
        commit: "wedge",
        dist,
        priority: 52,
      });
    }

    if (it.id === "brk_west" && !s.electrical.chen_rerouted) {
      push({
        id: "reroute",
        verb: "Close",
        noun: "west bus",
        targetId: "brk_west",
        kind: "board",
        commit: "reroute",
        dist,
        priority: 88,
      });
    }

    if (s.cables.some((c) => c.id === "sling") && (it.id === "carrier" || it.id === "dock" || it.id === "frame" || it.kind === "member")) {
      push({
        id: "clear-sling",
        verb: "Clear",
        noun: "sling",
        targetId: "sling",
        kind: "world",
        commit: "clear-sling",
        dist,
        priority: 58,
      });
    }

    if (args.slingA && args.slingA !== it.id) {
      if (slingCompatible(args.slingA, it.id)) {
        push({
          id: `sling2:${it.id}`,
          verb: "Attach to",
          noun: it.label,
          targetId: it.id,
          kind: it.kind,
          commit: "sling2",
          dist,
          priority: 90,
        });
      }
    } else if (!args.slingA && (it.id === "carrier" || it.id === "dock" || it.id === "frame" || it.kind === "member")) {
      push({
        id: `sling:${it.id}`,
        verb: "Attach sling",
        noun: it.label,
        targetId: it.id,
        kind: it.kind,
        commit: "sling",
        dist,
        priority: 42,
      });
    }

    push({
      id: `inspect:${it.id}`,
      verb: "Inspect",
      noun: it.label,
      targetId: it.id,
      kind: it.kind,
      commit: "inspect",
      dist,
      priority: 28,
    });
  } else if (look) {
    push({
      id: `inspect:${look.id}`,
      verb: "Inspect",
      noun: look.label,
      targetId: look.id,
      kind: look.kind,
      commit: "inspect",
      dist: look.dist,
      priority: 22,
    });
  }

  if (args.mantle) {
    push({
      id: "mantle",
      verb: "Mantle",
      noun: "ledge",
      targetId: "locomotion",
      kind: "world",
      commit: "mantle",
      dist: 0,
      priority: 64,
    });
  } else if (args.grounded && args.speed > 0.55 && !args.operateId) {
    push({
      id: "jump",
      verb: "Jump",
      noun: "",
      targetId: "locomotion",
      kind: "world",
      commit: "jump",
      dist: 0,
      priority: 18,
    });
  }

  choices.sort((a, b) => b.priority - a.priority);
  const unique: CtxAction[] = [];
  const seen = new Set<string>();
  for (const c of choices) {
    if (seen.has(c.commit + c.targetId) && c.commit !== "inspect") continue;
    seen.add(c.commit + c.targetId);
    unique.push(c);
  }

  const primary =
    unique.find((c) => c.commit !== "inspect" && c.commit !== "jump" && c.commit !== "exit-operate") ??
    unique.find((c) => c.commit === "inspect") ??
    unique[0] ??
    null;
  const secondary =
    unique.find((c) => c !== primary && (c.commit === "inspect" || c.commit === "mantle" || c.commit === "jump" || c.commit === "exit-operate")) ??
    unique.find((c) => c !== primary) ??
    null;

  return {
    look,
    action: actionHit
      ? { id: actionHit.it.id, label: actionHit.it.label, dist: actionHit.dist, kind: actionHit.it.kind }
      : null,
    primary,
    secondary,
    choices: unique.slice(0, 5),
    mantle: args.mantle,
  };
}

export type CommitBag = {
  sim: Simulation;
  audio: GameAudio;
  inspect: (id: string) => void;
  flash: (msg: string) => void;
  startWork: (id: string, kind: "cut" | "brace") => void;
  enterOperate: (id: string) => void;
  exitOperate: () => void;
  startTalk: (npcId: string) => void;
  setSlingA: (id: string | null) => void;
  slingA: string | null;
  persist: () => void;
  jump: () => void;
  mantle: () => void;
};

export function commitAction(action: CtxAction, bag: CommitBag): void {
  const s = bag.sim.state();
  switch (action.commit) {
    case "talk": {
      if (!DIALOGUE[action.targetId]) return;
      bag.startTalk(action.targetId);
      return;
    }
    case "inspect": {
      bag.inspect(action.targetId);
      bag.audio.beep(520, 0.06, 0.06);
      return;
    }
    case "operate": {
      if (action.targetId === "pendant" && !s.electrical.carrier_powered) {
        bag.flash("Pendant is dead. Carrier has no island.");
        return;
      }
      if (action.targetId === "gate" && !s.electrical.gate_powered) {
        bag.flash("Gate motor feed is open. The leaf will not take torque.");
        return;
      }
      bag.enterOperate(action.targetId);
      bag.audio.clank();
      return;
    }
    case "exit-operate":
      bag.exitOperate();
      return;
    case "toggle": {
      const id = action.targetId === "board" ? "brk_shop" : action.targetId;
      bag.flash(bag.sim.act({ type: "toggle_breaker", id }));
      bag.audio.beep(180, 0.1, 0.1);
      return;
    }
    case "bench": {
      if (!s.electrical.shop_powered) {
        bag.flash("Bench is dead. Shop is not an island yet.");
        return;
      }
      bag.sim.act({ type: "mark_save_used" });
      bag.persist();
      bag.flash("Authority snapshot written. The building will not heal.");
      bag.audio.beep(440, 0.12, 0.1);
      return;
    }
    case "sling":
      bag.setSlingA(action.targetId);
      bag.flash(`Sling first attachment: ${action.noun}. Need a compatible second.`);
      return;
    case "sling2": {
      const msg = bag.sim.act({ type: "sling", a: bag.slingA ?? action.targetId, b: action.targetId });
      bag.setSlingA(null);
      bag.flash(msg);
      bag.audio.clank();
      return;
    }
    case "cut":
      bag.startWork(action.targetId, "cut");
      return;
    case "brace":
      bag.startWork(action.targetId, "brace");
      return;
    case "jack":
      bag.flash(bag.sim.act({ type: "jack_member", id: action.targetId, on: true }));
      bag.audio.clank();
      return;
    case "release":
      bag.flash(bag.sim.act({ type: "carrier_release" }));
      bag.audio.clank();
      return;
    case "recover":
      bag.flash(bag.sim.act({ type: "recover_drive" }));
      bag.audio.clank();
      return;
    case "vent":
      bag.sim.setCommand("GateVent", true);
      window.setTimeout(() => bag.sim.setCommand("GateVent", false), 4000);
      bag.flash("Venting gate inventory.");
      bag.audio.hiss();
      return;
    case "wedge":
      bag.sim.setCommand("GateWedge", true);
      bag.sim.setCommand("GateWedge", false);
      bag.audio.clank();
      return;
    case "reroute":
      bag.flash(bag.sim.act({ type: "chen_reroute" }));
      bag.audio.clank();
      return;
    case "clear-sling":
      bag.flash(bag.sim.act({ type: "clear_sling" }));
      bag.setSlingA(null);
      bag.audio.clank();
      return;
    case "cascade-push-out":
      bag.flash(bag.sim.act({ type: "rube_push_ballast", direction: 1 }));
      bag.audio.clank();
      return;
    case "cascade-push-in":
      bag.flash(bag.sim.act({ type: "rube_push_ballast", direction: -1 }));
      bag.audio.clank();
      return;
    case "cascade-latch":
      bag.flash(bag.sim.act({ type: "rube_toggle_latch" }));
      bag.audio.clank();
      return;
    case "jump":
      bag.jump();
      return;
    case "mantle":
      bag.mantle();
      return;
  }
}

export function inspectOrNull(state: WorldState, id: string) {
  return inspectTarget(state, id);
}
