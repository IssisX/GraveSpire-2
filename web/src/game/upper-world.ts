import * as THREE from "three";
import type { Simulation } from "@/sim/simulation.ts";
import {
  UPPER,
  ensureUpperCascadeState,
  mc05BallastWorld,
  mc05BasculeWorld,
  mc05TableWorld,
  mc06World,
  upperBrakeEngaged,
} from "@/sim/upper-cascade.ts";
import { mechCable, mechDof } from "@/sim/mechanical-network.ts";
import { MECH_ID } from "@/sim/mechanical-ids.ts";
import type { Collider } from "./collision.ts";
import type { Interactable, Level } from "./level.ts";
import { makeSignTexture } from "./materials.ts";

type UpperBindings = {
  root: THREE.Group;
  bascule: THREE.Group;
  ballast: THREE.Group;
  table: THREE.Group;
  rotor: THREE.Group;
  radial: THREE.Group;
  drop: THREE.Group;
  tableHaul: THREE.Mesh;
  dropRope: THREE.Mesh;
  mc05BrakeLamp: THREE.Mesh;
  mc06BrakeLamp: THREE.Mesh;
  basculeCols: Collider[];
  tableCol: Collider;
  radialCols: Collider[];
  dropCol: Collider;
};

const cache = new WeakMap<Level, UpperBindings>();
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
      id: id ?? "upper_static",
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

function placeLine(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz) || 0.01;
  mesh.position.set((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5);
  mesh.scale.set(1, len, 1);
  dir.set(dx / len, dy / len, dz / len);
  mesh.quaternion.setFromUnitVectors(up, dir);
}

function dynamicSegments(level: Level, prefix: string, count: number, zHalf: number): Collider[] {
  const out: Collider[] = [];
  for (let i = 0; i < count; i++) {
    const c: Collider = { id: `${prefix}_${i}`, minx: 0, maxx: 0, miny: 0, maxy: 0, minz: UPPER.z - zHalf, maxz: UPPER.z + zHalf };
    level.colliders.push(c);
    out.push(c);
  }
  return out;
}

