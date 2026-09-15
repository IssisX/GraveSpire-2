import type { WorldState } from "./types.ts";
import { Simulation } from "./simulation.ts";
import { createInitialState } from "./world-init.ts";

export const SAVE_VERSION = 2;
export const SAVE_KEY = "gravespire-act-i-v1";
export const SAVE_BACKUP_KEY = "gravespire-act-i-v1.bak";

export interface PlayerSave {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface SaveBlob {
  version: number;
  savedAt: number;
  authority: WorldState;
  player: PlayerSave;
}

const defaultPlayer = (): PlayerSave => ({
  // West floor, a short walk from the carrier pulpit, facing it. The opening
  // hands control over already looking at the thing it just named.
  x: 8.8,
  y: 0.05,
  z: -4.0,
  yaw: 1.1,
  pitch: -0.02,
});

export function captureSave(sim: Simulation, player: PlayerSave): SaveBlob {
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    authority: structuredClone(sim.state()),
    player: { ...player },
  };
}

/**
 * Fill authority fields a newer build introduced.
 *
 * Only fields that are genuinely absent are filled, and only from the initial
 * world. Nothing already stored is recomputed: a save must never heal the
 * building it describes.
 */
export function migrate(raw: SaveBlob): SaveBlob {
  const save: SaveBlob = { ...raw };
  const base = createInitialState();
  const a = save.authority as unknown as Record<string, unknown> | undefined;
  if (!a) return save;

  const fill = <T extends object>(target: T | undefined, defaults: T): T => {
    if (!target || typeof target !== "object") return { ...defaults };
    const out = target as Record<string, unknown>;
    for (const [k, v] of Object.entries(defaults as Record<string, unknown>)) {
      if (out[k] === undefined || (typeof v === "number" && !Number.isFinite(out[k] as number))) {
        out[k] = v;
      }
    }
    return target;
  };

  save.authority.freight = fill(save.authority.freight, base.freight);
  save.authority.frame = fill(save.authority.frame, base.frame);
  save.authority.gate = fill(save.authority.gate, base.gate);
  save.authority.flags = fill(save.authority.flags, base.flags);
  save.authority.electrical = fill(save.authority.electrical, base.electrical);
  if (!Array.isArray(save.authority.electrical.breakers)) {
    save.authority.electrical.breakers = base.electrical.breakers;
  } else {
    for (const b of save.authority.electrical.breakers) {
      const ref = base.electrical.breakers.find((x) => x.id === b.id);
      if (ref) fill(b, ref);
    }
  }
  if (!Array.isArray(save.authority.members)) save.authority.members = base.members;
  if (!Array.isArray(save.authority.cables)) save.authority.cables = [];
  if (!Array.isArray(save.authority.npcs)) save.authority.npcs = base.npcs;
  if (!Array.isArray(save.authority.events)) save.authority.events = [];

  save.version = SAVE_VERSION;
  return save;
}

/** True when a snapshot exists that this build can resume. */
export function hasSave(): boolean {
  try {
    return Boolean(localStorage.getItem(SAVE_KEY));
  } catch {
    return false;
  }
}


export function writeSave(blob: SaveBlob): boolean {
  try {
    const prev = localStorage.getItem(SAVE_KEY);
    if (prev) localStorage.setItem(SAVE_BACKUP_KEY, prev);
    localStorage.setItem(SAVE_KEY, JSON.stringify(blob));
    return true;
  } catch {
    return false;
  }
}

export function readSave(): SaveBlob | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SaveBlob;
    if (!parsed || typeof parsed !== "object" || !parsed.authority) return null;
    return migrate(parsed);
  } catch {
    return null;
  }
}

export function applySave(sim: Simulation, blob: SaveBlob): PlayerSave {
  sim.replaceState(blob.authority);
  return blob.player ?? defaultPlayer();
}

export { defaultPlayer };
