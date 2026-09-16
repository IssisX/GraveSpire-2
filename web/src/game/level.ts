import { carrierWorldPos } from "@/sim/geometry.ts";
import * as THREE from "three";
import { Atmosphere } from "./atmosphere.ts";
import type { Collider } from "./collision.ts";
import { createMaterials, makeSignTexture, type Materials } from "./materials.ts";

export type Interactable = {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
  r: number;
  kind: "machine" | "member" | "npc" | "board" | "bench" | "world";
};

export type Bindings = {
  carrier: THREE.Group;
  payload: THREE.Group;
  payloadDeck: THREE.Group;
  frame: THREE.Group;
  gate: THREE.Mesh;
  cable: THREE.Mesh;
  gantry: THREE.Group;
  members: Map<string, THREE.Mesh>;
  npcs: Map<string, THREE.Group>;
  brakeGlow: THREE.Mesh;
  shopLights: THREE.Mesh[];
  bayLights: THREE.PointLight[];
  steam: THREE.Points;
  hookLight: THREE.PointLight;
  sun: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
  wellLamp: THREE.PointLight;
  hemi: THREE.HemisphereLight;
  amb: THREE.AmbientLight;
  pendant: THREE.Group;
  pendantLamps: { power: THREE.Mesh; brake: THREE.Mesh; offset: THREE.Mesh };
  telltales: THREE.Mesh[];
  strainLamp: THREE.PointLight;
  strainMesh: THREE.Mesh;
  pulpitGlass: THREE.Mesh;
  trolley: THREE.Mesh;
  dockLamps: { ok: THREE.Mesh; close: THREE.Mesh; far: THREE.Mesh };
  dockChevrons: THREE.Mesh;
  gatePanel: THREE.Group;
  gateLamps: { power: THREE.Mesh; pressure: THREE.Mesh; open: THREE.Mesh };
  gateNeedle: THREE.Mesh;
  breakerHandles: Map<string, THREE.Mesh>;
  breakerLamps: Map<string, THREE.Mesh>;
  busRuns: THREE.Mesh[];
  emergency: THREE.Mesh[];
  jackStand: THREE.Mesh;
  gallerySlabs: Map<string, THREE.Mesh>;
  galleryChain: THREE.Mesh;
  slingRope: THREE.Mesh;
  slingPreview: THREE.Line;
  driveHousing: THREE.Mesh;
  driveWreck: THREE.Mesh;
  wedgePin: THREE.Mesh;
  neckPlates: THREE.Mesh[];
};

export type Level = {
  colliders: Collider[];
  interactables: Interactable[];
  bindings: Bindings;
  materials: Materials;
  geos: THREE.BufferGeometry[];
  atmosphere: Atmosphere;
  dispose: () => void;
};

class Kit {
  colliders: Collider[] = [];
  interactables: Interactable[] = [];
  geos: THREE.BufferGeometry[] = [];
  lamps: THREE.PointLight[] = [];
  constructor(
    public scene: THREE.Scene,
    public mats: Materials,
  ) {}

  geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.push(g);
    return g;
  }

  box(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
    opts?: { id?: string; collider?: boolean; cast?: boolean; receive?: boolean; ry?: number },
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geo(new THREE.BoxGeometry(w, h, d)), mat);
    mesh.position.set(x, y, z);
    if (opts?.ry) mesh.rotation.y = opts.ry;
    mesh.castShadow = opts?.cast ?? true;
    mesh.receiveShadow = opts?.receive ?? true;
    this.scene.add(mesh);
    if (opts?.collider !== false) {
      const hw = w / 2;
      const hh = h / 2;
      const hd = d / 2;
      this.colliders.push({
        id: opts?.id ?? "static",
        minx: x - hw,
        maxx: x + hw,
        miny: y - hh,
        maxy: y + hh,
        minz: z - hd,
        maxz: z + hd,
      });
    }
    return mesh;
  }

  cyl(
    rTop: number,
    rBot: number,
    h: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
    rx = 0,
    rz = 0,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(rTop, rBot, h, 10)), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    mesh.rotation.z = rz;
    mesh.castShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  ibeam(len: number, x: number, y: number, z: number, axis: "x" | "z", mat: THREE.Material) {
    const g = new THREE.Group();
    const fl = new THREE.Mesh(this.geo(new THREE.BoxGeometry(axis === "x" ? len : 0.42, 0.06, axis === "x" ? 0.42 : len)), mat);
    const fu = fl.clone();
    const web = new THREE.Mesh(
      this.geo(new THREE.BoxGeometry(axis === "x" ? len : 0.08, 0.48, axis === "x" ? 0.08 : len)),
      mat,
    );
    fl.position.y = -0.27;
    fu.position.y = 0.27;
    g.add(fl, fu, web);
    g.position.set(x, y, z);
    this.scene.add(g);
    return g;
  }

  railing(x0: number, z0: number, x1: number, z1: number, y: number) {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const yaw = Math.atan2(dx, dz);
    this.box(0.06, 1.05, len, cx, y + 0.52, cz, this.mats.steel, { collider: false, ry: yaw });
    this.box(0.05, 0.05, len, cx, y + 0.52, cz, this.mats.steelDark, { collider: false, ry: yaw });
    const t = 0.08;
    this.colliders.push({
      id: "rail",
      minx: Math.min(x0, x1) - t,
      maxx: Math.max(x0, x1) + t,
      miny: y,
      maxy: y + 1.08,
      minz: Math.min(z0, z1) - t,
      maxz: Math.max(z0, z1) + t,
    });
  }

  sign(title: string, sub: string, w: number, h: number, x: number, y: number, z: number, ry: number) {
    const tex = makeSignTexture(title, sub);
    const mat = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.1, roughness: 0.6 });
    const mesh = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(w, h)), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    this.scene.add(mesh);
    return mesh;
  }

  lightFixture(x: number, y: number, z: number, sodium = true): THREE.PointLight {
    this.box(0.9, 0.12, 0.35, x, y, z, this.mats.steelBlack, { collider: false, cast: false });
    this.box(0.7, 0.06, 0.22, x, y - 0.08, z, sodium ? this.mats.emissiveSodium : this.mats.emissiveCool, {
      collider: false,
      cast: false,
    });
    const l = new THREE.PointLight(sodium ? 0xffc07a : 0xdde6ee, sodium ? 14 : 8.5, 36, 1.1);
    l.position.set(x, y - 0.3, z);
    l.castShadow = false;
    this.scene.add(l);
    this.lamps.push(l);
    return l;
  }

  interact(id: string, label: string, x: number, y: number, z: number, r: number, kind: Interactable["kind"]) {
    this.interactables.push({ id, label, x, y, z, r, kind });
  }
}

