import * as THREE from "three";

/**
 * Atmosphere — the air itself.
 *
 * Every other renderer module draws surfaces. This one draws the volume
 * between them: suspended dust, the visible cone under a lamp, and the
 * unsteadiness of a real ballast. That volume is what separates a room the
 * player is standing in from a set of objects floating in a background
 * colour, and nothing else in the stack was drawing it.
 *
 * It owns no world truth. It never feeds the Simulation and never changes
 * what the player may do. It reads light intensities that other systems have
 * already set for their own reasons and modulates them for presentation, so
 * a lamp that the electrical bus has dimmed still reads as dimmed here, and
 * its shaft dims with it.
 *
 * There is no post-processing anywhere in this project and this module does
 * not add any: the shafts are real geometry with a real depth test, so they
 * are occluded by the structure exactly like everything else.
 */

/** Motes drawn at effectDensity 1. Bounded: the field wraps, it never grows. */
const MOTE_BUDGET = 1100;
/** Edge length, in metres, of the cube of air the mote field fills. */
const MOTE_BOX = 22;
/** Drift speed cap, m/s. Slow enough to read as suspended, not as snow. */
const MOTE_DRIFT = 0.06;

/** Shafts fade out entirely once their lamp falls below this of its base. */
const SHAFT_CUTOFF = 0.12;

export interface ShaftSpec {
  /** Cone radius at the floor end, metres. */
  radius: number;
  /** How far down the cone reaches from the fixture, metres. */
  length: number;
  color: number;
  /** Peak additive strength at full lamp output. */
  strength: number;
}

export interface LampSpec {
  /** Ballast unsteadiness, 0 = rock steady, 1 = visibly swimming. */
  restless?: number;
  shaft?: ShaftSpec;
}

interface Lamp {
  light: THREE.PointLight;
  shaft: THREE.Mesh | null;
  shaftMat: THREE.ShaderMaterial | null;
  shaftStrength: number;
  /** The unmodulated intensity this lamp is currently asked for. Only ever
   *  written here or through setLampBase(); nothing else touches
   *  light.intensity, so there is no race over who owns the field. */
  base: number;
  /** The highest base this fixture has ever been given -- what it puts out
   *  with a healthy bus. The shaft is scaled against it, so a lamp the
   *  electrical state has dimmed shows a correspondingly thinner cone. It
   *  cannot be the registration value: fixtures are built at their catalogue
   *  intensity and driven at a different one from the first frame onwards. */
  designBase: number;
  seed: number;
  restless: number;
}

function softDotTexture(size = 64): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * Brightness of a light shaft at a fragment stands in for how much air the
 * view ray crossed inside the cone. That path length is longest where the
 * surface faces the camera and falls to nothing at the silhouette, which is
 * exactly |dot(normal, view)| — so the cone reads as a volume rather than as
 * a cone-shaped object. Tone mapping and output colour space are applied
 * explicitly because a raw ShaderMaterial does not get them for free.
 */
/**
 * Motes are drawn with size attenuation so the field has depth, but an
 * unclamped attenuated point a third of a metre from the eye is a 75-pixel
 * additive blob sitting over the crosshair -- the field reads as dirt on the
 * lens, not as dust in the air. The size is capped and the alpha is faded out
 * over the first metre and a half, so motes that wander into the reader's
 * face simply are not drawn, and faded again at the far edge of the field so
 * the wrap boundary never shows as a shell.
 */
const MOTE_VERT = /* glsl */ `
  uniform float uSize;
  uniform float uScale;
  uniform float uFar;
  varying float vFade;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = max(-mv.z, 0.0001);
    gl_PointSize = min(uSize * (uScale / d), 9.0);
    vFade = smoothstep(0.4, 1.9, d) * (1.0 - smoothstep(uFar * 0.72, uFar, d));
    gl_Position = projectionMatrix * mv;
  }
`;

