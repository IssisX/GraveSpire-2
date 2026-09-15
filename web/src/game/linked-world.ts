import * as THREE from "three";
import type { Simulation } from "@/sim/simulation.ts";
import { CHAIN, carriageWorld, counterweightWorld, ensureLinkedCascadeState } from "@/sim/linked-cascade.ts";
import { mechCable, mechDof } from "@/sim/mechanical-network.ts";
import type { Collider } from "./collision.ts";
import type { Interactable, Level } from "./level.ts";
import { makeSignTexture } from "./materials.ts";

type LinkedBindings = {
  root: THREE.Group;
  entryRocker: THREE.Group;
  entryPawl: THREE.Mesh;
  carriage: THREE.Group;
  carriageBrake: THREE.Group;
  counterweight: THREE.Group;
  transferRopeA: THREE.Mesh;
  transferRopeB: THREE.Mesh;
  bridgeRelease: THREE.Group;
  bridgePawl: THREE.Mesh;
  bridge: THREE.Group;
  carriageCol: Collider;
  bridgeCols: Collider[];
};

const cache = new WeakMap<Level, LinkedBindings>();
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
      id: id ?? "linked_static",
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

function openEastWall(level: Level, scene: THREE.Scene, root: THREE.Group) {
  const oldCol = level.colliders.find((c) => c.id === "cascade_wall_e");
  if (oldCol) oldCol.disabled = true;
  const cascadeRoot = scene.getObjectByName("mechanical-cascade-01");
  cascadeRoot?.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const p = (o.geometry as THREE.BoxGeometry).parameters;
    if (!p) return;
    if (
      Math.abs(o.position.x - 67) < 0.02 &&
      Math.abs(p.width - 0.45) < 0.02 &&
      Math.abs(p.height - 7) < 0.02 &&
      Math.abs(p.depth - 20) < 0.05
    ) {
      o.visible = false;
    }
  });

  // Replace the old full wall with two real segments, leaving a carriage-sized opening.
  addBox(level, root, 0.45, 7, 10, 67, 3.5, -26.5, level.materials.steelDark, "linked_wall_e_north");
  addBox(level, root, 0.45, 7, 3, 67, 3.5, -40.0, level.materials.steelDark, "linked_wall_e_south");
  addBox(level, root, 0.65, 0.55, 7.0, 67, 6.9, -35.0, level.materials.steel, undefined, false);
}

