import * as THREE from "three";

function canvasTex(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  repeatX = 1,
  repeatY = 1,
): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 8;
  t.needsUpdate = true;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export type Materials = ReturnType<typeof createMaterials>;

export function createMaterials() {
  const concreteMap = canvasTex(
    256,
    (g, s) => {
      g.fillStyle = "#5a6268";
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 1400; i++) {
        g.fillStyle = `rgba(${20 + Math.random() * 40},${22 + Math.random() * 36},${24 + Math.random() * 32},${0.15 + Math.random() * 0.25})`;
        g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 3, 1);
      }
      g.strokeStyle = "rgba(0,0,0,0.35)";
      g.strokeRect(0, 0, s, s);
    },
    8,
    8,
  );

  const steelMap = canvasTex(
    256,
    (g, s) => {
      g.fillStyle = "#6a747c";
      g.fillRect(0, 0, s, s);
      for (let y = 0; y < s; y += 4) {
        g.fillStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.08})`;
        g.fillRect(0, y, s, 2);
      }
      for (let i = 0; i < 80; i++) {
        g.strokeStyle = `rgba(200,210,220,${0.04 + Math.random() * 0.06})`;
        g.beginPath();
        g.moveTo(Math.random() * s, Math.random() * s);
        g.lineTo(Math.random() * s, Math.random() * s);
        g.stroke();
      }
    },
    2,
    2,
  );

  const rustMap = canvasTex(
    256,
    (g, s) => {
      g.fillStyle = "#4a2c22";
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 200; i++) {
        g.fillStyle = `rgba(${80 + Math.random() * 70},${40 + Math.random() * 30},${20},${0.2})`;
        g.beginPath();
        g.arc(Math.random() * s, Math.random() * s, 4 + Math.random() * 18, 0, 6.3);
        g.fill();
      }
    },
    2,
    2,
  );

  const hazardMap = canvasTex(
    128,
    (g, s) => {
      g.fillStyle = "#121418";
      g.fillRect(0, 0, s, s);
      g.fillStyle = "#b08620";
      for (let i = -s; i < s * 2; i += 18) {
        g.save();
        g.translate(i, 0);
        g.transform(1, 0, -0.6, 1, 0, 0);
        g.fillRect(0, 0, 9, s);
        g.restore();
      }
    },
    6,
    1,
  );

  const gratingMap = canvasTex(
    128,
    (g, s) => {
      g.fillStyle = "#0c0e10";
      g.fillRect(0, 0, s, s);
      g.fillStyle = "#2a3238";
      const cell = 8;
      for (let i = 0; i < s; i += cell) {
        g.fillRect(i, 0, 2, s);
        g.fillRect(0, i, s, 2);
      }
    },
    12,
    4,
  );

  const diamondMap = canvasTex(
    128,
    (g, s) => {
      g.fillStyle = "#2b3338";
      g.fillRect(0, 0, s, s);
      g.fillStyle = "#3d474e";
      for (let y = 0; y < s; y += 16) {
        for (let x = 0; x < s; x += 16) {
          g.beginPath();
          g.moveTo(x + 8, y + 2);
          g.lineTo(x + 14, y + 8);
          g.lineTo(x + 8, y + 14);
          g.lineTo(x + 2, y + 8);
          g.closePath();
          g.fill();
        }
      }
    },
    4,
    4,
  );

  // Precast wall panel: a field with a recessed joint on all four edges and
  // weather streaking below it. The shared concrete map tiles far too small
  // to carry a 45 m wall -- at that size it reads as noise, which is exactly
  // the flat "surface with no scale" look the envelope is here to fix.
  const panelMap = canvasTex(
    256,
    (g, s2) => {
      g.fillStyle = "#3c4348";
      g.fillRect(0, 0, s2, s2);
      const inset = 5;
      g.fillStyle = "#585f62";
      g.fillRect(inset, inset, s2 - inset * 2, s2 - inset * 2);
      // Cast-in mottle.
      for (let i = 0; i < 900; i++) {
        const v = 70 + Math.random() * 30;
        g.fillStyle = `rgba(${v},${v + 4},${v + 6},${0.06 + Math.random() * 0.12})`;
        g.fillRect(inset + Math.random() * (s2 - inset * 2), inset + Math.random() * (s2 - inset * 2), 2 + Math.random() * 5, 2);
      }
      // Streaks running down from the top joint.
      for (let i = 0; i < 26; i++) {
        const x = inset + Math.random() * (s2 - inset * 2);
        const h = 20 + Math.random() * (s2 * 0.7);
        g.fillStyle = `rgba(28,30,30,${0.05 + Math.random() * 0.1})`;
        g.fillRect(x, inset, 1 + Math.random() * 3, h);
      }
      // Lift off the bottom joint so the panel reads as catching light.
      const grad = g.createLinearGradient(0, s2 * 0.55, 0, s2 - inset);
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(1, "rgba(255,255,255,0.05)");
      g.fillStyle = grad;
      g.fillRect(inset, s2 * 0.55, s2 - inset * 2, s2 * 0.45 - inset);
    },
    10,
    4,
  );

  const paint = (color: number, metal = 0.72, rough = 0.48, map?: THREE.Texture) =>
    new THREE.MeshStandardMaterial({
      color,
      metalness: metal,
      roughness: rough,
      ...(map ? { map } : {}),
    });

  const mats = {
    concrete: paint(0x9aa3a8, 0.08, 0.92, concreteMap),
    steel: paint(0x8a949c, 0.78, 0.42, steelMap),
    steelDark: paint(0x5a646c, 0.7, 0.5, steelMap),
    steelBlack: paint(0x1c2226, 0.65, 0.55),
    rust: paint(0x8a5a40, 0.45, 0.62, rustMap),
    carrier: paint(0xb56a2a, 0.55, 0.48, rustMap),
    gate: paint(0x3a4a52, 0.7, 0.4, steelMap),
    paintGreen: paint(0x3d4a3c, 0.35, 0.55),
    hab: paint(0x4a4c44, 0.25, 0.65),
    hazard: new THREE.MeshStandardMaterial({
      map: hazardMap,
      metalness: 0.2,
      roughness: 0.7,
    }),
    grating: new THREE.MeshStandardMaterial({
      map: gratingMap,
      metalness: 0.7,
      roughness: 0.4,
      transparent: true,
      opacity: 0.95,
    }),
    diamond: paint(0x6a747c, 0.8, 0.4, diamondMap),
    emissiveSodium: new THREE.MeshStandardMaterial({
      color: 0x22180c,
      emissive: 0xffb45a,
      emissiveIntensity: 1.4,
    }),
    emissiveCool: new THREE.MeshStandardMaterial({
      color: 0x0c1014,
      emissive: 0xc8d4dc,
      emissiveIntensity: 0.9,
    }),
    emissiveWarn: new THREE.MeshStandardMaterial({
      color: 0x1a0804,
      emissive: 0xc45a2a,
      emissiveIntensity: 0.8,
    }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x8aa0aa,
      metalness: 0.2,
      roughness: 0.05,
      transparent: true,
      opacity: 0.28,
    }),
    cable: paint(0xb9c1c4, 0.85, 0.3),
    black: paint(0x0a0c0e, 0.4, 0.7),
    // Envelope. Precast wall panel and ribbed roof deck for the halls the
    // structure actually holds up, and raw shotcrete for the outer hull the
    // whole facility is cut into. All three are dielectric and rough: they
    // are meant to sit behind the machinery and take lamp light without
    // competing with it for specular.
    wallPanel: paint(0xb6c0c4, 0.04, 0.95, panelMap),
    roofDeck: paint(0x59636c, 0.35, 0.72, steelMap),
    // Untextured on purpose: concreteMap draws a border on each tile, and
    // at the hull's 100 m x 32 m faces that border tiles into a visible
    // grid. Bare rough colour under fog is what distance should look like.
    shotcrete: paint(0x4c4539, 0.02, 0.98),
    npcVest: paint(0xb08620, 0.15, 0.7),
    npcSkin: paint(0x8a6a52, 0.05, 0.85),
    npcHelm: paint(0xc8b44a, 0.2, 0.55),
    textures: { concreteMap, steelMap, rustMap, hazardMap, gratingMap, diamondMap, panelMap },
  };

  return mats;
}

export function makeSignTexture(title: string, sub = "", w = 512, h = 256): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = "#14181c";
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "#c8ccd4";
  g.lineWidth = 6;
  g.strokeRect(10, 10, w - 20, h - 20);
  g.fillStyle = "#e8e6df";
  g.font = "700 64px Barlow Condensed, sans-serif";
  g.textAlign = "center";
  g.fillText(title, w / 2, h / 2 - (sub ? 12 : -16));
  if (sub) {
    g.fillStyle = "#8b9198";
    g.font = "500 28px IBM Plex Mono, monospace";
    g.fillText(sub, w / 2, h / 2 + 48);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export function disposeMaterials(m: Materials) {
  Object.values(m.textures).forEach((t) => t.dispose());
  for (const v of Object.values(m)) {
    if (v instanceof THREE.Material) v.dispose();
  }
}
