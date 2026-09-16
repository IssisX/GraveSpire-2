import * as THREE from "three";
import { attachmentWorld, dockEnvelope, DOCK_WORLD_X, DOCK_WORLD_Y } from "@/sim/geometry.ts";
import { evaluateTraversal, neckWalkClear } from "@/sim/missions.ts";
import type { Simulation } from "@/sim/simulation.ts";
import type { Collider } from "./collision.ts";
import { steamStep } from "./graphics.ts";
import type { Level } from "./level.ts";
import { carrierWorld } from "./level.ts";
import { applyRubeCoupling } from "./rube-world.ts";
import { applyLinkedCascadeCoupling } from "./linked-world.ts";
import { applySpringShuttleCoupling } from "./spring-shuttle-world.ts";
import type { SkyWitness } from "./sky-world.ts";
import { applyRecoveryWorld } from "./recovery-world.ts";
import { getSettings } from "./settings.ts";

function lamp(mesh: THREE.Mesh, on: boolean, hot = false) {
  const mat = mesh.material as THREE.MeshStandardMaterial;
  mat.emissiveIntensity = on ? (hot ? 1.8 : 1.25) : 0.06;
}

const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();

function placeRope(mesh: THREE.Mesh, ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz) || 0.01;
  mesh.position.set((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
  mesh.scale.set(1, len, 1);
  _dir.set(dx / len, dy / len, dz / len);
  mesh.quaternion.setFromUnitVectors(_up, _dir);
}

/** Presentation of authority. Never writes WorldState. */
export function applyCoupling(
  level: Level,
  sim: Simulation,
  px?: number,
  pz?: number,
  slingA?: string | null,
  lookId?: string | null,
  witness?: SkyWitness,
): { x: number; y: number; z: number } {
  const s = sim.state();
  const defl = s.frame.deflection_m;
  const pos = carrierWorld(s.freight.lateral_m, s.freight.height_m, Math.min(defl, 0.35));
  const b = level.bindings;

  b.carrier.position.set(pos.x, pos.y, pos.z);
  const crateY = pos.y - 1.35;
  if (!s.freight.payload_released) {
    b.payload.visible = true;
    b.payload.position.set(pos.x, crateY, pos.z);
    b.payloadDeck.visible = false;
  } else {
    b.payload.visible = false;
    b.payloadDeck.visible = true;
    b.payloadDeck.position.set(DOCK_WORLD_X, DOCK_WORLD_Y + 0.85, 0);
  }
  b.hookLight.position.set(pos.x, pos.y + 0.5, pos.z);
  b.hookLight.intensity = s.electrical.bay_lights ? 22 : 3;
  const gantryY = 11.1 - defl * 2.4;
  b.gantry.position.y = gantryY;
  b.trolley.position.x = pos.x - 22;
  const cableLen = Math.max(0.3, gantryY - pos.y - 0.4);
  b.cable.position.set(pos.x, pos.y + cableLen * 0.5 + 0.4, pos.z);
  b.cable.scale.set(1, cableLen, 1);
  b.frame.position.set(52, 4.6 - Math.min(defl, 0.35) * 4.0, 0);
  b.frame.rotation.z = s.frame.twist_rad * 3.0;
  b.gate.rotation.z = -s.gate.angle_rad;
  b.gate.rotation.x = s.gate.seal_misalignment_m * 2.4;
  b.gate.position.set(40.4, 3.2 - defl * 1.5, 0);

  const hot = (s.freight.brake_temperature_k - 293) / 160;
  (b.brakeGlow.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + Math.max(0, hot);

  for (const [id, mesh] of b.members) {
    const m = s.members.find((x) => x.id === id);
    if (!m) continue;
    mesh.visible = !m.cut;
    if (m.role === "gallery_span") {
      mesh.position.y = 2.15 - m.sag_m * 8;
      mesh.rotation.z = m.twist_rad * 4;
    }
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.color.set(m.braced ? 0x7a9aaa : m.jacked ? 0x8a7a4a : 0x8a949c);
    if (id === "neck_brace") {
      mesh.visible = true;
      const matB = mesh.material as THREE.MeshStandardMaterial;
      matB.transparent = true;
      matB.opacity = m.braced ? 1 : 0.22;
      matB.color.set(m.braced ? 0x7a9aaa : 0x5a5050);
    }
  }

  for (const [id, slab] of b.gallerySlabs) {
    const m = s.members.find((x) => x.id === id);
    const col = level.colliders.find((c) => c.id === `slab_${id}`);
    if (!m) continue;
    if (m.cut) {
      slab.position.y = 1.15;
      slab.rotation.z = 0.18;
      slab.visible = true;
      if (col) col.disabled = true;
    } else {
      slab.position.y = 2.31 - m.sag_m * 6;
      slab.rotation.z = m.twist_rad * 2;
      if (col) col.disabled = false;
    }
  }

  for (const n of s.npcs) {
    const g = b.npcs.get(n.id);
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

  const cfg = getSettings();
  const shopOn = s.electrical.shop_powered;
  for (const m of b.shopLights) {
    (m.material as THREE.MeshStandardMaterial).emissiveIntensity = shopOn ? 0.9 : 0.05;
  }
  for (const l of b.bayLights) {
    if (l.visible) level.atmosphere.setLampBase(l, s.electrical.bay_lights ? 14 : 0.55);
  }
  level.atmosphere.setLampBase(
    b.wellLamp,
    s.electrical.bay_lights ? (cfg.lightQuality === "low" ? 16 : 32) : 7,
  );
  b.hemi.intensity = s.electrical.bay_lights ? (cfg.lightQuality === "low" ? 0.72 : 1.05) : 0.38;
  b.amb.intensity = s.electrical.bay_lights ? (cfg.lightQuality === "low" ? 0.4 : 0.58) : 0.18;

  const venting = sim.active("GateVent") || s.gate.pressure_pa < 200000;
  steamStep(level, 1 / 30, venting, cfg.steamDensity, cfg.reducedMotion);

  lamp(b.pendantLamps.power, s.electrical.carrier_powered);
  lamp(b.pendantLamps.brake, s.freight.brake_engaged, s.freight.brake_temperature_k > 400);
  lamp(b.pendantLamps.offset, Math.abs(s.freight.lateral_m - 16) > 1.8 || Math.abs(s.frame.twist_rad) > 0.008);
  const glass = b.pulpitGlass.material as THREE.MeshStandardMaterial;
  const twistK = Math.min(1, Math.abs(s.frame.twist_rad) / 0.04);
  glass.emissive.setRGB(0.35 + twistK * 0.45, 0.55 - twistK * 0.25, 0.62 - twistK * 0.4);
  glass.emissiveIntensity = s.electrical.carrier_powered ? 0.7 + twistK : 0.08;

  const lean = s.frame.twist_rad * 6 + defl * 8;
  for (const rod of b.telltales) {
    rod.rotation.z = lean;
    rod.rotation.x = defl * 4;
  }
  const strain = Math.min(1, Math.abs(s.frame.twist_rad) / 0.035 + defl / 0.12);
  const sm = b.strainMesh.material as THREE.MeshStandardMaterial;
  sm.emissive.setRGB(0.2 + strain * 0.7, 0.35 - strain * 0.2, 0.15);
  sm.emissiveIntensity = 0.2 + strain * 1.6;
  b.strainLamp.color.setRGB(0.3 + strain * 0.7, 0.25, 0.12);
  b.strainLamp.intensity = 0.3 + strain * 8;

  const env = dockEnvelope(s.freight);
  lamp(b.dockLamps.ok, env === "in" && s.freight.brake_engaged);
  lamp(b.dockLamps.close, env === "close" || env === "in");
  lamp(b.dockLamps.far, env === "offset", true);
  (b.dockChevrons.material as THREE.MeshStandardMaterial).emissiveIntensity = env === "in" ? 1.1 : env === "close" ? 0.45 : 0.08;

  lamp(b.gateLamps.power, s.electrical.gate_powered);
  lamp(b.gateLamps.pressure, s.gate.pressure_pa > 180000, s.gate.pressure_pa > 300000);
  lamp(b.gateLamps.open, s.gate.angle_rad > 0.95);
  b.gateNeedle.rotation.z = -Math.min(1.1, s.gate.pressure_pa / 420000) * 1.4;
  b.wedgePin.visible = s.gate.wedged;
  b.wedgePin.position.y = s.gate.wedged ? 1.1 : 0.35;

  for (const brk of s.electrical.breakers) {
    const handle = b.breakerHandles.get(brk.id);
    const lampM = b.breakerLamps.get(brk.id);
    if (handle) handle.rotation.z = brk.closed && !brk.tripped ? 0.55 : -0.7;
    if (lampM) lamp(lampM, brk.closed && !brk.tripped, brk.tripped);
  }
  const busOn = s.electrical.voltage_process > 40;
  for (const run of b.busRuns) {
    (run.material as THREE.MeshStandardMaterial).emissiveIntensity = busOn ? 0.55 : 0.04;
  }
  for (const strip of b.emergency) {
    (strip.material as THREE.MeshStandardMaterial).emissiveIntensity = s.electrical.bay_lights ? 0.05 : 1.15;
  }

  const neckJacked = Boolean(s.members.find((m) => m.id === "neck_brace")?.jacked) || sim.active("FrameJack");
  b.jackStand.visible = neckJacked;
  b.jackStand.position.y = neckJacked ? 0.55 + Math.min(0.25, defl) : 0.2;

  const trav = evaluateTraversal(s);
  const galleryNpc = trav.find((e) => e.id === "gallery_span")?.npc_safe ?? false;
  b.galleryChain.visible = !galleryNpc;

  const present = s.flags.drive_present;
  b.driveHousing.visible = present;
  b.driveWreck.visible = s.flags.drive_abandoned;
  const driveCol = level.colliders.find((c) => c.id === "drive_box");
  if (driveCol) driveCol.disabled = !present && !s.flags.drive_abandoned;

  const mis = s.gate.seal_misalignment_m;
  b.neckPlates[0]!.position.y = 0.08 + Math.max(0, mis) * 4;
  b.neckPlates[1]!.position.y = 0.08 - Math.max(0, mis) * 3;
  b.neckPlates[0]!.rotation.z = s.frame.twist_rad * 2;

  const sling = s.cables.find((c) => c.id === "sling");
  if (sling) {
    const a = attachmentWorld(s, sling.a);
    const bb = attachmentWorld(s, sling.b);
    if (a && bb) {
      b.slingRope.visible = true;
      placeRope(b.slingRope, a.x, a.y, a.z, bb.x, bb.y, bb.z);
    }
    b.slingPreview.visible = false;
  } else if (slingA) {
    const a = attachmentWorld(s, slingA);
    const bb = lookId ? attachmentWorld(s, lookId) : px != null && pz != null ? { x: px, y: 1.4, z: pz } : null;
    if (a && bb) {
      b.slingPreview.visible = true;
      const posAttr = b.slingPreview.geometry.getAttribute("position") as THREE.BufferAttribute;
      posAttr.setXYZ(0, a.x, a.y, a.z);
      posAttr.setXYZ(1, bb.x, bb.y, bb.z);
      posAttr.needsUpdate = true;
      b.slingPreview.computeLineDistances();
    }
    b.slingRope.visible = false;
  } else {
    b.slingRope.visible = false;
    b.slingPreview.visible = false;
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
  const shopDoor = level.colliders.find((c) => c.id === "shop_door");
  if (shopDoor) shopDoor.disabled = Boolean(trav.find((e) => e.id === "neck_to_shop")?.valid);
  const galDoor = level.colliders.find((c) => c.id === "gal_shop_door");
  if (galDoor) galDoor.disabled = Boolean(trav.find((e) => e.id === "gallery_to_shop")?.valid);
  const neckGap = level.colliders.find((c) => c.id === "neck_gap");
  if (neckGap) neckGap.disabled = neckWalkClear(s);

  for (const it of level.interactables) {
    if (it.id === "carrier" || it.id === "cable") {
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

  applyRubeCoupling(level, sim);
  applyLinkedCascadeCoupling(level, sim);
  applySpringShuttleCoupling(level, sim, witness);
  applyRecoveryWorld(level, sim);
  return pos;
}

export function disableCollider(col: Collider | undefined, disabled: boolean) {
  if (col) col.disabled = disabled;
}
