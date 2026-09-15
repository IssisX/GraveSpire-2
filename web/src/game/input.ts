/**
 * Input interpretation.
 *
 * Three sources land in the same place: keyboard + mouse, standard gamepads,
 * and the touch layer. Movement is analogue everywhere and is never snapped to
 * eight directions. Look is a delta stream, so a right-side drag is direct
 * camera control rather than a second virtual stick.
 */

import type { Settings } from "./settings.ts";
import { DEFAULT_SETTINGS } from "./settings.ts";

export type Actions = {
  /** Analogue move, magnitude preserved, deadzone already removed. */
  moveX: number;
  moveY: number;
  moveMag: number;
  /** Accumulated look delta for this frame, sensitivity and invert applied. */
  lookX: number;
  lookY: number;
  jump: boolean;
  jumpPressed: boolean;
  crouch: boolean;
  sprint: boolean;
  interact: boolean;
  interactPressed: boolean;
  interactReleased: boolean;
  inspectPressed: boolean;
  pausePressed: boolean;
  /** Cycle the contextual action selector without opening it (keyboard). */
  cyclePressed: boolean;
};

const GAME_CODES = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "KeyR", "KeyF", "KeyB", "KeyT",
  "KeyX", "KeyV", "KeyG", "KeyZ", "KeyC", "KeyI",
  "Space", "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "Tab", "Escape",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
]);

/** Radial deadzone: direction is preserved and magnitude is rescaled. */
function radial(x: number, y: number, dz: number): { x: number; y: number; m: number } {
  const m = Math.hypot(x, y);
  if (m < dz) return { x: 0, y: 0, m: 0 };
  const scaled = Math.min(1, (m - dz) / (1 - dz));
  const k = scaled / m;
  return { x: x * k, y: y * k, m: scaled };
}

export function detectTouch(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.has("touch")) return true;
    if (q.has("desktop")) return false;
  } catch {
    /* ignore */
  }
  if (window.matchMedia("(pointer: coarse)").matches) return true;
  if ((navigator.maxTouchPoints ?? 0) > 0) return true;
  return window.innerWidth < 720;
}