function worker(scene: THREE.Scene, mats: Materials, helm: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.7, 4, 8), mats.npcVest);
  body.position.y = 0.9;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), mats.npcSkin);
  head.position.y = 1.48;
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.12, 8), new THREE.MeshStandardMaterial({ color: helm, roughness: 0.5 }));
  hat.position.y = 1.62;
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.03, 8), new THREE.MeshStandardMaterial({ color: helm, roughness: 0.5 }));
  brim.position.y = 1.56;
  g.add(body, head, hat, brim);
  scene.add(g);
  return g;
}

export function buildLevel(scene: THREE.Scene): Level {
  const mats = createMaterials();
  const k = new Kit(scene, mats);
  const bayLights: THREE.PointLight[] = [];
  const shopLights: THREE.Mesh[] = [];

  // The older fog began beyond almost all Bay 07 sight-lines, leaving the
  // structure to read as isolated meshes against a flat backdrop. Keep a
  // long enough far plane to preserve the visible MC-01→12 descent, but let
  // the industrial air establish depth in the rooms and shaft.
  scene.background = new THREE.Color(0x171d23);
  scene.fog = new THREE.Fog(0x1a2128, 18, 260);

  const hemi = new THREE.HemisphereLight(0xc5d0d8, 0x2e261c, 1.05);
  scene.add(hemi);
  const amb = new THREE.AmbientLight(0x9aa4ac, 0.58);
  scene.add(amb);
  const sun = new THREE.DirectionalLight(0xffe6c8, 2.7);
  sun.position.set(-18, 34, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 4;
  sun.shadow.camera.far = 90;
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 50;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xb8c4ce, 0.85);
  fill.position.set(22, 18, -16);
  scene.add(fill);
  const wellLamp = new THREE.PointLight(0xffc07a, 32, 34, 1.0);
  wellLamp.position.set(21, 4.2, 0);
  scene.add(wellLamp);

  // --- floors (bay perimeter, well in center) ---
  k.box(42, 0.5, 8, 21, -0.25, -7.5, mats.concrete, { id: "floor_sw" });
  k.box(42, 0.5, 8, 21, -0.25, 7.5, mats.concrete, { id: "floor_n" });
  k.box(12, 0.5, 22, 4, -0.25, 0, mats.concrete, { id: "floor_w" });
  k.box(10, 0.5, 22, 37, -0.25, 0, mats.concrete, { id: "floor_e" });
  k.box(8, 0.18, 22, 21, -0.02, -10.4, mats.hazard, { collider: false });
  k.box(8, 0.18, 22, 21, -0.02, 10.4, mats.hazard, { collider: false });

  // pit walls
  k.box(22, 10, 0.4, 21, -5, -3.5, mats.steelDark, { collider: false });
  k.box(22, 10, 0.4, 21, -5, 3.5, mats.steelDark, { collider: false });
  k.box(0.4, 10, 7, 10, -5, 0, mats.steelDark, { collider: false });
  k.box(0.4, 10, 7, 32, -5, 0, mats.steelDark, { collider: false });
  k.box(24, 0.4, 8, 21, -10, 0, mats.black, { collider: false });

  // columns
  for (const x of [2, 10, 18, 26, 34, 40]) {
    for (const z of [-10.2, 10.2]) {
      k.box(0.7, 14, 0.7, x, 7, z, mats.steelDark, { id: `col_${x}_${z}` });
    }
  }
  // overhead trusses
  for (const y of [13.2]) {
    for (let x = 4; x <= 38; x += 6) {
      k.ibeam(20.4, x, y, 0, "z", mats.steel);
    }
    k.ibeam(40, 21, y + 0.4, -10.2, "x", mats.steel);
    k.ibeam(40, 21, y + 0.4, 10.2, "x", mats.steel);
  }

  // catwalks
  k.box(38, 0.16, 1.6, 20, 5.68, 9.15, mats.grating, { id: "cat_n" });
  k.box(38, 0.16, 1.6, 20, 5.68, -9.15, mats.grating, { id: "cat_s" });
  k.box(1.6, 0.16, 18, 8.2, 5.68, 0, mats.grating, { id: "cat_cross_w" });
  k.box(1.6, 0.16, 18, 34.2, 5.68, 0, mats.grating, { id: "cat_cross_e" });
  k.railing(1.2, 9.9, 39, 9.9, 5.76);
  k.railing(1.2, 8.4, 7.2, 8.4, 5.76);
  k.railing(9.2, 8.4, 33.2, 8.4, 5.76);
  k.railing(35.2, 8.4, 39, 8.4, 5.76);
  k.railing(1.2, -9.9, 39, -9.9, 5.76);
  // well lips — fall is real, so the edge is a rail, not an invisible wall
  k.railing(11.2, 3.42, 31.4, 3.42, 0);
  k.railing(11.2, -3.42, 31.4, -3.42, 0);
  k.railing(9.72, -3.2, 9.72, 3.2, 0);

  // stairs catwalk to floor (west)
  for (let i = 0; i < 12; i++) {
    k.box(1.4, 0.12, 0.55, 3.2, 5.6 - i * 0.45, 8.6 - i * 0.42, mats.diamond, { id: `stair_w_${i}` });
  }
  // stairs catwalk to gallery
  for (let i = 0; i < 8; i++) {
    k.box(1.5, 0.12, 0.5, 14, 5.6 - i * 0.4, 10.1 + i * 0.28, mats.diamond, { id: `stair_gal_${i}` });
  }

  // pulpit — local hoist station. The hanging load is not a remote control.
  k.box(4.2, 1.2, 3.2, 4.8, 0.6, -7.6, mats.steel, { id: "pulpit" });
  k.box(4.2, 0.08, 3.2, 4.8, 1.24, -7.6, mats.diamond, { id: "pulpit_top" });
  k.box(1.6, 1.1, 0.12, 4.8, 1.85, -6.1, mats.black, { collider: false });
  const pulpitGlass = k.box(1.4, 0.7, 0.04, 4.8, 1.85, -6.04, mats.emissiveCool, { collider: false });

  const pendant = new THREE.Group();
  const pBody = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.48, 0.12), mats.steelBlack);
  const pCable = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.1, 6), mats.cable);
  pCable.position.set(0, 0.78, 0);
  const mkLamp = (emissive: number) => {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.028, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x14181c, emissive, emissiveIntensity: 0.08, roughness: 0.4 }),
    );
    return m;
  };
  const lampPower = mkLamp(0x7ec8d4);
  const lampBrake = mkLamp(0xc47a4a);
  const lampOffset = mkLamp(0xc8b44a);
  lampPower.position.set(-0.06, 0.12, 0.07);
  lampBrake.position.set(0, 0.12, 0.07);
  lampOffset.position.set(0.06, 0.12, 0.07);
  pendant.add(pBody, pCable, lampPower, lampBrake, lampOffset);
  pendant.position.set(4.52, 1.72, -6.42);
  scene.add(pendant);
  k.interact("pendant", "Carrier pendant", 4.52, 1.72, -6.42, 2.0, "machine");
  k.interact("carrier", "Carrier 07-A", 20, 6, 0, 2.8, "machine");

  // gantry
  const gantry = new THREE.Group();
  const gBeam = new THREE.Mesh(new THREE.BoxGeometry(28, 0.7, 1.1), mats.steel);
  gBeam.castShadow = true;
  gantry.add(gBeam);
  const gTruckL = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 3.6), mats.steelDark);
  gTruckL.position.set(-13.2, -0.1, 0);
  const gTruckR = gTruckL.clone();
  gTruckR.position.x = 13.2;
  gantry.add(gTruckL, gTruckR);
  gantry.position.set(22, 11.1, 0);
  scene.add(gantry);
  const trolley = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.42, 2.2), mats.steelDark);
  trolley.position.set(-2, -0.55, 0);
  gantry.add(trolley);
  k.ibeam(38, 21, 11.18, 1.7, "x", mats.steel);
  k.ibeam(38, 21, 11.18, -1.7, "x", mats.steel);

  // hoist height scale — world-readable, not a HUD number
  for (let m = 1; m <= 10; m++) {
    const mark = m % 5 === 0;
    k.box(0.08, mark ? 0.06 : 0.035, mark ? 0.42 : 0.22, 32.35, m, -3.38, mark ? mats.hazard : mats.steel, {
      collider: false,
      cast: false,
    });
  }

  // carrier
  const carrier = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.7, 3.1), mats.carrier);
  body.castShadow = true;
  const hoist = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 1.2), mats.steelDark);
  hoist.position.y = 0.55;
  const sheave = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.22, 10), mats.steel);
  sheave.rotation.z = Math.PI / 2;
  sheave.position.y = 0.85;
  const railL = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.12, 0.12), mats.steel);
  railL.position.set(0, 0.45, 1.45);
  const railR = railL.clone();
  railR.position.z = -1.45;
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 3.1), mats.hazard);
  bumper.position.set(-2.15, 0, 0);
  carrier.add(body, hoist, sheave, railL, railR, bumper);
  scene.add(carrier);
  k.colliders.push({
    id: "carrier",
    minx: 0,
    maxx: 0,
    miny: 0,
    maxy: 0,
    minz: 0,
    maxz: 0,
    platform: "carrier",
  });

  const payload = new THREE.Group();
  const crate = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.7, 1.9), mats.carrier);
  crate.castShadow = true;
  const band = new THREE.Mesh(new THREE.BoxGeometry(2.48, 0.22, 1.98), mats.hazard);
  band.position.y = 0.15;
  const band2 = band.clone();
  band2.position.y = -0.45;
  const corner = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.08, 2.0), mats.emissiveWarn);
  corner.position.y = 0.82;
  payload.add(crate, band, band2, corner);
  scene.add(payload);

  const payloadDeck = new THREE.Group();
  payloadDeck.add(crate.clone(), band.clone(), band2.clone());
  payloadDeck.visible = false;
  scene.add(payloadDeck);

  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1, 8), mats.cable);
  scene.add(cable);

  const brakeGlow = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.3), mats.emissiveWarn);
  carrier.add(brakeGlow);
  brakeGlow.position.set(1.8, -0.2, 0);

  const hookLight = new THREE.PointLight(0xffd0a0, 22, 18, 1.05);
  scene.add(hookLight);

  // pipes along south wall
  for (let i = 0; i < 3; i++) {
    k.cyl(0.12 + i * 0.03, 0.12 + i * 0.03, 36, 20, 3.2 + i * 0.4, -10.5, mats.rust, 0, Math.PI / 2);
  }
  k.cyl(0.8, 0.8, 3.4, 38.4, 1.8, -4.6, mats.steelDark);
  k.cyl(0.7, 0.7, 2.8, 38.4, 1.5, -6.4, mats.steel);
  k.interact("gate", "Isolation gate G-07", 39.15, 1.7, -3.55, 2.4, "machine");

  // process board — isolation is a real breaker, not a UI toggle
  k.box(0.22, 2.7, 3.9, 38.85, 1.85, -8.15, mats.steelBlack, { id: "proc_board" });
  k.box(0.08, 2.4, 3.6, 38.72, 1.85, -8.15, mats.emissiveCool, { collider: false });
  k.interact("brk_gen", "Process generator breaker", 38.2, 1.8, -9.4, 1.5, "board");
  k.interact("brk_drive", "Drive cabinet breaker", 38.2, 1.8, -8.5, 1.5, "board");
  k.interact("brk_gate", "Gate motor feed", 38.2, 1.8, -7.6, 1.5, "board");
  k.interact("brk_hab", "Hab feed via drive", 38.2, 1.8, -6.7, 1.5, "board");

  // gate
  const gate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 6.4, 7.2), mats.gate);
  gate.castShadow = true;
  gate.position.set(40.4, 3.2, 0);
  scene.add(gate);
  k.colliders.push({
    id: "gate",
    minx: 39.9,
    maxx: 41.1,
    miny: 0,
    maxy: 6.6,
    minz: -3.6,
    maxz: 3.6,
    platform: "gate",
  });

  // frame in neck
  const frame = new THREE.Group();
  const fBeam = new THREE.Mesh(new THREE.BoxGeometry(14, 0.7, 0.9), mats.steel);
  fBeam.castShadow = true;
  frame.add(fBeam);
  const fWeb = new THREE.Mesh(new THREE.BoxGeometry(14, 0.12, 2.2), mats.steelDark);
  fWeb.position.y = -0.4;
  frame.add(fWeb);
  frame.position.set(52, 4.6, 0);
  scene.add(frame);
  const telltales: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.03, 1.35, 6), mats.hazard);
    rod.position.set(-4 + i * 4, -0.95, 0.55);
    frame.add(rod);
    telltales.push(rod);
  }
  const strainMesh = k.box(0.22, 0.22, 0.22, 48.6, 3.4, 0.9, mats.emissiveWarn, { collider: false, cast: false });
  const strainLamp = new THREE.PointLight(0xc47a4a, 0.4, 10, 1.4);
  strainLamp.position.set(48.6, 3.4, 0.9);
  scene.add(strainLamp);

  // neck architecture
  k.box(22, 0.5, 20, 53, -0.25, 0, mats.concrete, { id: "neck_floor" });
  for (const x of [46, 54, 62]) {
    for (const z of [-8.5, 8.5]) k.box(0.65, 10, 0.65, x, 5, z, mats.steelDark, { id: `ncol_${x}` });
  }
  k.ibeam(18, 53, 9.4, 0, "x", mats.steel);
  const driveHousing = k.box(3.4, 2.2, 2.6, 56.2, 1.2, 2.4, mats.carrier, { id: "drive_box", collider: true });
  k.box(3.4, 0.08, 2.6, 56.2, 2.34, 2.4, mats.hazard, { collider: false });
  const driveWreck = k.box(3.4, 1.1, 2.6, 56.2, 0.7, 2.4, mats.rust, { collider: false });
  driveWreck.visible = false;
  k.interact("drive", "Transfer drive housing", 56.2, 1.6, 2.4, 2.4, "machine");
  k.interact("frame", "Load-transfer frame", 52, 3.2, 0, 3.5, "machine");
  k.interact("dock", "Neck receiving deck", 36.5, 2.3, 0, 3.2, "world");
  k.interact("neck_brace", "Neck transfer brace", 53, 1.4, 0.2, 2.8, "member");
  const members = new Map<string, THREE.Mesh>();
  const neckBrace = k.box(10.4, 0.32, 0.32, 53, 1.35, 0.15, mats.steel, { id: "neck_brace", collider: false, ry: 0.38 });
  members.set("neck_brace", neckBrace);

  k.sign("FS-07", "FREIGHT SPINE  ·  BAY 07", 8.5, 2.6, 0.4, 8.4, 0, Math.PI / 2);
  k.sign("G-07", "ISOLATION  ·  PRESSURE", 4.2, 1.4, 40.9, 7.4, -5.2, -Math.PI / 2);
  k.sign("FS-08", "TRANSFER NECK", 5.2, 1.6, 42.3, 6.8, 8.2, Math.PI / 2);
  const bayDecal = k.sign("07", "FREIGHT WELL", 7.2, 3.6, 21, 0.05, 7.15, 0);
  bayDecal.rotation.x = -Math.PI / 2;
  bayDecal.position.set(21, 0.04, 7.15);

  // pit internals — the well is a volume, not a black rectangle
  for (const x of [14, 21, 28]) {
    k.cyl(0.16, 0.16, 9.5, x, -4.6, -3.1, mats.steelDark);
    k.cyl(0.16, 0.16, 9.5, x, -4.6, 3.1, mats.steelDark);
  }
  k.box(18, 0.2, 4.2, 21, -9.4, 0, mats.steelDark, { collider: false });

  // receiving deck over well east — this is the dock, not a HUD number
  k.box(10, 0.22, 6.4, 36, 2.28, 0, mats.steel, { id: "recv" });
  k.box(10, 0.05, 0.4, 36, 2.42, 3.1, mats.hazard, { collider: false });
  k.box(10, 0.05, 0.4, 36, 2.42, -3.1, mats.hazard, { collider: false });
  const dockChevrons = k.box(3.6, 0.04, 2.2, 36, 2.42, 0, mats.hazard, { collider: false, cast: false });
  const mkDockLamp = (emissive: number, x: number) => {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x14181c, emissive, emissiveIntensity: 0.08, roughness: 0.35 }),
    );
    m.position.set(x, 2.62, 2.85);
    scene.add(m);
    return m;
  };
  const dockLamps = {
    far: mkDockLamp(0xc47a4a, 34.6),
    close: mkDockLamp(0xc8b44a, 36.0),
    ok: mkDockLamp(0x6ec8a0, 37.4),
  };

  // traverse marks on the gantry rail — world-readable meters
  for (let m = -8; m <= 16; m += 2) {
    const mark = m % 8 === 0;
    k.box(mark ? 0.08 : 0.04, 0.04, mark ? 0.55 : 0.28, 20 + m, 11.55, -2.15, mark ? mats.hazard : mats.steel, {
      collider: false,
      cast: false,
    });
  }

  // lights bay
  for (const x of [8, 18, 28, 36]) {
    bayLights.push(k.lightFixture(x, 12.4, 0, true));
    k.lightFixture(x, 8.8, 9.1, false);
    k.lightFixture(x, 8.8, -9.1, false);
  }

  // --- Gallery 12 ---
  k.box(8, 0.28, 16, 12, 2.31, 19.5, mats.concrete, { id: "gal_west" });
  k.box(8, 0.28, 16, 54, 2.31, 19.5, mats.concrete, { id: "gal_east" });
  k.box(50, 0.5, 16, 33, -0.2, 19.5, mats.steelDark, { collider: false });
  const gallerySlabs = new Map<string, THREE.Mesh>();
  for (const x of [16, 24, 32, 40, 48]) {
    k.box(0.55, 2.3, 0.55, x, 1.1, 12.6, mats.steel, { id: `gcol_s_${x}` });
    k.box(0.55, 2.3, 0.55, x, 1.1, 26.4, mats.steel, { id: `gcol_n_${x}` });
  }
  for (const [id, x] of [
    ["g12_a", 16],
    ["g12_b", 24],
    ["g12_c", 32],
    ["g12_d", 40],
    ["g12_e", 48],
  ] as const) {
    const m = k.box(0.38, 0.42, 14.2, x, 2.15, 19.5, mats.steel, { id, collider: false });
    members.set(id, m);
    k.interact(id, `Gallery span ${id.slice(-1).toUpperCase()}`, x, 2.5, 19.5, 2.1, "member");
    const slab = k.box(8, 0.28, 16, x, 2.31, 19.5, mats.concrete, { id: `slab_${id}` });
    gallerySlabs.set(id, slab);
  }
  k.railing(9, 27.2, 57, 27.2, 2.45);
  k.railing(9, 11.8, 13, 11.8, 2.45);
  k.sign("LT-12", "LOAD-TRANSFER GALLERY", 6.4, 1.6, 33, 5.4, 27.6, Math.PI);
  k.lightFixture(24, 7.2, 19.5, false);
  k.lightFixture(42, 7.2, 19.5, false);

  // stairs gallery to neck
  for (let i = 0; i < 6; i++) {
    k.box(1.5, 0.12, 0.5, 54, 2.3 - i * 0.35, 11.6 - i * 0.35, mats.diamond, { id: `stair_gn_${i}` });
  }

  // --- Circ Shop ---
  k.box(24, 0.5, 24, 75, -0.25, -2, mats.concrete, { id: "shop_floor" });
  k.box(0.4, 6, 24, 86.8, 3, -2, mats.hab, { id: "shop_wall_e" });
  k.box(24, 6, 0.4, 75, 3, -13.8, mats.hab, { id: "shop_wall_s" });
  k.box(24, 6, 0.4, 75, 3, 9.8, mats.hab, { id: "shop_wall_n" });
  k.box(24, 0.3, 24, 75, 6.2, -2, mats.steelDark, { id: "shop_ceil" });
  // benches
  k.box(4.4, 0.9, 1.2, 70, 0.45, -8.4, mats.steel, { id: "bench1" });
  k.box(3.2, 0.9, 1.2, 78, 0.45, -8.4, mats.steel, { id: "save_bench" });
  k.box(0.4, 0.15, 0.4, 77.2, 1.05, -8.1, mats.emissiveCool, { collider: false });
  k.interact("save_bench", "Circ Shop bench", 78, 1.1, -8.4, 2.0, "bench");
  // board
  k.box(0.2, 2.4, 3.6, 86.5, 2.0, 2.4, mats.steelBlack, { id: "board_panel", collider: false });
  k.box(0.08, 2.1, 3.3, 86.38, 2.0, 2.4, mats.emissiveCool, { collider: false });
  k.interact("board", "Distribution board", 85.2, 1.6, 2.4, 2.2, "board");
  k.interact("brk_shop", "Shop breaker", 85.2, 1.6, 2.4, 2.2, "board");
  k.interact("brk_west", "West bus (reroute)", 85.2, 1.6, 1.2, 1.8, "board");
  k.sign("SH-A", "CIRC SHOP  ·  HAB BAND A", 5.6, 1.5, 75, 5.2, 9.5, Math.PI);
  for (const x of [68, 75, 82]) {
    const fixture = k.box(1.4, 0.1, 0.3, x, 5.9, -2, mats.emissiveCool, { collider: false, cast: false });
    shopLights.push(fixture);
    k.lightFixture(x, 5.9, -2, false);
  }
  // crates
  k.box(1.4, 1.2, 1.1, 68, 0.6, 5.4, mats.paintGreen, { id: "crate1" });
  k.box(1.1, 0.8, 1.1, 69.4, 0.4, 6.2, mats.rust, { id: "crate2" });
  k.box(1.6, 1.4, 1.2, 12, 0.7, -8.2, mats.paintGreen, { id: "baycrate" });
  k.box(1.2, 1.0, 1.0, 13.4, 0.5, -9, mats.steelDark, { id: "baycrate2" });

  // shop door opening in west wall - we don't put a wall at x=64 except a partial
  k.box(0.4, 6, 8, 64.2, 3, -8, mats.hab, { id: "shop_wall_w_s" });
  k.box(0.4, 6, 6, 64.2, 3, 7, mats.hab, { id: "shop_wall_w_n" });
  // door collider (locked until walk)
  k.colliders.push({
    id: "shop_door",
    minx: 63.8,
    maxx: 64.6,
    miny: 0,
    maxy: 3.2,
    minz: -3.2,
    maxz: 3.2,
  });
  k.colliders.push({
    id: "gal_shop_door",
    minx: 63.8,
    maxx: 64.6,
    miny: 0,
    maxy: 3.2,
    minz: 16,
    maxz: 22,
  });

  // cable trays
  for (let x = 6; x < 38; x += 4) {
    k.box(3.6, 0.08, 0.5, x, 10.4, 10.4, mats.steelDark, { collider: false });
  }

  // NPCs
  const npcs = new Map<string, THREE.Group>();
  npcs.set("rami", worker(scene, mats, 0xc8b44a));
  npcs.set("ilea", worker(scene, mats, 0xdde4ea));
  npcs.set("chen", worker(scene, mats, 0x4a8aca));
  npcs.set("skip", worker(scene, mats, 0xb05a2a));
  k.interact("rami", "Rami Okonkwo", 4.6, 1.4, -7.4, 2.0, "npc");
  k.interact("ilea", "Ilea Voss", 74.2, 1.2, -1.8, 2.0, "npc");
  k.interact("chen", "Chen Park", 51.4, 1.2, -5.2, 2.0, "npc");
  k.interact("skip", "Skip Delgado", 33, 3.4, 19.4, 2.0, "npc");

  // steam particles
  const steamGeo = new THREE.BufferGeometry();
  const steamN = 80;
  const steamPos = new Float32Array(steamN * 3);
  for (let i = 0; i < steamN; i++) {
    steamPos[i * 3] = 40.2 + Math.random() * 0.4;
    steamPos[i * 3 + 1] = 1 + Math.random() * 3;
    steamPos[i * 3 + 2] = -2 + Math.random() * 4;
  }
  steamGeo.setAttribute("position", new THREE.BufferAttribute(steamPos, 3));
  const steam = new THREE.Points(
    steamGeo,
    new THREE.PointsMaterial({ color: 0xb0c0c8, size: 0.12, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  steam.visible = false;
  scene.add(steam);

  k.interact("cable", "Hoist rope 07-A", 20, 6, 0, 2.5, "machine");

  // local gate station — torque is here, not from the west deck
  const gatePanel = new THREE.Group();
  const gpBody = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.62, 0.42), mats.steelBlack);
  const gpFace = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.48, 0.34), mats.emissiveCool);
  gpFace.position.x = 0.1;
  const mkGLamp = (emissive: number, y: number, z: number) => {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.028, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x14181c, emissive, emissiveIntensity: 0.08, roughness: 0.4 }),
    );
    m.position.set(0.12, y, z);
    return m;
  };
  const gateLampPower = mkGLamp(0x7ec8d4, 0.18, 0.1);
  const gateLampPressure = mkGLamp(0xc47a4a, 0.18, 0);
  const gateLampOpen = mkGLamp(0x6ec8a0, 0.18, -0.1);
  const gateNeedle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.02), mats.hazard);
  gateNeedle.position.set(0.13, -0.04, 0);
  gatePanel.add(gpBody, gpFace, gateLampPower, gateLampPressure, gateLampOpen, gateNeedle);
  gatePanel.position.set(39.15, 1.55, -3.55);
  scene.add(gatePanel);

  const wedgePin = k.box(0.12, 0.7, 0.12, 40.15, 1.1, -3.15, mats.hazard, { collider: false, id: "wedge" });

  // breaker handles on the process board
  const breakerHandles = new Map<string, THREE.Mesh>();
  const breakerLamps = new Map<string, THREE.Mesh>();
  const procBreakers: [string, number][] = [
    ["brk_gen", -9.4],
    ["brk_drive", -8.5],
    ["brk_gate", -7.6],
    ["brk_hab", -6.7],
  ];
  for (const [id, z] of procBreakers) {
    const handle = k.box(0.08, 0.28, 0.06, 38.62, 2.05, z, mats.hazard, { collider: false, cast: false });
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x14181c, emissive: 0x6ec8a0, emissiveIntensity: 0.1, roughness: 0.4 }),
    );
    lamp.position.set(38.68, 2.35, z);
    scene.add(lamp);
    breakerHandles.set(id, handle);
    breakerLamps.set(id, lamp);
  }
  const shopHandle = k.box(0.08, 0.28, 0.06, 86.32, 2.15, 2.55, mats.hazard, { collider: false, cast: false });
  const westHandle = k.box(0.08, 0.28, 0.06, 86.32, 2.15, 1.35, mats.paintGreen, { collider: false, cast: false });
  const shopLamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x14181c, emissive: 0x6ec8a0, emissiveIntensity: 0.08, roughness: 0.4 }),
  );
  shopLamp.position.set(86.28, 2.45, 2.55);
  scene.add(shopLamp);
  const westLamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x14181c, emissive: 0x6ec8a0, emissiveIntensity: 0.08, roughness: 0.4 }),
  );
  westLamp.position.set(86.28, 2.45, 1.35);
  scene.add(westLamp);
  breakerHandles.set("brk_shop", shopHandle);
  breakerHandles.set("brk_west", westHandle);
  breakerLamps.set("brk_shop", shopLamp);
  breakerLamps.set("brk_west", westLamp);

  const busRuns: THREE.Mesh[] = [];
  for (let x = 8; x < 40; x += 4) {
    const run = k.box(3.4, 0.05, 0.12, x, 10.52, 10.4, mats.emissiveCool, { collider: false, cast: false });
    busRuns.push(run);
  }
  const neckBus = k.box(18, 0.05, 0.12, 50, 8.6, -8.4, mats.emissiveCool, { collider: false, cast: false });
  busRuns.push(neckBus);

  const emergency: THREE.Mesh[] = [];
  for (const [x, z] of [
    [12, 3.55],
    [21, 3.55],
    [30, 3.55],
    [12, -3.55],
    [21, -3.55],
    [30, -3.55],
  ] as const) {
    const strip = k.box(2.4, 0.04, 0.08, x, 0.16, z, mats.emissiveWarn, { collider: false, cast: false });
    emergency.push(strip);
  }

  const jackStand = k.cyl(0.16, 0.22, 1.05, 53, 0.55, 0.15, mats.hazard);
  jackStand.visible = false;

  const galleryChain = k.box(0.08, 1.15, 14, 32, 3.05, 19.5, mats.hazard, { collider: false, cast: false });
  galleryChain.visible = false;

  const slingRope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 6), mats.cable);
  slingRope.visible = false;
  scene.add(slingRope);
  const slingGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 1, 0),
  ]);
  const slingPreview = new THREE.Line(
    slingGeo,
    new THREE.LineDashedMaterial({ color: 0xc8b44a, dashSize: 0.25, gapSize: 0.12, transparent: true, opacity: 0.85 }),
  );
  slingPreview.visible = false;
  scene.add(slingPreview);

  const neckPlates: THREE.Mesh[] = [
    k.box(4.2, 0.12, 3.6, 48.4, 0.08, 0, mats.diamond, { collider: false }),
    k.box(4.2, 0.12, 3.6, 53.2, 0.08, 0, mats.diamond, { collider: false }),
  ];

  k.colliders.push({
    id: "neck_gap",
    minx: 49.4,
    maxx: 50.6,
    miny: 0,
    maxy: 2.4,
    minz: -2.6,
    maxz: 2.6,
  });

  const bindings: Bindings = {
    carrier,
    payload,
    payloadDeck,
    frame,
    gate,
    cable,
    gantry,
    members,
    npcs,
    brakeGlow,
    shopLights,
    bayLights,
    steam,
    hookLight,
    sun,
    fill,
    wellLamp,
    hemi,
    amb,
    pendant,
    pendantLamps: { power: lampPower, brake: lampBrake, offset: lampOffset },
    telltales,
    strainLamp,
    strainMesh,
    pulpitGlass,
    trolley,
    dockLamps,
    dockChevrons,
    gatePanel,
    gateLamps: { power: gateLampPower, pressure: gateLampPressure, open: gateLampOpen },
    gateNeedle,
    breakerHandles,
    breakerLamps,
    busRuns,
    emergency,
    jackStand,
    gallerySlabs,
    galleryChain,
    slingRope,
    slingPreview,
    driveHousing,
    driveWreck,
    wedgePin,
    neckPlates,
  };

  // This is presentation only: dust and shafts answer to live fixture
  // output, never to invented game state. The web tower retains the
  // candidate branch's atmospheric gain without changing the shared
  // mechanical authority or adding a traversal surface.
  const atmosphere = new Atmosphere(scene);
  atmosphere.addLamp(wellLamp, {
    restless: 0.18,
    shaft: { radius: 3.8, length: 4.0, color: 0xffc07a, strength: 0.095 },
  });
  for (const fixture of k.lamps) {
    const length = Math.max(2.8, Math.min(10.4, fixture.position.y - 0.3));
    atmosphere.addLamp(fixture, {
      restless: fixture.color.r > fixture.color.b ? 0.40 : 0.24,
      shaft: {
        radius: fixture.color.r > fixture.color.b ? 2.2 : 1.65,
        length,
        color: fixture.color.getHex(),
        strength: fixture.color.r > fixture.color.b ? 0.062 : 0.044,
      },
    });
  }

  return {
    colliders: k.colliders,
    interactables: k.interactables,
    bindings,
    materials: mats,
    geos: k.geos,
    atmosphere,
    dispose: () => {
      atmosphere.dispose();
      k.geos.forEach((g) => g.dispose());
      steamGeo.dispose();
      slingGeo.dispose();
    },
  };
}

export function carrierWorld(lateral: number, height: number, defl: number) {
  return carrierWorldPos(lateral, height, defl);
}
