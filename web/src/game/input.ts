import { getSettings } from "./settings.ts";

export type Actions = {
  moveX: number;
  moveY: number;
  lookX: number;
  lookY: number;
  lookSens: number;
  invertY: boolean;
  autoSprint: boolean;
  jump: boolean;
  jumpPressed: boolean;
  crouch: boolean;
  sprint: boolean;
  interact: boolean;
  interactPressed: boolean;
  interactHold: boolean;
  inspect: boolean;
  selector: boolean;
  pausePressed: boolean;
  operateRaise: boolean;
  operateLower: boolean;
  operateLeft: boolean;
  operateRight: boolean;
  operateBrake: boolean;
  operateVent: boolean;
  operateOpen: boolean;
  operateClose: boolean;
};

const GAME_CODES = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyQ",
  "KeyE",
  "KeyR",
  "KeyF",
  "KeyB",
  "KeyT",
  "KeyX",
  "KeyV",
  "KeyG",
  "KeyZ",
  "Space",
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "Tab",
  "KeyI",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

function radial(x: number, y: number, dz: number): { x: number; y: number } {
  const m = Math.hypot(x, y);
  if (m < dz) return { x: 0, y: 0 };
  const scale = (m - dz) / (1 - dz) / m;
  return { x: x * scale, y: y * scale };
}