export function createInput(canvas: HTMLCanvasElement) {
  const keys = new Set<string>();
  let injected: string[] = [];
  let settings: Settings = { ...DEFAULT_SETTINGS };

  let lookDX = 0;
  let lookDY = 0;
  let touchMoveX = 0;
  let touchMoveY = 0;
  let touchMoveMag = 0;
  let touchInteract = false;

  let prevJump = false;
  let prevInteract = false;
  let prevPause = false;
  let prevInspect = false;
  let prevCycle = false;
  let ignoreLookUntil = 0;

  const onKeyDown = (e: KeyboardEvent) => {
    if (GAME_CODES.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
  const clear = () => keys.clear();
  const onBlur = () => clear();
  const onVis = () => {
    if (document.hidden) clear();
  };
  const onMouse = (e: MouseEvent) => {
    if (document.pointerLockElement !== canvas) return;
    if (performance.now() < ignoreLookUntil) return;
    lookDX += e.movementX;
    lookDY += e.movementY;
  };
  const onContext = (e: Event) => e.preventDefault();

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVis);
  document.addEventListener("mousemove", onMouse);
  canvas.addEventListener("contextmenu", onContext);

  const down = (code: string) => keys.has(code) || injected.includes(code);

  function pollGamepad(): { mx: number; my: number; lx: number; ly: number } {
    let mx = 0;
    let my = 0;
    let lx = 0;
    let ly = 0;
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) {
      if (!p || p.mapping !== "standard") continue;
      const ls = radial(p.axes[0] ?? 0, p.axes[1] ?? 0, settings.moveDeadzone);
      mx += ls.x;
      my += -ls.y;
      const rs = radial(p.axes[2] ?? 0, p.axes[3] ?? 0, 0.1);
      lx += rs.x;
      ly += rs.y;
      if (p.buttons[0]?.pressed) keys.add("Space");
      else keys.delete("Space");
      if (p.buttons[1]?.pressed) keys.add("ControlLeft");
      if (p.buttons[2]?.pressed) keys.add("KeyE");
      if (p.buttons[9]?.pressed) keys.add("Escape");
      if ((p.buttons[7]?.value ?? 0) > 0.4) keys.add("ShiftLeft");
    }
    return { mx, my, lx, ly };
  }

  function sample(dt: number): Actions {
    const gp = pollGamepad();
    let mx = gp.mx + touchMoveX;
    let my = gp.my + touchMoveY;
    if (down("KeyA") || down("ArrowLeft")) mx -= 1;
    if (down("KeyD") || down("ArrowRight")) mx += 1;
    if (down("KeyW") || down("ArrowUp")) my += 1;
    if (down("KeyS") || down("ArrowDown")) my -= 1;
    let mag = Math.hypot(mx, my);
    if (mag > 1) {
      mx /= mag;
      my /= mag;
      mag = 1;
    }
    if (touchMoveMag > 0 && gp.mx === 0 && gp.my === 0) mag = Math.max(mag, touchMoveMag);

    // Gamepad right stick is a rate, so it is integrated into the delta stream.
    const padLook = 620 * dt;
    const sens = settings.lookSensitivity;
    const invert = settings.invertY ? -1 : 1;
    const outLookX = (lookDX + gp.lx * padLook) * sens;
    const outLookY = (lookDY + gp.ly * padLook) * sens * invert;

    const jump = down("Space");
    const interactKey = down("KeyE");
    const interact = interactKey || touchInteract;
    const pauseKey = down("Escape");
    const inspectKey = down("KeyI") || down("Tab");
    const cycleKey = down("KeyQ");

    const actions: Actions = {
      moveX: mx,
      moveY: my,
      moveMag: mag,
      lookX: outLookX,
      lookY: outLookY,
      jump,
      jumpPressed: jump && !prevJump,
      crouch: down("ControlLeft") || down("ControlRight") || down("KeyC"),
      sprint: down("ShiftLeft") || down("ShiftRight") || (settings.autoSprint && mag > 0.92),
      interact,
      interactPressed: interact && !prevInteract,
      interactReleased: !interact && prevInteract,
      inspectPressed: inspectKey && !prevInspect,
      pausePressed: pauseKey && !prevPause,
      cyclePressed: cycleKey && !prevCycle,
    };

    lookDX = 0;
    lookDY = 0;
    prevJump = jump;
    prevInteract = interact;
    prevPause = pauseKey;
    prevInspect = inspectKey;
    prevCycle = cycleKey;
    return actions;
  }

  /** Dynamic stick output: already a unit-ish vector, deadzone applied here. */
  function setTouchMove(x: number, y: number) {
    const v = radial(x, y, settings.moveDeadzone);
    touchMoveX = v.x;
    touchMoveY = v.y;
    touchMoveMag = v.m;
  }

  /** Direct look: raw pixel deltas from a right-side drag. */
  function addTouchLook(dx: number, dy: number) {
    if (performance.now() < ignoreLookUntil) return;
    const k = 0.82 * settings.touchLookSensitivity;
    lookDX += dx * k;
    lookDY += dy * k;
  }

  function setTouchInteract(on: boolean) {
    touchInteract = on;
  }

  function hold(code: string, on: boolean) {
    if (on) keys.add(code);
    else keys.delete(code);
  }

  function inject(codes: string[]) {
    injected = codes.slice();
  }

  function suppressLook(ms = 350) {
    ignoreLookUntil = performance.now() + ms;
    lookDX = 0;
    lookDY = 0;
  }

  function applySettings(next: Settings) {
    settings = next;
  }

  /**
   * Drop every held input AND every edge-detection flag.
   *
   * Without clearing the previous-frame flags, a control still held when the
   * phase changed reads as a release on the first frame back, which would fire
   * a contextual action the player never asked for.
   */
  function releaseAll() {
    keys.clear();
    injected = [];
    touchMoveX = 0;
    touchMoveY = 0;
    touchMoveMag = 0;
    touchInteract = false;
    lookDX = 0;
    lookDY = 0;
    prevJump = false;
    prevInteract = false;
    prevPause = false;
    prevInspect = false;
    prevCycle = false;
  }

  function dispose() {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("visibilitychange", onVis);
    document.removeEventListener("mousemove", onMouse);
    canvas.removeEventListener("contextmenu", onContext);
  }

  return {
    sample,
    setTouchMove,
    addTouchLook,
    setTouchInteract,
    hold,
    inject,
    suppressLook,
    applySettings,
    releaseAll,
    dispose,
    down,
  };
}

export type Input = ReturnType<typeof createInput>;
