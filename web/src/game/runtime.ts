import * as THREE from "three";
import { Simulation } from "@/sim/simulation.ts";
import { inspectTarget } from "@/sim/inspect.ts";
import { DISTRICT_META, districtAt, MODEL_CLASS } from "@/sim/types.ts";
import { endingCopy, evaluateMissions, evaluateTraversal, inhabitantCanReachShop } from "@/sim/missions.ts";
import { applySave, captureSave, defaultPlayer, readSave, writeSave } from "@/sim/save.ts";
import { GameAudio } from "./audio.ts";
import { mantleProbe } from "./collision.ts";
import { commitAction, resolveContext, worldWarning, type CtxAction } from "./context.ts";
import { DIALOGUE, talk } from "./dialogue.ts";
import { createGait, gaitOffset, impulseGait, stepGait } from "./gait.ts";
import { applyGraphics, steamStep } from "./graphics.ts";
import { createInput, detectTouch } from "./input.ts";
import { buildLevel, carrierWorld } from "./level.ts";
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

  function lamp(mesh: THREE.Mesh, on: boolean, hot = false) {
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity = on ? (hot ? 1.8 : 1.25) : 0.06;
  }

  function bindView(px?: number, pz?: number) {
    const s = sim.state();
    const defl = s.frame.deflection_m;
    const pos = carrierWorld(s.freight.lateral_m, s.freight.height_m, Math.min(defl, 0.35));
    level.bindings.carrier.position.set(pos.x, pos.y, pos.z);
    const crateY = pos.y - 1.35;
    if (!s.freight.payload_released) {
      level.bindings.payload.visible = true;
      level.bindings.payload.position.set(pos.x, crateY, pos.z);
      level.bindings.payloadDeck.visible = false;
    } else {
      level.bindings.payload.visible = false;
      level.bindings.payloadDeck.visible = true;
      level.bindings.payloadDeck.position.set(20 + Math.max(4.2, s.freight.lateral_m), 3.15 - defl * 1.2, 0);
    }
    level.bindings.hookLight.position.set(pos.x, pos.y + 0.5, pos.z);
    level.bindings.hookLight.intensity = s.electrical.bay_lights ? 22 : 3;
    const gantryY = 11.1 - defl * 2.4;
    level.bindings.gantry.position.y = gantryY;
    level.bindings.trolley.position.x = pos.x - 22;
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
      if (px != null && pz != null) {
        const dx = px - n.x;
        const dz = pz - n.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 9 && dist > 0.25) g.rotation.y = Math.atan2(-dx, -dz);
        else g.rotation.y = n.yaw;
      } else {
        g.rotation.y = n.yaw;
      }
    }
    const shopOn = s.electrical.shop_powered;
    for (const m of level.bindings.shopLights) {
      (m.material as THREE.MeshStandardMaterial).emissiveIntensity = shopOn ? 0.9 : 0.05;
    }
    for (const l of level.bindings.bayLights) {
      if (l.visible) l.intensity = s.electrical.bay_lights ? 14 : 0.55;
    }

    const cfg = getSettings();
    const venting = sim.active("GateVent") || s.gate.pressure_pa < 200000;
    steamStep(level, 1 / 30, venting, cfg.steamDensity, cfg.reducedMotion);

    lamp(level.bindings.pendantLamps.power, s.electrical.carrier_powered);
    lamp(level.bindings.pendantLamps.brake, s.freight.brake_engaged, s.freight.brake_temperature_k > 400);
    lamp(level.bindings.pendantLamps.offset, Math.abs(s.freight.lateral_m - 16) > 1.8 || Math.abs(s.frame.twist_rad) > 0.008);
    const glass = level.bindings.pulpitGlass.material as THREE.MeshStandardMaterial;
    const twistK = Math.min(1, Math.abs(s.frame.twist_rad) / 0.04);
    glass.emissive.setRGB(0.35 + twistK * 0.45, 0.55 - twistK * 0.25, 0.62 - twistK * 0.4);
    glass.emissiveIntensity = s.electrical.carrier_powered ? 0.7 + twistK : 0.08;

    const lean = s.frame.twist_rad * 6 + defl * 8;
    for (const rod of level.bindings.telltales) {
      rod.rotation.z = lean;
      rod.rotation.x = defl * 4;
    }
    const strain = Math.min(1, Math.abs(s.frame.twist_rad) / 0.035 + defl / 0.12);
    const sm = level.bindings.strainMesh.material as THREE.MeshStandardMaterial;
    sm.emissive.setRGB(0.2 + strain * 0.7, 0.35 - strain * 0.2, 0.15);
    sm.emissiveIntensity = 0.2 + strain * 1.6;
    level.bindings.strainLamp.color.setRGB(0.3 + strain * 0.7, 0.25, 0.12);
    level.bindings.strainLamp.intensity = 0.3 + strain * 8;

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

    for (const it of level.interactables) {
      if (it.id === "carrier") {
        it.x = pos.x;
        it.y = pos.y;
        it.z = pos.z;
      }
      if (it.kind === "npc") {
        const n = s.npcs.find((x) => x.id === it.id);
        if (n) {
          it.x = n.x;
          it.y = n.y + 1.2;
          it.z = n.z;
        }
      }
    }
    return pos;
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
      hint: touch ? "Walk to the pulpit. Action on the pendant — not the hanging load." : "Walk to the pulpit. E on the pendant.",
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

    const load = Math.abs(sim.state().freight.vertical_velocity_mps) + Math.abs(sim.state().freight.lateral_velocity_mps);
    audio.setMotor(Math.min(1, load / 2.5), Boolean(useGame.getState().operateId));

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
