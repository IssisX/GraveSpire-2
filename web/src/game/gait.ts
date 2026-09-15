import type { Settings } from "./settings.ts";

/** Presentation-only first-person embodiment. Never writes player world pose. */
export type Gait = {
  phase: number;
  time: number;
  vert: number;
  lat: number;
  roll: number;
  yaw: number;
  pitch: number;
  land: number;
  breath: number;
  trauma: number;
  prevPhase: number;
  foot: boolean;
};

export function createGait(): Gait {
  return {
    phase: 0,
    time: 0,
    vert: 0,
    lat: 0,
    roll: 0,
    yaw: 0,
    pitch: 0,
    land: 0,
    breath: 0,
    trauma: 0,
    prevPhase: 0,
    foot: false,
  };
}

function damp(current: number, target: number, lambda: number, dt: number) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export function impulseGait(g: Gait, amount: number) {
  g.trauma = Math.min(1, g.trauma + amount);
}

export function stepGait(
  g: Gait,
  dt: number,
  sample: {
    speed: number;
    grounded: boolean;
    crouch: boolean;
    sprint: boolean;
    forwardAccel: number;
    yawRate: number;
    landed: number;
  },
  settings: Settings,
) {
  g.time += dt;
  g.foot = false;
  const reduced = settings.reducedMotion;
  const shakeK = reduced ? 0 : settings.shake;

  const stride = sample.sprint ? 2.45 : sample.crouch ? 1.28 : 1.72;
  g.prevPhase = g.phase;
  if (sample.grounded && sample.speed > 0.32) {
    g.phase += (sample.speed / stride) * Math.PI * 2 * dt;
    if (g.phase > Math.PI * 2) g.phase -= Math.PI * 2;
  } else {
    g.phase = damp(g.phase, 0, 4.2, dt);
  }

  const crossed =
    (g.prevPhase < Math.PI && g.phase >= Math.PI) || (g.prevPhase > g.phase && g.phase < 0.4);
  if (sample.grounded && sample.speed > 0.7 && crossed) g.foot = true;

  const speedK = Math.min(1, sample.speed / (sample.sprint ? 4.4 : 2.4));
  const amp = reduced ? 0 : sample.crouch ? 0.008 : sample.sprint ? 0.022 : 0.016;
  const wantV = sample.grounded ? -Math.cos(g.phase * 2) * amp * speedK : 0;
  const wantL = sample.grounded ? Math.sin(g.phase) * amp * 0.55 * speedK : 0;
  const wantRoll = sample.grounded ? -Math.sin(g.phase) * 0.012 * speedK : 0;
  const wantYaw = -sample.yawRate * (reduced ? 0.02 : 0.07);
  const wantPitch = -Math.max(-3.2, Math.min(3.2, sample.forwardAccel)) * (reduced ? 0.004 : 0.012);

  if (sample.landed > 0 && !reduced) {
    g.land = Math.max(g.land, sample.landed);
    g.trauma = Math.min(1, g.trauma + sample.landed * 0.35 * shakeK);
  }

  g.vert = damp(g.vert, wantV, 14, dt) - (reduced ? 0 : g.land * 0.05);
  g.lat = damp(g.lat, wantL, 12, dt);
  g.roll = damp(g.roll, wantRoll + (reduced ? 0 : sample.yawRate * 0.04), 10, dt);
  g.yaw = damp(g.yaw, wantYaw, 8, dt);
  g.pitch = damp(g.pitch, wantPitch, 9, dt);
  g.land = damp(g.land, 0, 6.5, dt);

  const idle = sample.grounded && sample.speed < 0.28 ? 1 : 0;
  const wantBreath = reduced ? 0 : Math.sin(g.time * 1.25) * 0.0038 * idle;
  g.breath = damp(g.breath, wantBreath, 3.4, dt);

  g.trauma = Math.max(0, g.trauma - dt * 1.8);
}

export function gaitOffset(g: Gait, settings: Settings): {
  x: number;
  y: number;
  z: number;
  roll: number;
  yaw: number;
  pitch: number;
} {
  const shake = g.trauma * g.trauma * (settings.reducedMotion ? 0 : settings.shake);
  const t = g.time * 29;
  const sx = Math.sin(t * 1.13) * 0.012 * shake;
  const sy = Math.cos(t * 1.31) * 0.01 * shake;
  const sr = Math.sin(t * 0.9) * 0.008 * shake;
  return {
    x: g.lat + sx,
    y: g.vert + g.breath + sy,
    z: 0,
    roll: g.roll + sr,
    yaw: g.yaw,
    pitch: g.pitch,
  };
}