function ensureLinkedWorld(level: Level): LinkedBindings {
  const prior = cache.get(level);
  if (prior) return prior;
  const scene = sceneFor(level);
  const mats = level.materials;
  const root = new THREE.Group();
  root.name = "mechanical-cascade-linked";
  scene.add(root);
  openEastWall(level, scene, root);

  const signMat02 = new THREE.MeshStandardMaterial({
    map: makeSignTexture("MC-02", "GRAVITY TRANSFER  ·  COUNTERWEIGHT CARRIAGE"),
    metalness: 0.15,
    roughness: 0.65,
  });
  const sign02 = new THREE.Mesh(geo(level, new THREE.PlaneGeometry(7.1, 1.8)), signMat02);
  sign02.position.set(73.5, 5.4, -39.45);
  root.add(sign02);

  // The gap is real. Only the moving carriage spans it.
  addBox(level, root, 1.4, 0.28, 5.2, 67.1, CHAIN.deckY - 0.14, CHAIN.z, mats.grating, "chain_near_lip");
  addBox(level, root, 3.2, 0.32, 5.2, 84.0, CHAIN.deckY - 0.16, CHAIN.z, mats.grating, "chain_far_dock");
  addBox(level, root, 18.0, 0.25, 8.0, 76.0, -8.2, CHAIN.z, mats.steelDark, undefined, false);

  for (const z of [CHAIN.z - 1.65, CHAIN.z + 1.65]) {
    addBox(level, root, 17.0, 0.18, 0.18, 75.5, 1.65, z, mats.steel, undefined, false);
  }
  for (const x of [68, 74, 80, 84]) {
    addBox(level, root, 0.18, 3.2, 0.18, x, 0.0, CHAIN.z - 1.65, mats.steelDark, undefined, false);
  }

  // MC-01 lift physically pushes this rocker; no completion flag opens the next machine.
  const entryRocker = new THREE.Group();
  const erBeam = new THREE.Mesh(geo(level, new THREE.BoxGeometry(1.35, 0.22, 0.42)), mats.hazard);
  erBeam.position.x = -0.55;
  entryRocker.add(erBeam);
  entryRocker.position.set(66.25, CHAIN.entryContactBaseY, -32.15);
  root.add(entryRocker);
  const entryPawl = new THREE.Mesh(geo(level, new THREE.BoxGeometry(0.34, 0.75, 0.48)), mats.steel);
  entryPawl.position.set(68.1, 3.0, -38.0);
  root.add(entryPawl);

  // Player-carrying gravity transfer carriage.
  const carriage = new THREE.Group();
  const carDeck = new THREE.Mesh(geo(level, new THREE.BoxGeometry(3.4, 0.32, 3.2)), mats.diamond);
  carDeck.position.y = -0.16;
  const carFrame = new THREE.Mesh(geo(level, new THREE.BoxGeometry(3.25, 0.12, 3.05)), mats.hazard);
  carFrame.position.y = 0.05;
  carriage.add(carDeck, carFrame);
  for (const z of [-1.4, 1.4]) {
    const wheel = new THREE.Mesh(geo(level, new THREE.CylinderGeometry(0.24, 0.24, 0.28, 12)), mats.steelBlack);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(-0.95, -0.32, z);
    const wheel2 = wheel.clone();
    wheel2.position.x = 0.95;
    carriage.add(wheel, wheel2);
  }
  root.add(carriage);

  const carriageBrake = new THREE.Group();
  const brakeBody = new THREE.Mesh(geo(level, new THREE.BoxGeometry(0.55, 0.72, 0.45)), mats.steelDark);
  const brakeHandle = new THREE.Mesh(geo(level, new THREE.BoxGeometry(0.12, 0.72, 0.12)), mats.hazard);
  brakeHandle.position.y = 0.56;
  brakeHandle.rotation.z = 0.35;
  carriageBrake.add(brakeBody, brakeHandle);
  carriageBrake.position.set(-1.0, 0.62, 1.0);
  carriage.add(carriageBrake);

  const carriageCol: Collider = {
    id: "chain_carriage_platform",
    minx: 0,
    maxx: 0,
    miny: 0,
    maxy: 0,
    minz: 0,
    maxz: 0,
  };
  level.colliders.push(carriageCol);

  // Counterweight tower and 1:1 routed rope. Weight descends as carriage is hauled east.
  addBox(level, root, 0.28, 10.0, 0.28, CHAIN.counterweightX - 1.2, 4.0, CHAIN.z - 4.6, mats.steelDark, undefined, false);
  addBox(level, root, 0.28, 10.0, 0.28, CHAIN.counterweightX + 1.2, 4.0, CHAIN.z - 4.6, mats.steelDark, undefined, false);
  const sheave = new THREE.Mesh(geo(level, new THREE.CylinderGeometry(0.5, 0.5, 0.32, 18)), mats.steel);
  sheave.rotation.x = Math.PI / 2;
  sheave.position.set(83.0, 8.7, CHAIN.z - 1.9);
  root.add(sheave);
  const counterweight = new THREE.Group();
  const cwBody = new THREE.Mesh(geo(level, new THREE.BoxGeometry(1.8, 2.2, 1.7)), mats.carrier);
  const cwStripe = new THREE.Mesh(geo(level, new THREE.BoxGeometry(1.86, 0.28, 1.76)), mats.hazard);
  counterweight.add(cwBody, cwStripe);
  root.add(counterweight);
  const transferRopeA = new THREE.Mesh(geo(level, new THREE.CylinderGeometry(0.05, 0.05, 1, 8)), mats.cable);
  const transferRopeB = new THREE.Mesh(geo(level, new THREE.CylinderGeometry(0.05, 0.05, 1, 8)), mats.cable);
  root.add(transferRopeA, transferRopeB);

  // Carriage arrival physically rotates this release rocker, retracting the bridge pawl through cable tension.
  const bridgeRelease = new THREE.Group();
  const brBeam = new THREE.Mesh(geo(level, new THREE.BoxGeometry(1.3, 0.22, 0.5)), mats.hazard);
  brBeam.position.x = -0.52;
  bridgeRelease.add(brBeam);
  bridgeRelease.position.set(83.3, 2.72, CHAIN.z);
  root.add(bridgeRelease);
  const bridgePawl = new THREE.Mesh(geo(level, new THREE.BoxGeometry(0.32, 0.72, 0.52)), mats.steel);
  bridgePawl.position.set(CHAIN.bridgePivotX - 0.25, 3.12, CHAIN.z + 0.9);
  root.add(bridgePawl);

  // MC-03: 11 m drop bridge. Its own weight lowers it once the physical pawl clears.
  const signMat03 = new THREE.MeshStandardMaterial({
    map: makeSignTexture("MC-03", "GRAVITY BRIDGE  ·  PAWL / MOMENT / FALL"),
    metalness: 0.15,
    roughness: 0.65,
  });
  const sign03 = new THREE.Mesh(geo(level, new THREE.PlaneGeometry(6.4, 1.6)), signMat03);
  sign03.position.set(88.0, 5.25, -39.45);
  root.add(sign03);
  const bridge = new THREE.Group();
  const bridgeDeck = new THREE.Mesh(geo(level, new THREE.BoxGeometry(CHAIN.bridgeLengthM, 0.34, 3.2)), mats.grating);
  bridgeDeck.position.x = CHAIN.bridgeLengthM * 0.5;
  const bridgeEdgeA = new THREE.Mesh(geo(level, new THREE.BoxGeometry(CHAIN.bridgeLengthM, 0.14, 0.18)), mats.hazard);
  bridgeEdgeA.position.set(CHAIN.bridgeLengthM * 0.5, 0.22, 1.48);
  const bridgeEdgeB = bridgeEdgeA.clone();
  bridgeEdgeB.position.z = -1.48;
  bridge.add(bridgeDeck, bridgeEdgeA, bridgeEdgeB);
  bridge.position.set(CHAIN.bridgePivotX, CHAIN.bridgePivotY, CHAIN.z);
  root.add(bridge);

  const bridgeCols: Collider[] = [];
  for (let i = 0; i < 11; i++) {
    const c: Collider = {
      id: `chain_bridge_${i}`,
      minx: 0,
      maxx: 0,
      miny: 0,
      maxy: 0,
      minz: CHAIN.z - 1.62,
      maxz: CHAIN.z + 1.62,
    };
    bridgeCols.push(c);
    level.colliders.push(c);
  }

  // The bridge delivers the player into a real next apron; this is not an end-of-level trigger.
  addBox(level, root, 8.0, 0.32, 7.0, 99.5, CHAIN.deckY - 0.16, CHAIN.z, mats.grating, "chain_next_apron");
  addBox(level, root, 0.22, 2.2, 7.0, 103.4, 3.25, CHAIN.z, mats.steelDark, "chain_next_bulkhead");
  for (const x of [96.2, 99.5, 102.8]) {
    addBox(level, root, 0.3, 7.0, 0.3, x, 5.8, CHAIN.z - 3.1, mats.steelDark, undefined, false);
  }

  const lightA = new THREE.PointLight(0xffb86b, 24, 26, 1.1);
  lightA.position.set(74, 7.4, CHAIN.z);
  const lightB = new THREE.PointLight(0xd7e9f3, 20, 28, 1.1);
  lightB.position.set(91, 7.1, CHAIN.z);
  root.add(lightA, lightB);

  addInteract(level, { id: "chain_entry_rocker", label: "MC-02 release rocker", x: 66.1, y: 2.7, z: -32.2, r: 2.4, kind: "machine" });
  addInteract(level, { id: "cascade_transfer_brake", label: "Gravity carriage brake", x: CHAIN.carriageStartX - 1, y: CHAIN.deckY + 0.7, z: CHAIN.z + 1, r: 2.6, kind: "machine" });
  addInteract(level, { id: "chain_carriage", label: "30-ton transfer carriage", x: CHAIN.carriageStartX, y: CHAIN.deckY, z: CHAIN.z, r: 3.1, kind: "world" });
  addInteract(level, { id: "chain_counterweight", label: "2.5-ton transfer counterweight", x: CHAIN.counterweightX, y: CHAIN.counterweightStartY, z: CHAIN.z - 4.6, r: 3.2, kind: "machine" });
  addInteract(level, { id: "chain_bridge_release", label: "MC-03 bridge release rocker", x: 83.3, y: 2.8, z: CHAIN.z, r: 2.5, kind: "machine" });
  addInteract(level, { id: "chain_bridge", label: "11 m gravity bridge", x: CHAIN.bridgePivotX + 3.5, y: 4.2, z: CHAIN.z, r: 4.0, kind: "world" });

  const made = {
    root,
    entryRocker,
    entryPawl,
    carriage,
    carriageBrake,
    counterweight,
    transferRopeA,
    transferRopeB,
    bridgeRelease,
    bridgePawl,
    bridge,
    carriageCol,
    bridgeCols,
  };
  cache.set(level, made);
  return made;
}

