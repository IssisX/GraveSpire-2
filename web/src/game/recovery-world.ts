import * as THREE from "three";
import type { Simulation } from "@/sim/simulation.ts";
import { ensureLinkedCascadeState } from "@/sim/linked-cascade.ts";
import { mc07World } from "@/sim/vertical-spine.ts";
import { mc10World } from "@/sim/pressure-crown.ts";
import { mc11World, mc12World, SKY } from "@/sim/sky-spine.ts";
import type { Level } from "./level.ts";
import { RETURN_BRACES, RETURN_LADDERS, RETURN_TIERS, type ReturnBrace, type ReturnLadder, type ReturnTier } from "./recovery-layout.ts";

type RecoveryBindings = {
  root: THREE.Group;
  dust: THREE.Points;
  dustSeed: Float32Array;
  cables: THREE.Mesh[];
  haze: THREE.Mesh[];
};

const cache = new WeakMap<Level, RecoveryBindings>();
const UP = new THREE.Vector3(0, 1, 0);
const DIR = new THREE.Vector3();

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
  const mesh = new THREE.Mesh(geo(level, new THREE.BoxGeometry(w, h, d)), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  if (collider) {
    level.colliders.push({ id: id ?? "return_steel", minx: x - w * 0.5, maxx: x + w * 0.5, miny: y - h * 0.5, maxy: y + h * 0.5, minz: z - d * 0.5, maxz: z + d * 0.5 });
  }
  return mesh;
}

function addTier(level: Level, root: THREE.Group, tier: ReturnTier) {
  const h = tier.kind === "beam" ? 0.28 : 0.20;
  addBox(level, root, tier.width, h, tier.depth, tier.x, tier.y - h * 0.5, tier.z, level.materials.grating, tier.id);
  addBox(level, root, tier.width + 0.16, 0.16, 0.18, tier.x, tier.y - h - 0.18, tier.z - tier.depth * 0.42, level.materials.steelDark, undefined, false);
  if (tier.kind === "rack" || tier.kind === "platform") {
    for (const dz of [-tier.depth * 0.26, tier.depth * 0.26]) {
      addBox(level, root, tier.width * 0.88, 0.10, 0.10, tier.x, tier.y + 0.66, tier.z + dz, level.materials.steel, undefined, false);
    }
  }
  if (tier.kind === "rack") {
    // A rack is a set of real narrow pipes above the deck: useful as a
    // precarious landing, but too discontinuous to behave like a floor.
    for (const dz of [-tier.depth * 0.31, 0, tier.depth * 0.31]) {
      addBox(level, root, tier.width * 0.92, 0.13, 0.16, tier.x, tier.y + 0.48, tier.z + dz, level.materials.steelDark, `${tier.id}_pipe_${dz.toFixed(2)}`);
    }
  }
  if (tier.kind === "platform") {
    for (const sx of [-tier.width * 0.38, tier.width * 0.38]) {
      addBox(level, root, 0.14, 5.0, 0.14, tier.x + sx, tier.y + 2.25, tier.z, level.materials.cable, undefined, false);
    }
  }
}

function addLadder(level: Level, root: THREE.Group, ladder: ReturnLadder) {
  const alongX = Math.abs(ladder.normalZ) > 0.5;
  const railSpan = 0.74;
  for (const side of [-1, 1]) {
    const x = ladder.x + (alongX ? side * railSpan * 0.5 : 0);
    const z = ladder.z + (alongX ? 0 : side * railSpan * 0.5);
    addBox(level, root, 0.12, ladder.height, 0.12, x, ladder.bottomY + ladder.height * 0.5, z, level.materials.steelDark, undefined, false);
  }
  for (let y = ladder.bottomY + 0.22; y < ladder.bottomY + ladder.height - 0.08; y += 0.34) {
    addBox(level, root, alongX ? railSpan : 0.10, 0.07, alongX ? 0.10 : railSpan, ladder.x, y, ladder.z, level.materials.steel, undefined, false);
  }
  const hx = alongX ? railSpan * 0.5 : 0.11;
  const hz = alongX ? 0.11 : railSpan * 0.5;
  level.colliders.push({
    id: ladder.id,
    minx: ladder.x - hx,
    maxx: ladder.x + hx,
    miny: ladder.bottomY,
    maxy: ladder.bottomY + ladder.height,
    minz: ladder.z - hz,
    maxz: ladder.z + hz,
    climbable: { normalX: ladder.normalX, normalZ: ladder.normalZ },
  });
}

