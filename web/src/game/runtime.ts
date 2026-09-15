import * as THREE from "three";
import { Simulation } from "@/sim/simulation.ts";
import { inspectTarget } from "@/sim/inspect.ts";
import { DISTRICT_META, districtAt, MODEL_CLASS, type Command } from "@/sim/types.ts";
import {
  endingCopy,
  evaluateMissions,
  evaluateTraversal,
  inhabitantCanReachShop,
} from "@/sim/missions.ts";
import { applySave, captureSave, defaultPlayer, readSave, writeSave, type PlayerSave } from "@/sim/save.ts";
import { GameAudio } from "./audio.ts";
import { createInput, detectTouch, type Input } from "./input.ts";
import { buildLevel, carrierWorld, type Level } from "./level.ts";
import { Player } from "./player.ts";
import { useGame, type Tool } from "./store.ts";
import { DIALOGUE, talk } from "./dialogue.ts";

const TOOL_KEYS: Tool[] = ["inspect", "operate", "isolate", "sling", "brace", "jack", "cut", "talk"];

export function mountGame(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, detectTouch() ? 1.2 : 1.75));
  renderer.shadowMap.enabled = !detectTouch() && window.innerWidth > 900;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.32;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, 1, 0.08, 160);
  const sim = new Simulation();
  const level = buildLevel(scene);
  const player = new Player();
  const input = createInput(canvas);
  const audio = new GameAudio();

  let lastCarrier = { x: 0, y: 0, z: 0 };
  let accAuth = 0;
  let accPlayer = 0;
  let last = performance.now();
  let running = true;
  let work: { id: string; kind: "cut" | "brace" | "jack"; t: number } | null = null;
  let hurtT = 0;
  let attractT = 0;
  let inspectHold = 0;
  let lastOperate: Record<string, boolean> = {};

  const touch = detectTouch();
  useGame.getState().patch({ touch, ready: true });

  function resize() {
    const vv = window.visualViewport;
    const w = Math.round(vv?.width || canvas.clientWidth || window.innerWidth);
    const h = Math.round(vv?.height || canvas.clientHeight || window.innerHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.fov = camera.aspect < 0.62 ? 70 : 72;
    camera.updateProjectionMatrix();
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
    useGame.getState().patch({ phase: "playing" });
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
    if (document.hidden) {
      audio.resume();
    } else audio.resume();
  });

  function bindView() {
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
      g.rotation.y = n.yaw;
    }
    const shopOn = s.electrical.shop_powered;
    for (const m of level.bindings.shopLights) {
      (m.material as THREE.MeshStandardMaterial).emissiveIntensity = shopOn ? 0.9 : 0.05;
    }
    for (const l of level.bindings.bayLights) {
      l.intensity = s.electrical.bay_lights ? 14 : 0.55;
    }
    level.bindings.steam.visible = sim.active("GateVent") || s.gate.pressure_pa < 200000;
    if (level.bindings.steam.visible) {
      const posAttr = level.bindings.steam.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < posAttr.count; i++) {
        posAttr.setY(i, (posAttr.getY(i) + 0.01) % 4 + 0.8);
      }
      posAttr.needsUpdate = true;
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
    if (gateCol) {
      const open = s.gate.angle_rad > 0.95;
      gateCol.disabled = open;
    }
    const trav = evaluateTraversal(s);
    const shopDoor = level.colliders.find((c) => c.id === "shop_door");
    if (shopDoor) {
      const neck = trav.find((e) => e.id === "neck_to_shop");
      shopDoor.disabled = Boolean(neck?.valid);
    }
    const galDoor = level.colliders.find((c) => c.id === "gal_shop_door");
    if (galDoor) {
      galDoor.disabled = Boolean(trav.find((e) => e.id === "gallery_to_shop")?.valid);
    }

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

  function closestLook(): { id: string; label: string; dist: number; kind: (typeof level.interactables)[0]["kind"] } | null {
    const f = player.forward();
    const origin = new THREE.Vector3(player.x, player.y + player.eye, player.z);
    const dir = new THREE.Vector3(-Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch), -Math.cos(player.yaw) * Math.cos(player.pitch));
    let best: ReturnType<typeof closestLook> = null;
    for (const it of level.interactables) {
      const dx = it.x - origin.x;
      const dy = it.y - origin.y;
      const dz = it.z - origin.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < 0.2) continue;
      const maxd = it.kind === "machine" ? 14 : it.kind === "npc" ? 3.4 : 4.2;
      if (dist > maxd) continue;
      const nd = dist || 1;
      const dot = (dx / nd) * dir.x + (dy / nd) * dir.y + (dz / nd) * dir.z;
      if (dot < 0.55) continue;
      if (!best || dist < best.dist) best = { id: it.id, label: it.label, dist, kind: it.kind };
    }
    void f;
    return best;
  }

  function applyOperate(id: string | null, actions: ReturnType<Input["sample"]>) {
    const hold = (cmd: Command, on: boolean) => {
      if (lastOperate[cmd] === on) return;
      lastOperate[cmd] = on;
      sim.setCommand(cmd, on);
    };
    const carrier = id === "carrier" || id === "cable" || id === "dock";
    const gate = id === "gate";
    const frame = id === "frame" || id === "neck_brace";
    hold("CarrierRaise", carrier && actions.operateRaise);
    hold("CarrierLower", carrier && actions.operateLower);
    hold("CarrierLeft", carrier && actions.operateLeft);
    hold("CarrierRight", carrier && actions.operateRight);
    if (carrier && actions.operateBrake && !lastOperate["brakePulse"]) {
      lastOperate["brakePulse"] = true;
      sim.setCommand("CarrierBrake", true);
      sim.setCommand("CarrierBrake", false);
    }
    if (!actions.operateBrake) lastOperate["brakePulse"] = false;
    hold("GateVent", gate && actions.operateVent);
    hold("GateOpen", gate && actions.operateOpen);
    hold("GateClose", gate && actions.operateClose);
    hold("FrameJack", frame && actions.operateRaise);
    if (id !== "carrier" && id !== "cable" && id !== "dock" && id !== "gate" && id !== "frame" && id !== "neck_brace") {
      hold("CarrierRaise", false);
      hold("CarrierLower", false);
      hold("CarrierLeft", false);
      hold("CarrierRight", false);
      hold("GateVent", false);
      hold("GateOpen", false);
      hold("GateClose", false);
      hold("FrameJack", false);
    }
  }

  function interact(look: NonNullable<ReturnType<typeof closestLook>>) {
    const tool = useGame.getState().tool;
    const s = sim.state();
    if (tool === "talk" || look.kind === "npc") {
      const d = DIALOGUE[look.id];
      if (d) {
        document.exitPointerLock?.();
        useGame.getState().patch({
          phase: "dialogue",
          dialogue: talk(look.id, "open", s),
        });
      }
      return;
    }
    if (look.id === "drive" && (tool === "operate" || tool === "isolate")) {
      const msg = sim.act({ type: "recover_drive" });
      flash(msg);
      audio.clank();
      return;
    }
    if (tool === "inspect") {
      useGame.getState().patch({ inspect: inspectTarget(s, look.id), inspectOpen: true });
      audio.beep(520, 0.06, 0.06);
      return;
    }
    if (tool === "operate") {
      useGame.getState().patch({ operateId: look.id, prompt: operatePrompt(look.id) });
      audio.clank();
      return;
    }
    if (tool === "isolate") {
      if (look.id.startsWith("brk_") || look.id === "board") {
        const id = look.id === "board" ? "brk_shop" : look.id;
        const msg = sim.act({ type: "toggle_breaker", id });
        flash(msg);
        audio.beep(180, 0.1, 0.1);
      } else if (look.id === "gate") {
        sim.setCommand("GateVent", true);
        setTimeout(() => sim.setCommand("GateVent", false), 4000);
        flash("Venting gate inventory.");
        audio.hiss();
      }
      return;
    }
    if (tool === "sling") {
      const a = useGame.getState().slingA;
      if (!a) {
        useGame.getState().patch({ slingA: look.id, prompt: `Sling first attachment: ${look.label}. Select second.` });
      } else {
        const msg = sim.act({ type: "sling", a, b: look.id });
        useGame.getState().patch({ slingA: null, prompt: msg });
        flash(msg);
      }
      return;
    }
    if (tool === "cut" && look.kind === "member") {
      work = { id: look.id, kind: "cut", t: 0 };
      return;
    }
    if (tool === "brace" && (look.kind === "member" || look.id === "frame" || look.id === "neck_brace")) {
      work = { id: look.id === "frame" ? "neck_brace" : look.id, kind: "brace", t: 0 };
      return;
    }
    if (tool === "jack" && (look.kind === "member" || look.id === "frame")) {
      const id = look.id === "frame" ? "neck_brace" : look.id;
      const msg = sim.act({ type: "jack_member", id, on: true });
      flash(msg);
      return;
    }
    if (look.kind === "bench") {
      if (!s.electrical.shop_powered) {
        flash("Bench is dead. Shop is not an island yet.");
        return;
      }
      sim.act({ type: "mark_save_used" });
      persist();
      flash("Authority snapshot written. The building will not heal.");
      audio.beep(440, 0.12, 0.1);
      return;
    }
    if (look.id === "dock" || look.id === "carrier") {
      const msg = sim.act({ type: "carrier_release" });
      flash(msg);
    }
  }

  function operatePrompt(id: string): string {
    if (id === "carrier" || id === "cable") return "R raise  F lower  Z/X traverse  B brake  E release over deck";
    if (id === "gate") return "G open  T close  V vent  (pressure and jam are real)";
    if (id === "frame" || id === "neck_brace") return "R jack  ·  Brace tool to install a path";
    return "Physical commands only.";
  }

  function flash(message: string) {
    useGame.getState().patch({ message });
    window.setTimeout(() => {
      if (useGame.getState().message === message) useGame.getState().patch({ message: null });
    }, 2800);
  }

  function persist() {
    const blob = captureSave(sim, {
      x: player.x,
      y: player.y,
      z: player.z,
      yaw: player.yaw,
      pitch: player.pitch,
    });
    writeSave(blob);
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
      },
      objectives: evaluateMissions(s),
      events: s.events.slice(-6),
    });
  }

  function loop(now: number) {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const ui = useGame.getState();
    const actions = input.sample();

    if (ui.phase === "title") {
      attractT += dt;
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
      useGame.getState().patch({ phase: "paused" });
    } else if (actions.pausePressed && ui.phase === "paused") {
      setPhasePlaying();
    }

    if (ui.phase === "paused" || ui.phase === "dialogue" || ui.phase === "ending" || ui.phase === "dead") {
      renderer.render(scene, camera);
      requestAnimationFrame(loop);
      return;
    }

    // tool wheel / number keys
    if (actions.toolWheel && !ui.toolWheel) useGame.getState().patch({ toolWheel: true });
    if (!actions.toolWheel && ui.toolWheel) useGame.getState().patch({ toolWheel: false });
    for (let i = 0; i < 8; i++) {
      if (input.down(`Digit${i + 1}`)) useGame.getState().patch({ tool: TOOL_KEYS[i]!, toolWheel: false });
    }

    if (actions.inspect) inspectHold += dt;
    else inspectHold = 0;
    if (inspectHold > 0.25 && ui.look) {
      useGame.getState().patch({ inspect: inspectTarget(sim.state(), ui.look.id), inspectOpen: true });
    }

    accAuth += dt;
    while (accAuth >= 1 / 30) {
      sim.advanceAuthorityTick();
      accAuth -= 1 / 30;
    }

    const prev = lastCarrier;
    const pos = bindView();
    const platformDelta = { x: pos.x - prev.x, y: pos.y - prev.y, z: pos.z - prev.z };
    lastCarrier = pos;

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
      flash("Hard landing. The deck did not catch you.");
    }
    hurtT = Math.max(0, hurtT - dt);

    const look = closestLook();
    useGame.getState().patch({ look });

    if (actions.interactPressed && look) interact(look);
    if (actions.interactPressed && !look && ui.operateId) {
      useGame.getState().patch({ operateId: null, prompt: "" });
    }

    applyOperate(ui.operateId ?? (ui.tool === "operate" ? look?.id ?? null : null), actions);

    if (work) {
      work.t += dt;
      const need = work.kind === "cut" ? 3.6 : 2.2;
      useGame.getState().patch({ work: { label: work.kind === "cut" ? "Cutting member" : "Installing brace", progress: work.t / need } });
      if (!look || look.id !== work.id && look.id !== "frame") {
        work = null;
        useGame.getState().patch({ work: null });
      } else if (work.t >= need) {
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

    const bob = Math.sin(player.bob * 6.2) * 0.035 * (player.grounded ? 1 : 0);
    camera.position.set(player.x, player.y + player.eye + bob, player.z);
    const cy = player.yaw;
    const cp = player.pitch;
    camera.lookAt(
      player.x - Math.sin(cy) * Math.cos(cp),
      player.y + player.eye + Math.sin(cp),
      player.z - Math.cos(cy) * Math.cos(cp),
    );

    const load =
      Math.abs(sim.state().freight.vertical_velocity_mps) + Math.abs(sim.state().freight.lateral_velocity_mps);
    audio.setMotor(Math.min(1, load / 2.5), Boolean(ui.operateId));
    audio.foot(dt, player.speed, player.grounded);

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
      const sp = defaultPlayer();
      player.x = sp.x;
      player.y = sp.y;
      player.z = sp.z;
      player.yaw = sp.yaw;
      player.pitch = sp.pitch;
      player.vx = 0;
      player.vy = 0;
      player.vz = 0;
      setPhasePlaying();
      pushHud();
      if (useGame.getState().touch) {
        flash("Left thumb walk. Right thumb look. Use on what you face.");
      }
    },
    continueSave: () => {
      audio.unlock();
      if (loadSave()) {
        setPhasePlaying();
        pushHud();
        flash("Restored mid-state. Nothing settled. Nothing healed.");
      } else {
        setPhasePlaying();
      }
    },
    resume: () => setPhasePlaying(),
    newGame: () => {
      const fresh = new Simulation();
      sim.replaceState(fresh.state());
      const sp = defaultPlayer();
      player.x = sp.x;
      player.y = sp.y;
      player.z = sp.z;
      player.yaw = sp.yaw;
      player.pitch = sp.pitch;
      setPhasePlaying();
      pushHud();
    },
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
        const msg = sim.act(act);
        flash(msg);
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
    setTool: (t: Tool) => useGame.getState().patch({ tool: t, toolWheel: false }),
    setTouchMove: input.setTouchMove,
    setTouchLook: input.setTouchLook,
    hold: input.hold,
    pulse: input.pulse,
    pause: () => {
      document.exitPointerLock?.();
      useGame.getState().patch({ phase: "paused" });
    },
    inspectNow: () => {
      const look = closestLook();
      if (!look) {
        flash("Face a machine, member, or person first.");
        return;
      }
      useGame.getState().patch({ inspect: inspectTarget(sim.state(), look.id), inspectOpen: true });
      audio.beep(520, 0.06, 0.06);
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
