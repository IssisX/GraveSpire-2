import * as THREE from "three";
import type { Simulation } from "@/sim/simulation.ts";
import { CASCADE, ballastWorld, leverTip, ropeGeometry } from "@/sim/rube-mechanics.ts";
import type { Collider } from "./collision.ts";
import type { Interactable, Level } from "./level.ts";
import { makeSignTexture } from "./materials.ts";

type RubeBindings = {
  root: THREE.Group;
  lever: THREE.Group;
  ballast: THREE.Group;
  lift: THREE.Group;
  pulley: THREE.Mesh;
  ropeA: THREE.Mesh;
  ropeB: THREE.Mesh;
  latchLamp: THREE.Mesh;
  tensionLamp: THREE.Mesh;
  leverCols: Collider[];
  ballastCol: Collider;
  liftCol: Collider;
};

const cache = new WeakMap<Level, RubeBindings>();
const up = new THREE.Vector3(0, 1, 0);
const dir = new THREE.Vector3();

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
      id: id ?? "cascade_static",
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

function addInteract(level: Level, it: Interactable) {
  if (!level.interactables.some((x) => x.id === it.id)) level.interactables.push(it);
}

function placeRope(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz) || 0.01;
  mesh.position.set((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5);
  mesh.scale.set(1, len, 1);
  dir.set(dx / len, dy / len, dz / len);
  mesh.quaternion.setFromUnitVectors(up, dir);
}

