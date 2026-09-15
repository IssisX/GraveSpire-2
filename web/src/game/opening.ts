export type OpeningBeat = {
  dur: number;
  kicker: string;
  title: string;
  body: string;
};

export const OPENING_BEATS: OpeningBeat[] = [
  {
    dur: 2.6,
    kicker: "Freight Spine · Act I",
    title: "Bay 07 is inhabited",
    body: "You are a reclamation specialist. This machine still has people in it. The building will not reset.",
  },
  {
    dur: 3.0,
    kicker: "Live freight",
    title: "Carrier 07-A is offset",
    body: "The hanging load is already in the well. Dock is east, on the receiving apron. Offset cargo twists the neck. Twist jams G-07.",
  },
  {
    dur: 2.8,
    kicker: "Local command",
    title: "The pendant is on the pulpit",
    body: "You do not operate a hoist by staring at it. Rami still owns this drum. Walk to the pendant.",
  },
  {
    dur: 2.8,
    kicker: "The job",
    title: "Make a path that still exists",
    body: "Raise, traverse, dock the live load. Open a walk. Stand Circ Shop as an island. The drive is a decision, not a pickup.",
  },
];

export const OPENING_TOTAL = OPENING_BEATS.reduce((a, b) => a + b.dur, 0);

export function openingBeatAt(t: number): { index: number; local: number; beat: OpeningBeat } {
  let acc = 0;
  for (let i = 0; i < OPENING_BEATS.length; i++) {
    const b = OPENING_BEATS[i]!;
    if (t < acc + b.dur) return { index: i, local: t - acc, beat: b };
    acc += b.dur;
  }
  const last = OPENING_BEATS[OPENING_BEATS.length - 1]!;
  return { index: OPENING_BEATS.length - 1, local: last.dur, beat: last };
}

const KEYS = [
  { x: 8.4, y: 7.6, z: 13.2, lx: 20.5, ly: 3.4, lz: 0 },
  { x: 12.2, y: 4.4, z: 6.4, lx: 18.2, ly: 2.2, lz: 0 },
  { x: 7.4, y: 2.55, z: -4.2, lx: 4.55, ly: 1.72, lz: -6.4 },
  { x: 5.6, y: 1.72, z: -1.35, lx: 19.4, ly: 3.1, lz: 0.2 },
];

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** Camera is presentation. Player pose is not moved until control is granted. */
export function openingCamera(t: number): {
  x: number;
  y: number;
  z: number;
  lx: number;
  ly: number;
  lz: number;
} {
  const u = Math.min(1, t / OPENING_TOTAL);
  const scaled = u * (KEYS.length - 1);
  const i = Math.min(KEYS.length - 2, Math.floor(scaled));
  const f = scaled - i;
  const ease = f * f * (3 - 2 * f);
  const a = KEYS[i]!;
  const b = KEYS[i + 1]!;
  return {
    x: lerp(a.x, b.x, ease),
    y: lerp(a.y, b.y, ease) + Math.sin(t * 0.35) * 0.04,
    z: lerp(a.z, b.z, ease),
    lx: lerp(a.lx, b.lx, ease),
    ly: lerp(a.ly, b.ly, ease),
    lz: lerp(a.lz, b.lz, ease),
  };
}
