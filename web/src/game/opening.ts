export type OpeningBeat = {
  dur: number;
  kicker: string;
  title: string;
  body: string;
};

export const OPENING_BEATS: OpeningBeat[] = [
  {
    dur: 2.4,
    kicker: "Freight Spine · Act I",
    title: "Bay 07 is inhabited",
    body: "You are a reclamation specialist. This machine still has people in it. The building will not reset.",
  },
  {
    dur: 2.8,
    kicker: "Live freight",
    title: "Carrier 07-A is offset",
    body: "The hanging load is already in the transfer frame. Offset cargo twists the neck. Twist jams G-07.",
  },
  {
    dur: 2.6,
    kicker: "Local command",
    title: "The pendant is on the pulpit",
    body: "You do not operate a hoist by staring at it. Rami still owns this drum. Walk to the pendant.",
  },
  {
    dur: 2.8,
    kicker: "The job",
    title: "Make a path that still exists",
    body: "Dock the live load. Open a maintenance walk. Stand Circ Shop as an island. The drive is a decision, not a pickup.",
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
  const ease = u * u * (3 - 2 * u);
  const x = 5.6 + ease * 2.4;
  const y = 1.72 + Math.sin(t * 0.35) * 0.05;
  const z = -1.35 + ease * 0.8;
  return {
    x,
    y,
    z,
    lx: 19.4,
    ly: 3.1 + Math.sin(t * 0.2) * 0.2,
    lz: 0.2,
  };
}
