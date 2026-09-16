import * as THREE from "three";
import type { Simulation } from "@/sim/simulation.ts";
import { ensureLinkedCascadeState } from "@/sim/linked-cascade.ts";
import { mc11World, mc12World, SKY } from "@/sim/sky-spine.ts";
import type { Collider } from "./collision.ts";
import type { Interactable, Level } from "./level.ts";
import { makeSignTexture } from "./materials.ts";
import { applyCompositionWorld } from "./composition-world.ts";

type SkyBindings = {
  root: THREE.Group;
  sail: THREE.Group;
  skyCar: THREE.Group;
  counterweight: THREE.Group;
  pendulum: THREE.Group;
  pendulumBallast: THREE.Group;
  bridge: THREE.Group;
  bridgeDeck: THREE.Mesh;
  skyCarCol: Collider;
  bridgeCol: Collider;
  pendulumCols: Collider[];
  pendulumBobCol: Collider;
  vultures: THREE.Group[];
};

/** Presentation witness only. It cannot alter player or simulation state. */
export type SkyWitness = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  chute: boolean;
};

const cache = new WeakMap<Level, SkyBindings>();

function sceneFor(level: Level): THREE.Scene {
  const p = level.bindings.carrier.parent;
  if (!(p instanceof THREE.Scene)) throw new Error("GRAVESPIRE level is not attached to a THREE.Scene");
  return p;
}

function geo<T extends THREE.BufferGeometry>(level: Level, g: T): T {
  level.geos.push(g);
  return g;
}

function addBox(level: Level, root: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, id?: string, collider = true): THREE.Mesh {
  const m = new THREE.Mesh(geo(level, new THREE.BoxGeometry(w, h, d)), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  root.add(m);
  if (collider) level.colliders.push({ id: id ?? "sky_static", minx: x - w / 2, maxx: x + w / 2, miny: y - h / 2, maxy: y + h / 2, minz: z - d / 2, maxz: z + d / 2 });
  return m;
}

function addInteract(level: Level, it: Interactable) {
  if (!level.interactables.some((x) => x.id === it.id)) level.interactables.push(it);
}

function makeVulture(level: Level): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x17191a, side: THREE.DoubleSide });
  const wingGeo = geo(level, new THREE.BufferGeometry());
  wingGeo.setAttribute("position", new THREE.Float32BufferAttribute([
    0, 0, 0, -1.3, 0.12, 0, -0.35, -0.1, 0,
    0, 0, 0, 1.3, 0.12, 0, 0.35, -0.1, 0,
  ], 3));
  wingGeo.setIndex([0, 1, 2, 3, 4, 5]);
  wingGeo.computeVertexNormals();
  g.add(new THREE.Mesh(wingGeo, mat));
  const body = new THREE.Mesh(geo(level, new THREE.CapsuleGeometry(0.08, 0.28, 3, 6)), mat);
  body.rotation.z = Math.PI / 2;
  g.add(body);
  return g;
}

function updatePendulumColliders(b: SkyBindings, angle: number, omega: number) {
  const segmentLength = SKY.pendulumLengthM / b.pendulumCols.length;
  const sx = Math.sin(angle);
  const cy = Math.cos(angle);
  for (let i = 0; i < b.pendulumCols.length; i++) {
    const c = b.pendulumCols[i]!;
    const along = (i + 0.5) * segmentLength;
    const x = SKY.pendulumPivotX + sx * along;
    const y = SKY.pendulumPivotY - cy * along;
    const hx = Math.abs(sx) * segmentLength * 0.5 + 0.54;
    const hy = Math.abs(cy) * segmentLength * 0.5 + 0.54;
    c.minx = x - hx;
    c.maxx = x + hx;
    c.miny = y - hy;
    c.maxy = y + hy;
    c.minz = SKY.z - 0.54;
    c.maxz = SKY.z + 0.54;
    c.surfaceVx = 0;
    c.surfaceVy = 0;
    c.surfaceVz = 0;
    c.surfaceAngularZ = omega;
    c.surfacePivotX = SKY.pendulumPivotX;
    c.surfacePivotY = SKY.pendulumPivotY;
  }

  const along = SKY.pendulumLengthM;
  const x = SKY.pendulumPivotX + sx * along;
  const y = SKY.pendulumPivotY - cy * along;
  const hx = Math.abs(cy) * 2.4 + Math.abs(sx) * 2.0;
  const hy = Math.abs(sx) * 2.4 + Math.abs(cy) * 2.0;
  const bob = b.pendulumBobCol;
  bob.minx = x - hx;
  bob.maxx = x + hx;
  bob.miny = y - hy;
  bob.maxy = y + hy;
  bob.minz = SKY.z - 2.2;
  bob.maxz = SKY.z + 2.2;
  bob.surfaceVx = 0;
  bob.surfaceVy = 0;
  bob.surfaceVz = 0;
  bob.surfaceAngularZ = omega;
  bob.surfacePivotX = SKY.pendulumPivotX;
  bob.surfacePivotY = SKY.pendulumPivotY;
}