function updateBridgeCollision(cols: Collider[], angle: number, omega: number) {
  const seg = CHAIN.bridgeLengthM / cols.length;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  for (let i = 0; i < cols.length; i++) {
    const along = seg * (i + 0.5);
    const x = CHAIN.bridgePivotX + along * c;
    const y = CHAIN.bridgePivotY + along * s;
    const hx = Math.abs(c) * seg * 0.52 + 0.10;
    const hy = Math.abs(s) * seg * 0.52 + 0.20;
    const col = cols[i]!;
    col.minx = x - hx;
    col.maxx = x + hx;
    col.miny = y - hy;
    col.maxy = y + hy;
    col.minz = CHAIN.z - 1.62;
    col.maxz = CHAIN.z + 1.62;
    col.surfaceAngularZ = omega;
    col.surfacePivotX = CHAIN.bridgePivotX;
    col.surfacePivotY = CHAIN.bridgePivotY;
  }
}

/** Presentation/collision projection only. All motion comes from committed mechanical state. */
export function applyLinkedCascadeCoupling(level: Level, sim: Simulation): void {
  const b = ensureLinkedWorld(level);
  const rube = sim.state().rube;
  if (!rube) return;
  const chain = ensureLinkedCascadeState(rube);
  const net = chain.network;
  const entryRocker = mechDof(net, "entry_rocker");
  const entryPawl = mechDof(net, "entry_pawl");
  const release = mechDof(net, "bridge_release");
  const bridgePawl = mechDof(net, "bridge_pawl");
  const bridgeDof = mechDof(net, "bridge");

  b.entryRocker.rotation.z = entryRocker.q;
  b.entryPawl.position.y = 3.0 + entryPawl.q;

  const car = carriageWorld(rube);
  b.carriage.position.set(car.x, car.y, car.z);
  b.carriageCol.minx = car.x - 1.7;
  b.carriageCol.maxx = car.x + 1.7;
  b.carriageCol.miny = car.y - 0.34;
  b.carriageCol.maxy = car.y;
  b.carriageCol.minz = car.z - 1.6;
  b.carriageCol.maxz = car.z + 1.6;
  b.carriageCol.surfaceVx = car.vx;
  b.carriageCol.surfaceVy = 0;
  b.carriageCol.surfaceVz = 0;

  const cw = counterweightWorld(rube);
  b.counterweight.position.set(cw.x, cw.y, cw.z);
  const pulley = new THREE.Vector3(83.0, 8.7, CHAIN.z - 1.9);
  const carAnchor = new THREE.Vector3(car.x + 0.8, car.y + 0.45, CHAIN.z - 1.45);
  const cwAnchor = new THREE.Vector3(cw.x, cw.y + 1.1, cw.z);
  placeRope(b.transferRopeA, carAnchor, pulley);
  placeRope(b.transferRopeB, pulley, cwAnchor);

  b.bridgeRelease.rotation.z = release.q;
  b.bridgePawl.position.y = 3.12 + bridgePawl.q;
  b.bridge.rotation.z = bridgeDof.q;
  updateBridgeCollision(b.bridgeCols, bridgeDof.q, bridgeDof.v);

  const liftCol = level.colliders.find((c) => c.id === "cascade_lift_platform");
  if (liftCol) {
    liftCol.surfaceVx = 0;
    liftCol.surfaceVy = rube.lift.velocity_mps;
    liftCol.surfaceVz = 0;
  }

  const brake = level.interactables.find((x) => x.id === "cascade_transfer_brake");
  if (brake) {
    brake.x = car.x - 1.0;
    brake.y = car.y + 0.72;
    brake.z = car.z + 1.0;
  }
  const carIt = level.interactables.find((x) => x.id === "chain_carriage");
  if (carIt) carIt.x = car.x;
  const cwIt = level.interactables.find((x) => x.id === "chain_counterweight");
  if (cwIt) cwIt.y = cw.y;
  const bridgeIt = level.interactables.find((x) => x.id === "chain_bridge");
  if (bridgeIt) {
    bridgeIt.x = CHAIN.bridgePivotX + 0.5 * CHAIN.bridgeLengthM * Math.cos(bridgeDof.q);
    bridgeIt.y = CHAIN.bridgePivotY + 0.5 * CHAIN.bridgeLengthM * Math.sin(bridgeDof.q);
  }

  const brakeHandle = b.carriageBrake.children[1] as THREE.Mesh;
  brakeHandle.rotation.z = chain.transfer_brake_engaged ? 0.35 : -0.55;

  // Read tension here only to make the routed rope an explicit dependency of this projection.
  // Do not mutate shared level materials from mechanism state.
  void mechCable(net, "transfer_rope").tension_n;
}
