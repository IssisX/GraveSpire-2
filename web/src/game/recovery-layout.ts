/**
 * Physical return ecology threaded through the existing MC-01 -> MC-12 void.
 * These are exposed fragments, not a hidden safety net: every entry is a real
 * deck, beam, ladder, rack, or brace with deliberate discontinuities.
 */
export type ReturnTier = {
  id: string;
  mc: string;
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  kind: "beam" | "catwalk" | "rack" | "platform";
};

export type ReturnLadder = {
  id: string;
  x: number;
  bottomY: number;
  z: number;
  height: number;
  normalX: number;
  normalZ: number;
};

export type ReturnBrace = {
  id: string;
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  segments: number;
};

export const RETURN_TIERS: readonly ReturnTier[] = [
  { id: "return_mc12_outrigger", mc: "MC-12", x: 295, y: 127, z: -31.0, width: 7.2, depth: 0.72, kind: "beam" },
  { id: "return_mc11_windward", mc: "MC-11", x: 270, y: 116, z: -42.5, width: 7.6, depth: 1.15, kind: "platform" },
  { id: "return_mc10_governor", mc: "MC-10", x: 239, y: 94, z: -31.4, width: 6.4, depth: 0.86, kind: "catwalk" },
  { id: "return_mc09_pressure", mc: "MC-09", x: 215, y: 79, z: -43.2, width: 7.4, depth: 1.10, kind: "rack" },
  { id: "return_mc08_torsion", mc: "MC-08", x: 198, y: 62, z: -30.6, width: 5.8, depth: 0.74, kind: "beam" },
  { id: "return_mc07_throat", mc: "MC-07", x: 178, y: 45, z: -43.5, width: 6.0, depth: 1.05, kind: "catwalk" },
  { id: "return_mc06_rotunda", mc: "MC-06", x: 160, y: 27, z: -30.8, width: 7.0, depth: 0.92, kind: "platform" },
  { id: "return_mc05_bascule", mc: "MC-05", x: 126, y: 15, z: -43.1, width: 6.2, depth: 0.78, kind: "beam" },
  { id: "return_mc04_spring", mc: "MC-04", x: 103, y: 7.1, z: -30.7, width: 5.4, depth: 0.92, kind: "rack" },
  { id: "return_mc03_release", mc: "MC-03", x: 86, y: 4.8, z: -43.0, width: 5.3, depth: 0.74, kind: "beam" },
  { id: "return_mc02_transfer", mc: "MC-02", x: 74, y: 3.4, z: -30.8, width: 5.0, depth: 1.00, kind: "catwalk" },
  { id: "return_mc01_service", mc: "MC-01", x: 62, y: 3.1, z: -43.0, width: 6.6, depth: 1.20, kind: "platform" },
] as const;

export const RETURN_LADDERS: readonly ReturnLadder[] = [
  { id: "ladder_mc11_windward", x: 265.8, bottomY: 108.0, z: -42.5, height: 5.6, normalX: -1, normalZ: 0 },
  { id: "ladder_mc10_governor", x: 236.2, bottomY: 88.0, z: -31.4, height: 4.8, normalX: -1, normalZ: 0 },
  { id: "ladder_mc09_pressure", x: 211.0, bottomY: 72.2, z: -43.2, height: 5.4, normalX: -1, normalZ: 0 },
  { id: "ladder_mc08_torsion", x: 195.1, bottomY: 55.3, z: -30.6, height: 4.9, normalX: -1, normalZ: 0 },
  { id: "ladder_mc07_throat", x: 174.5, bottomY: 37.4, z: -43.5, height: 5.8, normalX: -1, normalZ: 0 },
  { id: "ladder_mc06_rotunda", x: 156.0, bottomY: 20.6, z: -30.8, height: 4.7, normalX: -1, normalZ: 0 },
  { id: "ladder_mc05_bascule", x: 122.6, bottomY: 9.2, z: -43.1, height: 4.3, normalX: -1, normalZ: 0 },
  { id: "ladder_mc04_spring", x: 99.8, bottomY: 2.0, z: -30.7, height: 4.2, normalX: -1, normalZ: 0 },
] as const;

export const RETURN_BRACES: readonly ReturnBrace[] = [
  { id: "brace_crown_windward", x0: 294, y0: 126, z0: -38.8, x1: 269, y1: 116, z1: -42.5, segments: 7 },
  { id: "brace_wind_governor", x0: 270, y0: 115, z0: -42.5, x1: 239, y1: 94, z1: -31.4, segments: 10 },
  { id: "brace_governor_pressure", x0: 238, y0: 93, z0: -31.4, x1: 215, y1: 79, z1: -43.2, segments: 8 },
  { id: "brace_pressure_torsion", x0: 214, y0: 78, z0: -43.2, x1: 198, y1: 62, z1: -30.6, segments: 8 },
  { id: "brace_torsion_throat", x0: 197, y0: 61, z0: -30.6, x1: 178, y1: 45, z1: -43.5, segments: 8 },
  { id: "brace_throat_rotunda", x0: 177, y0: 44, z0: -43.5, x1: 160, y1: 27, z1: -30.8, segments: 8 },
  { id: "brace_rotunda_bascule", x0: 159, y0: 26, z0: -30.8, x1: 126, y1: 15, z1: -43.1, segments: 10 },
] as const;

/** Visible gaps make each recovery band a parkour decision rather than stairs. */
export const RECOVERY_VOID_MIN_Y = -78;