function updateVultures(b: SkyBindings, w11: ReturnType<typeof mc11World>, w12: ReturnType<typeof mc12World>, witness?: SkyWitness) {
  const machineDisturbance = Math.min(
    1,
    Math.abs(w12.pendulum.omega) * 0.9 + Math.abs(w12.bridge.vx) * 0.18 + Math.abs(w11.sail.omega) * 0.35,
  );
  let playerDisturbance = 0;
  let fleeX = 0;
  let fleeZ = 0;
  if (witness) {
    const dx = witness.x - 285;
    const dz = witness.z - (SKY.z - 12);
    const dist = Math.hypot(dx, witness.y - 142, dz);
    const proximity = Math.max(0, Math.min(1, 1 - dist / 74));
    const falling = Math.max(0, Math.min(1, -witness.vy / 18));
    const trajectory = Math.max(0, Math.min(1, Math.hypot(witness.vx, witness.vz) / 9));
    playerDisturbance = proximity * (0.20 + falling * 0.62 + trajectory * 0.22 + (witness.chute ? 0.18 : 0));
    const planar = Math.hypot(dx, dz) || 1;
    fleeX = -dx / planar * playerDisturbance * 13;
    fleeZ = -dz / planar * playerDisturbance * 13;
  }
  const disturbance = Math.min(1, machineDisturbance + playerDisturbance);
  const t = performance.now() * 0.00016;
  for (let i = 0; i < b.vultures.length; i++) {
    const a = t * (0.72 + i * 0.08 + disturbance * 0.22) + i * 2.2;
    const radius = 18 + i * 7 + disturbance * 10;
    const bird = b.vultures[i]!;
    bird.position.set(
      285 + fleeX + Math.cos(a) * radius,
      142 + i * 6 + disturbance * 8 + Math.sin(a * 1.7) * (2.2 + disturbance * 2.5),
      SKY.z - 12 + fleeZ + Math.sin(a) * radius * 0.35,
    );
    bird.rotation.y = -a + Math.PI / 2;
    bird.rotation.z = Math.sin(a * (2.1 + disturbance)) * (0.12 + disturbance * 0.18);
  }
}