export function detectTouch(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).has("touch")) return true;
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
  let lookX = 0;
  let lookY = 0;
  let prevJump = false;
  let prevE = false;
  let prevPause = false;
  let touchMoveX = 0;
  let touchMoveY = 0;
  let touchLookDX = 0;
  let touchLookDY = 0;
  let ignoreLookUntil = 0;
  let interactPulse = 0;
  let inspectPulse = 0;
  let pausePulse = 0;
  let interactHeld = false;
  let interactHoldT = 0;
  let jumpPulse = 0;

  const onKeyDown = (e: KeyboardEvent) => {
    if (GAME_CODES.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    keys.delete(e.code);
  };
  const clear = () => keys.clear();
  const onBlur = () => clear();
  const onVis = () => {
    if (document.hidden) clear();
  };
  const onMouse = (e: MouseEvent) => {
    if (document.pointerLockElement !== canvas) return;
    if (performance.now() < ignoreLookUntil) return;
    lookX += e.movementX;
    lookY += e.movementY;
  };
  const onContext = (e: Event) => e.preventDefault();

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVis);
  document.addEventListener("mousemove", onMouse);
  canvas.addEventListener("contextmenu", onContext);

  const down = (code: string) => keys.has(code) || injected.includes(code);

  function pollGamepad(): { mx: number; my: number; lx: number; ly: number; e: boolean } {
    let mx = 0;
    let my = 0;
    let lx = 0;
    let ly = 0;
    let e = false;
    const pads = navigator.getGamepads?.() ?? [];
    const dz = getSettings().moveDeadzone;
    for (const p of pads) {
      if (!p || p.mapping !== "standard") continue;
      const ls = radial(p.axes[0] ?? 0, p.axes[1] ?? 0, dz);
      mx += ls.x;
      my += -ls.y;
      const rs = radial(p.axes[2] ?? 0, p.axes[3] ?? 0, 0.12);
      lx += rs.x;
      ly += rs.y;
      if (p.buttons[0]?.pressed) keys.add("Space");
      if (p.buttons[1]?.pressed) keys.add("ControlLeft");
      if (p.buttons[9]?.pressed) keys.add("Escape");
      if (p.buttons[7]!.value > 0.4) keys.add("ShiftLeft");
      if (p.buttons[2]?.pressed) e = true;
    }
    return { mx, my, lx, ly, e };
  }

  function sample(dt = 1 / 60): Actions {
    const cfg = getSettings();
    const gp = pollGamepad();
    let mx = gp.mx + touchMoveX;
    let my = gp.my + touchMoveY;
    if (down("KeyA") || down("ArrowLeft")) mx -= 1;
    if (down("KeyD") || down("ArrowRight")) mx += 1;
    if (down("KeyW") || down("ArrowUp")) my += 1;
    if (down("KeyS") || down("ArrowDown")) my -= 1;
    const mag = Math.hypot(mx, my);
    if (mag > 1) {
      mx /= mag;
      my /= mag;
    }

    const jump = down("Space") || jumpPulse > 0;
    const eDown = down("KeyE") || interactHeld || gp.e;
    if (eDown) interactHoldT += dt * 1000;
    const holdReady = interactHoldT >= cfg.promptHoldMs;
    const tap = !eDown && prevE && interactHoldT > 40 && interactHoldT < cfg.promptHoldMs;
    if (!eDown) interactHoldT = 0;

    const pause = down("Escape") || pausePulse > 0;
    const inspect = down("KeyI") || down("Tab") || inspectPulse > 0;

    const actions: Actions = {
      moveX: mx,
      moveY: my,
      lookX: lookX + touchLookDX + gp.lx * 18,
      lookY: lookY + touchLookDY + gp.ly * 18,
      lookSens: 0.0022 * cfg.lookSensitivity,
      invertY: cfg.invertY,
      autoSprint: cfg.autoSprint,
      jump,
      jumpPressed: (jump && !prevJump) || jumpPulse > 0,
      crouch: down("ControlLeft") || down("ControlRight") || down("KeyC"),
      sprint: down("ShiftLeft") || down("ShiftRight"),
      interact: eDown,
      interactPressed: tap || interactPulse > 0,
      interactHold: holdReady && eDown,
      inspect,
      selector: down("KeyQ") || (holdReady && eDown),
      pausePressed: (pause && !prevPause) || pausePulse > 0,
      operateRaise: down("KeyR"),
      operateLower: down("KeyF"),
      operateLeft: down("KeyZ"),
      operateRight: down("KeyX"),
      operateBrake: down("KeyB"),
      operateVent: down("KeyV"),
      operateOpen: down("KeyG"),
      operateClose: down("KeyT"),
    };
    lookX = 0;
    lookY = 0;
    touchLookDX = 0;
    touchLookDY = 0;
    if (interactPulse > 0) interactPulse -= 1;
    if (inspectPulse > 0) inspectPulse -= 1;
    if (pausePulse > 0) pausePulse -= 1;
    if (jumpPulse > 0) jumpPulse -= 1;
    prevJump = jump && jumpPulse <= 0;
    prevE = eDown;
    prevPause = pause && pausePulse <= 0;
    return actions;
  }

  function setTouchMove(x: number, y: number) {
    const v = radial(x, y, getSettings().moveDeadzone);
    touchMoveX = v.x;
    touchMoveY = v.y;
  }
  function setTouchLookDelta(dx: number, dy: number) {
    const k = 0.42 * getSettings().lookSensitivity;
    touchLookDX += dx * k;
    touchLookDY += dy * k;
  }
  /** @deprecated stick-look kept for tests; prefer setTouchLookDelta */
  function setTouchLook(x: number, y: number) {
    const v = radial(x, y, 0.08);
    touchLookDX += v.x * 10;
    touchLookDY += v.y * 10;
  }
  function hold(code: string, on: boolean) {
    if (code === "KeyE") {
      interactHeld = on;
      if (!on) return;
      return;
    }
    if (on) keys.add(code);
    else keys.delete(code);
  }
  function pulse(code: string) {
    if (code === "KeyE") interactPulse = 3;
    else if (code === "KeyI") inspectPulse = 3;
    else if (code === "Escape") pausePulse = 3;
    else if (code === "Space") jumpPulse = 3;
    else {
      keys.add(code);
      window.setTimeout(() => keys.delete(code), 90);
    }
  }
  function inject(codes: string[]) {
    injected = codes.slice();
  }
  function suppressLook(ms = 350) {
    ignoreLookUntil = performance.now() + ms;
    lookX = 0;
    lookY = 0;
    touchLookDX = 0;
    touchLookDY = 0;
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
    setTouchLook,
    setTouchLookDelta,
    hold,
    pulse,
    inject,
    suppressLook,
    dispose,
    down,
  };
}

export type Input = ReturnType<typeof createInput>;
