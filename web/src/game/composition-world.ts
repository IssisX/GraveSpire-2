import * as THREE from "three";
import type { Simulation } from "@/sim/simulation.ts";
import { ensureLinkedCascadeState } from "@/sim/linked-cascade.ts";
import { compositionBodyWorld, type IngredientKind } from "@/sim/composition-bodies.ts";
import type { Collider } from "./collision.ts";
import type { Level } from "./level.ts";

type BodyBinding = {
  root: THREE.Group;
  cols: Collider[];
  kind: IngredientKind;
  sling?: THREE.Mesh;
};

const cache = new WeakMap<Level, Map<string, BodyBinding>>();
const UP = new THREE.Vector3(0, 1, 0);
const DIR = new THREE.Vector3();

function geo<T extends THREE.BufferGeometry>(level: Level, g: T): T {
  level.geos.push(g);
  return g;
}

function materialFor(level: Level, kind: IngredientKind): THREE.Material {
  if (kind === "ballast" || kind === "hanging") return level.materials.carrier;
  if (kind === "wedge") return level.materials.hazard;
  if (kind === "roller") return level.materials.steel;
  return level.materials.rust;
}

function placeSling(mesh: THREE.Mesh, ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz) || 0.01;
  mesh.position.set((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
  mesh.scale.set(1, len, 1);
  DIR.set(dx / len, dy / len, dz / len);
  mesh.quaternion.setFromUnitVectors(UP, DIR);
}

function makeBody(level: Level, body: ReturnType<typeof compositionBodyWorld>[number]): BodyBinding {
  const scene = level.bindings.carrier.parent;
  if (!(scene instanceof THREE.Scene)) throw new Error("GRAVESPIRE level is not attached to a THREE.Scene");
  const root = new THREE.Group();
  root.name = `composition-${body.id}`;
  const mat = materialFor(level, body.kind);
  let sling: THREE.Mesh | undefined;

  if (body.kind === "roller") {
    const roll = new THREE.Mesh(geo(level, new THREE.CylinderGeometry(body.sizeY * 0.5, body.sizeY * 0.5, body.sizeZ, 16)), mat);
    roll.rotation.x = Math.PI / 2;
    roll.castShadow = true;
    roll.receiveShadow = true;
    root.add(roll);
    const witness = new THREE.Mesh(geo(level, new THREE.BoxGeometry(body.sizeY * 0.92, 0.08, body.sizeZ + 0.04)), level.materials.hazard);
    root.add(witness);
  } else if (body.kind === "wedge") {
    const shape = new THREE.Shape();
    shape.moveTo(-body.sizeX * 0.5, -body.sizeY * 0.5);
    shape.lineTo(body.sizeX * 0.5, -body.sizeY * 0.5);
    shape.lineTo(body.sizeX * 0.5, body.sizeY * 0.5);
    shape.closePath();
    const wedge = new THREE.Mesh(geo(level, new THREE.ExtrudeGeometry(shape, { depth: body.sizeZ, bevelEnabled: false })), mat);
    wedge.position.z = -body.sizeZ * 0.5;
    wedge.castShadow = true;
    wedge.receiveShadow = true;
    root.add(wedge);
  } else {
    const mesh = new THREE.Mesh(geo(level, new THREE.BoxGeometry(body.sizeX, body.sizeY, body.sizeZ)), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    if (body.kind === "hanging") {
      const eye = new THREE.Mesh(geo(level, new THREE.TorusGeometry(0.25, 0.055, 6, 18)), level.materials.steel);
      eye.position.y = body.sizeY * 0.5 + 0.16;
      eye.rotation.x = Math.PI / 2;
      root.add(eye);
      sling = new THREE.Mesh(geo(level, new THREE.CylinderGeometry(0.035, 0.035, 1, 8)), level.materials.steelDark);
      scene.add(sling);
      const anchorEye = new THREE.Mesh(geo(level, new THREE.TorusGeometry(0.30, 0.06, 6, 18)), level.materials.steel);
      anchorEye.position.set(body.anchorX ?? body.x, body.anchorY ?? body.y, body.z);
      anchorEye.rotation.x = Math.PI / 2;
      scene.add(anchorEye);
    }
  }
  scene.add(root);

  const count = body.kind === "beam" ? 7 : body.kind === "wedge" ? 3 : 1;
  const cols: Collider[] = [];
  for (let i = 0; i < count; i++) {
    const c: Collider = {
      id: `ingredient:${body.id}:${i}`,
      minx: 0, maxx: 0, miny: 0, maxy: 0,
      minz: body.z - body.sizeZ * 0.5,
      maxz: body.z + body.sizeZ * 0.5,
    };
    level.colliders.push(c);
    cols.push(c);
  }
  return { root, cols, kind: body.kind, sling };
}

function updateSegments(binding: BodyBinding, body: ReturnType<typeof compositionBodyWorld>[number]) {
  const ca = Math.cos(body.angle);
  const sa = Math.sin(body.angle);
  const segLen = body.sizeX / binding.cols.length;
  for (let i = 0; i < binding.cols.length; i++) {
    const local = -body.sizeX * 0.5 + (i + 0.5) * segLen;
    const x = body.x + local * ca;
    const y = body.y + local * sa;
    const hx = Math.abs(ca) * segLen * 0.52 + Math.abs(sa) * body.sizeY * 0.52;
    const hy = Math.abs(sa) * segLen * 0.52 + Math.abs(ca) * body.sizeY * 0.52;
    const c = binding.cols[i]!;
    c.minx = x - hx;
    c.maxx = x + hx;
    c.miny = y - hy;
    c.maxy = y + hy;
    c.minz = body.z - body.sizeZ * 0.5;
    c.maxz = body.z + body.sizeZ * 0.5;
    c.surfaceVx = body.vx;
    c.surfaceVy = body.vy;
    c.surfaceVz = 0;
    c.surfaceAngularZ = body.omega;
    c.surfacePivotX = body.x;
    c.surfacePivotY = body.y;
  }
}

function updateBox(binding: BodyBinding, body: ReturnType<typeof compositionBodyWorld>[number]) {
  const c = binding.cols[0]!;
  const ca = Math.cos(body.angle);
  const sa = Math.sin(body.angle);
  const hx = Math.abs(ca) * body.sizeX * 0.5 + Math.abs(sa) * body.sizeY * 0.5;
  const hy = Math.abs(sa) * body.sizeX * 0.5 + Math.abs(ca) * body.sizeY * 0.5;
  c.minx = body.x - hx;
  c.maxx = body.x + hx;
  c.miny = body.y - hy;
  c.maxy = body.y + hy;
  c.minz = body.z - body.sizeZ * 0.5;
  c.maxz = body.z + body.sizeZ * 0.5;
  c.surfaceVx = body.vx;
  c.surfaceVy = body.vy;
  c.surfaceVz = 0;
  c.surfaceAngularZ = body.omega;
  c.surfacePivotX = body.x;
  c.surfacePivotY = body.y;
}

/** Presentation/collision projection only; state is owned by MechanicalNetworkState. */
export function applyCompositionWorld(level: Level, sim: Simulation): void {
  const rube = sim.state().rube;
  if (!rube?.chain) return;
  const chain = ensureLinkedCascadeState(rube);
  const bodies = compositionBodyWorld(chain);
  let bindings = cache.get(level);
  if (!bindings) {
    bindings = new Map();
    cache.set(level, bindings);
  }

  for (const body of bodies) {
    let b = bindings.get(body.id);
    if (!b) {
      b = makeBody(level, body);
      bindings.set(body.id, b);
    }
    b.root.position.set(body.x, body.y, body.z);
    b.root.rotation.z = body.kind === "hanging" ? 0 : body.angle;
    if (body.kind === "beam" || body.kind === "wedge") updateSegments(b, body);
    else updateBox(b, body);
    if (body.kind === "hanging" && b.sling) {
      placeSling(
        b.sling,
        body.anchorX ?? body.x,
        body.anchorY ?? body.y,
        body.z,
        body.x,
        body.y + body.sizeY * 0.5,
        body.z,
      );
    }
  }
}
