export type ShadowQuality = "off" | "low" | "high";
export type LightQuality = "low" | "high";

export type Settings = {
  lookSensitivity: number;
  invertY: boolean;
  moveDeadzone: number;
  autoSprint: boolean;
  promptHoldMs: number;
  reducedMotion: boolean;
  pixelRatioCap: number;
  shadows: ShadowQuality;
  shadowRes: number;
  lightQuality: LightQuality;
  steamDensity: number;
  fov: number;
  shake: number;
  masterVolume: number;
};

export const SETTINGS_KEY = "gravespire-settings-v1";

export const DEFAULT_SETTINGS: Settings = {
  lookSensitivity: 1,
  invertY: false,
  moveDeadzone: 0.12,
  autoSprint: true,
  promptHoldMs: 280,
  reducedMotion: false,
  pixelRatioCap: 1.5,
  shadows: "low",
  shadowRes: 1024,
  lightQuality: "high",
  steamDensity: 1,
  fov: 72,
  shake: 0.55,
  masterVolume: 0.7,
};

let current: Settings = loadSettings();
const listeners = new Set<(s: Settings) => void>();

function clamp(v: number, a: number, b: number) {
  return Math.min(b, Math.max(a, v));
}

function sanitize(raw: Partial<Settings> | null | undefined): Settings {
  const s = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
  s.lookSensitivity = clamp(Number(s.lookSensitivity) || 1, 0.4, 2.4);
  s.moveDeadzone = clamp(Number(s.moveDeadzone) || 0.12, 0.04, 0.32);
  s.promptHoldMs = clamp(Number(s.promptHoldMs) || 280, 160, 520);
  s.pixelRatioCap = clamp(Number(s.pixelRatioCap) || 1.5, 0.7, 2);
  s.shadowRes = s.shadows === "high" ? 2048 : s.shadows === "low" ? 1024 : 512;
  s.steamDensity = clamp(Number(s.steamDensity) || 0, 0, 1);
  s.fov = clamp(Number(s.fov) || 72, 58, 90);
  s.shake = clamp(Number(s.shake) || 0, 0, 1);
  s.masterVolume = clamp(Number(s.masterVolume) || 0, 0, 1);
  s.invertY = Boolean(s.invertY);
  s.autoSprint = s.autoSprint !== false;
  s.reducedMotion = Boolean(s.reducedMotion);
  s.shadows = s.shadows === "off" || s.shadows === "high" ? s.shadows : "low";
  s.lightQuality = s.lightQuality === "low" ? "low" : "high";
  return s;
}

export function loadSettings(): Settings {
  if (typeof window === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      const prefers = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const coarse = window.matchMedia?.("(pointer: coarse)").matches;
      return sanitize({
        reducedMotion: prefers,
        pixelRatioCap: coarse ? 1.2 : 1.75,
        shadows: coarse ? "off" : "low",
        autoSprint: true,
      });
    }
    return sanitize(JSON.parse(raw) as Partial<Settings>);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function persist() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
  } catch {
    /* private mode */
  }
}

export function getSettings(): Settings {
  return current;
}

export function setSettings(patch: Partial<Settings>): Settings {
  current = sanitize({ ...current, ...patch });
  persist();
  for (const fn of listeners) fn(current);
  return current;
}

export function resetSettings(): Settings {
  current = sanitize({
    reducedMotion: typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  });
  persist();
  for (const fn of listeners) fn(current);
  return current;
}

export function subscribeSettings(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
