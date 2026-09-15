import type { WorldState } from "./types.ts";
import { Simulation } from "./simulation.ts";

export const SAVE_VERSION = 1;
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
  x: 5.6,
  y: 0.05,
  z: -1.35,
  yaw: -1.62,
  pitch: 0.06,
});

export function captureSave(sim: Simulation, player: PlayerSave): SaveBlob {
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    authority: structuredClone(sim.state()),
    player: { ...player },
  };
}

export function migrate(raw: SaveBlob): SaveBlob {
  const save = { ...raw };
  if (save.version === SAVE_VERSION) return save;
  save.version = SAVE_VERSION;
  return save;
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