function ensureUpperWorld(level: Level): UpperBindings {
  const prior = cache.get(level);
  if (prior) return prior;
  const scene = sceneFor(level);
  const mats = level.materials;
  const root = new THREE.Group();
  root.name = "upper-mechanical-spine";
  scene.add(root);

  // MC-04 upper landing flows directly into MC-05; no portal or reset.
  addBox(level, root, 5.0, 0.34, 5.2, 118.0, UPPER.mc05PivotY - 0.17, UPPER.z, mats.grating, "mc05_pivot_landing");
  addBox(level, root, 2.0, 8.0, 2.0, 118.0, UPPER.mc05PivotY - 4.0, UPPER.z + 4.4, mats.steelDark, "mc05_pier_n");
  addBox(level, root, 2.0, 8.0, 2.0, 118.0, UPPER.mc05PivotY - 4.0, UPPER.z - 4.4, mats.steelDark, "mc05_pier_s");

  const signTex = makeSignTexture("MC-05", "BASCULE EXCHANGE  ·  BALANCE / HAUL / TRANSFER");
  const signMat = new THREE.MeshStandardMaterial({ map: signTex, metalness: 0.15, roughness: 0.65 });
  const sign = new THREE.Mesh(geo(level, new THREE.PlaneGeometry(7.2, 1.9)), signMat);
  sign.position.set(117.7, 14.2, UPPER.z + 2.55);
  sign.rotation.y = Math.PI;
  root.add(sign);

  const bascule = new THREE.Group();
  bascule.position.set(UPPER.mc05PivotX, UPPER.mc05PivotY, UPPER.z);
  const leaf = new THREE.Mesh(geo(level, new THREE.BoxGeometry(UPPER.basculeLengthM, 0.48, 4.6)), mats.steel);
  leaf.position.x = UPPER.basculeLengthM * 0.5;
  const deck = new THREE.Mesh(geo(level, new THREE.BoxGeometry(UPPER.basculeLengthM - 0.4, 0.16, 4.25)), mats.grating);
  deck.position.set(UPPER.basculeLengthM * 0.5, 0.31, 0);
  bascule.add(leaf, deck);
  root.add(bascule);

  const trunnion = new THREE.Mesh(geo(level, new THREE.CylinderGeometry(1.25, 1.25, 5.3, 22)), mats.steelDark);
  trunnion.position.set(UPPER.mc05PivotX, UPPER.mc05PivotY, UPPER.z);
  trunnion.rotation.x = Math.PI / 2;
  root.add(trunnion);

  const ballast = new THREE.Group();
  const ballastBody = new THREE.Mesh(geo(level, new THREE.BoxGeometry(4.2, 2.6, 3.7)), mats.carrier);
  ballast.add(ballastBody);
  for (const x of [-1.45, 1.45]) {
    const wheel = new THREE.Mesh(geo(level, new THREE.CylinderGeometry(0.48, 0.48, 3.9, 14)), mats.steelBlack);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(x, -1.15, 0);
    ballast.add(wheel);
  }
  root.add(ballast);

  const table = new THREE.Group();
  const tableDeck = new THREE.Mesh(geo(level, new THREE.BoxGeometry(8.0, 0.5, 6.2)), mats.diamond);
  const tableFrame = new THREE.Mesh(geo(level, new THREE.BoxGeometry(7.5, 1.2, 5.4)), mats.steelDark);
  tableFrame.position.y = -0.65;
  table.add(tableDeck, tableFrame);
  root.add(table);

  // Long visible haul line makes bascule -> table coupling legible.
  const tableHaul = new THREE.Mesh(geo(level, new THREE.CylinderGeometry(0.07, 0.07, 1, 8)), mats.cable);
  root.add(tableHaul);

  // Rail bed continues toward MC-06. The moving table is the route and the actuator.
  addBox(level, root, 22.0, 0.28, 7.0, 145.0, UPPER.mc05PivotY - 1.0, UPPER.z, mats.steelDark, "mc05_rail_bed");
  for (const z of [UPPER.z - 2.5, UPPER.z + 2.5]) {
    addBox(level, root, 22.0, 0.18, 0.22, 145.0, UPPER.mc05PivotY - 0.72, z, mats.steel, undefined, false);
  }

  // MC-06 hub / rotunda.
  addBox(level, root, 7.5, 0.36, 7.5, UPPER.mc06PivotX, UPPER.mc06PivotY - 0.18, UPPER.z, mats.grating, "mc06_hub_floor");
  const rotor = new THREE.Group();
  rotor.position.set(UPPER.mc06PivotX, UPPER.mc06PivotY, UPPER.z);
  const ring = new THREE.Mesh(geo(level, new THREE.TorusGeometry(4.0, 0.45, 10, 30)), mats.steel);
  ring.rotation.x = Math.PI / 2;
  rotor.add(ring);
  const hub = new THREE.Mesh(geo(level, new THREE.CylinderGeometry(1.1, 1.1, 2.4, 20)), mats.steelDark);
  hub.rotation.x = Math.PI / 2;
  rotor.add(hub);
  root.add(rotor);

  const radial = new THREE.Group();
  const radialMaxLen = UPPER.radialBaseRadiusM + UPPER.radialMaxM;
  const radialBeam = new THREE.Mesh(geo(level, new THREE.BoxGeometry(radialMaxLen, 0.44, 3.1)), mats.steel);
  radialBeam.position.x = radialMaxLen * 0.5;
  const radialDeck = new THREE.Mesh(geo(level, new THREE.BoxGeometry(radialMaxLen - 0.3, 0.14, 2.8)), mats.grating);
  radialDeck.position.set(radialMaxLen * 0.5, 0.29, 0);
  radial.add(radialBeam, radialDeck);
  rotor.add(radial);

  // Drop-weight tower is a macro system, not decorative scenery.
  for (const x of [UPPER.mc06PivotX - 3.0, UPPER.mc06PivotX + 3.0]) {
    addBox(level, root, 0.45, 22.0, 0.45, x, 17.0, UPPER.z - 6.5, mats.steelDark, `mc06_tower_${x}`);
  }
  const drop = new THREE.Group();
  const dropBody = new THREE.Mesh(geo(level, new THREE.BoxGeometry(4.4, 3.2, 3.6)), mats.rust);
  drop.add(dropBody);
  root.add(drop);
  const dropRope = new THREE.Mesh(geo(level, new THREE.CylinderGeometry(0.075, 0.075, 1, 8)), mats.cable);
  root.add(dropRope);

  // High receiving catwalk requires rotor orientation; it cannot be reached by the initial horizontal arm.
  addBox(level, root, 12.0, 0.32, 4.0, 166.5, 23.0, UPPER.z, mats.grating, "mc06_high_exit");
  addBox(level, root, 0.18, 1.2, 12.0, 172.2, 23.6, UPPER.z, mats.steel, "mc06_high_rail");

  const mc05Station = addBox(level, root, 1.5, 1.25, 1.1, 116.1, 10.9, UPPER.z + 2.2, mats.steelDark, "mc05_station_base");
  mc05Station.rotation.y = 0.2;
  const mc06Station = addBox(level, root, 1.5, 1.25, 1.1, 154.1, 10.9, UPPER.z + 2.3, mats.steelDark, "mc06_station_base");
  mc06Station.rotation.y = 0.2;

  const brakeMat05 = new THREE.MeshStandardMaterial({ color: 0x121518, emissive: 0x6ec8a0, emissiveIntensity: 1.1, roughness: 0.4 });
  const brakeMat06 = brakeMat05.clone();
  const mc05BrakeLamp = new THREE.Mesh(geo(level, new THREE.SphereGeometry(0.11, 9, 7)), brakeMat05);
  mc05BrakeLamp.position.set(116.1, 11.75, UPPER.z + 2.2);
  root.add(mc05BrakeLamp);
  const mc06BrakeLamp = new THREE.Mesh(geo(level, new THREE.SphereGeometry(0.11, 9, 7)), brakeMat06);
  mc06BrakeLamp.position.set(154.1, 11.75, UPPER.z + 2.3);
  root.add(mc06BrakeLamp);

  addInteract(level, { id: "mc05_station", label: "Bascule control stand", x: 116.1, y: 11.1, z: UPPER.z + 2.2, r: 2.2, kind: "machine" });
  addInteract(level, { id: "mc05_bascule", label: "52 t bascule span", x: 124.0, y: 12.0, z: UPPER.z, r: 3.0, kind: "machine" });
  addInteract(level, { id: "mc05_ballast", label: "65 t travelling ballast", x: 112.0, y: 12.0, z: UPPER.z, r: 3.0, kind: "machine" });
  addInteract(level, { id: "mc05_table", label: "46 t transfer table", x: UPPER.tableStartX, y: UPPER.mc05PivotY, z: UPPER.z, r: 3.2, kind: "machine" });
  addInteract(level, { id: "mc06_station", label: "Momentum rotunda stand", x: 154.1, y: 11.1, z: UPPER.z + 2.3, r: 2.2, kind: "machine" });
  addInteract(level, { id: "mc06_rotor", label: "Momentum rotor", x: UPPER.mc06PivotX, y: UPPER.mc06PivotY, z: UPPER.z, r: 3.0, kind: "machine" });
  addInteract(level, { id: "mc06_bridge", label: "Radial transfer bridge", x: UPPER.mc06PivotX + 6, y: UPPER.mc06PivotY, z: UPPER.z, r: 3.0, kind: "world" });
  addInteract(level, { id: "mc06_dropweight", label: "18 t drop weight", x: UPPER.mc06PivotX, y: 18.0, z: UPPER.z - 6.5, r: 3.0, kind: "machine" });

  const basculeCols = dynamicSegments(level, "mc05_bascule", 16, 2.2);
  const tableCol: Collider = { id: "mc05_table_platform", minx: 0, maxx: 0, miny: 0, maxy: 0, minz: UPPER.z - 3.1, maxz: UPPER.z + 3.1 };
  level.colliders.push(tableCol);
  const radialCols = dynamicSegments(level, "mc06_bridge", 12, 1.55);
  const dropCol: Collider = { id: "mc06_dropweight_body", minx: 0, maxx: 0, miny: 0, maxy: 0, minz: UPPER.z - 8.3, maxz: UPPER.z - 4.7 };
  level.colliders.push(dropCol);

  const made = { root, bascule, ballast, table, rotor, radial, drop, tableHaul, dropRope, mc05BrakeLamp, mc06BrakeLamp, basculeCols, tableCol, radialCols, dropCol };
  cache.set(level, made);
  return made;
}

