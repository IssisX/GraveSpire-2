import * as THREE from "three";
import type { Simulation } from "@/sim/simulation.ts";
import { ensureLinkedCascadeState } from "@/sim/linked-cascade.ts";
import { mc07World, mc08World, VERTICAL } from "@/sim/vertical-spine.ts";
import type { Collider } from "./collision.ts";
import type { Interactable, Level } from "./level.ts";
import { makeSignTexture } from "./materials.ts";

type VerticalBindings = {
  root: THREE.Group;
  ascender: THREE.Group;
  countercar: THREE.Group;
  cradle: THREE.Group;
  ring: THREE.Group;
  ballast: THREE.Group;
  helix: THREE.Group;
  ascenderCol: Collider;
  counterCol: Collider;
  cradleCols: Collider[];
  helixCol: Collider;
};

const cache = new WeakMap<Level, VerticalBindings>();

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
      id: id ?? "vertical_static",
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

function dynamicSegments(level: Level, prefix: string, count: number, zHalf: number): Collider[] {
  const out: Collider[] = [];
  for (let i = 0; i < count; i++) {
    const c: Collider = { id: `${prefix}_${i}`, minx: 0, maxx: 0, miny: 0, maxy: 0, minz: VERTICAL.z - zHalf, maxz: VERTICAL.z + zHalf };
    level.colliders.push(c);
    out.push(c);
  }
  return out;
}

function updateRotatingSegments(
  cols: Collider[],
  pivotX: number,
  pivotY: number,
  length: number,
  angle: number,
  omega: number,
) {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const segLen = length / cols.length;
  for (let i = 0; i < cols.length; i++) {
    const along = (i + 0.5) * segLen;
    const x = pivotX + along * ca;
    const y = pivotY + along * sa;
    const hx = Math.abs(ca) * segLen * 0.52 + Math.abs(sa) * 0.35;
    const hy = Math.abs(sa) * segLen * 0.52 + Math.abs(ca) * 0.35;
    const c = cols[i]!;
    c.minx = x - hx;
    c.maxx = x + hx;
    c.miny = y - hy;
    c.maxy = y + hy;
    c.surfaceAngularZ = omega;
    c.surfacePivotX = pivotX;
    c.surfacePivotY = pivotY;
  }
}