function ensureWorld(level: Level): SkyBindings {
  const prior = cache.get(level);
  if (prior) return prior;
  const scene = sceneFor(level);
  const mats = level.materials;
  const root = new THREE.Group();
  root.name = "mc11-12-sky-machine";
  scene.add(root);

  const sign11Mat = new THREE.MeshStandardMaterial({ map: makeSignTexture("MC-11", "WINDWARD HOIST  ·  EXPOSED SAIL / 38 t SKY-CAR"), metalness: 0.15, roughness: 0.68 });
  const sign11 = new THREE.Mesh(geo(level, new THREE.PlaneGeometry(8.8, 1.8)), sign11Mat);
  sign11.position.set(249, 96.5, SKY.z + 2.6);
  root.add(sign11);

  // Open crown apron: no enclosing floor under the machine. Height is gameplay.
  addBox(level, root, 14.0, 0.30, 4.8, 248.0, 91.0, SKY.z, mats.grating, "mc11_entry_apron");
  for (const x of [247.0, 269.0]) {
    addBox(level, root, 0.34, 39.0, 0.34, x, 111.0, SKY.z - 2.4, mats.steelDark, undefined, false);
    addBox(level, root, 0.34, 39.0, 0.34, x, 111.0, SKY.z + 2.4, mats.steelDark, undefined, false);
  }

  // Building-scale ~1,100 m² effective wind sail and drum.
  const sail = new THREE.Group();
  sail.position.set(SKY.sailPivotX, SKY.sailPivotY, SKY.z);
  const mast = new THREE.Mesh(geo(level, new THREE.CylinderGeometry(0.48, 0.48, 17.0, 12)), mats.steelDark);
  mast.rotation.z = Math.PI / 2;
  sail.add(mast);
  const panel = new THREE.Mesh(geo(level, new THREE.BoxGeometry(0.38, 16.0, 26.0)), mats.rust);
  panel.position.x = 7.6;
  sail.add(panel);
  const drum = new THREE.Mesh(geo(level, new THREE.CylinderGeometry(2.0, 2.0, 2.2, 18)), mats.steel);
  drum.rotation.z = Math.PI / 2;
  sail.add(drum);
  root.add(sail);

  const skyCar = new THREE.Group();
  const carDeck = new THREE.Mesh(geo(level, new THREE.BoxGeometry(6.4, 0.44, 5.0)), mats.diamond);
  carDeck.position.y = -0.22;
  const carFrame = new THREE.Mesh(geo(level, new THREE.BoxGeometry(5.8, 1.0, 4.4)), mats.steelDark);
  carFrame.position.y = -0.8;
  skyCar.add(carDeck, carFrame);
  root.add(skyCar);
  const skyCarCol: Collider = { id: "mc11_sky_car", minx: 0, maxx: 0, miny: 0, maxy: 0, minz: 0, maxz: 0 };
  level.colliders.push(skyCarCol);

  const counterweight = new THREE.Group();
  counterweight.add(new THREE.Mesh(geo(level, new THREE.BoxGeometry(4.4, 5.2, 4.2)), mats.carrier));
  root.add(counterweight);

  const sign12Mat = new THREE.MeshStandardMaterial({ map: makeSignTexture("MC-12", "PENDULUM CROWN  ·  70 t SWING / IMPACT TRANSFER"), metalness: 0.15, roughness: 0.68 });
  const sign12 = new THREE.Mesh(geo(level, new THREE.PlaneGeometry(8.8, 1.8)), sign12Mat);
  sign12.position.set(275.5, 137.0, SKY.z + 2.6);
  root.add(sign12);

  // Pendulum is a full-height piece of structure, not a decorative bob.
  const pendulum = new THREE.Group();
  pendulum.position.set(SKY.pendulumPivotX, SKY.pendulumPivotY, SKY.z);
  const arm = new THREE.Mesh(geo(level, new THREE.BoxGeometry(1.0, SKY.pendulumLengthM, 1.0)), mats.steel);
  arm.position.y = -SKY.pendulumLengthM * 0.5;
  const bob = new THREE.Mesh(geo(level, new THREE.BoxGeometry(4.8, 4.0, 4.4)), mats.rust);
  bob.position.y = -SKY.pendulumLengthM;
  pendulum.add(arm, bob);
  root.add(pendulum);
  const pendulumCols: Collider[] = [];
  for (let i = 0; i < 6; i++) {
    const c: Collider = { id: `mc12_pendulum_arm_${i}`, minx: 0, maxx: 0, miny: 0, maxy: 0, minz: 0, maxz: 0 };
    level.colliders.push(c);
    pendulumCols.push(c);
  }
  const pendulumBobCol: Collider = { id: "mc12_pendulum_bob", minx: 0, maxx: 0, miny: 0, maxy: 0, minz: 0, maxz: 0 };
  level.colliders.push(pendulumBobCol);

  const pendulumBallast = new THREE.Group();
  pendulumBallast.add(new THREE.Mesh(geo(level, new THREE.BoxGeometry(2.6, 2.2, 2.4)), mats.carrier));
  root.add(pendulumBallast);

  const bridge = new THREE.Group();
  bridge.position.set(SKY.bridgeX, SKY.bridgeY, SKY.z);
  const bridgeDeck = new THREE.Mesh(geo(level, new THREE.BoxGeometry(1, 0.38, 4.4)), mats.grating);
  bridge.add(bridgeDeck);
  root.add(bridge);
  const bridgeCol: Collider = { id: "mc12_landing_bridge", minx: 0, maxx: 0, miny: 0, maxy: 0, minz: 0, maxz: 0 };
  level.colliders.push(bridgeCol);

  addBox(level, root, 16.0, 0.30, 5.0, 314.0, SKY.bridgeY - 0.15, SKY.z, mats.grating, "mc12_sky_landing");
  addBox(level, root, 0.32, 18.0, 0.32, 321.0, 141.0, SKY.z - 2.3, mats.steelDark, undefined, false);
  addBox(level, root, 0.32, 18.0, 0.32, 321.0, 141.0, SKY.z + 2.3, mats.steelDark, undefined, false);

  // Physical parachute re-entry shelves: no rescue detector, just reachable steel.
  addBox(level, root, 8.0, 0.24, 3.0, 242.0, 78.0, SKY.z + 5.0, mats.grating, "sky_reentry_78");
  addBox(level, root, 7.0, 0.24, 3.0, 266.0, 111.0, SKY.z - 5.2, mats.grating, "sky_reentry_111");
  addBox(level, root, 8.0, 0.24, 3.0, 286.0, 120.0, SKY.z + 5.4, mats.grating, "sky_reentry_120");

  addInteract(level, { id: "mc11_sail", label: "High-altitude wind sail", x: SKY.sailPivotX + 5, y: SKY.sailPivotY, z: SKY.z, r: 5.5, kind: "machine" });
  addInteract(level, { id: "mc11_sky_car", label: "38 t windward sky-car", x: SKY.skyCarX, y: SKY.skyCarBaseY, z: SKY.z, r: 4.0, kind: "world" });
  addInteract(level, { id: "mc12_pendulum", label: "70 t gravity pendulum", x: SKY.pendulumPivotX, y: SKY.pendulumPivotY - 8, z: SKY.z, r: 5.0, kind: "machine" });
  addInteract(level, { id: "mc12_bridge", label: "Impact-driven crown bridge", x: SKY.bridgeX, y: SKY.bridgeY, z: SKY.z, r: 4.0, kind: "world" });

  const vultures: THREE.Group[] = [];
  for (let i = 0; i < 3; i++) {
    const bird = makeVulture(level);
    root.add(bird);
    vultures.push(bird);
  }

  const made = { root, sail, skyCar, counterweight, pendulum, pendulumBallast, bridge, bridgeDeck, skyCarCol, bridgeCol, pendulumCols, pendulumBobCol, vultures };
  cache.set(level, made);
  return made;
}

