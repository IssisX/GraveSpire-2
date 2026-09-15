import * as THREE from "three";
import { applyCoupling } from "./coupling.ts";
import { npcMutter } from "./npc-ai.ts";
import { tickSoundscape } from "./soundscape.ts";
import { dockEnvelope } from "@/sim/geometry.ts";
import { Simulation } from "@/sim/simulation.ts";
import { inspectTarget } from "@/sim/inspect.ts";
import { DISTRICT_META, districtAt, MODEL_CLASS } from "@/sim/types.ts";
import { endingCopy, evaluateMissions, inhabitantCanReachShop } from "@/sim/missions.ts";
import { applySave, captureSave, defaultPlayer, readSave, writeSave } from "@/sim/save.ts";
import { GameAudio } from "./audio.ts";
import { mantleProbe } from "./collision.ts";
import { commitAction, resolveContext, worldWarning, type CtxAction } from "./context.ts";
import { DIALOGUE, talk } from "./dialogue.ts";
import { createGait, gaitOffset, impulseGait, stepGait } from "./gait.ts";
import { applyGraphics } from "./graphics.ts";
import { createInput, detectTouch } from "./input.ts";
import { buildLevel } from "./level.ts";
import { OPENING_TOTAL, openingBeatAt, openingCamera } from "./opening.ts";
import { applyOperate, operateKind, operateStationId } from "./operate.ts";
import { Player } from "./player.ts";
import { getSettings, subscribeSettings } from "./settings.ts";
import { useGame } from "./store.ts";

