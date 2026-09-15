export type Actions = {
  moveX: number;
  moveY: number;
  lookX: number;
  lookY: number;
  jump: boolean;
  jumpPressed: boolean;
  crouch: boolean;
  sprint: boolean;
  interact: boolean;
  interactPressed: boolean;
  inspect: boolean;
  toolWheel: boolean;
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
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "Digit5",
  "Digit6",
  "Digit7",
  "Digit8",
]);

function radial(x: number, y: number, dz = 0.15): { x: number; y: number } {
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
  let prevInteract = false;
  let prevPause = false;
  let touchMoveX = 0;
  let touchMoveY = 0;
  let touchLookX = 0;
  let touchLookY = 0;
  let ignoreLookUntil = 0;
  let interactPulse = 0;
  let inspectPulse = 0;
  let pausePulse = 0;

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

  function pollGamepad(): { mx: number; my: number; lx: number; ly: number } {
    let mx = 0;
    let my = 0;
    let lx = 0;
    let ly = 0;
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) {
      if (!p || p.mapping !== "standard") continue;
      const ls = radial(p.axes[0] ?? 0, p.axes[1] ?? 0);
      mx += ls.x;
      my += -ls.y;
      const rs = radial(p.axes[2] ?? 0, p.axes[3] ?? 0, 0.12);
      lx += rs.x;
      ly += rs.y;
      if (p.buttons[0]?.pressed) keys.add("Space");
      if (p.buttons[1]?.pressed) keys.add("ControlLeft");
      if (p.buttons[9]?.pressed) keys.add("Escape");
      if (p.buttons[7]!.value > 0.4) keys.add("ShiftLeft");
    }
    return { mx, my, lx, ly };
  }

  function sample(): Actions {
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

    const jump = down("Space");
    const interact = down("KeyE") || interactPulse > 0;
    const pause = down("Escape") || pausePulse > 0;
    const inspect = down("KeyI") || down("Tab") || inspectPulse > 0;
    const actions: Actions = {
      moveX: mx,
      moveY: my,
      lookX: lookX + touchLookX * 10 + gp.lx * 18,
      lookY: lookY + touchLookY * 10 + gp.ly * 18,
      jump,
      jumpPressed: jump && !prevJump,
      crouch: down("ControlLeft") || down("ControlRight") || down("KeyC"),
      sprint: down("ShiftLeft") || down("ShiftRight"),
      interact,
      interactPressed: (interact && !prevInteract) || interactPulse > 0,
      inspect,
      toolWheel: down("KeyQ"),
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
    if (interactPulse > 0) interactPulse -= 1;
    if (inspectPulse > 0) inspectPulse -= 1;
    if (pausePulse > 0) pausePulse -= 1;
    prevJump = jump;
    prevInteract = interact && interactPulse <= 0;
    prevPause = pause && pausePulse <= 0;
    return actions;
  }

  function setTouchMove(x: number, y: number) {
    const v = radial(x, y, 0.12);
    touchMoveX = v.x;
    touchMoveY = v.y;
  }
  function setTouchLook(x: number, y: number) {
    const v = radial(x, y, 0.1);
    touchLookX = v.x;
    touchLookY = v.y;
  }
  function hold(code: string, on: boolean) {
    if (on) keys.add(code);
    else keys.delete(code);
  }
  function pulse(code: string) {
    if (code === "KeyE") interactPulse = 3;
    else if (code === "KeyI") inspectPulse = 3;
    else if (code === "Escape") pausePulse = 3;
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
  }
  function dispose() {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("visibilitychange", onVis);
    document.removeEventListener("mousemove", onMouse);
    canvas.removeEventListener("contextmenu", onContext);
  }

  return { sample, setTouchMove, setTouchLook, hold, pulse, inject, suppressLook, dispose, down };
}

export type Input = ReturnType<typeof createInput>;
