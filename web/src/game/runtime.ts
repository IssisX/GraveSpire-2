import * as THREE from "three";
import { Simulation } from "@/sim/simulation.ts";
import { inspectTarget } from "@/sim/inspect.ts";
import { DISTRICT_META, districtAt, MODEL_CLASS, type Act } from "@/sim/types.ts";
import {
  endingCopy,
  evaluateMissions,
  evaluateTraversal,
  inhabitantCanReachShop,
} from "@/sim/missions.ts";
import {
  applySave,
  captureSave,
  defaultPlayer,
  hasSave,
  readSave,
  writeSave,
} from "@/sim/save.ts";
import { GameAudio } from "./audio.ts";
import { createInput, detectTouch } from "./input.ts";
import { buildLevel, carrierWorld, type Interactable } from "./level.ts";
import { Player } from "./player.ts";
import { useGame, type MachineControlView, type Phase } from "./store.ts";
import { DIALOGUE, talk } from "./dialogue.ts";
import { Gait } from "./gait.ts";
import { ContextResolver, eyePose, type ContextResult } from "./context.ts";
import { lineOfSight } from "./collision.ts";
import { actionsFor, type ActionOption } from "./actions.ts";
import { MachineOperator, type MachineKind } from "./machine.ts";
import {
  DEFAULT_SETTINGS,
  deviceDefaults,
  prefersReducedMotion,
  readSettings,
  sanitize,
  writeSettings,
  type Settings,
} from "./settings.ts";
import { INTRO_BEATS, activeWarnings, currentGuidance, introAt } from "./opening.ts";

/** Hold this long on the action control to open the selector instead of acting. */
const SELECTOR_HOLD_S = 0.28;
/** Leaving a machine station by this factor of its reach ends the mode. */
const MACHINE_LEAVE_FACTOR = 1.7;