export function mountGame(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.32;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(getSettings().fov, 1, 0.08, 160);
  const sim = new Simulation();
  const level = buildLevel(scene);
  const player = new Player();
  const input = createInput(canvas);
  const audio = new GameAudio();
  const gait = createGait();

  applyGraphics(renderer, camera, level, getSettings());
  audio.setMaster(getSettings().masterVolume);
  const unsubSettings = subscribeSettings((s) => {
    applyGraphics(renderer, camera, level, s);
    audio.setMaster(s.masterVolume);
  });

  let lastCarrier = { x: 0, y: 0, z: 0 };
  let accAuth = 0;
  let accPlayer = 0;
  let last = performance.now();
  let running = true;
  let work: { id: string; kind: "cut" | "brace"; t: number } | null = null;
  let hurtT = 0;
  let attractT = 0;
  let openingT = 0;
  let hintUntil = 0;
  let lastOperate: Record<string, boolean> = {};
  let prevActionId: string | null = null;

  const touch = detectTouch();
  useGame.getState().patch({ touch, ready: true, hasSave: Boolean(readSave()) });

  function resize() {
    const vv = window.visualViewport;
    const w = Math.round(vv?.width || canvas.clientWidth || window.innerWidth);
    const h = Math.round(vv?.height || canvas.clientHeight || window.innerHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    const settings = getSettings();
    camera.fov = camera.aspect < 0.62 ? Math.min(settings.fov, 70) : settings.fov;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.pixelRatioCap));
    const nextTouch = detectTouch();
    if (nextTouch !== useGame.getState().touch) useGame.getState().patch({ touch: nextTouch });
  }
  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);
  window.visualViewport?.addEventListener("resize", resize);

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
        /* touch / denied */
      }
    }
  }

  function setPhasePlaying() {
    audio.unlock();
    input.suppressLook(400);
    useGame.getState().patch({ phase: "playing", opening: null });
    if (!useGame.getState().touch) {
      window.setTimeout(() => {
        if (useGame.getState().phase !== "playing") return;
        input.suppressLook(250);
        requestLock();
      }, 40);
    }
  }

  canvas.addEventListener("click", () => {
    const phase = useGame.getState().phase;
    if (phase === "title") return;
    if (phase === "opening") {
      skipOpening();
      return;
    }
    if (phase === "playing" && !useGame.getState().touch && document.pointerLockElement !== canvas) {
      requestLock();
    }
  });

  let hadLock = false;
  document.addEventListener("pointerlockchange", () => {
    const locked = document.pointerLockElement === canvas;
    if (locked) hadLock = true;
    const phase = useGame.getState().phase;
    if (!locked && hadLock && phase === "playing" && !useGame.getState().touch) {
      useGame.getState().patch({ phase: "paused" });
    }
    if (!locked) hadLock = false;
  });
  document.addEventListener("visibilitychange", () => {
    audio.resume();
  });

  function bindView(px?: number, pz?: number) {
    const ui = useGame.getState();
    return applyCoupling(level, sim, px, pz, ui.slingA, ui.look?.id ?? null);
  }

  function flash(message: string) {
    useGame.getState().patch({ message });
    window.setTimeout(() => {
      if (useGame.getState().message === message) useGame.getState().patch({ message: null });
    }, 2800);
  }

  function persist() {
    writeSave(
      captureSave(sim, {
        x: player.x,
        y: player.y,
        z: player.z,
        yaw: player.yaw,
        pitch: player.pitch,
      }),
    );
    useGame.getState().patch({ hasSave: true });
  }

  function loadSave() {
    const blob = readSave();
    if (!blob) return false;
    const p = applySave(sim, blob);
    player.x = p.x;
    player.y = p.y;
    player.z = p.z;
    player.yaw = p.yaw;
    player.pitch = p.pitch;
    return true;
  }

  function pushHud() {
    const s = sim.state();
    const d = districtAt(player.x, player.z);
    useGame.getState().patch({
      snap: {
        tension_kn: s.freight.cable_tension_n / 1000,
        deflection_mm: s.frame.deflection_m * 1000,
        twist_deg: (s.frame.twist_rad * 180) / Math.PI,
        set_mm: s.frame.plastic_set_m * 1000,
        pressure_kpa: s.gate.pressure_pa / 1000,
        misalign_mm: s.gate.seal_misalignment_m * 1000,
        brake: s.freight.brake_engaged,
        brake_k: s.freight.brake_temperature_k,
        shop_v: s.electrical.voltage_shop,
        tick: s.authority_tick,
        time_s: s.sim_time_s,
        district: DISTRICT_META[d].name,
        districtShort: DISTRICT_META[d].short,
        carrierPower: s.electrical.carrier_powered,
        gateOpen: s.gate.angle_rad > 0.95,
        height_m: s.freight.height_m,
        lateral_m: s.freight.lateral_m,
        dock: dockEnvelope(s.freight),
      },
      objectives: evaluateMissions(s),
      events: s.events.slice(-6),
      warning: worldWarning(s),
    });
  }

  function bag() {
    return {
      sim,
      audio,
      inspect: (id: string) => {
        useGame.getState().patch({ inspect: inspectTarget(sim.state(), id), inspectOpen: true });
      },
      flash,
      startWork: (id: string, kind: "cut" | "brace") => {
        work = { id, kind, t: 0 };
      },
      enterOperate: (id: string) => {
        useGame.getState().patch({ operateId: id, operateKind: operateKind(id), selectorOpen: false });
      },
      exitOperate: () => {
        useGame.getState().patch({ operateId: null, operateKind: null });
      },
      startTalk: (npcId: string) => {
        if (!DIALOGUE[npcId]) return;
        document.exitPointerLock?.();
        useGame.getState().patch({
          phase: "dialogue",
          dialogue: talk(npcId, "open", sim.state()),
          selectorOpen: false,
        });
      },
      setSlingA: (id: string | null) => useGame.getState().patch({ slingA: id }),
      slingA: useGame.getState().slingA,
      persist,
      jump: () => player.requestJump(),
      mantle: () => {
        player.tryMantle(level.colliders);
      },
    };
  }

  function runCommit(action: CtxAction) {
    commitAction(action, bag());
  }
  function skipOpening() {
    openingT = OPENING_TOTAL;
    setPhasePlaying();
    hintUntil = performance.now() + 12000;
    useGame.getState().patch({
      hint: touch
        ? "Walk to the pulpit. Action on the pendant. Raise, then traverse east to the painted deck."
        : "Walk to the pulpit. E on the pendant. Raise, then traverse east to the painted deck.",
    });
  }

  function loop(now: number) {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const ui = useGame.getState();
    const actions = input.sample(dt);
    const settings = getSettings();

    if (ui.phase === "title") {
      attractT += dt;
      camera.up.set(0, 1, 0);
      camera.position.set(12.4 + Math.sin(attractT * 0.1) * 1.6, 7.35, 11.8);
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

    if (actions.pausePressed && ui.phase === "playing") {
      document.exitPointerLock?.();
      useGame.getState().patch({ phase: "paused", selectorOpen: false });
    } else if (actions.pausePressed && ui.phase === "paused") {
      setPhasePlaying();
    }

    if (ui.phase === "paused" || ui.phase === "dialogue" || ui.phase === "ending" || ui.phase === "dead") {
      renderer.render(scene, camera);
      requestAnimationFrame(loop);
      return;
    }

    accAuth += dt;
    while (accAuth >= 1 / 30) {
      sim.advanceAuthorityTick();
      accAuth -= 1 / 30;
    }

    const prev = lastCarrier;
    const pos = bindView(player.x, player.z);
    const platformDelta = { x: pos.x - prev.x, y: pos.y - prev.y, z: pos.z - prev.z };
    lastCarrier = pos;

    if (ui.phase === "opening") {
      openingT += dt;
      const cam = openingCamera(openingT);
      camera.up.set(0, 1, 0);
      camera.position.set(cam.x, cam.y, cam.z);
      camera.lookAt(cam.lx, cam.ly, cam.lz);
      const beat = openingBeatAt(openingT);
      useGame.getState().patch({ opening: beat.beat, openingIndex: beat.index });
      if (openingT >= OPENING_TOTAL || actions.interactPressed || actions.jumpPressed) {
        skipOpening();
      }
      if (sim.state().authority_tick % 8 === 0) pushHud();
      renderer.render(scene, camera);
      requestAnimationFrame(loop);
      return;
    }

    accPlayer += dt;
    const STEP = 1 / 60;
    while (accPlayer >= STEP) {
      player.step(STEP, actions, level.colliders, platformDelta);
      accPlayer -= STEP;
    }

    const fall = player.fallDamage();
    if (fall === "dead") {
      document.exitPointerLock?.();
      useGame.getState().patch({ phase: "dead", prompt: "No support. The well is real." });
    } else if (fall === "hurt") {
      hurtT = 0.8;
      impulseGait(gait, 0.55 * settings.shake);
      flash("Hard landing. The deck did not catch you.");
    }
    hurtT = Math.max(0, hurtT - dt);

    stepGait(
      gait,
      dt,
      {
        speed: player.speed,
        grounded: player.grounded,
        crouch: player.crouch,
        sprint: player.sprinting,
        forwardAccel: player.forwardAccel,
        yawRate: player.yawRate / Math.max(dt, 1e-4),
        landed: player.landed,
      },
      settings,
    );
    if (gait.foot) audio.footstep(player.sprinting);

    const f = player.forward();
    const mantle = Boolean(mantleProbe(player.x, player.y, player.z, f.x, f.z, level.colliders));
    const ctx = resolveContext({
      px: player.x,
      py: player.y,
      pz: player.z,
      eye: player.eye,
      yaw: player.yaw,
      pitch: player.pitch,
      interactables: level.interactables,
      colliders: level.colliders,
      state: sim.state(),
      prevActionId,
      operateId: ui.operateId,
      slingA: ui.slingA,
      mantle,
      grounded: player.grounded,
      speed: player.speed,
    });
    prevActionId = ctx.action?.id ?? prevActionId;
    const ambiguous = ctx.choices.filter((c) => c.commit !== "jump" && c.commit !== "inspect").length > 1;
    useGame.getState().patch({
      look: ctx.look,
      action: ctx.action,
      primary: ctx.primary,
      secondary: ctx.secondary,
      choices: ctx.choices,
      selectorOpen: actions.selector && ambiguous,
      prompt: ctx.primary?.prompt ?? "",
    });

    if (actions.interactPressed && ctx.primary && !ui.selectorOpen) {
      runCommit(ctx.primary);
    }
    if (actions.inspect && ctx.look) {
      useGame.getState().patch({ inspect: inspectTarget(sim.state(), ctx.look.id), inspectOpen: true });
      audio.beep(520, 0.06, 0.06);
    }

    if (ui.operateId) {
      const station = operateStationId(ui.operateKind) ?? ui.operateId;
      const it = level.interactables.find((x) => x.id === station);
      if (it) {
        const d = Math.hypot(player.x - it.x, player.z - it.z);
        if (d > 3.5) {
          useGame.getState().patch({ operateId: null, operateKind: null });
          flash("You left the station. Commands dropped.");
        }
      }
    }

    applyOperate(sim, useGame.getState().operateId, actions, lastOperate);

    if (work) {
      work.t += dt;
      const need = work.kind === "cut" ? 3.6 : 2.2;
      useGame.getState().patch({
        work: { label: work.kind === "cut" ? "Cutting member" : "Installing brace", progress: work.t / need },
      });
      const still = ctx.action && (ctx.action.id === work.id || ctx.action.id === "frame" || ctx.action.id === "neck_brace");
      if (!still) {
        work = null;
        useGame.getState().patch({ work: null });
      } else if (work.t >= need) {
        const msg =
          work.kind === "cut" ? sim.act({ type: "cut_member", id: work.id }) : sim.act({ type: "brace_member", id: work.id });
        flash(msg);
        audio.clank();
        work = null;
        useGame.getState().patch({ work: null });
      }
    }

    const off = gaitOffset(gait, settings);
    const r = player.right();
    const yaw = player.yaw + off.yaw;
    const pitch = player.pitch + off.pitch;
    camera.position.set(player.x + r.x * off.x, player.y + player.eye + off.y, player.z + r.z * off.x);
    camera.up.set(Math.sin(off.roll), Math.cos(off.roll), 0);
    camera.lookAt(
      camera.position.x - Math.sin(yaw) * Math.cos(pitch),
      camera.position.y + Math.sin(pitch),
      camera.position.z - Math.cos(yaw) * Math.cos(pitch),
    );

    tickSoundscape(audio, sim.state(), Boolean(useGame.getState().operateId));

    let mutter: string | null = null;
    if (ctx.action?.kind === "npc") {
      mutter = npcMutter(sim.state(), ctx.action.id, ctx.action.dist);
    } else if (ctx.look?.kind === "npc") {
      mutter = npcMutter(sim.state(), ctx.look.id, ctx.look.dist);
    }
    if (mutter !== ui.mutter) useGame.getState().patch({ mutter });

    if (hintUntil && now > hintUntil) {
      hintUntil = 0;
      useGame.getState().patch({ hint: null });
    }

    if (sim.state().authority_tick % 8 === 0) pushHud();
    else if (!ui.snap) pushHud();

    if (sim.state().flags.act_ended) {
      document.exitPointerLock?.();
      useGame.getState().patch({ phase: "ending", ending: endingCopy(sim.state()) });
    }

    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);

  const api = {
    start: () => {
      audio.unlock();
      const fresh = new Simulation();
      sim.replaceState(fresh.state());
      const sp = defaultPlayer();
      player.x = sp.x;
      player.y = sp.y;
      player.z = sp.z;
      player.yaw = sp.yaw;
      player.pitch = sp.pitch;
      player.vx = 0;
      player.vy = 0;
      player.vz = 0;
      openingT = 0;
      audio.unlock();
      useGame.getState().patch({
        phase: "opening",
        operateId: null,
        operateKind: null,
        inspectOpen: false,
        selectorOpen: false,
      });
      pushHud();
    },
    continueSave: () => {
      audio.unlock();
      if (loadSave()) {
        setPhasePlaying();
        pushHud();
        flash("Restored mid-state. Nothing settled. Nothing healed.");
      } else {
        api.start();
      }
    },
    resume: () => setPhasePlaying(),
    newGame: () => api.start(),
    skipOpening,
    load: () => {
      if (loadSave()) {
        setPhasePlaying();
        pushHud();
      }
    },
    save: () => {
      persist();
      flash("Snapshot written.");
    },
    chooseDialogue: (opt: string) => {
      const d = useGame.getState().dialogue;
      if (!d) return;
      const next = talk(d.npcId, opt, sim.state(), (act) => {
        flash(sim.act(act));
      });
      if (!next) {
        useGame.getState().patch({ dialogue: null, phase: "playing" });
        setPhasePlaying();
      } else {
        useGame.getState().patch({ dialogue: next });
      }
    },
    respawn: () => {
      if (!loadSave()) {
        const sp = defaultPlayer();
        player.x = sp.x;
        player.y = sp.y;
        player.z = sp.z;
      }
      setPhasePlaying();
    },
    setTouchMove: input.setTouchMove,
    setTouchLook: input.setTouchLook,
    setTouchLookDelta: input.setTouchLookDelta,
    hold: input.hold,
    pulse: input.pulse,
    pause: () => {
      document.exitPointerLock?.();
      useGame.getState().patch({ phase: "paused", selectorOpen: false });
    },
    inspectNow: () => {
      const look = useGame.getState().look;
      if (!look) {
        flash("Face a machine, member, or person first.");
        return;
      }
      useGame.getState().patch({ inspect: inspectTarget(sim.state(), look.id), inspectOpen: true });
      audio.beep(520, 0.06, 0.06);
    },
    commitChoice: (id: string) => {
      const choice = useGame.getState().choices.find((c) => c.id === id);
      if (!choice) return;
      useGame.getState().patch({ selectorOpen: false });
      runCommit(choice);
    },
    endAct: () => {
      const msg = sim.act({ type: "end_act" });
      flash(msg);
      if (sim.state().flags.act_ended) {
        document.exitPointerLock?.();
        useGame.getState().patch({ phase: "ending", ending: endingCopy(sim.state()) });
      }
    },
    recoverDrive: () => flash(sim.act({ type: "recover_drive" })),
    abandonDrive: () => flash(sim.act({ type: "abandon_drive" })),
    sim,
    player,
    stop: () => {
      running = false;
      unsubSettings();
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
    },
  };
  window.__gravespire = {
    sim,
    player,
    start: api.start,
    MODEL_CLASS,
    inhabitantCanReachShop: () => inhabitantCanReachShop(sim.state()),
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