function ensureRubeWorld(level: Level): RubeBindings {
  const prior = cache.get(level);
  if (prior) return prior;

  const scene = sceneFor(level);
  const mats = level.materials;
  const root = new THREE.Group();
  root.name = "mechanical-cascade-01";
  scene.add(root);

  // Continuous access from the Transfer Neck: no teleport, portal, or separate arena.
  addBox(level, root, 6.0, 0.5, 14.0, 58.0, -0.25, -15.2, mats.concrete, "cascade_corridor");
  addBox(level, root, 18.0, 0.5, 20.0, 58.0, -0.25, -31.5, mats.concrete, "cascade_floor");
  addBox(level, root, 0.45, 7.0, 20.0, 49.0, 3.5, -31.5, mats.steelDark, "cascade_wall_w");
  addBox(level, root, 0.45, 7.0, 20.0, 67.0, 3.5, -31.5, mats.steelDark, "cascade_wall_e");
  addBox(level, root, 18.0, 7.0, 0.45, 58.0, 3.5, -41.4, mats.steelDark, "cascade_wall_s");

  // Corridor curb/thresholds make the route visually part of FS-08 rather than a floating add-on.
  addBox(level, root, 0.18, 0.7, 14.0, 54.95, 0.35, -15.2, mats.hazard, undefined, false);
  addBox(level, root, 0.18, 0.7, 14.0, 61.05, 0.35, -15.2, mats.hazard, undefined, false);

  for (const x of [50.4, 58.0, 65.6]) {
    addBox(level, root, 0.55, 9.0, 0.55, x, 4.5, -40.5, mats.steelDark, `cascade_col_${x}`);
  }
  addBox(level, root, 17.0, 0.55, 0.8, 58, 8.6, -40.5, mats.steel, undefined, false);
  addBox(level, root, 17.0, 0.55, 0.8, 58, 8.6, -22.7, mats.steel, undefined, false);

  // Upper route: the lift can physically deliver the player to this deck.
  addBox(level, root, 5.2, 0.28, 9.0, 64.0, 4.44, -36.0, mats.grating, "cascade_upper_deck");
  addBox(level, root, 0.16, 1.05, 9.0, 66.5, 5.0, -36.0, mats.steel, "cascade_upper_rail");
  addBox(level, root, 5.2, 0.18, 0.35, 64.0, 4.68, -40.25, mats.hazard, undefined, false);
  // A visibly interrupted continuation makes this the first machine, not the end of the world.
  addBox(level, root, 3.2, 0.32, 0.5, 61.1, 4.4, -40.2, mats.rust, undefined, false).rotation.z = -0.18;
  addBox(level, root, 2.8, 0.32, 0.5, 66.1, 4.1, -40.2, mats.rust, undefined, false).rotation.z = 0.24;

  // Small approach step: lower lift surface remains ordinary collision, not a teleport trigger.
  addBox(level, root, 3.2, 0.24, 1.1, CASCADE.liftX, 0.12, -29.65, mats.diamond, "cascade_lift_step");

  const signTex = makeSignTexture("MC-01", "MECHANICAL CASCADE  ·  LOAD / LEVER / LIFT");
  const signMat = new THREE.MeshStandardMaterial({ map: signTex, metalness: 0.15, roughness: 0.65 });
  const sign = new THREE.Mesh(geo(level, new THREE.PlaneGeometry(6.4, 1.8)), signMat);
  sign.position.set(58, 4.2, -22.45);
  root.add(sign);

  // Pivot and lever body.
  const fulcrum = new THREE.Mesh(geo(level, new THREE.CylinderGeometry(0.72, 0.95, 1.15, 4)), mats.steelDark);
  fulcrum.position.set(CASCADE.pivotX, 0.58, CASCADE.z);
  fulcrum.rotation.y = Math.PI / 4;
  root.add(fulcrum);
  level.colliders.push({
    id: "cascade_fulcrum",
    minx: CASCADE.pivotX - 0.75,
    maxx: CASCADE.pivotX + 0.75,
    miny: 0,
    maxy: 1.16,
    minz: CASCADE.z - 0.75,
    maxz: CASCADE.z + 0.75,
  });

  const lever = new THREE.Group();
  const leverBeam = new THREE.Mesh(geo(level, new THREE.BoxGeometry(CASCADE.leverLengthM, 0.34, 1.15)), mats.steel);
  const leverStripe = new THREE.Mesh(geo(level, new THREE.BoxGeometry(CASCADE.leverLengthM - 0.3, 0.05, 1.19)), mats.hazard);
  leverStripe.position.y = 0.19;
  lever.add(leverBeam, leverStripe);
  lever.position.set(CASCADE.pivotX, CASCADE.pivotY, CASCADE.z);
  root.add(lever);

  const ballast = new THREE.Group();
  const ballastBody = new THREE.Mesh(geo(level, new THREE.BoxGeometry(1.25, 0.72, 1.05)), mats.carrier);
  ballastBody.position.y = 0.2;
  ballast.add(ballastBody);
  for (const x of [-0.42, 0.42]) {
    const wheel = new THREE.Mesh(geo(level, new THREE.CylinderGeometry(0.16, 0.16, 1.16, 10)), mats.steelBlack);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(x, -0.22, 0);
    ballast.add(wheel);
  }
  root.add(ballast);

  // Routed cable: lever tip -> fixed sheave -> lift anchor.
  const pulley = new THREE.Mesh(geo(level, new THREE.CylinderGeometry(0.58, 0.58, 0.28, 18)), mats.steel);
  pulley.rotation.x = Math.PI / 2;
  pulley.position.set(CASCADE.pulleyX, CASCADE.pulleyY, CASCADE.z);
  root.add(pulley);
  addBox(level, root, 0.35, 2.3, 0.35, CASCADE.pulleyX, CASCADE.pulleyY + 1.25, CASCADE.z, mats.steelDark, undefined, false);

  const ropeA = new THREE.Mesh(geo(level, new THREE.CylinderGeometry(0.045, 0.045, 1, 7)), mats.cable);
  const ropeB = new THREE.Mesh(geo(level, new THREE.CylinderGeometry(0.045, 0.045, 1, 7)), mats.cable);
  root.add(ropeA, ropeB);

  const lift = new THREE.Group();
  const liftDeck = new THREE.Mesh(geo(level, new THREE.BoxGeometry(3.0, 0.28, 3.0)), mats.diamond);
  liftDeck.position.y = -0.14;
  const liftFrame = new THREE.Mesh(geo(level, new THREE.BoxGeometry(2.8, 0.12, 2.8)), mats.hazard);
  liftFrame.position.y = 0.04;
  lift.add(liftDeck, liftFrame);
  root.add(lift);
  addBox(level, root, 0.18, 5.9, 0.18, CASCADE.liftX - 1.45, 2.95, CASCADE.z, mats.steelDark, undefined, false);
  addBox(level, root, 0.18, 5.9, 0.18, CASCADE.liftX + 1.45, 2.95, CASCADE.z, mats.steelDark, undefined, false);

  // Local mechanical latch. It captures the current pivot angle only when slow enough.
  addBox(level, root, 0.7, 1.0, 0.7, 54.55, 0.5, -30.2, mats.steelDark, "cascade_latch_base");
  const latchHandle = new THREE.Mesh(geo(level, new THREE.BoxGeometry(0.18, 0.75, 0.18)), mats.hazard);
  latchHandle.position.set(54.55, 1.35, -30.2);
  latchHandle.rotation.z = 0.38;
  root.add(latchHandle);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x111519, emissive: 0x6ec8a0, emissiveIntensity: 1.0, roughness: 0.4 });
  const latchLamp = new THREE.Mesh(geo(level, new THREE.SphereGeometry(0.08, 8, 6)), lampMat);
  latchLamp.position.set(54.55, 1.82, -30.2);
  root.add(latchLamp);

  const tensionMat = new THREE.MeshStandardMaterial({ color: 0x111519, emissive: 0xc8b44a, emissiveIntensity: 0.08, roughness: 0.4 });
  const tensionLamp = new THREE.Mesh(geo(level, new THREE.SphereGeometry(0.09, 8, 6)), tensionMat);
  tensionLamp.position.set(CASCADE.pulleyX, CASCADE.pulleyY + 0.95, CASCADE.z + 0.45);
  root.add(tensionLamp);

  const hallLightA = new THREE.PointLight(0xffc07a, 22, 24, 1.1);
  hallLightA.position.set(54, 7.6, -29);
  const hallLightB = new THREE.PointLight(0xdde6ee, 18, 22, 1.1);
  hallLightB.position.set(64, 7.2, -36);
  root.add(hallLightA, hallLightB);

  const leverCols: Collider[] = [];
  for (let i = 0; i < 9; i++) {
    const c: Collider = { id: `cascade_lever_${i}`, minx: 0, maxx: 0, miny: 0, maxy: 0, minz: CASCADE.z - 0.66, maxz: CASCADE.z + 0.66 };
    leverCols.push(c);
    level.colliders.push(c);
  }
  const ballastCol: Collider = { id: "cascade_ballast_body", minx: 0, maxx: 0, miny: 0, maxy: 0, minz: 0, maxz: 0 };
  const liftCol: Collider = { id: "cascade_lift_platform", minx: 0, maxx: 0, miny: 0, maxy: 0, minz: 0, maxz: 0 };
  level.colliders.push(ballastCol, liftCol);

  addInteract(level, { id: "cascade_lever", label: "Balance lever", x: CASCADE.pivotX, y: CASCADE.pivotY + 0.3, z: CASCADE.z, r: 3.0, kind: "machine" });
  addInteract(level, { id: "cascade_ballast", label: "Ballast trolley", x: CASCADE.pivotX - 2.7, y: CASCADE.pivotY + 0.4, z: CASCADE.z, r: 2.4, kind: "machine" });
  addInteract(level, { id: "cascade_latch", label: "Pivot latch", x: 54.55, y: 1.35, z: -30.2, r: 2.2, kind: "machine" });
  addInteract(level, { id: "cascade_pulley", label: "Transfer sheave", x: CASCADE.pulleyX, y: CASCADE.pulleyY, z: CASCADE.z, r: 2.0, kind: "machine" });
  addInteract(level, { id: "cascade_lift", label: "Counterlift platform", x: CASCADE.liftX, y: CASCADE.liftMinY, z: CASCADE.z, r: 2.8, kind: "world" });

  const made = { root, lever, ballast, lift, pulley, ropeA, ropeB, latchLamp, tensionLamp, leverCols, ballastCol, liftCol };
  cache.set(level, made);
  return made;
}

