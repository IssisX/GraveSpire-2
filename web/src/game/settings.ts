/**
 * Settings authority.
 *
 * Every field here is backed by real input handling or a real renderer/scene
 * control. Nothing in this file may alter mechanical world truth: no entry
 * feeds the Simulation, changes a load path, or changes which actions are
 * legal. Presentation and input only.
 */

export type HudDensity = "sparse" | "full";
export type PromptMode = "always" | "minimal";
export type LightQuality = "low" | "high";

export interface Settings {
  /** Multiplier on pointer-lock / mouse look. 1 = the shipped baseline. */
  lookSensitivity: number;
  /** Multiplier on right-side touch drag look. */
  touchLookSensitivity: number;
  invertY: boolean;
  /** Dynamic stick deadzone as a fraction of stick travel. */
  moveDeadzone: number;
  /** Full stick deflection sprints without a modifier. */
  autoSprint: boolean;
  /** Scales procedural gait amplitude. 0 disables all gait offsets. */
  gaitIntensity: number;
  /** "minimal" hides the action prompt once the player has used it enough. */
  promptMode: PromptMode;
  /** "full" restores the engineering strip during ordinary traversal. */
  hudDensity: HudDensity;

  /** Device pixel ratio multiplier applied to the renderer. */
  renderScale: number;
  shadows: boolean;
  shadowResolution: 512 | 1024 | 2048;
  /** Toggles the optional secondary light fixtures in the scene. */
  lightQuality: LightQuality;
  /** Fraction of the atmospheric effect budget that is drawn: vent steam,
   *  suspended dust, and the visible cones under the lamps. 0 draws none. */
  effectDensity: number;
  /** Vertical-ish base FOV in degrees at landscape aspect. */
  fov: number;

  masterVolume: number;
}

export const DEFAULT_SETTINGS: Settings = {
  lookSensitivity: 1,
  touchLookSensitivity: 1,
  invertY: false,
  moveDeadzone: 0.12,
  autoSprint: false,
  gaitIntensity: 1,
  promptMode: "always",
  hudDensity: "sparse",

  renderScale: 1,
  shadows: true,
  shadowResolution: 1024,
  lightQuality: "high",
  effectDensity: 1,
  fov: 72,

  masterVolume: 0.7,
};

export const SETTINGS_KEY = "gravespire-settings-v1";

const NUMERIC_BOUNDS: Record<string, [number, number]> = {
  lookSensitivity: [0.25, 3],
  touchLookSensitivity: [0.25, 3],
  moveDeadzone: [0.02, 0.35],
  gaitIntensity: [0, 1.5],
  renderScale: [0.5, 1.6],
  effectDensity: [0, 1],
  fov: [60, 100],
  masterVolume: [0, 1],
};

function clampNumber(key: string, value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const bounds = NUMERIC_BOUNDS[key];
  if (!bounds) return value;
  return Math.min(bounds[1], Math.max(bounds[0], value));
}

/** Accepts arbitrary parsed JSON and returns a fully-populated Settings. */
export function sanitize(raw: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== "object") return out;
  const src = raw as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const value = src[key];
    const fallback = DEFAULT_SETTINGS[key];
    if (typeof fallback === "number") {
      if (typeof value === "number") {
        (out[key] as number) = clampNumber(key, value, fallback);
      }
    } else if (typeof fallback === "boolean") {
      if (typeof value === "boolean") (out[key] as boolean) = value;
    } else if (typeof value === "string") {
      (out[key] as string) = value;
    }
  }
  if (out.shadowResolution !== 512 && out.shadowResolution !== 1024 && out.shadowResolution !== 2048) {
    out.shadowResolution = DEFAULT_SETTINGS.shadowResolution;
  }
  if (out.hudDensity !== "sparse" && out.hudDensity !== "full") out.hudDensity = "sparse";
  if (out.promptMode !== "always" && out.promptMode !== "minimal") out.promptMode = "always";
  if (out.lightQuality !== "low" && out.lightQuality !== "high") out.lightQuality = "high";
  return out;
}

export function readSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return sanitize(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(settings: Settings): boolean {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

/** Device defaults chosen once, before any stored settings are applied. */
export function deviceDefaults(touch: boolean): Partial<Settings> {
  if (!touch) return {};
  return {
    renderScale: 0.85,
    shadows: false,
    shadowResolution: 512,
    lightQuality: "low",
    effectDensity: 0.7,
    // Touch has no sprint button by design, so full stick deflection sprints.
    // The setting stays exposed, so it can be turned off.
    autoSprint: true,
  };
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