function ensureVerticalWorld(level: Level): VerticalBindings {
  const prior = cache.get(level);
  if (prior) return prior;
  const scene = sceneFor(level);
  const mats = level.materials;
  const root = new THREE.Group();
  root.name = "vertical-mechanical-skyscraper";
  scene.add(root);

  // The MC-06 high exit is a narrow industrial bridge into the open lift throat.
  // There is deliberately no sealed floor beneath it: falling remains possible.
  addBox(level, root, 9.5, 0.28, 3.2, 170.5, VERTICAL.shaftBaseY - 0.14, VERTICAL.z, mats.grating, "mc07_entry_walk");

  const sign07 = new THREE.MeshStandardMaterial({
    map: makeSignTexture("MC-07", "COUNTERBALANCED THROAT  ·  24 m VERTICAL TRANSFER"),
    metalness: 0.15,
    roughness: 0.65,
  });
  const s07 = new THREE.Mesh(geo(level, new THREE.PlaneGeometry(8.2, 1.8)), sign07);
  s07.position.set(171.5, 26.0, VERTICAL.z + 2.3);
  root.add(s07);

  // Open lattice tower: it reads like an industrial yard turned vertically.
  for (const x of [VERTICAL.mc07X - 2.4, VERTICAL.mc07X + 2.4, VERTICAL.countercarX - 2.4, VERTICAL.countercarX + 2.4]) {
    addBox(level, root, 0.42, 30.0, 0.42, x, 36.5, VERTICAL.z + 2.4, mats.steelDark, undefined, false);
    addBox(level, root, 0.42, 30.0, 0.42, x, 36.5, VERTICAL.z - 2.4, mats.steelDark, undefined, false);
  }
  for (const y of [25, 31, 37, 43, 49]) {
    addBox(level, root, 12.0, 0.22, 0.22, 177.5, y, VERTICAL.z + 2.4, mats.steel, undefined, false);
    addBox(level, root, 12.0, 0.22, 0.22, 177.5, y, VERTICAL.z - 2.4, mats.steel, undefined, false);
  }

  const ascender = new THREE.Group();
  const ascDeck = new THREE.Mesh(geo(level, new THREE.BoxGeometry(5.0, 0.42, 4.6)), mats.diamond);
  ascDeck.position.y = -0.21;
  const ascFrame = new THREE.Mesh(geo(level, new THREE.BoxGeometry(4.6, 1.25, 4.2)), mats.steelDark);
  ascFrame.position.y = -0.85;
  ascender.add(ascDeck, ascFrame);
  for (const z of [-2.05, 2.05]) {
    const rail = new THREE.Mesh(geo(level, new THREE.BoxGeometry(4.6, 0.12, 0.12)), mats.steel);
    rail.position.set(0, 1.0, z);
    ascender.add(rail);
  }
  root.add(ascender);

  const countercar = new THREE.Group();
  const counterBody = new THREE.Mesh(geo(level, new THREE.BoxGeometry(5.0, 3.0, 4.6)), mats.rust);
  countercar.add(counterBody);
  root.add(countercar);

  const ascenderCol: Collider = { id: "mc07_ascender_platform", minx: 0, maxx: 0, miny: 0, maxy: 0, minz: 0, maxz: 0 };
  const counterCol: Collider = { id: "mc07_countercar_body", minx: 0, maxx: 0, miny: 0, maxy: 0, minz: 0, maxz: 0 };
  level.colliders.push(ascenderCol, counterCol);

  // Top transfer cradle is itself a 42 t tilting floor into MC-08.
  const cradle = new THREE.Group();
  cradle.position.set(VERTICAL.cradlePivotX, VERTICAL.cradlePivotY, VERTICAL.z);
  const cradleBeam = new THREE.Mesh(geo(level, new THREE.BoxGeometry(VERTICAL.cradleLengthM, 0.62, 4.2)), mats.steel);
  cradleBeam.position.x = VERTICAL.cradleLengthM * 0.5;
  const cradleDeck = new THREE.Mesh(geo(level, new THREE.BoxGeometry(VERTICAL.cradleLengthM - 0.3, 0.14, 3.9)), mats.grating);
  cradleDeck.position.set(VERTICAL.cradleLengthM * 0.5, 0.39, 0);
  cradle.add(cradleBeam, cradleDeck);
  root.add(cradle);
  const cradleCols = dynamicSegments(level, "mc07_cradle", 10, 2.0);

  // A tiny service ledge at the top. Missing the cradle means a LONG fall.
  addBox(level, root, 5.8, 0.28, 4.4, 174.7, 47.05, VERTICAL.z, mats.grating, "mc07_top_landing");

  const sign08 = new THREE.MeshStandardMaterial({
    map: makeSignTexture("MC-08", "TORSION STACK  ·  ECCENTRIC BALLAST / HELICAL ASCENT"),
    metalness: 0.15,
    roughness: 0.65,
  });
  const s08 = new THREE.Mesh(geo(level, new THREE.PlaneGeometry(8.4, 1.8)), sign08);
  s08.position.set(188.5, 54.5, VERTICAL.z + 2.3);
  root.add(s08);

  // Giant annular machine suspended in the same open shaft.
  const ring = new THREE.Group();
  ring.position.set(VERTICAL.mc08PivotX, VERTICAL.mc08PivotY, VERTICAL.z);
  const ringMesh = new THREE.Mesh(geo(level, new THREE.TorusGeometry(VERTICAL.ringRadiusM, 0.58, 10, 40)), mats.steel);
  ringMesh.rotation.x = Math.PI / 2;
  ring.add(ringMesh);
  const crossA = new THREE.Mesh(geo(level, new THREE.BoxGeometry(VERTICAL.ringRadiusM * 2, 0.38, 2.0)), mats.grating);
  const crossB = crossA.clone();
  crossB.rotation.z = Math.PI / 2;
  ring.add(crossA, crossB);
  root.add(ring);

  const ballast = new THREE.Group();
  const ballastBody = new THREE.Mesh(geo(level, new THREE.BoxGeometry(3.8, 2.7, 3.4)), mats.carrier);
  ballast.add(ballastBody);
  root.add(ballast);

  // Helical transfer platform rises through the rotating ring to the next level.
  const helix = new THREE.Group();
  const helixDeck = new THREE.Mesh(geo(level, new THREE.BoxGeometry(5.4, 0.42, 5.0)), mats.diamond);
  helixDeck.position.y = -0.21;
  const helixFrame = new THREE.Mesh(geo(level, new THREE.BoxGeometry(4.8, 0.85, 4.5)), mats.hazard);
  helixFrame.position.y = -0.72;
  helix.add(helixDeck, helixFrame);
  root.add(helix);
  const helixCol: Collider = { id: "mc08_helix_platform", minx: 0, maxx: 0, miny: 0, maxy: 0, minz: 0, maxz: 0 };
  level.colliders.push(helixCol);

  // Upper receiving yard: sparse grating, open sides, lots of visible depth.
  addBox(level, root, 16.0, 0.30, 4.5, 198.0, 69.0, VERTICAL.z, mats.grating, "mc08_upper_yard");
  addBox(level, root, 0.24, 9.0, 0.24, 205.0, 64.5, VERTICAL.z + 2.0, mats.steelDark, undefined, false);
  addBox(level, root, 0.24, 9.0, 0.24, 205.0, 64.5, VERTICAL.z - 2.0, mats.steelDark, undefined, false);

  addInteract(level, { id: "mc07_ascender", label: "26 t ascent carrier", x: VERTICAL.mc07X, y: VERTICAL.shaftBaseY, z: VERTICAL.z, r: 3.2, kind: "machine" });
  addInteract(level, { id: "mc07_countercar", label: "34 t counter-car", x: VERTICAL.countercarX, y: VERTICAL.shaftBaseY + VERTICAL.shaftTravelM, z: VERTICAL.z, r: 3.2, kind: "machine" });
  addInteract(level, { id: "mc07_cradle", label: "42 t tilting transfer cradle", x: VERTICAL.cradlePivotX + 3.0, y: VERTICAL.cradlePivotY, z: VERTICAL.z, r: 3.2, kind: "world" });
  addInteract(level, { id: "mc08_ring", label: "Torsion annulus", x: VERTICAL.mc08PivotX, y: VERTICAL.mc08PivotY, z: VERTICAL.z, r: 3.4, kind: "machine" });
  addInteract(level, { id: "mc08_ballast", label: "45 t eccentric ballast", x: VERTICAL.mc08PivotX + VERTICAL.ballastStartM, y: VERTICAL.mc08PivotY, z: VERTICAL.z, r: 3.2, kind: "machine" });
  addInteract(level, { id: "mc08_helix", label: "Helical transfer platform", x: VERTICAL.mc08PivotX, y: VERTICAL.mc08PivotY, z: VERTICAL.z, r: 3.2, kind: "world" });

  const lampA = new THREE.PointLight(0xffb26b, 34, 30, 1.1);
  lampA.position.set(177, 35, VERTICAL.z);
  root.add(lampA);
  const lampB = new THREE.PointLight(0x7fc8ff, 34, 32, 1.0);
  lampB.position.set(190, 57, VERTICAL.z);
  root.add(lampB);

  const made = { root, ascender, countercar, cradle, ring, ballast, helix, ascenderCol, counterCol, cradleCols, helixCol };
  cache.set(level, made);
  return made;
}

