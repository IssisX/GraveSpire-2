import type { FreightState, WorldState } from "./types.ts";

/** Well-center of carrier 07-A. World x = CARRIER_ORIGIN_X + lateral_m. */
export const CARRIER_ORIGIN_X = 20;
export const TRAVERSE_MIN_M = -9.6;
export const TRAVERSE_MAX_M = 16.4;

/** Receiving deck lives on the east apron, not over the well. */
export const DOCK_LATERAL_M = 16.0;
export const DOCK_LATERAL_TOL_M = 1.45;
export const DOCK_HEIGHT_M = 4.48;
export const DOCK_HEIGHT_TOL_M = 0.55;
export const DOCK_WORLD_X = CARRIER_ORIGIN_X + DOCK_LATERAL_M;
export const DOCK_WORLD_Y = 2.28;

/** Lumped 3-body cell still uses a bounded lever. Full gantry travel is reach, not a longer moment arm. */
export const MECH_LATERAL_CLAMP_M = 5.8;

export function carrierWorldPos(lateral: number, height: number, defl: number) {
  return {
    x: CARRIER_ORIGIN_X + lateral,
    y: height - defl * 2.4,
    z: 0,
  };
}

export function overDock(f: FreightState): boolean {
  return (
    Math.abs(f.lateral_m - DOCK_LATERAL_M) < DOCK_LATERAL_TOL_M &&
    Math.abs(f.height_m - DOCK_HEIGHT_M) < DOCK_HEIGHT_TOL_M
  );
}

export function nearDock(f: FreightState): boolean {
  return Math.abs(f.lateral_m - DOCK_LATERAL_M) < 4.2 && Math.abs(f.height_m - DOCK_HEIGHT_M) < 1.35;
}

export function dockEnvelope(f: FreightState): "in" | "close" | "offset" {
  if (overDock(f)) return "in";
  if (nearDock(f)) return "close";
  return "offset";
}

export function mechLateral(lateral: number): number {
  return Math.max(-MECH_LATERAL_CLAMP_M, Math.min(MECH_LATERAL_CLAMP_M, lateral));
}

export function dockShare(lateral: number): number {
  return Math.max(0, Math.min(1, (lateral - 10) / 6));
}

export type AttachId = string;

export function attachmentWorld(state: WorldState, id: AttachId): { x: number; y: number; z: number } | null {
  const f = state.freight;
  const defl = Math.min(state.frame.deflection_m, 0.35);
  if (id === "carrier" || id === "cable" || id === "pendant") {
    const p = carrierWorldPos(f.lateral_m, f.height_m, defl);
    return { x: p.x, y: p.y - 1.2, z: p.z };
  }
  if (id === "dock") return { x: DOCK_WORLD_X, y: DOCK_WORLD_Y + 0.4, z: 0 };
  if (id === "frame") return { x: 52, y: 4.6 - defl * 4, z: 0 };
  if (id === "neck_brace") return { x: 53, y: 1.35, z: 0.15 };
  if (id === "gate") return { x: 40.4, y: 3.2, z: 0 };
  const m = state.members.find((x) => x.id === id);
  if (m) {
    return {
      x: (m.ax + m.bx) * 0.5,
      y: (m.ay + m.by) * 0.5 - m.sag_m * 4,
      z: (m.az + m.bz) * 0.5,
    };
  }
  return null;
}

const SLING_KIND: Record<string, "load" | "structure" | "deck" | "other"> = {
  carrier: "load",
  cable: "load",
  dock: "deck",
  frame: "structure",
  neck_brace: "structure",
};

export function slingCompatible(a: string, b: string): boolean {
  if (a === b) return false;
  const ka = SLING_KIND[a] ?? (a.startsWith("g12_") ? "structure" : "other");
  const kb = SLING_KIND[b] ?? (b.startsWith("g12_") ? "structure" : "other");
  if (ka === "other" || kb === "other") return false;
  if (ka === kb && ka === "load") return false;
  return true;
}

export function slingRestLength(state: WorldState, a: string, b: string): number | null {
  if (!slingCompatible(a, b)) return null;
  const pa = attachmentWorld(state, a);
  const pb = attachmentWorld(state, b);
  if (!pa || !pb) return null;
  const dist = Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
  return Math.max(1.2, dist * 1.02);
}
