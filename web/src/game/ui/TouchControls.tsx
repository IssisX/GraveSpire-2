import { useEffect, useRef, useState, type MutableRefObject, type PointerEvent } from "react";
import { useGame } from "../store.ts";
import type { GameHandle } from "../runtime.ts";

/**
 * Touch control surface.
 *
 * The normal traversal state is: left thumb moves, right side looks, one Action
 * control does whatever the world offers, with a hold for the rare case where
 * more than one thing is genuinely possible. Machine verbs are not here — they
 * appear in the machine panel while the player is operating that machine, and
 * they leave again when the player does.
 *
 * The movement stick is dynamic: it appears wherever the thumb lands, keeps its
 * analogue magnitude, and re-anchors itself if the thumb wanders, so it never
 * requires a precise touch.
 */

/** Stick travel in CSS pixels from anchor to full deflection. */
const STICK_RADIUS = 64;
/** Fraction of the width reserved for movement. */
const MOVE_ZONE = 0.46;

type Anchor = { id: number; ox: number; oy: number; x: number; y: number };

export function TouchControls({ handleRef }: { handleRef: MutableRefObject<GameHandle | null> }) {
  const stage = useRef<HTMLDivElement>(null);
  const movePad = useRef<Anchor | null>(null);
  const lookPad = useRef<{ id: number; lx: number; ly: number } | null>(null);
  const [stick, setStick] = useState<Anchor | null>(null);

  const machineOpen = useGame((s) => Boolean(s.machine));
  const selectorOpen = useGame((s) => s.selectorOpen);
  const action = useGame((s) => s.action);
  const inspectOpen = useGame((s) => s.inspectOpen);
  const [crouch, setCrouch] = useState(false);

  const h = () => handleRef.current;

  useEffect(() => {
    return () => {
      const g = handleRef.current;
      g?.setTouchMove(0, 0);
      g?.setTouchInteract(false);
    };
  }, [handleRef]);

  const publishMove = (pad: Anchor | null) => {
    if (!pad) {
      h()?.setTouchMove(0, 0);
      return;
    }
    h()?.setTouchMove((pad.x - pad.ox) / STICK_RADIUS, -((pad.y - pad.oy) / STICK_RADIUS));
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    const el = stage.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const wantsMove = x < r.width * MOVE_ZONE;

    if (wantsMove) {
      if (movePad.current) return;
      const pad: Anchor = { id: e.pointerId, ox: x, oy: y, x, y };
      movePad.current = pad;
      setStick({ ...pad });
      publishMove(pad);
    } else {
      if (lookPad.current) return;
      lookPad.current = { id: e.pointerId, lx: x, ly: y };
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture unavailable */
    }
  };

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const el = stage.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;

    const pad = movePad.current;
    if (pad && pad.id === e.pointerId) {
      pad.x = x;
      pad.y = y;
      // Forgiving anchor: once the thumb passes full deflection the origin
      // follows it, so a long drag never loses the stick.
      const dx = pad.x - pad.ox;
      const dy = pad.y - pad.oy;
      const d = Math.hypot(dx, dy);
      if (d > STICK_RADIUS) {
        const k = (d - STICK_RADIUS) / d;
        pad.ox += dx * k;
        pad.oy += dy * k;
      }
      setStick({ ...pad });
      publishMove(pad);
      return;
    }

    const look = lookPad.current;
    if (look && look.id === e.pointerId) {
      h()?.addTouchLook(x - look.lx, y - look.ly);
      look.lx = x;
      look.ly = y;
    }
  };

  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (movePad.current?.id === e.pointerId) {
      movePad.current = null;
      setStick(null);
      publishMove(null);
    }
    if (lookPad.current?.id === e.pointerId) lookPad.current = null;
  };

  const actionLabel = machineOpen
    ? "Leave"
    : selectorOpen
      ? "Close"
      : action
        ? shortVerb(action.label)
        : "—";

  return (
    <div className="gs-touch">
      <div
        ref={stage}
        className={`gs-stage${inspectOpen ? " is-off" : ""}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onLostPointerCapture={up}
      >
        {stick && (
          <>
            <i className="gs-stick-base" style={{ left: stick.ox, top: stick.oy }} />
            <i
              className="gs-stick-knob"
              style={{
                left: stick.ox + clampTravel(stick.x - stick.ox),
                top: stick.oy + clampTravel(stick.y - stick.oy),
              }}
            />
          </>
        )}
      </div>

      <button type="button" className="gs-chip-btn gs-pause-fab" onPointerUp={() => h()?.pause()}>
        Pause
      </button>

      <button
        type="button"
        className={`gs-chip-btn gs-crouch${crouch ? " is-on" : ""}`}
        onPointerUp={() => {
          const next = !crouch;
          setCrouch(next);
          h()?.setCrouch(next);
        }}
      >
        {crouch ? "Stand" : "Crouch"}
      </button>

      <div className="gs-thumb">
        <button
          type="button"
          className="gs-jump"
          onPointerDown={(e) => {
            e.preventDefault();
            h()?.setJump(true);
          }}
          onPointerUp={() => h()?.setJump(false)}
          onPointerCancel={() => h()?.setJump(false)}
        >
          Jump
        </button>
        <button
          type="button"
          className={`gs-action-btn${action?.refused ? " is-refused" : ""}${action || machineOpen ? "" : " is-idle"}`}
          onPointerDown={(e) => {
            e.preventDefault();
            h()?.setTouchInteract(true);
          }}
          onPointerUp={() => h()?.setTouchInteract(false)}
          onPointerCancel={() => h()?.setTouchInteract(false)}
        >
          <span>{actionLabel}</span>
        </button>
      </div>
    </div>
  );
}

function clampTravel(v: number): number {
  return Math.max(-STICK_RADIUS, Math.min(STICK_RADIUS, v));
}

/** The button face gets the verb; the full line stays in the prompt. */
function shortVerb(label: string): string {
  const first = label.split(" ")[0] ?? label;
  return first.length > 9 ? `${first.slice(0, 8)}…` : first;
}