export function mountGame(canvas: HTMLCanvasElement) {
  const touch0 = detectTouch();
  let settings: Settings = { ...DEFAULT_SETTINGS, ...deviceDefaults(touch0), ...readSettings() };

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !touch0,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.32;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.08, 160);
  const sim = new Simulation();
  const level = buildLevel(scene);
  const player = new Player();
  const input = createInput(canvas);
  const audio = new GameAudio();
  const gait = new Gait();
  const resolver = new ContextResolver();
  const machine = new MachineOperator();

  const interactById = new Map<string, Interactable>();
  for (const it of level.interactables) interactById.set(it.id, it);

  let lastCarrier = { x: 0, y: 0, z: 0 };
  let accAuth = 0;
  let accPlayer = 0;
  let last = performance.now();
  let running = true;
  let work: { id: string; kind: "cut" | "brace"; t: number; need: number; label: string } | null = null;
  let attractT = 0;
  const bootStartMs = performance.now();
  let introT = 0;
  let interactHeldT = 0;
  let metRami = false;
  let hudTick = 0;
  const machineKeyPrev = new Map<string, boolean>();

  const shownAction = { label: "", kind: "" };
  const shownLook = { id: "", dist: -1 };

  useGame.getState().patch({ touch: touch0, settings, hasSave: hasSave() });

  // ---------------------------------------------------------------- settings
  function applySettings(next: Settings) {
    settings = next;
    input.applySettings(next);
    audio.setMasterVolume(next.masterVolume);
    gait.intensity = prefersReducedMotion() ? Math.min(next.gaitIntensity, 0.25) : next.gaitIntensity;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, next.renderScale * (touchNow() ? 1.4 : 2)));
    renderer.shadowMap.enabled = next.shadows;
    for (const obj of scene.children) {
      if (obj instanceof THREE.DirectionalLight && obj.castShadow) {
        obj.shadow.mapSize.set(next.shadowResolution, next.shadowResolution);
        if (obj.shadow.map) {
          obj.shadow.map.dispose();
          obj.shadow.map = null;
        }
      }
    }
    for (const l of level.bindings.optionalLights) l.visible = next.lightQuality === "high";

    const steamDraw = Math.round(level.bindings.steamCount * next.effectDensity);
    level.bindings.steam.geometry.setDrawRange(0, steamDraw);

    camera.fov = next.fov;
    camera.updateProjectionMatrix();
    resize();
    useGame.getState().patch({ settings: next });
  }

  function patchSettings(partial: Partial<Settings>) {
    const next = sanitize({ ...settings, ...partial });
    applySettings(next);
    writeSettings(next);
  }

  function touchNow(): boolean {
    return useGame.getState().touch;
  }

  // ------------------------------------------------------------------ layout
  function resize() {
    const vv = window.visualViewport;
    const w = Math.round(vv?.width || canvas.clientWidth || window.innerWidth);
    const h = Math.round(vv?.height || canvas.clientHeight || window.innerHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    // Folded portrait needs a slightly narrower frame to keep scale readable.
    camera.fov = camera.aspect < 0.62 ? settings.fov - 2 : settings.fov;
    camera.updateProjectionMatrix();
    const nextTouch = detectTouch();
    if (nextTouch !== useGame.getState().touch) useGame.getState().patch({ touch: nextTouch });
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);
  window.visualViewport?.addEventListener("resize", resize);
  applySettings(settings);

  // -------------------------------------------------------------- pointerlock
  function requestLock() {
    if (useGame.getState().touch) return;
    try {
      const p = canvas.requestPointerLock({ unadjustedMovement: true } as PointerLockOptions);
      if (p && typeof (p as Promise<void>).catch === "function") {
        (p as Promise<void>).catch(() => canvas.requestPointerLock());
      }
    } catch {
      try {
        canvas.requestPointerLock();
      } catch {
        /* touch or denied */
      }
    }
  }

  function setPhase(phase: Phase) {
    useGame.getState().patch({ phase });
  }

  function enterPlaying() {
    audio.unlock();
    audio.setMasterVolume(settings.masterVolume);
    input.suppressLook(400);
    input.releaseAll();
    interactHeldT = 0;
    setPhase("playing");
    if (!useGame.getState().touch) {
      window.setTimeout(() => {
        if (useGame.getState().phase !== "playing") return;
        input.suppressLook(250);
        requestLock();
      }, 40);
    }
  }

  function leavePlaying(phase: Phase) {
    document.exitPointerLock?.();
    input.releaseAll();
    interactHeldT = 0;
    machine.clearHolds();
    useGame.getState().patch({ selectorOpen: false });
    work = null;
    setPhase(phase);
  }

  canvas.addEventListener("click", () => {
    const phase = useGame.getState().phase;
    if (phase === "playing" && !useGame.getState().touch && document.pointerLockElement !== canvas) {
      requestLock();
    }
  });

  let hadLock = false;
  document.addEventListener("pointerlockchange", () => {
    const locked = document.pointerLockElement === canvas;
    if (locked) hadLock = true;
    if (!locked && hadLock && useGame.getState().phase === "playing" && !useGame.getState().touch) {
      leavePlaying("paused");
    }
    if (!locked) hadLock = false;
  });
  document.addEventListener("visibilitychange", () => {
    audio.resume();
    if (document.hidden) input.releaseAll();
  });

  // --------------------------------------------------------------- view bind
  function bindView() {
    const s = sim.state();
    const defl = s.frame.deflection_m;
    const pos = carrierWorld(s.freight.lateral_m, s.freight.height_m, Math.min(defl, 0.35));
    level.bindings.carrier.position.set(pos.x, pos.y, pos.z);

    if (!s.freight.payload_released) {
      level.bindings.payload.visible = true;
      // Pivot at the sheave; the authoritative pendulum angle is the rotation.
      level.bindings.payload.position.set(pos.x, pos.y, pos.z);
      level.bindings.payload.rotation.z = s.freight.payload_swing_rad;
      level.bindings.payloadDeck.visible = false;
    } else {
      level.bindings.payload.visible = false;
      level.bindings.payloadDeck.visible = true;
      level.bindings.payloadDeck.position.set(20 + Math.max(4.2, s.freight.lateral_m), 1.05, 0);
    }

    level.bindings.hookLight.position.set(pos.x, pos.y + 0.5, pos.z);
    level.bindings.hookLight.intensity = s.electrical.bay_lights ? 22 : 3;
    const gantryY = 11.1 - defl * 2.4;
    level.bindings.gantry.position.y = gantryY;
    const cableLen = Math.max(0.3, gantryY - pos.y - 0.4);
    level.bindings.cable.position.set(pos.x, pos.y + cableLen * 0.5 + 0.4, pos.z);
    level.bindings.cable.scale.set(1, cableLen, 1);
    level.bindings.frame.position.set(52, 4.6 - Math.min(defl, 0.35) * 4.0, 0);
    level.bindings.frame.rotation.z = s.frame.twist_rad * 3.0;
    level.bindings.gate.rotation.z = -s.gate.angle_rad;
    level.bindings.gate.rotation.x = s.gate.seal_misalignment_m * 2.4;
    level.bindings.gate.position.set(40.4, 3.2 - defl * 1.5, 0);

    const hot = (s.freight.brake_temperature_k - 293) / 160;
    (level.bindings.brakeGlow.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + Math.max(0, hot);

    // World cues for electrical stress: the console dims and the pulpit beacon
    // lights before the breaker actually lets go.
    const gen = s.electrical.breakers.find((b) => b.id === "brk_gen");
    const thermal = gen?.thermal ?? 0;
    const tripped = Boolean(gen?.tripped);
    const consoleMat = level.bindings.console.material as THREE.MeshStandardMaterial;
    consoleMat.emissiveIntensity = s.electrical.carrier_powered
      ? 0.55 - 0.22 * thermal + (thermal > 0.1 ? Math.sin(s.sim_time_s * 9) * 0.12 * thermal : 0)
      : 0.015;
    const beaconMat = level.bindings.beacon.material as THREE.MeshStandardMaterial;
    beaconMat.emissiveIntensity = tripped
      ? 1.6
      : thermal > 0.05
        ? 0.4 + 1.4 * thermal * (0.6 + 0.4 * Math.sin(s.sim_time_s * 7))
        : 0.03;

    for (const [id, mesh] of level.bindings.members) {
      const m = s.members.find((x) => x.id === id);
      if (!m) continue;
      mesh.visible = !m.cut;
      mesh.position.y = 2.15 - m.sag_m * 8;
      mesh.rotation.z = m.twist_rad * 4;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.color.set(m.braced ? 0x7a9aaa : m.jacked ? 0x8a7a4a : 0x8a949c);
    }
    for (const n of s.npcs) {
      const g = level.bindings.npcs.get(n.id);
      if (!g) continue;
      g.position.set(n.x, n.y, n.z);
      g.rotation.y = n.yaw;
    }

    const shopOn = s.electrical.shop_powered;
    for (const m of level.bindings.shopLights) {
      (m.material as THREE.MeshStandardMaterial).emissiveIntensity = shopOn ? 0.9 : 0.05;
    }
    // Bay fixtures sag as the process bus approaches its rating, then die with
    // it. The light is a reading of the electrical state, not decoration.
    for (const l of level.bindings.bayLights) {
      l.intensity = s.electrical.bay_lights ? 24 * (1 - 0.38 * thermal) : 0.9;
    }

    const venting = s.gate.vent_open || sim.active("GateVent");
    level.bindings.steam.visible = settings.effectDensity > 0 && (venting || s.gate.pressure_pa < 200000);
    if (level.bindings.steam.visible) {
      const posAttr = level.bindings.steam.geometry.getAttribute("position") as THREE.BufferAttribute;
      const rise = venting ? 0.026 : 0.008;
      const n = level.bindings.steam.geometry.drawRange.count;
      const count = n === Infinity ? posAttr.count : Math.min(n, posAttr.count);
      for (let i = 0; i < count; i++) {
        posAttr.setY(i, ((posAttr.getY(i) + rise) % 4) + 0.8);
      }
      posAttr.needsUpdate = true;
      level.bindings.steamMaterial.opacity = venting ? 0.5 : 0.24;
    }

    const carrierCol = level.colliders.find((c) => c.id === "carrier");
    if (carrierCol) {
      carrierCol.minx = pos.x - 2.2;
      carrierCol.maxx = pos.x + 2.2;
      carrierCol.miny = pos.y - 0.35;
      carrierCol.maxy = pos.y + 0.38;
      carrierCol.minz = pos.z - 1.55;
      carrierCol.maxz = pos.z + 1.55;
    }
    const gateCol = level.colliders.find((c) => c.id === "gate");
    if (gateCol) gateCol.disabled = s.gate.angle_rad > 0.95;

    const trav = evaluateTraversal(s);
    const shopDoor = level.colliders.find((c) => c.id === "shop_door");
    if (shopDoor) shopDoor.disabled = Boolean(trav.find((e) => e.id === "neck_to_shop")?.valid);
    const galDoor = level.colliders.find((c) => c.id === "gal_shop_door");
    if (galDoor) galDoor.disabled = Boolean(trav.find((e) => e.id === "gallery_to_shop")?.valid);

    // Interactables that ride moving bodies follow authoritative positions.
    const carrierIt = interactById.get("carrier");
    if (carrierIt) {
      carrierIt.x = pos.x;
      carrierIt.y = pos.y;
      carrierIt.z = pos.z;
    }
    for (const n of s.npcs) {
      const it = interactById.get(n.id);
      if (it) {
        it.x = n.x;
        it.y = n.y + 1.2;
        it.z = n.z;
      }
    }
    return pos;
  }

  // ----------------------------------------------------------------- actions
  function currentActionCtx() {
    const ui = useGame.getState();
    const a = ui.slingA;
    return { slingA: a, slingALabel: a ? (interactById.get(a)?.label ?? a) : null };
  }

  function optionsFor(it: Interactable): ActionOption[] {
    return actionsFor(sim.state(), it, currentActionCtx());
  }

  function flash(message: string) {
    useGame.getState().patch({ message });
    window.setTimeout(() => {
      if (useGame.getState().message === message) useGame.getState().patch({ message: null });
    }, 2800);
  }

  function openInspect(id: string) {
    useGame.getState().patch({ inspect: inspectTarget(sim.state(), id), inspectOpen: true });
    audio.beep(520, 0.06, 0.06);
  }

  function enterMachine(kind: MachineKind, stationId: string) {
    machine.enter(kind, stationId);
    machineKeyPrev.clear();
    audio.clank();
    pushMachine();
  }

  function exitMachine(reason?: string) {
    if (!machine.active) return;
    machine.exit();
    machine.applyHolds(sim.state(), (c, on) => sim.setCommand(c, on));
    useGame.getState().patch({ machine: null });
    if (reason) flash(reason);
  }

  function performAction(opt: ActionOption) {
    const s = sim.state();
    if (opt.refused) {
      flash(opt.refused);
      return;
    }
    switch (opt.kind) {
      case "talk": {
        if (!DIALOGUE[opt.targetId]) return;
        if (opt.targetId === "rami") metRami = true;
        leavePlaying("dialogue");
        useGame.getState().patch({ dialogue: talk(opt.targetId, "open", s) });
        return;
      }
      case "inspect":
        openInspect(opt.targetId);
        return;
      case "operate":
        if (opt.machine) enterMachine(opt.machine, resolver.actionId ?? opt.targetId);
        return;
      case "breaker": {
        flash(sim.act({ type: "toggle_breaker", id: opt.targetId }));
        audio.beep(180, 0.1, 0.1);
        return;
      }
      case "sling_attach": {
        const label = interactById.get(opt.targetId)?.label ?? opt.targetId;
        useGame.getState().patch({ slingA: opt.targetId });
        flash(`Sling on ${label}. Find a compatible second attachment.`);
        return;
      }
      case "sling_commit": {
        const a = useGame.getState().slingA;
        if (!a) return;
        flash(sim.act({ type: "sling", a, b: opt.targetId }));
        useGame.getState().patch({ slingA: null });
        audio.clank();
        return;
      }
      case "sling_clear": {
        if (useGame.getState().slingA) {
          useGame.getState().patch({ slingA: null });
          flash("Sling attachment cancelled.");
        } else {
          flash(sim.act({ type: "clear_sling" }));
        }
        return;
      }
      case "brace":
      case "cut": {
        work = {
          id: opt.targetId,
          kind: opt.kind === "cut" ? "cut" : "brace",
          t: 0,
          need: opt.work?.seconds ?? 2.5,
          label: opt.kind === "cut" ? "Cutting member" : "Installing brace",
        };
        return;
      }
      case "jack_on":
      case "jack_off": {
        flash(sim.act({ type: "jack_member", id: opt.targetId, on: opt.kind === "jack_on" }));
        audio.clank();
        return;
      }
      case "bench_save": {
        sim.act({ type: "mark_save_used" });
        persist();
        flash("Authority snapshot written. The building will not heal.");
        audio.beep(440, 0.12, 0.1);
        return;
      }
      case "recover_drive": {
        flash(sim.act({ type: "recover_drive" }));
        audio.clank();
        return;
      }
    }
  }

  // ---------------------------------------------------------------- machines
  function machineControlViews(): MachineControlView[] {
    const def = machine.def;
    if (!def) return [];
    const s = sim.state();
    return def.controls.map((c) => ({
      id: c.id,
      label: c.label,
      mode: c.mode,
      keyLabel: c.keyLabel,
      engaged: c.mode === "hold" ? machine.isHeld(c.id) : Boolean(c.engaged?.(s)),
      refused: c.refuse?.(s) ?? null,
    }));
  }

  function pushMachine() {
    const def = machine.def;
    if (!def) {
      if (useGame.getState().machine) useGame.getState().patch({ machine: null });
      return;
    }
    useGame.getState().patch({
      machine: {
        kind: def.kind,
        title: def.title,
        subtitle: def.subtitle,
        controls: machineControlViews(),
        readouts: def.readouts(sim.state()),
      },
    });
  }

  function triggerMachineControl(controlId: string) {
    const def = machine.def;
    if (!def) return;
    const c = def.controls.find((x) => x.id === controlId);
    if (!c) return;
    const s = sim.state();
    const refused = c.refuse?.(s) ?? null;
    if (refused) {
      flash(refused);
      return;
    }
    if (c.mode === "hold") return;
    if (c.offAct && c.engaged?.(s)) {
      flash(sim.act(c.offAct as Act));
      return;
    }
    if (c.act) {
      flash(sim.act(c.act as Act));
      audio.clank();
      return;
    }
    if (c.command) {
      sim.setCommand(c.command, true);
      sim.setCommand(c.command, false);
      audio.clank();
    }
  }

  function machineHoldControl(controlId: string, on: boolean) {
    machine.setHold(controlId, on);
  }

  function stepMachineKeys() {
    const def = machine.def;
    if (!def) return;
    for (const c of def.controls) {
      const pressed = input.down(c.key);
      if (c.mode === "hold") {
        machine.setHold(c.id, pressed);
      } else {
        const was = machineKeyPrev.get(c.key) ?? false;
        if (pressed && !was) triggerMachineControl(c.id);
      }
      machineKeyPrev.set(c.key, pressed);
    }
  }

  // ----------------------------------------------------------------- persist
  function persist() {
    writeSave(captureSave(sim, { x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch }));
    useGame.getState().patch({ hasSave: true });
  }

  function loadSave(): boolean {
    const blob = readSave();
    if (!blob) return false;
    const p = applySave(sim, blob);
    player.x = p.x;
    player.y = p.y;
    player.z = p.z;
    player.yaw = p.yaw;
    player.pitch = p.pitch;
    player.vx = 0;
    player.vy = 0;
    player.vz = 0;
    gait.reset(player.yaw);
    resolver.reset();
    exitMachine();
    metRami = true;
    return true;
  }

  function spawnFresh() {
    const sp = defaultPlayer();
    player.x = sp.x;
    player.y = sp.y;
    player.z = sp.z;
    player.yaw = sp.yaw;
    player.pitch = sp.pitch;
    player.vx = 0;
    player.vy = 0;
    player.vz = 0;
    gait.reset(player.yaw);
    resolver.reset();
    exitMachine();
  }

  // --------------------------------------------------------------- HUD state
  function pushHud() {
    const s = sim.state();
    useGame.getState().patch({
      objectives: evaluateMissions(s),
      guidance: currentGuidance(s, metRami),
      warnings: activeWarnings(s),
      events: s.events.slice(-6),
    });
  }

  function pushContext(
    action: ActionOption | null,
    options: ActionOption[],
    look: ContextResult["look"],
    outOfReach: ContextResult["outOfReach"],
  ) {
    const ui = useGame.getState();
    const nextLabel = action?.label ?? "";
    const nextKind = action?.kind ?? "";
    const lookId = look?.id ?? "";
    const lookDist = look ? Math.round(look.dist * 4) / 4 : -1;
    if (nextLabel === shownAction.label && nextKind === shownAction.kind && lookId === shownLook.id && lookDist === shownLook.dist) {
      return;
    }
    shownAction.label = nextLabel;
    shownAction.kind = nextKind;
    shownLook.id = lookId;
    shownLook.dist = lookDist;
    ui.patch({
      action,
      actionOptions: options,
      look: look ? { id: look.id, label: look.label, dist: look.dist, kind: look.kind } : null,
      outOfReach,
    });
  }

  function resolveContext() {
    const eye = eyePose(player.x, player.y + player.eye, player.z, player.yaw, player.pitch);
    return resolver.resolve(eye, level.interactables, level.colliders, (it) => optionsFor(it).length > 0);
  }

  // -------------------------------------------------------------- vent hazard
  /**
   * Declared reduced discharge hazard.
   *
   * While G-07's vent valve is open, the jet occupies a bounded region west of
   * the seal and pushes anything standing in it. The magnitude comes from the
   * authoritative vessel pressure. It is not a general fluid solver, and it
   * does not feed anything back into the simulation.
   */
  function applyVentHazard(dt: number) {
    const s = sim.state();
    if (!(s.gate.vent_open || sim.active("GateVent"))) return;
    if (s.gate.pressure_pa < 45000) return;
    const inJet =
      player.x > 35.4 &&
      player.x < 40.8 &&
      Math.abs(player.z) < 2.6 &&
      player.y > 0.2 &&
      player.y < 4.2;
    if (!inJet) return;
    const k = Math.min(1, s.gate.pressure_pa / 420000);
    player.vx -= 7.5 * k * dt;
    player.vz += (player.z >= 0 ? 1 : -1) * 1.6 * k * dt;
    if (hudTick % 30 === 0) flash("The discharge is pushing you off the seal. Stand clear or shut the valve.");
  }

  // -------------------------------------------------------------------- loop
  function loop(now: number) {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const ui = useGame.getState();
    const actions = input.sample(dt);
    const phase = ui.phase;

    // Machine hold commands are pushed every frame in every phase, so leaving a
    // mode or pausing can never strand a command in the authority.
    if (phase === "playing" && machine.active) stepMachineKeys();
    machine.applyHolds(sim.state(), (c, on) => sim.setCommand(c, on));

    // --- front end phases: the bay keeps running underneath -----------------
    if (phase === "boot" || phase === "menu") {
      // The splash is a UI timer, so it runs on wall clock. Frame dt is clamped
      // for simulation stability and would stretch the splash on a slow device.
      attractT += dt;
      if (phase === "boot" && now - bootStartMs > 1900) setPhase("menu");
      camera.position.set(12.4 + Math.sin(attractT * 0.1) * 1.6, 7.35, 11.8);
      camera.rotation.set(0, 0, 0);
      camera.lookAt(19.2, 3.1, 0);
      accAuth += dt;
      while (accAuth >= 1 / 30) {
        sim.advanceAuthorityTick();
        accAuth -= 1 / 30;
      }
      bindView();
      renderer.render(scene, camera);
      requestAnimationFrame(loop);
      return;
    }

    if (phase === "intro") {
      introT += dt;
      accAuth += dt;
      while (accAuth >= 1 / 30) {
        sim.advanceAuthorityTick();
        accAuth -= 1 / 30;
      }
      bindView();
      const frame = introAt(introT);
      if (!frame || actions.pausePressed || actions.interactPressed) {
        beginPlay();
      } else {
        const b = frame.beat;
        if (frame.handover > 0) {
          const h = frame.handover * frame.handover * (3 - 2 * frame.handover);
          camera.position.set(
            b.from[0] + (player.x - b.from[0]) * h,
            b.from[1] + (player.y + player.eye - b.from[1]) * h,
            b.from[2] + (player.z - b.from[2]) * h,
          );
          const tx = -Math.sin(player.yaw) * Math.cos(player.pitch);
          const ty = Math.sin(player.pitch);
          const tz = -Math.cos(player.yaw) * Math.cos(player.pitch);
          camera.lookAt(
            b.at[0] + (player.x + tx * 6 - b.at[0]) * h,
            b.at[1] + (player.y + player.eye + ty * 6 - b.at[1]) * h,
            b.at[2] + (player.z + tz * 6 - b.at[2]) * h,
          );
        } else {
          const drift = frame.local * 0.9;
          camera.position.set(b.from[0] + drift, b.from[1], b.from[2] - drift * 0.35);
          camera.lookAt(b.at[0], b.at[1], b.at[2]);
        }
        const shown = ui.intro;
        if (!shown || shown.index !== frame.index) {
          useGame.getState().patch({
            intro: { kicker: b.kicker, text: b.text, index: frame.index, total: INTRO_BEATS.length },
          });
        }
      }
      renderer.render(scene, camera);
      requestAnimationFrame(loop);
      return;
    }

    if (actions.pausePressed && (phase === "playing" || phase === "paused")) {
      if (phase === "playing") {
        if (useGame.getState().inspectOpen) useGame.getState().patch({ inspectOpen: false });
        else if (machine.active) exitMachine();
        else leavePlaying("paused");
      } else if (phase === "paused") {
        enterPlaying();
      }
      requestAnimationFrame(loop);
      return;
    }

    if (phase !== "playing") {
      renderer.render(scene, camera);
      requestAnimationFrame(loop);
      return;
    }

    // --- authority ----------------------------------------------------------
    accAuth += dt;
    while (accAuth >= 1 / 30) {
      sim.advanceAuthorityTick();
      accAuth -= 1 / 30;
    }
    hudTick++;

    const prev = lastCarrier;
    const pos = bindView();
    const platformDelta = { x: pos.x - prev.x, y: pos.y - prev.y, z: pos.z - prev.z };
    lastCarrier = pos;

    // --- player -------------------------------------------------------------
    accPlayer += dt;
    const STEP = 1 / 60;
    let guard = 0;
    while (accPlayer >= STEP && guard++ < 6) {
      player.step(STEP, actions, level.colliders, platformDelta);
      accPlayer -= STEP;
    }
    if (guard >= 6) accPlayer = 0;
    applyVentHazard(dt);

    const landing = player.takeLandingImpact();
    if (landing > 0.6) audio.land(landing);

    const fall = player.fallDamage();
    if (fall === "dead") {
      leavePlaying("dead");
      useGame.getState().patch({ prompt: "No support. The well is real." });
      requestAnimationFrame(loop);
      return;
    }
    if (fall === "hurt") flash("Hard landing. The deck did not catch you.");

    // --- contextual resolution ---------------------------------------------
    const ctx = resolveContext();
    const actionIt = ctx.action ? interactById.get(ctx.action.id) : undefined;
    const options = actionIt ? optionsFor(actionIt) : [];
    const dominant = options[0] ?? null;
    pushContext(dominant, options, ctx.look, ctx.outOfReach);
    if (useGame.getState().selectorOpen && options.length < 2) {
      useGame.getState().patch({ selectorOpen: false });
    }

    // --- interaction --------------------------------------------------------
    if (machine.active) {
      const station = interactById.get(machine.active.stationId);
      if (station) {
        const d = Math.hypot(station.x - player.x, station.y - (player.y + player.eye), station.z - player.z);
        if (d > station.reach * MACHINE_LEAVE_FACTOR) {
          exitMachine("Stepped away from the controls.");
        }
      }
      if (actions.interactPressed) exitMachine();
      pushMachine();
    } else {
      if (actions.interactPressed) interactHeldT = 0;
      if (actions.interact) interactHeldT += dt;

      if (actions.interact && interactHeldT > SELECTOR_HOLD_S && options.length > 1) {
        if (!useGame.getState().selectorOpen) useGame.getState().patch({ selectorOpen: true });
      }
      if (actions.interactReleased) {
        const heldLong = interactHeldT > SELECTOR_HOLD_S;
        interactHeldT = 0;
        if (useGame.getState().selectorOpen) {
          if (!heldLong) useGame.getState().patch({ selectorOpen: false });
        } else if (!heldLong) {
          if (dominant) performAction(dominant);
          else if (ctx.outOfReach) {
            flash(`${ctx.outOfReach.label} is ${ctx.outOfReach.dist.toFixed(1)} m away. Get within ${ctx.outOfReach.need.toFixed(1)} m.`);
          }
        }
      }
      if (actions.cyclePressed && options.length > 1) {
        useGame.getState().patch({ selectorOpen: !useGame.getState().selectorOpen });
      }
    }

    if (actions.inspectPressed) {
      const id = ctx.look?.id ?? ctx.action?.id ?? null;
      if (id) openInspect(id);
      else flash("Face a machine, member, board, or person first.");
    }

    // --- slow work ----------------------------------------------------------
    if (work) {
      const stillOn = ctx.action?.id === work.id;
      if (!stillOn) {
        work = null;
        useGame.getState().patch({ work: null });
      } else {
        work.t += dt;
        useGame.getState().patch({ work: { label: work.label, progress: work.t / work.need } });
        if (work.t >= work.need) {
          const msg =
            work.kind === "cut"
              ? sim.act({ type: "cut_member", id: work.id })
              : sim.act({ type: "brace_member", id: work.id });
          flash(msg);
          audio.clank();
          work = null;
          useGame.getState().patch({ work: null });
        }
      }
    }

    // --- camera presentation ------------------------------------------------
    const g = gait.update({
      dt,
      speed: player.speed,
      vx: player.vx,
      vz: player.vz,
      yaw: player.yaw,
      grounded: player.grounded,
      crouch: player.crouch,
      landingImpact: landing,
      moveInput: player.moveInput,
    });
    if (g.step) audio.foot(g.stepStrength, g.step === 1);

    const camYaw = player.yaw + g.yaw;
    const camPitch = player.pitch + g.pitch;
    const rx = Math.cos(camYaw);
    const rz = -Math.sin(camYaw);
    const fx = -Math.sin(camYaw) * Math.cos(camPitch);
    const fz = -Math.cos(camYaw) * Math.cos(camPitch);
    camera.position.set(
      player.x + rx * g.offsetRight + fx * g.offsetForward,
      player.y + player.eye + g.offsetUp,
      player.z + rz * g.offsetRight + fz * g.offsetForward,
    );
    camera.rotation.set(camPitch, camYaw, g.roll, "YXZ");

    // --- audio --------------------------------------------------------------
    const s = sim.state();
    const load = Math.abs(s.freight.vertical_velocity_mps) + Math.abs(s.freight.lateral_velocity_mps);
    audio.setMotor(Math.min(1, load / 2.5), Boolean(machine.active));
    audio.setVent(s.gate.vent_open || sim.active("GateVent"), Math.min(1, s.gate.pressure_pa / 420000));

    if (hudTick % 6 === 0 || !useGame.getState().objectives.length) pushHud();

    if (s.flags.act_ended) {
      leavePlaying("ending");
      useGame.getState().patch({ ending: endingCopy(s) });
    }

    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }

  function beginPlay() {
    useGame.getState().patch({ intro: null });
    enterPlaying();
    pushHud();
  }

  requestAnimationFrame(loop);

  const api = {
    // front end -------------------------------------------------------------
    skipBoot: () => {
      if (useGame.getState().phase === "boot") setPhase("menu");
    },
    newGame: () => {
      audio.unlock();
      sim.replaceState(new Simulation().state());
      spawnFresh();
      metRami = false;
      introT = 0;
      useGame.getState().patch({ intro: null, inspectOpen: false, selectorOpen: false, slingA: null });
      pushHud();
      setPhase("intro");
    },
    continueSave: () => {
      audio.unlock();
      if (loadSave()) {
        enterPlaying();
        pushHud();
        flash("Restored mid-state. Nothing settled. Nothing healed.");
      } else {
        api.newGame();
      }
    },
    openSettings: () => {
      const cur = useGame.getState().phase;
      useGame.getState().patch({ settingsReturn: cur === "settings" ? "menu" : cur, phase: "settings" });
      document.exitPointerLock?.();
    },
    closeSettings: () => {
      const back = useGame.getState().settingsReturn;
      if (back === "playing") enterPlaying();
      else setPhase(back);
    },
    setSetting: (partial: Partial<Settings>) => patchSettings(partial),
    resetSettings: () => patchSettings({ ...DEFAULT_SETTINGS, ...deviceDefaults(touchNow()) }),
    toMenu: () => {
      leavePlaying("menu");
      useGame.getState().patch({ hasSave: hasSave() });
    },

    // in play ---------------------------------------------------------------
    resume: () => enterPlaying(),
    pause: () => leavePlaying("paused"),
    save: () => {
      persist();
      flash("Snapshot written.");
    },
    load: () => {
      if (loadSave()) {
        enterPlaying();
        pushHud();
      } else flash("No snapshot to load.");
    },
    respawn: () => {
      if (!loadSave()) spawnFresh();
      enterPlaying();
    },
    closeInspect: () => useGame.getState().patch({ inspectOpen: false }),
    chooseDialogue: (opt: string) => {
      const d = useGame.getState().dialogue;
      if (!d) return;
      const next = talk(d.npcId, opt, sim.state(), (act) => flash(sim.act(act)));
      if (!next) {
        useGame.getState().patch({ dialogue: null });
        enterPlaying();
      } else {
        useGame.getState().patch({ dialogue: next });
      }
    },
    endAct: () => {
      const msg = sim.act({ type: "end_act" });
      flash(msg);
      if (sim.state().flags.act_ended) {
        leavePlaying("ending");
        useGame.getState().patch({ ending: endingCopy(sim.state()) });
      }
    },

    // contextual control ----------------------------------------------------
    performOption: (index: number) => {
      const opts = useGame.getState().actionOptions;
      const opt = opts[index];
      useGame.getState().patch({ selectorOpen: false });
      if (opt) performAction(opt);
    },
    closeSelector: () => useGame.getState().patch({ selectorOpen: false }),
    inspectNow: () => {
      const ctx = resolveContext();
      const id = ctx.look?.id ?? ctx.action?.id ?? null;
      if (!id) {
        flash("Face a machine, member, board, or person first.");
        return;
      }
      openInspect(id);
    },

    // machine mode ----------------------------------------------------------
    machineHold: (controlId: string, on: boolean) => machineHoldControl(controlId, on),
    machineTrigger: (controlId: string) => {
      triggerMachineControl(controlId);
      pushMachine();
    },
    exitMachine: () => exitMachine(),

    // touch plumbing --------------------------------------------------------
    setTouchMove: input.setTouchMove,
    addTouchLook: input.addTouchLook,
    setTouchInteract: input.setTouchInteract,
    setJump: (on: boolean) => input.hold("Space", on),
    setCrouch: (on: boolean) => input.hold("ControlLeft", on),

    sim,
    player,
    stop: () => {
      running = false;
      input.dispose();
      audio.dispose();
      level.dispose();
      renderer.dispose();
      window.removeEventListener("resize", resize);
      window.removeEventListener("orientationchange", resize);
      window.visualViewport?.removeEventListener("resize", resize);
    },
  };

  window.__controlsTest = {
    getYaw: () => player.yaw,
    getSpeed: () => player.speed,
    getPos: () => ({ x: player.x, y: player.y, z: player.z }),
    setKeys: (codes: string[]) => input.inject(codes),
    setPose: (p: { x: number; y: number; z: number; yaw?: number; pitch?: number }) => {
      player.x = p.x;
      player.y = p.y;
      player.z = p.z;
      if (p.yaw != null) player.yaw = p.yaw;
      if (p.pitch != null) player.pitch = p.pitch;
      player.vx = 0;
      player.vy = 0;
      player.vz = 0;
      gait.reset(player.yaw);
    },
  };
  window.__gravespire = {
    sim,
    player,
    level,
    los: (ox: number, oy: number, oz: number, tx: number, ty: number, tz: number, ignore?: string) =>
      lineOfSight(ox, oy, oz, tx, ty, tz, level.colliders, ignore ? new Set([ignore]) : undefined),
    MODEL_CLASS,
    district: () => DISTRICT_META[districtAt(player.x, player.z)].name,
    inhabitantCanReachShop: () => inhabitantCanReachShop(sim.state()),
    resolveContext,
  };

  useGame.getState().patch({ ready: true });
  return api;
}

export type GameHandle = ReturnType<typeof mountGame>;

declare global {
  interface Window {
    __controlsTest?: {
      getYaw: () => number;
      getSpeed: () => number;
      getPos: () => { x: number; y: number; z: number };
      setKeys: (codes: string[]) => void;
      setPose: (p: { x: number; y: number; z: number; yaw?: number; pitch?: number }) => void;
    };
    __gravespire?: Record<string, unknown>;
    __game?: GameHandle;
  }
}
