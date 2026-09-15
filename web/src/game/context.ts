/**
 * Contextual target resolution.
 *
 * Two distinct things are resolved every frame:
 *
 *   LOOK TARGET   — what the player is visually examining. Generous range,
 *                   tight reticle cone. Enables inspection and identification.
 *   ACTION TARGET — what the player can physically affect from where they are
 *                   standing. Bounded by the object's own declared reach, by
 *                   line of sight, by facing, and by whether any action is
 *                   actually eligible in the current world state.
 *
 * Seeing a machine across the bay does not make it operable. That separation is
 * the whole point of this module.
 *
 * Candidate choice is sticky: a target keeps its claim until another candidate
 * is clearly better, so the prompt does not flicker between neighbouring
 * objects when the camera drifts a degree.
 */

import { lineOfSight, type Collider } from "./collision.ts";

export type InteractKind = "machine" | "member" | "npc" | "board" | "bench" | "world" | "station" | "body";

export interface Interactable {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
  /** Declared physical interaction range in metres. Not a look range. */
  reach: number;
  kind: InteractKind;
  /** How far away this object can still be identified and inspected. */
  lookRange?: number;
  /** Minimum facing alignment (dot) required to act on it. */
  cone?: number;
  /** Ties broken toward higher priority when scores are close. */
  priority?: number;
  /** Collider ids that must not count as occluders for this object. */
  ignoreOccluders?: string[];
  /** Skip the line-of-sight test (used for panels flush against their mount). */
  noOcclusion?: boolean;
}

export interface ContextTarget {
  id: string;
  label: string;
  kind: InteractKind;
  dist: number;
  /** Facing alignment, 1 = dead centre. */
  align: number;
}

export interface ContextResult {
  look: ContextTarget | null;
  action: ContextTarget | null;
  /**
   * Set when something is plainly in view but cannot be acted on from here,
   * so the HUD can say why instead of going silent.
   */
  outOfReach: { label: string; need: number; dist: number } | null;
}

const DEFAULT_CONE: Record<InteractKind, number> = {
  machine: 0.5,
  station: 0.42,
  member: 0.5,
  npc: 0.32,
  board: 0.45,
  bench: 0.42,
  world: 0.5,
  body: 0.45,
};

const DEFAULT_PRIORITY: Record<InteractKind, number> = {
  station: 0.9,
  npc: 0.8,
  machine: 0.6,
  board: 0.6,
  bench: 0.55,
  member: 0.4,
  world: 0.3,
  body: 0.5,
};

/**
 * Reticle cone for identifying what the player is looking at.
 *
 * Distance-aware: an object two metres away fills the screen, so acquiring it
 * should not demand precision, while at range a wide cone would let the player
 * acquire something they are not actually pointing at.
 */
const LOOK_CONE_NEAR = 0.94;
const LOOK_CONE_FAR = 0.962;
const LOOK_NEAR_M = 3.5;

function lookCone(dist: number): number {
  return dist <= LOOK_NEAR_M ? LOOK_CONE_NEAR : LOOK_CONE_FAR;
}
/** How much better a rival must score before the action target changes. */
const SWITCH_MARGIN = 0.07;
/** Bonus retained by the current action target. */
const STICKY_BONUS = 0.13;
/**
 * Bonus for being the thing under the reticle.
 *
 * Large on purpose: if the player is looking straight at a reachable object,
 * that is what they mean, whatever else is nearer or higher priority. Standing
 * at the pulpit and looking at Rami should offer Rami.
 */
const LOOK_BONUS = 0.5;

export interface EyePose {
  x: number;
  y: number;
  z: number;
  dirX: number;
  dirY: number;
  dirZ: number;
}

/** Authoritative eye pose. Gait offsets are deliberately not applied here. */
export function eyePose(x: number, y: number, z: number, yaw: number, pitch: number): EyePose {
  const cp = Math.cos(pitch);
  return {
    x,
    y,
    z,
    dirX: -Math.sin(yaw) * cp,
    dirY: Math.sin(pitch),
    dirZ: -Math.cos(yaw) * cp,
  };
}

interface Scored {
  it: Interactable;
  dist: number;
  align: number;
  score: number;
}

export class ContextResolver {
  private lastActionId: string | null = null;
  private lastLookId: string | null = null;