function updateLeverCollision(cols: Collider[], angle: number) {
  const seg = CASCADE.leverLengthM / cols.length;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  for (let i = 0; i < cols.length; i++) {
    const along = -CASCADE.leverLengthM * 0.5 + seg * (i + 0.5);
    const x = CASCADE.pivotX + along * c;
    const y = CASCADE.pivotY + along * s;
    const hx = Math.abs(c) * seg * 0.52 + 0.12;
    const hy = Math.abs(s) * seg * 0.52 + 0.19;
    const col = cols[i]!;
    col.minx = x - hx;
    col.maxx = x + hx;
    col.miny = y - hy;
    col.maxy = y + hy;
    col.minz = CASCADE.z - 0.66;
    col.maxz = CASCADE.z + 0.66;
  }
}

/** Presentation/collision projection of authoritative cascade state. Never advances mechanics. */
export function applyRubeCoupling(level: Level, sim: Simulation): void {
  const b = ensureRubeWorld(level);
  const rube = sim.state().rube;
  if (!rube) return;

  b.lever.rotation.z = rube.lever.angle_rad;

  const bw = ballastWorld(rube);
  b.ballast.position.set(bw.x, bw.y, bw.z);
  b.ballast.rotation.z = rube.lever.angle_rad;

  b.lift.position.set(CASCADE.liftX, rube.lift.y_m, CASCADE.z);

  const rg = ropeGeometry(rube);
  placeRope(b.ropeA, new THREE.Vector3(rg.tip.x, rg.tip.y, rg.tip.z), new THREE.Vector3(rg.pulley.x, rg.pulley.y, rg.pulley.z));
  placeRope(b.ropeB, new THREE.Vector3(rg.pulley.x, rg.pulley.y, rg.pulley.z), new THREE.Vector3(rg.lift.x, rg.lift.y, rg.lift.z));

  updateLeverCollision(b.leverCols, rube.lever.angle_rad);
  b.ballastCol.minx = bw.x - 0.68;
  b.ballastCol.maxx = bw.x + 0.68;
  b.ballastCol.miny = bw.y - 0.4;
  b.ballastCol.maxy = bw.y + 0.45;
  b.ballastCol.minz = CASCADE.z - 0.58;
  b.ballastCol.maxz = CASCADE.z + 0.58;

  b.liftCol.minx = CASCADE.liftX - 1.5;
  b.liftCol.maxx = CASCADE.liftX + 1.5;
  b.liftCol.miny = rube.lift.y_m - 0.28;
  b.liftCol.maxy = rube.lift.y_m;
  b.liftCol.minz = CASCADE.z - 1.5;
  b.liftCol.maxz = CASCADE.z + 1.5;

  const ballastIt = level.interactables.find((x) => x.id === "cascade_ballast");
  if (ballastIt) {
    ballastIt.x = bw.x;
    ballastIt.y = bw.y;
    ballastIt.z = bw.z;
  }
  const liftIt = level.interactables.find((x) => x.id === "cascade_lift");
  if (liftIt) liftIt.y = rube.lift.y_m;

  const latchMat = b.latchLamp.material as THREE.MeshStandardMaterial;
  latchMat.emissive.setHex(rube.lever.latch_engaged ? 0x6ec8a0 : 0xc47a4a);
  latchMat.emissiveIntensity = rube.lever.latch_engaged ? 1.25 : 0.7;

  const tensionRatio = rube.rope.tension_n / Math.max(1, rube.rope.rated_tension_n);
  const tensionMat = b.tensionLamp.material as THREE.MeshStandardMaterial;
  tensionMat.emissive.setHex(tensionRatio > 0.9 ? 0xc44a2a : tensionRatio > 0.55 ? 0xc8b44a : 0x6ec8a0);
  tensionMat.emissiveIntensity = 0.18 + Math.min(1.8, tensionRatio * 1.6);
}

export function cascadeTipWorld(sim: Simulation) {
  const rube = sim.state().rube;
  return rube ? leverTip(rube) : null;
}
