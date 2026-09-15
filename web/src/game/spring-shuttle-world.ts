import * as THREE from "three";
import type { Simulation } from "@/sim/simulation.ts";
import { ensureLinkedCascadeState } from "@/sim/linked-cascade.ts";
import { SPRING_SHUTTLE, springShuttleWorld } from "@/sim/spring-shuttle.ts";
import { mechDof } from "@/sim/mechanical-network.ts";
import type { Collider } from "./collision.ts";
import type { Level } from "./level.ts";
import { makeSignTexture } from "./materials.ts";
import { applyUpperCascadeCoupling } from "./upper-world.ts";

type ShuttleBindings = {
  root: THREE.Group;
  platform: THREE.Group;
  latch: THREE.Mesh;
  spring: THREE.Group;
  platformCol: Collider;
};

const cache = new WeakMap<Level, ShuttleBindings>();

function sceneFor(level: Level): THREE.Scene {
  const p = level.bindings.carrier.parent;
  if (!(p instanceof THREE.Scene)) throw new Error("GRAVESPIRE level is not attached to a THREE.Scene");
  return p;
}

function geo<T extends THREE.BufferGeometry>(level: Level, g: T): T {
  level.geos.push(g);
  return g;
}

function addBox(
  level: Level,
  root: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  mat: THREE.Material,
  id?: string,
  collider = true,
): THREE.Mesh {
  const m = new THREE.Mesh(geo(level, new THREE.BoxGeometry(w, h, d)), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  root.add(m);
  if (collider) {
    level.colliders.push({
      id: id ?? "spring_shuttle_static",
      minx: x - w / 2,
      maxx: x + w / 2,
      miny: y - h / 2,
      maxy: y + h / 2,
      minz: z - d / 2,
      maxz: z + d / 2,
    });
  }
  return m;
}

function ensureWorld(level: Level): ShuttleBindings {
  const prior = cache.get(level);
  if (prior) return prior;
  const scene = sceneFor(level);
  const mats = level.materials;
  const root = new THREE.Group();
  root.name = "mechanical-cascade-04-spring-shuttle";
  scene.add(root);

  const signMat = new THREE.MeshStandardMaterial({
    map: makeSignTexture("MC-04", "SPRING SHUTTLE  ·  GRAVITY / PRELOAD / OSCILLATION"),
    metalness: 0.15,
    roughness: 0.65,
  });
  const sign = new THREE.Mesh(geo(level, new THREE.PlaneGeometry(6.8, 1.7)), signMat);
  sign.position.set(100.7, 6.2, -39.42);
  root.add(sign);

  addBox(level, root, 13.0, 0.32, 4.2, 110.0, SPRING_SHUTTLE.upperY - 0.16, SPRING_SHUTTLE.z, mats.grating, "spring_upper_catwalk");
  addBox(level, root, 0.30, 3.0, 0.30, 99.9, 6.5, SPRING_SHUTTLE.z - 1.9, mats.steelDark, undefined, false);
  addBox(level, root, 0.30, 3.0, 0.30, 103.7, 6.5, SPRING_SHUTTLE.z - 1.9, mats.steelDark, undefined, false);
  addBox(level, root, 0.30, 11.5, 0.30, 100.0, 6.3, SPRING_SHUTTLE.z + 1.9, mats.steelDark, undefined, false);
  addBox(level, root, 0.30, 11.5, 0.30, 103.6, 6.3, SPRING_SHUTTLE.z + 1.9, mats.steelDark, undefined, false);

  const platform = new THREE.Group();
  const deck = new THREE.Mesh(geo(level, new THREE.BoxGeometry(3.4, 0.34, 3.2)), mats.diamond);
  deck.position.y = -0.17;
  const frame = new THREE.Mesh(geo(level, new THREE.BoxGeometry(3.25, 0.12, 3.05)), mats.hazard);
  frame.position.y = 0.04;
  platform.add(deck, frame);
  for (const z of [-1.45, 1.45]) {
    const rail = new THREE.Mesh(geo(level, new THREE.BoxGeometry(3.1, 0.12, 0.10)), mats.steel);
    rail.position.set(0, 0.95, z);
    platform.add(rail);
  }
  root.add(platform);

  const platformCol: Collider = {
    id: "spring_shuttle_platform",
    minx: 0,
    maxx: 0,
    miny: 0,
    maxy: 0,
    minz: 0,
    maxz: 0,
  };
  level.colliders.push(platformCol);

  const latch = new THREE.Mesh(geo(level, new THREE.BoxGeometry(0.24, 0.58, 0.34)), mats.steel);
  latch.position.set(95.8, 2.75, SPRING_SHUTTLE.z + 1.5);
  root.add(latch);
  addBox(level, root, 1.1, 0.18, 0.18, 96.2, 2.42, SPRING_SHUTTLE.z + 1.5, mats.hazard, undefined, false);

  const spring = new THREE.Group();
  const springMat = new THREE.MeshStandardMaterial({ color: 0x8f9ca6, metalness: 0.82, roughness: 0.28 });
  for (let i = 0; i < 12; i++) {
    const ring = new THREE.Mesh(geo(level, new THREE.TorusGeometry(0.48, 0.055, 6, 18)), springMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = i / 11;
    spring.add(ring);
  }
  spring.position.set(SPRING_SHUTTLE.x - 1.15, SPRING_SHUTTLE.lowerY + 0.1, SPRING_SHUTTLE.z + 1.1);
  root.add(spring);

  const lamp = new THREE.PointLight(0xffbd73, 24, 24, 1.05);
  lamp.position.set(SPRING_SHUTTLE.x, 8.6, SPRING_SHUTTLE.z);
  root.add(lamp);

  const made = { root, platform, latch, spring, platformCol };
  cache.set(level, made);
  return made;
}

/** Presentation and moving-support projection only; authoritative motion lives in sim. */
export function applySpringShuttleCoupling(level: Level, sim: Simulation): void {
  const b = ensureWorld(level);
  const rube = sim.state().rube;
  if (!rube) return;
  const chain = ensureLinkedCascadeState(rube);
  const shuttle = mechDof(chain.network, "spring_shuttle");
  const latch = mechDof(chain.network, "spring_shuttle_latch");
  const w = springShuttleWorld(chain);

  b.platform.position.set(w.x, w.y, w.z);
  b.platformCol.minx = w.x - 1.7;
  b.platformCol.maxx = w.x + 1.7;
  b.platformCol.miny = w.y - 0.35;
  b.platformCol.maxy = w.y;
  b.platformCol.minz = w.z - 1.6;
  b.platformCol.maxz = w.z + 1.6;
  b.platformCol.surfaceVx = 0;
  b.platformCol.surfaceVy = w.vy;
  b.platformCol.surfaceVz = 0;

  b.latch.position.y = 2.75 + latch.q * 2.2;
  const compression = Math.max(0.18, shuttle.q / SPRING_SHUTTLE.travelM);
  const springHeight = 1.1 + compression * 5.2;
  b.spring.position.y = SPRING_SHUTTLE.lowerY + 0.12;
  b.spring.scale.y = springHeight;

  applyUpperCascadeCoupling(level, sim);
}