  /** Drop stickiness, e.g. after a teleport, load, or mode change. */
  reset(): void {
    this.lastActionId = null;
    this.lastLookId = null;
  }

  get actionId(): string | null {
    return this.lastActionId;
  }

  resolve(
    eye: EyePose,
    items: readonly Interactable[],
    colliders: readonly Collider[],
    /** True when this object currently offers at least one eligible action. */
    eligible: (it: Interactable) => boolean,
  ): ContextResult {
    const colliderList = colliders as Collider[];
    const lookCandidates: Scored[] = [];
    const actionCandidates: Scored[] = [];
    let nearestInView: Scored | null = null;

    for (const it of items) {
      const dx = it.x - eye.x;
      const dy = it.y - eye.y;
      const dz = it.z - eye.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < 1e-3) continue;
      const lookRange = it.lookRange ?? Math.max(it.reach * 3.2, 14);
      if (dist > lookRange) continue;
      const align = (dx * eye.dirX + dy * eye.dirY + dz * eye.dirZ) / dist;
      if (align <= 0) continue;

      const cone = it.cone ?? DEFAULT_CONE[it.kind];
      const priority = it.priority ?? DEFAULT_PRIORITY[it.kind];

      // Line of sight is shared by both resolutions; compute at most once.
      let visible: boolean | null = null;
      const seen = () => {
        if (visible === null) {
          visible = it.noOcclusion
            ? true
            : lineOfSight(
                eye.x,
                eye.y,
                eye.z,
                it.x,
                it.y,
                it.z,
                colliderList,
                new Set([it.id, ...(it.ignoreOccluders ?? [])]),
              );
        }
        return visible;
      };

      if (align >= lookCone(dist) && seen()) {
        lookCandidates.push({ it, dist, align, score: align * 100 - dist * 0.01 });
      }

      if (dist <= it.reach && align >= cone && eligible(it) && seen()) {
        const alignScore = (align - cone) / Math.max(1e-3, 1 - cone);
        const proxScore = 1 - dist / it.reach;
        // Look bonus is added after the look target is known, below.
        const score = 0.5 * alignScore + 0.34 * proxScore + 0.16 * priority;
        actionCandidates.push({ it, dist, align, score });
      } else if (align >= cone && eligible(it) && dist <= it.reach * 3 && seen()) {
        // In view, plainly the thing being approached, but not yet reachable.
        if (!nearestInView || dist < nearestInView.dist) {
          nearestInView = { it, dist, align, score: 0 };
        }
      }
    }

    // ---- look target -------------------------------------------------------
    let look: Scored | null = null;
    for (const c of lookCandidates) {
      if (!look || c.score > look.score) look = c;
    }
    // Mild stickiness so a shared edge between two objects does not strobe.
    if (look && this.lastLookId && look.it.id !== this.lastLookId) {
      const held = lookCandidates.find((c) => c.it.id === this.lastLookId);
      if (held && held.score > look.score - 0.6) look = held;
    }
    this.lastLookId = look?.it.id ?? null;

    // ---- action target -----------------------------------------------------
    // What the player is looking at outranks what happens to be nearest, so
    // standing at a control station and looking at a person offers the person.
    const lookId = look?.it.id ?? null;
    for (const c of actionCandidates) {
      if (c.it.id === lookId) c.score += LOOK_BONUS;
      if (c.it.id === this.lastActionId) c.score += STICKY_BONUS;
    }

    let best: Scored | null = null;
    for (const c of actionCandidates) {
      if (!best || c.score > best.score) best = c;
    }
    if (best && this.lastActionId && best.it.id !== this.lastActionId) {
      const held = actionCandidates.find((c) => c.it.id === this.lastActionId);
      if (held && best.score < held.score + SWITCH_MARGIN) best = held;
    }
    this.lastActionId = best?.it.id ?? null;

    const toTarget = (s: Scored | null): ContextTarget | null =>
      s ? { id: s.it.id, label: s.it.label, kind: s.it.kind, dist: s.dist, align: s.align } : null;

    return {
      look: toTarget(look),
      action: toTarget(best),
      outOfReach:
        !best && nearestInView
          ? { label: nearestInView.it.label, need: nearestInView.it.reach, dist: nearestInView.dist }
          : null,
    };
  }
}