const MOTE_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vFade;
  void main() {
    float a = texture2D(uMap, gl_PointCoord).a * vFade * uOpacity;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const SHAFT_VERT = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vViewW;
  varying float vDrop;
  varying float vDist;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewW = normalize(cameraPosition - wp.xyz);
    vDrop = uv.y;
    vec4 mv = viewMatrix * wp;
    vDist = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const SHAFT_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec3 vNormalW;
  varying vec3 vViewW;
  varying float vDrop;
  varying float vDist;
  void main() {
    float thickness = abs(dot(normalize(vNormalW), normalize(vViewW)));
    float a = pow(thickness, 1.5);
    // Solid at the fixture, gone before the floor: a shaft that ends in a
    // hard disc on the ground reads as a cone of plastic.
    a *= smoothstep(0.0, 0.55, vDrop) * pow(vDrop, 0.5);
    // Additive geometry gets no fog from three, so a cone fifty metres away
    // would burn at full strength in front of walls the fog has half erased,
    // inverting the depth cue the fog exists to give. Fade it by the same
    // range instead.
    a *= 1.0 - smoothstep(uFogNear, uFogFar, vDist);
    a *= uStrength;
    if (a < 0.002) discard;
    gl_FragColor = vec4(uColor, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Wrap a world coordinate into the box of edge length `box` centred on `c`.
 *
 * This is what makes a fixed mote buffer behave like an endless uniform
 * field: a mote that drifts out one side of the box around the eye reappears
 * a full box-length away on the other, so the buffer never grows and the
 * field is never exhausted. Returns a value in [c - box/2, c + box/2].
 */
export function wrapIntoBox(v: number, c: number, box: number): number {
  return v - Math.round((v - c) / box) * box;
}

/**
 * A fixture's healthy output, given everything it has been asked for so far.
 *
 * A shaft has to thin when the bus sags, which means comparing what a lamp is
 * putting out now against what it puts out when nothing is wrong. That figure
 * cannot be read at construction: `Kit.lightFixture` builds sodium fittings at
 * their catalogue 14 and the runtime then drives the bay at 24, so a frozen
 * registration value would peg every cone at full strength through the entire
 * derating range and the coupling would be decorative. Taking the running
 * maximum self-calibrates on the first healthy frame and never drifts down,
 * so a dimmed lamp reads as dimmed rather than redefining "healthy".
 */
export function designOutput(seenBest: number, base: number): number {
  return base > seenBest ? base : seenBest;
}

export class Atmosphere {
  private readonly scene: THREE.Scene;
  private readonly lamps: Lamp[] = [];

  private readonly moteGeo: THREE.BufferGeometry;
  private readonly moteMat: THREE.ShaderMaterial;
  private readonly moteTex: THREE.CanvasTexture;
  private readonly motes: THREE.Points;
  private readonly motePos: Float32Array;
  private readonly moteVel: Float32Array;

  private readonly shaftGeos: THREE.BufferGeometry[] = [];

  private t = 0;
  private density = 1;
  /** True until the first update() places the field around the real eye. */
  private moteFieldUnplaced = true;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.motePos = new Float32Array(MOTE_BUDGET * 3);
    this.moteVel = new Float32Array(MOTE_BUDGET * 3);
    for (let i = 0; i < MOTE_BUDGET; i++) {
      this.motePos[i * 3] = (Math.random() - 0.5) * MOTE_BOX;
      this.motePos[i * 3 + 1] = (Math.random() - 0.5) * MOTE_BOX;
      this.motePos[i * 3 + 2] = (Math.random() - 0.5) * MOTE_BOX;
      // Mostly horizontal wander with a weak upward bias: warm air off the
      // machinery carries dust up, it does not rain down.
      this.moteVel[i * 3] = (Math.random() - 0.5) * 2 * MOTE_DRIFT;
      this.moteVel[i * 3 + 1] = (Math.random() * 0.75 - 0.25) * MOTE_DRIFT;
      this.moteVel[i * 3 + 2] = (Math.random() - 0.5) * 2 * MOTE_DRIFT;
    }
    this.moteGeo = new THREE.BufferGeometry();
    this.moteGeo.setAttribute("position", new THREE.BufferAttribute(this.motePos, 3));
    this.moteTex = softDotTexture();
    this.moteMat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: this.moteTex },
        uColor: { value: new THREE.Color(0xd6ccb8) },
        uOpacity: { value: 0.6 },
        uSize: { value: 0.055 },
        // Overwritten every frame from the real drawing buffer; three does
        // this for PointsMaterial internally and a raw shader has to as well,
        // or motes are the wrong size on every device but one.
        uScale: { value: 360 },
        uFar: { value: MOTE_BOX / 2 },
      },
      vertexShader: MOTE_VERT,
      fragmentShader: MOTE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.motes = new THREE.Points(this.moteGeo, this.moteMat);
    // The field is recentred on the camera every frame, so the bounding
    // sphere three would compute from the buffer is never where the points
    // actually are.
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 2;
    scene.add(this.motes);
  }

  /**
   * Take over presentation of a lamp. From here on the Atmosphere is the only
   * thing that writes `light.intensity`; anyone who wants to change what a
   * fixture puts out goes through setLampBase().
   */
  addLamp(light: THREE.PointLight, spec: LampSpec = {}): void {
    let shaft: THREE.Mesh | null = null;
    let shaftMat: THREE.ShaderMaterial | null = null;
    if (spec.shaft) {
      const s = spec.shaft;
      const geo = new THREE.ConeGeometry(s.radius, s.length, 18, 1, true);
      this.shaftGeos.push(geo);
      const fog = this.scene.fog instanceof THREE.Fog ? this.scene.fog : null;
      shaftMat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(s.color) },
          uStrength: { value: s.strength },
          uFogNear: { value: fog ? fog.near : 1e6 },
          uFogFar: { value: fog ? fog.far : 1e6 },
        },
        vertexShader: SHAFT_VERT,
        fragmentShader: SHAFT_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      shaft = new THREE.Mesh(geo, shaftMat);
      // ConeGeometry puts the apex at +height/2, so dropping the mesh by half
      // its length hangs the apex exactly at the fixture.
      shaft.position.set(light.position.x, light.position.y - s.length / 2, light.position.z);
      shaft.renderOrder = 1;
      this.scene.add(shaft);
    }
    this.lamps.push({
      light,
      shaft,
      shaftMat,
      shaftStrength: spec.shaft?.strength ?? 0,
      base: light.intensity,
      designBase: Math.max(light.intensity, 1e-6),
      seed: Math.random() * 100,
      restless: spec.restless ?? 0.35,
    });
  }

  /**
   * Set what a registered fixture puts out, before flicker. This is how the
   * electrical state reaches a lamp: the caller says what the fixture is
   * being asked for and never writes `light.intensity` itself, so there is
   * exactly one writer and the flicker can never compound into its own base.
   * A lamp nobody calls this for keeps the intensity it was registered with.
   */
  setLampBase(light: THREE.PointLight, intensity: number): void {
    for (const l of this.lamps) {
      if (l.light !== light) continue;
      l.base = intensity;
      l.designBase = designOutput(l.designBase, intensity);
      return;
    }
    // Not registered: nothing here modulates it, so the caller's value stands.
    light.intensity = intensity;
  }

  /**
   * Fraction of the atmospheric budget that is drawn, 0..1.
   *
   * Only the mote draw range is touched here. Shaft strength and visibility
   * depend on live lamp state as well as density, and are recomputed in
   * update(); writing them from here too would flash every cone back to full
   * for a frame on each step of the effects slider, including cones under
   * lamps that are switched off.
   */
  setDensity(d: number): void {
    this.density = Math.min(1, Math.max(0, d));
    this.motes.visible = this.density > 0;
    this.moteGeo.setDrawRange(0, Math.round(MOTE_BUDGET * this.density));
  }

  /** @param viewportPx height of the drawing buffer, for point sizing. */
  update(dt: number, camera: THREE.Camera, viewportPx: number): void {
    this.t += dt;
    this.moteMat.uniforms.uScale!.value = viewportPx / 2;

    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;

    if (this.moteFieldUnplaced) {
      // Seeded around the origin, which is not where the eye starts. Without
      // this the first frame's wrap teleports the whole field at once.
      for (let i = 0; i < MOTE_BUDGET; i++) {
        this.motePos[i * 3] += cx;
        this.motePos[i * 3 + 1] += cy;
        this.motePos[i * 3 + 2] += cz;
      }
      this.moteFieldUnplaced = false;
    }

    if (this.motes.visible) {
      const drawn = Math.round(MOTE_BUDGET * this.density);
      for (let i = 0; i < drawn; i++) {
        const j = i * 3;
        // Motes live in world space and are wrapped into the cube around the
        // eye, so the field is effectively endless and uniform while the
        // buffer stays fixed. A mote that wraps does so a full half-box away
        // and sub-pixel small, where the jump cannot be seen.
        const x = this.motePos[j]! + this.moteVel[j]! * dt;
        const y = this.motePos[j + 1]! + this.moteVel[j + 1]! * dt;
        const z = this.motePos[j + 2]! + this.moteVel[j + 2]! * dt;
        this.motePos[j] = wrapIntoBox(x, cx, MOTE_BOX);
        this.motePos[j + 1] = wrapIntoBox(y, cy, MOTE_BOX);
        this.motePos[j + 2] = wrapIntoBox(z, cz, MOTE_BOX);
      }
      // Guard against a zero-length update range: three treats count 0 as
      // "draw nothing", which is correct, but needsUpdate on an empty range
      // still costs an upload.
      if (drawn > 0) {
        const attr = this.moteGeo.getAttribute("position") as THREE.BufferAttribute;
        attr.updateRanges.length = 0;
        attr.addUpdateRange(0, drawn * 3);
        attr.needsUpdate = true;
      }
    }

    for (const l of this.lamps) {
      const base = l.base;
      const s = l.seed;
      // Two slow incommensurate terms read as a ballast swimming rather than
      // as a sine wave, and a rare short dip reads as the tube striking.
      const swim =
        1 +
        l.restless * 0.045 * Math.sin(this.t * 1.7 + s) +
        l.restless * 0.03 * Math.sin(this.t * 4.3 + s * 2.1);
      const strike = Math.sin(this.t * 0.37 + s * 3.7);
      const dip = strike > 0.9965 ? 1 - l.restless * 0.55 : 1;
      const out = base * swim * dip;
      l.light.intensity = out;

      if (l.shaft && l.shaftMat) {
        // The shaft is the same light seen in the air instead of on a
        // surface, so it is driven by real output against what this fixture
        // was built to give: when the bus sags the cone thins with it, and
        // when the bay goes dark the cone goes with it. Below the cutoff it
        // is switched off outright rather than left as a faint ghost.
        const lit = l.light.visible ? Math.min(1, out / l.designBase) : 0;
        const faded = lit < SHAFT_CUTOFF ? 0 : (lit - SHAFT_CUTOFF) / (1 - SHAFT_CUTOFF);
        l.shaftMat.uniforms.uStrength!.value = l.shaftStrength * this.density * faded;
        l.shaft.visible = this.density > 0 && faded > 0;
      }
    }
  }

  dispose(): void {
    this.scene.remove(this.motes);
    this.moteGeo.dispose();
    this.moteMat.dispose();
    this.moteTex.dispose();
    for (const l of this.lamps) {
      if (l.shaft) this.scene.remove(l.shaft);
      l.shaftMat?.dispose();
    }
    for (const g of this.shaftGeos) g.dispose();
    this.lamps.length = 0;
  }
}