function addBrace(level: Level, root: THREE.Group, brace: ReturnBrace) {
  const count = brace.segments;
  const dx = (brace.x1 - brace.x0) / count;
  const dy = (brace.y1 - brace.y0) / count;
  const dz = (brace.z1 - brace.z0) / count;
  const len = Math.hypot(dx, dy, dz);
  for (let i = 0; i < count; i++) {
    const a = i / count;
    const b = (i + 0.86) / count;
    const ax = brace.x0 + (brace.x1 - brace.x0) * a;
    const ay = brace.y0 + (brace.y1 - brace.y0) * a;
    const az = brace.z0 + (brace.z1 - brace.z0) * a;
    const bx = brace.x0 + (brace.x1 - brace.x0) * b;
    const by = brace.y0 + (brace.y1 - brace.y0) * b;
    const bz = brace.z0 + (brace.z1 - brace.z0) * b;
    const seg = new THREE.Mesh(geo(level, new THREE.CylinderGeometry(0.16, 0.16, len * 0.86, 6)), level.materials.steel);
    seg.position.set((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
    DIR.set(bx - ax, by - ay, bz - az).normalize();
    seg.quaternion.setFromUnitVectors(UP, DIR);
    seg.castShadow = true;
    root.add(seg);
    const x = brace.x0 + dx * (i + 0.43);
    const y = brace.y0 + dy * (i + 0.43);
    const z = brace.z0 + dz * (i + 0.43);
    const hx = Math.abs(dx) * 0.48 + 0.20;
    const hy = Math.abs(dy) * 0.48 + 0.20;
    const hz = Math.abs(dz) * 0.48 + 0.20;
    level.colliders.push({ id: `${brace.id}_${i}`, minx: x - hx, maxx: x + hx, miny: y - hy, maxy: y + hy, minz: z - hz, maxz: z + hz });
  }
}

function placeLine(mesh: THREE.Mesh, ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz) || 0.01;
  mesh.position.set((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
  DIR.set(dx / len, dy / len, dz / len);
  mesh.quaternion.setFromUnitVectors(UP, DIR);
  mesh.scale.set(1, len, 1);
}

function makeDust(level: Level): { dust: THREE.Points; seed: Float32Array } {
  const count = 180;
  const seed = new Float32Array(count * 4);
  const positions = new Float32Array(count * 3);
  let r = 0x95acb1d;
  const rand = () => {
    r = (Math.imul(r, 1664525) + 1013904223) >>> 0;
    return r / 0x100000000;
  };
  for (let i = 0; i < count; i++) {
    const x = 62 + rand() * 252;
    const y = 2 + rand() * 140;
    const z = -49 + rand() * 26;
    seed.set([x, y, z, rand() * Math.PI * 2], i * 4);
    positions.set([x, y, z], i * 3);
  }
  const geometry = geo(level, new THREE.BufferGeometry());
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color: 0xa9b5bd, size: 0.18, transparent: true, opacity: 0.36, depthWrite: false, sizeAttenuation: true });
  return { dust: new THREE.Points(geometry, material), seed };
}

function ensureRecoveryWorld(level: Level): RecoveryBindings {
  const prior = cache.get(level);
  if (prior) return prior;
  const scene = sceneFor(level);
  const root = new THREE.Group();
  root.name = "mc01-12-return-ecology";
  scene.add(root);
  for (const tier of RETURN_TIERS) addTier(level, root, tier);
  for (const ladder of RETURN_LADDERS) addLadder(level, root, ladder);
  for (const brace of RETURN_BRACES) addBrace(level, root, brace);

  // Deliberately sparse exposed steel: it communicates the connected void
  // without turning the return route into a continuous staircase.
  for (const x of [89, 149, 220, 284]) {
    addBox(level, root, 0.18, 122, 0.18, x, 68, -47.5, level.materials.steelDark, undefined, false);
  }
  const { dust, seed } = makeDust(level);
  root.add(dust);

  const lampGeo = geo(level, new THREE.BoxGeometry(0.16, 0.08, 0.16));
  const lamps = new THREE.InstancedMesh(lampGeo, level.materials.emissiveSodium, RETURN_TIERS.length * 2);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < RETURN_TIERS.length; i++) {
    const t = RETURN_TIERS[i]!;
    matrix.makeTranslation(t.x - t.width * 0.32, t.y + 0.35, t.z + t.depth * 0.42);
    lamps.setMatrixAt(i * 2, matrix);
    matrix.makeTranslation(t.x + t.width * 0.28, t.y + 0.52, t.z - t.depth * 0.42);
    lamps.setMatrixAt(i * 2 + 1, matrix);
  }
  lamps.instanceMatrix.needsUpdate = true;
  root.add(lamps);

  const cables: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const cable = new THREE.Mesh(geo(level, new THREE.CylinderGeometry(0.028, 0.028, 1, 6)), level.materials.cable);
    cable.castShadow = false;
    root.add(cable);
    cables.push(cable);
  }
  const haze: THREE.Mesh[] = [];
  const hazeMat = new THREE.MeshBasicMaterial({ color: 0x8093a0, transparent: true, opacity: 0.055, depthWrite: false, side: THREE.DoubleSide });
  for (const [x, y, z, width, height] of [[112, 21, -48, 64, 11], [188, 57, -47, 72, 15], [253, 103, -46, 80, 17]] as const) {
    const sheet = new THREE.Mesh(geo(level, new THREE.PlaneGeometry(width, height)), hazeMat.clone());
    sheet.position.set(x, y, z);
    sheet.rotation.y = Math.PI * 0.08;
    root.add(sheet);
    haze.push(sheet);
  }
  const made = { root, dust, dustSeed: seed, cables, haze };
  cache.set(level, made);
  return made;
}

