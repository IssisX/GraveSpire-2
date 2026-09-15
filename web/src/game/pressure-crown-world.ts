import * as THREE from "three";
import type { Simulation } from "@/sim/simulation.ts";
import { ensureLinkedCascadeState } from "@/sim/linked-cascade.ts";
import { mc09World, mc10World, PRESSURE_CROWN } from "@/sim/pressure-crown.ts";
import type { Collider } from "./collision.ts";
import type { Interactable, Level } from "./level.ts";
import { makeSignTexture } from "./materials.ts";
import { applySkyWorldCoupling } from "./sky-world.ts";

type PressureBindings = {
  root: THREE.Group;
  ram: THREE.Group;
  valve: THREE.Group;
  flywheel: THREE.Group;
  governorWeights: THREE.Mesh[];
  bridge: THREE.Group;
  bridgeDeck: THREE.Mesh;
  ramCol: Collider;
  bridgeCol: Collider;
};

const cache = new WeakMap<Level, PressureBindings>();

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
  if (collider) level.colliders.push({ id: id ?? "pressure_crown_static", minx: x - w / 2, maxx: x + w / 2, miny: y - h / 2, maxy: y + h / 2, minz: z - d / 2, maxz: z + d / 2 });
  return m;
}

function addInteract(level: Level, it: Interactable) {
  if (!level.interactables.some((x) => x.id === it.id)) level.interactables.push(it);
}

function ensureWorld(level: Level): PressureBindings {
  const prior = cache.get(level);
  if (prior) return prior;
  const scene = sceneFor(level);
  const mats = level.materials;
  const root = new THREE.Group();
  root.name = "mc09-10-pressure-crown";
  scene.add(root);

  const sign09Mat = new THREE.MeshStandardMaterial({ map: makeSignTexture("MC-09", "PRESSURE ASCENDER  ·  80 t RAM / GAS WORK"), metalness: 0.15, roughness: 0.65 });
  const sign09 = new THREE.Mesh(geo(level, new THREE.PlaneGeometry(8.6, 1.8)), sign09Mat);
  sign09.position.set(207.0, 72.4, PRESSURE_CROWN.z + 2.6);
  root.add(sign09);

  for (const x of [203.2, 212.8]) {
    const tank = new THREE.Mesh(geo(level, new THREE.CylinderGeometry(1.65, 1.65, 9.5, 20)), mats.steelDark);
    tank.position.set(x, 73.7, PRESSURE_CROWN.z - 3.2);
    tank.castShadow = true;
    root.add(tank);
    const cap = new THREE.Mesh(geo(level, new THREE.TorusGeometry(1.66, 0.10, 7, 24)), mats.hazard);
    cap.rotation.x = Math.PI / 2;
    cap.position.set(x, 78.45, PRESSURE_CROWN.z - 3.2);
    root.add(cap);
  }

  const ram = new THREE.Group();
  const deck = new THREE.Mesh(geo(level, new THREE.BoxGeometry(10.0, 0.48, 5.2)), mats.diamond);
  deck.position.y = -0.24;
  const under = new THREE.Mesh(geo(level, new THREE.BoxGeometry(7.0, 1.1, 4.2)), mats.steelDark);
  under.position.y = -0.95;
  ram.add(deck, under);
  for (const z of [-2.35, 2.35]) {
    const rail = new THREE.Mesh(geo(level, new THREE.BoxGeometry(9.4, 0.12, 0.12)), mats.steel);
    rail.position.set(0, 1.0, z);
    ram.add(rail);
  }
  root.add(ram);
  const ramCol: Collider = { id: "mc09_pressure_ram", minx: 0, maxx: 0, miny: 0, maxy: 0, minz: 0, maxz: 0 };
  level.colliders.push(ramCol);

  const valve = new THREE.Group();
  valve.position.set(202.7, 69.6, PRESSURE_CROWN.z + 2.5);
  const valveStem = new THREE.Mesh(geo(level, new THREE.BoxGeometry(1.8, 0.22, 0.22)), mats.hazard);
  valveStem.position.x = 0.9;
  const valveBody = new THREE.Mesh(geo(level, new THREE.BoxGeometry(0.55, 0.75, 0.75)), mats.steel);
  valve.add(valveStem, valveBody);
  root.add(valve);

  for (const x of [202.5, 213.5]) {
    addBox(level, root, 0.34, 25.0, 0.34, x, 80.0, PRESSURE_CROWN.z + 2.5, mats.steelDark, undefined, false);
    addBox(level, root, 0.34, 25.0, 0.34, x, 80.0, PRESSURE_CROWN.z - 2.5, mats.steelDark, undefined, false);
  }

  const sign10Mat = new THREE.MeshStandardMaterial({ map: makeSignTexture("MC-10", "CENTRIFUGAL CROWN  ·  FLYWHEEL / GOVERNOR / TRANSFER SPAN"), metalness: 0.15, roughness: 0.65 });
  const sign10 = new THREE.Mesh(geo(level, new THREE.PlaneGeometry(9.2, 1.8)), sign10Mat);
  sign10.position.set(229.0, 96.0, PRESSURE_CROWN.z + 2.7);
  root.add(sign10);

  const flywheel = new THREE.Group();
  flywheel.position.set(PRESSURE_CROWN.crownX, PRESSURE_CROWN.crownY + 3.2, PRESSURE_CROWN.z);
  const wheel = new THREE.Mesh(geo(level, new THREE.TorusGeometry(6.0, 0.68, 12, 48)), mats.steel);
  wheel.castShadow = true;
  flywheel.add(wheel);
  for (let i = 0; i < 8; i++) {
    const spoke = new THREE.Mesh(geo(level, new THREE.BoxGeometry(11.0, 0.20, 0.25)), mats.steelDark);
    spoke.rotation.z = (i * Math.PI) / 4;
    flywheel.add(spoke);
  }
  root.add(flywheel);

  const governorWeights: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const w = new THREE.Mesh(geo(level, new THREE.BoxGeometry(1.5, 1.1, 1.1)), mats.rust);
    root.add(w);
    governorWeights.push(w);
  }

  const bridge = new THREE.Group();
  bridge.position.set(PRESSURE_CROWN.crownX, PRESSURE_CROWN.crownY, PRESSURE_CROWN.z);
  const bridgeDeck = new THREE.Mesh(geo(level, new THREE.BoxGeometry(1, 0.36, 4.2)), mats.grating);
  bridge.add(bridgeDeck);
  root.add(bridge);
  const bridgeCol: Collider = { id: "mc10_governor_bridge", minx: 0, maxx: 0, miny: 0, maxy: 0, minz: 0, maxz: 0 };
  level.colliders.push(bridgeCol);

  addBox(level, root, 14.0, 0.30, 5.2, 236.0, PRESSURE_CROWN.crownY - 0.15, PRESSURE_CROWN.z, mats.grating, "mc10_crown_landing");
  addBox(level, root, 0.28, 10.0, 0.28, 242.5, 96.0, PRESSURE_CROWN.z + 2.3, mats.steelDark, undefined, false);
  addBox(level, root, 0.28, 10.0, 0.28, 242.5, 96.0, PRESSURE_CROWN.z - 2.3, mats.steelDark, undefined, false);

  addInteract(level, { id: "mc09_ram", label: "80 t pressure ascender", x: PRESSURE_CROWN.ramX, y: PRESSURE_CROWN.ramBaseY, z: PRESSURE_CROWN.z, r: 4.0, kind: "machine" });
  addInteract(level, { id: "mc09_valve", label: "Pressure release spool", x: 203.6, y: 69.6, z: PRESSURE_CROWN.z, r: 2.8, kind: "machine" });
  addInteract(level, { id: "mc10_flywheel", label: "Centrifugal crown flywheel", x: PRESSURE_CROWN.crownX, y: PRESSURE_CROWN.crownY + 3.2, z: PRESSURE_CROWN.z, r: 4.5, kind: "machine" });
  addInteract(level, { id: "mc10_bridge", label: "Governor transfer span", x: PRESSURE_CROWN.crownX - 4.0, y: PRESSURE_CROWN.crownY, z: PRESSURE_CROWN.z, r: 3.5, kind: "world" });

  const pressureLamp = new THREE.PointLight(0xffa54c, 38, 34, 1.0);
  pressureLamp.position.set(208, 82, PRESSURE_CROWN.z);
  root.add(pressureLamp);
  const crownLamp = new THREE.PointLight(0x8fd4ff, 42, 38, 1.0);
  crownLamp.position.set(229, 96, PRESSURE_CROWN.z);
  root.add(crownLamp);

  const made = { root, ram, valve, flywheel, governorWeights, bridge, bridgeDeck, ramCol, bridgeCol };
  cache.set(level, made);
  return made;
}