/** Presentation only. Authority is the shared generalized-coordinate network. */
export function applyVerticalSpineCoupling(level: Level, sim: Simulation): void {
  const b = ensureVerticalWorld(level);
  const rube = sim.state().rube;
  if (!rube?.chain) return;
  const chain = ensureLinkedCascadeState(rube);
  const w7 = mc07World(chain);
  const w8 = mc08World(chain);

  b.ascender.position.set(w7.ascender.x, w7.ascender.y, w7.ascender.z);
  b.ascenderCol.minx = w7.ascender.x - 2.5;
  b.ascenderCol.maxx = w7.ascender.x + 2.5;
  b.ascenderCol.miny = w7.ascender.y - 0.45;
  b.ascenderCol.maxy = w7.ascender.y + 0.05;
  b.ascenderCol.minz = w7.ascender.z - 2.3;
  b.ascenderCol.maxz = w7.ascender.z + 2.3;
  b.ascenderCol.surfaceVy = w7.ascender.vy;

  b.countercar.position.set(w7.countercar.x, w7.countercar.y, w7.countercar.z);
  b.counterCol.minx = w7.countercar.x - 2.5;
  b.counterCol.maxx = w7.countercar.x + 2.5;
  b.counterCol.miny = w7.countercar.y - 1.5;
  b.counterCol.maxy = w7.countercar.y + 1.5;
  b.counterCol.minz = w7.countercar.z - 2.3;
  b.counterCol.maxz = w7.countercar.z + 2.3;
  b.counterCol.surfaceVy = w7.countercar.vy;

  b.cradle.rotation.z = w7.cradle.angle;
  updateRotatingSegments(
    b.cradleCols,
    VERTICAL.cradlePivotX,
    VERTICAL.cradlePivotY,
    VERTICAL.cradleLengthM,
    w7.cradle.angle,
    w7.cradle.omega,
  );

  b.ring.rotation.z = w8.ring.angle;
  const ballastX = VERTICAL.mc08PivotX + w8.ballastRadius * Math.cos(w8.ring.angle);
  const ballastY = VERTICAL.mc08PivotY + w8.ballastRadius * Math.sin(w8.ring.angle);
  b.ballast.position.set(ballastX, ballastY, VERTICAL.z);
  b.ballast.rotation.z = w8.ring.angle;

  b.helix.position.set(VERTICAL.mc08PivotX, w8.helixY, VERTICAL.z);
  b.helix.rotation.y = 0.35 * w8.ring.angle;
  b.helixCol.minx = VERTICAL.mc08PivotX - 2.7;
  b.helixCol.maxx = VERTICAL.mc08PivotX + 2.7;
  b.helixCol.miny = w8.helixY - 0.45;
  b.helixCol.maxy = w8.helixY + 0.05;
  b.helixCol.minz = VERTICAL.z - 2.5;
  b.helixCol.maxz = VERTICAL.z + 2.5;
  b.helixCol.surfaceVy = w8.helixVy;

  const a = level.interactables.find((x) => x.id === "mc07_ascender");
  if (a) a.y = w7.ascender.y;
  const c = level.interactables.find((x) => x.id === "mc07_countercar");
  if (c) c.y = w7.countercar.y;
  const cr = level.interactables.find((x) => x.id === "mc07_cradle");
  if (cr) {
    cr.x = VERTICAL.cradlePivotX + 0.6 * VERTICAL.cradleLengthM * Math.cos(w7.cradle.angle);
    cr.y = VERTICAL.cradlePivotY + 0.6 * VERTICAL.cradleLengthM * Math.sin(w7.cradle.angle);
  }
  const rb = level.interactables.find((x) => x.id === "mc08_ballast");
  if (rb) { rb.x = ballastX; rb.y = ballastY; }
  const hp = level.interactables.find((x) => x.id === "mc08_helix");
  if (hp) hp.y = w8.helixY;
}
