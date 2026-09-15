import * as THREE from "three";
import type { Level } from "./level.ts";
import type { Settings } from "./settings.ts";

/** Presentation only. Never writes simulation state. */
export function applyGraphics(
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  level: Level,
  settings: Settings,
) {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  renderer.setPixelRatio(Math.min(dpr, settings.pixelRatioCap));
  const shadowsOn = settings.shadows !== "off";
  renderer.shadowMap.enabled = shadowsOn;
  renderer.shadowMap.needsUpdate = true;
  level.bindings.sun.castShadow = shadowsOn;
  const res = settings.shadows === "high" ? 2048 : settings.shadows === "low" ? 1024 : 512;
  if (level.bindings.sun.shadow.mapSize.x !== res) {
    level.bindings.sun.shadow.mapSize.set(res, res);
    level.bindings.sun.shadow.map?.dispose();
  }
  camera.fov = settings.fov;
  camera.updateProjectionMatrix();

  const steamMat = level.bindings.steam.material as THREE.PointsMaterial;
  steamMat.opacity = 0.08 + 0.32 * settings.steamDensity;
  steamMat.size = 0.07 + 0.1 * settings.steamDensity;

  const low = settings.lightQuality === "low";
  for (const l of level.bindings.bayLights) {
    l.visible = !low;
    l.castShadow = false;
  }
  level.bindings.fill.intensity = low ? 0.32 : 0.85;
  level.bindings.wellLamp.intensity = low ? 16 : 32;
  level.bindings.hemi.intensity = low ? 0.72 : 1.05;
  level.bindings.amb.intensity = low ? 0.4 : 0.58;
  renderer.toneMappingExposure = low ? 1.18 : 1.32;
}

export function steamStep(level: Level, dt: number, on: boolean, density: number, reduced: boolean) {
  const pts = level.bindings.steam;
  pts.visible = on && density > 0.02;
  if (!pts.visible) return;
  const posAttr = pts.geometry.getAttribute("position") as THREE.BufferAttribute;
  const speed = (reduced ? 0.35 : 1) * (0.4 + density);
  for (let i = 0; i < posAttr.count; i++) {
    posAttr.setY(i, (posAttr.getY(i) + dt * 0.55 * speed) % 4 + 0.8);
  }
  posAttr.needsUpdate = true;
}