export function applyPressureCrownCoupling(level: Level, sim: Simulation): void {
  const b = ensureWorld(level);
  const rube = sim.state().rube;
  if (!rube?.chain) return;
  const chain = ensureLinkedCascadeState(rube);
  const w9 = mc09World(chain);
  const w10 = mc10World(chain);

  b.ram.position.set(w9.ram.x, w9.ram.y, w9.ram.z);
  b.ramCol.minx = w9.ram.x - 5.0;
  b.ramCol.maxx = w9.ram.x + 5.0;
  b.ramCol.miny = w9.ram.y - 0.48;
  b.ramCol.maxy = w9.ram.y + 0.04;
  b.ramCol.minz = w9.ram.z - 2.6;
  b.ramCol.maxz = w9.ram.z + 2.6;
  b.ramCol.surfaceVy = w9.ram.vy;
  b.valve.position.x = 202.7 + w9.valve * 3.4;

  b.flywheel.rotation.z = w10.flywheel.angle;
  for (let i = 0; i < b.governorWeights.length; i++) {
    const angle = w10.flywheel.angle + (i * Math.PI * 2) / b.governorWeights.length;
    const radius = w10.governorRadius;
    b.governorWeights[i]!.position.set(PRESSURE_CROWN.crownX + radius * Math.cos(angle), PRESSURE_CROWN.crownY + 3.2 + radius * Math.sin(angle), PRESSURE_CROWN.z);
  }

  const q = Math.max(0.25, w10.bridgeTravel);
  b.bridgeDeck.scale.x = q;
  b.bridgeDeck.position.x = -q * 0.5;
  b.bridgeCol.minx = PRESSURE_CROWN.crownX - w10.bridgeTravel;
  b.bridgeCol.maxx = PRESSURE_CROWN.crownX;
  b.bridgeCol.miny = PRESSURE_CROWN.crownY - 0.38;
  b.bridgeCol.maxy = PRESSURE_CROWN.crownY + 0.04;
  b.bridgeCol.minz = PRESSURE_CROWN.z - 2.1;
  b.bridgeCol.maxz = PRESSURE_CROWN.z + 2.1;
  b.bridgeCol.surfaceVx = -w10.bridgeVelocity;

  const ramIt = level.interactables.find((x) => x.id === "mc09_ram");
  if (ramIt) ramIt.y = w9.ram.y;
  const bridgeIt = level.interactables.find((x) => x.id === "mc10_bridge");
  if (bridgeIt) bridgeIt.x = PRESSURE_CROWN.crownX - 0.5 * w10.bridgeTravel;

  applySkyWorldCoupling(level, sim);
}