/** Presentation-only projection from the shared mechanical authority. */
export function applySkyWorldCoupling(level: Level, sim: Simulation, witness?: SkyWitness): void {
  const b = ensureWorld(level);
  const rube = sim.state().rube;
  if (!rube?.chain) return;
  const chain = ensureLinkedCascadeState(rube);
  const w11 = mc11World(chain);
  const w12 = mc12World(chain);

  b.sail.rotation.z = w11.sail.angle;
  b.skyCar.position.set(w11.car.x, w11.car.y, w11.car.z);
  b.counterweight.position.set(w11.counterweight.x, w11.counterweight.y, w11.counterweight.z);
  b.skyCarCol.minx = w11.car.x - 3.2;
  b.skyCarCol.maxx = w11.car.x + 3.2;
  b.skyCarCol.miny = w11.car.y - 0.46;
  b.skyCarCol.maxy = w11.car.y + 0.04;
  b.skyCarCol.minz = w11.car.z - 2.5;
  b.skyCarCol.maxz = w11.car.z + 2.5;
  b.skyCarCol.surfaceVx = 0;
  b.skyCarCol.surfaceVy = w11.car.vy;
  b.skyCarCol.surfaceVz = 0;

  b.pendulum.rotation.z = w12.pendulum.angle;
  const bx = SKY.pendulumPivotX + w12.ballastRadius * Math.sin(w12.pendulum.angle);
  const by = SKY.pendulumPivotY - w12.ballastRadius * Math.cos(w12.pendulum.angle);
  b.pendulumBallast.position.set(bx, by, SKY.z);
  updatePendulumColliders(b, w12.pendulum.angle, w12.pendulum.omega);

  const q = Math.max(0.25, w12.bridge.q);
  b.bridgeDeck.scale.x = q;
  b.bridgeDeck.position.x = q * 0.5;
  b.bridgeCol.minx = SKY.bridgeX;
  b.bridgeCol.maxx = SKY.bridgeX + w12.bridge.q;
  b.bridgeCol.miny = SKY.bridgeY - 0.40;
  b.bridgeCol.maxy = SKY.bridgeY + 0.04;
  b.bridgeCol.minz = SKY.z - 2.2;
  b.bridgeCol.maxz = SKY.z + 2.2;
  b.bridgeCol.surfaceVx = w12.bridge.vx;
  b.bridgeCol.surfaceVy = 0;
  b.bridgeCol.surfaceVz = 0;

  const carIt = level.interactables.find((x) => x.id === "mc11_sky_car");
  if (carIt) carIt.y = w11.car.y;
  const bridgeIt = level.interactables.find((x) => x.id === "mc12_bridge");
  if (bridgeIt) bridgeIt.x = SKY.bridgeX + 0.5 * w12.bridge.q;

  // Birds read visible player trajectory and authoritative machine motion;
  // their response has no gameplay consequence or detection path.
  updateVultures(b, w11, w12, witness);

  applyCompositionWorld(level, sim);
}