function updateRotatingSegments(
  cols: Collider[],
  pivotX: number,
  pivotY: number,
  length: number,
  angle: number,
  omega: number,
  radialV = 0,
) {
  const seg = length / cols.length;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  for (let i = 0; i < cols.length; i++) {
    const along = (i + 0.5) * seg;
    const x = pivotX + along * ca;
    const y = pivotY + along * sa;
    const hx = Math.abs(ca) * seg * 0.55 + Math.abs(sa) * 0.34;
    const hy = Math.abs(sa) * seg * 0.55 + Math.abs(ca) * 0.34;
    const c = cols[i]!;
    c.minx = x - hx;
    c.maxx = x + hx;
    c.miny = y - hy;
    c.maxy = y + hy;
    c.surfaceAngularZ = omega;
    c.surfacePivotX = pivotX;
    c.surfacePivotY = pivotY;
    c.surfaceVx = radialV * ca;
    c.surfaceVy = radialV * sa;
  }
}

export function applyUpperCascadeCoupling(level: Level, sim: Simulation): void {
  const b = ensureUpperWorld(level);
  const r = sim.state().rube;
  if (!r?.chain) return;
  ensureUpperCascadeState(r.chain);

  const basculeW = mc05BasculeWorld(r)!;
  const ballastW = mc05BallastWorld(r)!;
  const tableW = mc05TableWorld(r)!;
  const rotorW = mc06World(r)!;

  b.bascule.rotation.z = basculeW.angle;
  b.ballast.position.set(ballastW.x, ballastW.y, ballastW.z);
  b.ballast.rotation.z = ballastW.angle;
  b.table.position.set(tableW.x, tableW.y, tableW.z);

  updateRotatingSegments(b.basculeCols, UPPER.mc05PivotX, UPPER.mc05PivotY, UPPER.basculeLengthM, basculeW.angle, basculeW.omega);
  b.tableCol.minx = tableW.x - UPPER.tableHalfLengthM;
  b.tableCol.maxx = tableW.x + UPPER.tableHalfLengthM;
  b.tableCol.miny = tableW.y - 0.55;
  b.tableCol.maxy = tableW.y + 0.25;
  b.tableCol.surfaceVx = tableW.vx;

  const leafTip = new THREE.Vector3(
    UPPER.mc05PivotX + UPPER.basculeLengthM * Math.cos(basculeW.angle),
    UPPER.mc05PivotY + UPPER.basculeLengthM * Math.sin(basculeW.angle),
    UPPER.z,
  );
  placeLine(b.tableHaul, leafTip, new THREE.Vector3(tableW.x, tableW.y + 0.8, tableW.z));

  b.rotor.rotation.z = rotorW.rotorAngle;
  const radialLen = UPPER.radialBaseRadiusM + rotorW.bridgeExtension;
  const radialMaxLen = UPPER.radialBaseRadiusM + UPPER.radialMaxM;
  b.radial.scale.x = radialLen / radialMaxLen;
  updateRotatingSegments(b.radialCols, UPPER.mc06PivotX, UPPER.mc06PivotY, radialLen, rotorW.rotorAngle, rotorW.rotorOmega, rotorW.bridgeVelocity);

  b.drop.position.set(UPPER.mc06PivotX, rotorW.dropY, UPPER.z - 6.5);
  b.dropCol.minx = UPPER.mc06PivotX - 2.2;
  b.dropCol.maxx = UPPER.mc06PivotX + 2.2;
  b.dropCol.miny = rotorW.dropY - 1.6;
  b.dropCol.maxy = rotorW.dropY + 1.6;
  b.dropCol.surfaceVy = rotorW.dropVelocity;
  placeLine(
    b.dropRope,
    new THREE.Vector3(UPPER.mc06PivotX, UPPER.mc06PivotY + 3.8, UPPER.z - 6.5),
    new THREE.Vector3(UPPER.mc06PivotX, rotorW.dropY + 1.6, UPPER.z - 6.5),
  );

  const ballastIt = level.interactables.find((x) => x.id === "mc05_ballast");
  if (ballastIt) { ballastIt.x = ballastW.x; ballastIt.y = ballastW.y; }
  const tableIt = level.interactables.find((x) => x.id === "mc05_table");
  if (tableIt) tableIt.x = tableW.x;
  const bridgeIt = level.interactables.find((x) => x.id === "mc06_bridge");
  if (bridgeIt) {
    bridgeIt.x = UPPER.mc06PivotX + 0.62 * radialLen * Math.cos(rotorW.rotorAngle);
    bridgeIt.y = UPPER.mc06PivotY + 0.62 * radialLen * Math.sin(rotorW.rotorAngle);
  }
  const dropIt = level.interactables.find((x) => x.id === "mc06_dropweight");
  if (dropIt) dropIt.y = rotorW.dropY;

  const m05 = b.mc05BrakeLamp.material as THREE.MeshStandardMaterial;
  m05.emissive.setHex(upperBrakeEngaged(r, "mc05") ? 0xc45f43 : 0x6ec8a0);
  m05.emissiveIntensity = 1.15;
  const m06 = b.mc06BrakeLamp.material as THREE.MeshStandardMaterial;
  m06.emissive.setHex(upperBrakeEngaged(r, "mc06") ? 0xc45f43 : 0x6ec8a0);
  m06.emissiveIntensity = 1.15;

  // Force evaluation also keeps these cable states visible to presentation tooling.
  void mechCable(r.chain.network, MECH_ID.mc05TransferCable);
  void mechDof(r.chain.network, MECH_ID.mc06Rotor);
}