/** Presentation/collision projection. It reads existing MC state and never creates recovery triggers. */
export function applyRecoveryWorld(level: Level, sim: Simulation) {
  const b = ensureRecoveryWorld(level);
  const rube = sim.state().rube;
  if (!rube?.chain) return;
  const chain = ensureLinkedCascadeState(rube);
  const w7 = mc07World(chain);
  const w10 = mc10World(chain);
  const w11 = mc11World(chain);
  const w12 = mc12World(chain);
  const t = sim.state().sim_time_s;
  const motion = Math.min(1, Math.abs(w7.ascender.vy) * 0.16 + Math.abs(w10.flywheel.omega) * 0.18 + Math.abs(w11.sail.omega) * 0.24 + Math.abs(w12.pendulum.omega) * 0.30);

  const pos = b.dust.geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const k = i * 4;
    const bx = b.dustSeed[k]!;
    const by = b.dustSeed[k + 1]!;
    const bz = b.dustSeed[k + 2]!;
    const phase = b.dustSeed[k + 3]!;
    const drift = (0.18 + motion * 0.42) * t + phase;
    const zCycle = ((drift * 0.22) % 28 + 28) % 28;
    pos.setXYZ(i, bx + Math.sin(drift * 0.7) * (1.2 + motion * 2.5), by + Math.sin(drift * 0.31) * 1.5, bz - zCycle + 14 + Math.cos(drift * 0.45) * 0.8);
  }
  pos.needsUpdate = true;

  const pendulumX = SKY.pendulumPivotX + SKY.pendulumLengthM * Math.sin(w12.pendulum.angle);
  const pendulumY = SKY.pendulumPivotY - SKY.pendulumLengthM * Math.cos(w12.pendulum.angle);
  placeLine(b.cables[0]!, 247, 129, -38.4, w11.car.x, w11.car.y + 0.35, -38.4);
  placeLine(b.cables[1]!, 270, 132, -42.5, pendulumX, pendulumY, -42.5);
  placeLine(b.cables[2]!, 208, 101, -43.2, PRESSURE_CROWN_X(w10.bridgeTravel), 91, -43.2);
  placeLine(b.cables[3]!, 178, 51, -43.5, w7.ascender.x, w7.ascender.y + 0.35, -43.5);
  for (let i = 0; i < b.haze.length; i++) {
    const mat = b.haze[i]!.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.035 + motion * 0.032 + (i === 2 ? 0.012 : 0);
  }
}

function PRESSURE_CROWN_X(bridgeTravel: number): number {
  return 229 - Math.max(0, bridgeTravel);
}
