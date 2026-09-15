import { useEffect, useRef, useState, type MutableRefObject, type PointerEvent } from "react";
import { useGame } from "../store.ts";
import type { GameHandle } from "../runtime.ts";
import { operateKind } from "../operate.ts";

export function TouchControls({ handleRef }: { handleRef: MutableRefObject<GameHandle | null> }) {
  const g = useGame();
  const kind = g.operateKind ?? operateKind(g.operateId);
  const primary = g.primary;
  const secondary = g.secondary && g.secondary.commit !== "jump" ? g.secondary : null;
  const showSecondary = Boolean(
    secondary && (secondary.commit === "inspect" || secondary.commit === "mantle" || secondary.commit === "exit-operate" || secondary.commit === "vent"),
  );

  return (
    <div className="gs-touch">
      <TouchStage handleRef={handleRef} blocked={g.inspectOpen || g.selectorOpen} />
      <button type="button" className="gs-pause-fab" onClick={() => handleRef.current?.pause()}>
        Pause
      </button>

      {kind && (
        <div className="gs-ops">
          {kind === "carrier" && (
            <>
              <Hold label="Raise" code="KeyR" handleRef={handleRef} />
              <Hold label="Lower" code="KeyF" handleRef={handleRef} />
              <Hold label="Left" code="KeyZ" handleRef={handleRef} />
              <Hold label="Right" code="KeyX" handleRef={handleRef} />
              <Hold label="Brake" code="KeyB" handleRef={handleRef} />
            </>
          )}
          {kind === "gate" && (
            <>
              <Hold label="Open" code="KeyG" handleRef={handleRef} />
              <Hold label="Close" code="KeyT" handleRef={handleRef} />
              <Hold label="Vent" code="KeyV" handleRef={handleRef} />
            </>
          )}
          {kind === "frame" && <Hold label="Jack" code="KeyR" handleRef={handleRef} />}
        </div>
      )}

      <div className="gs-touch-actions">
        {showSecondary && secondary && (
          <button type="button" className="gs-sec" onPointerUp={() => handleRef.current?.commitChoice(secondary.id)}>
            {secondary.verb}
          </button>
        )}
        <ActionFab handleRef={handleRef} label={primary ? primary.verb : "Action"} armed={Boolean(primary)} />
      </div>
    </div>
  );
}

function ActionFab({
  handleRef,
  label,
  armed,
}: {
  handleRef: MutableRefObject<GameHandle | null>;
  label: string;
  armed: boolean;
}) {
  const pid = useRef<number | null>(null);
  const start = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    pid.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    handleRef.current?.hold("KeyE", true);
  };
  const end = (e: PointerEvent<HTMLButtonElement>) => {
    if (pid.current !== e.pointerId) return;
    pid.current = null;
    handleRef.current?.hold("KeyE", false);
  };
  return (
    <button
      type="button"
      className={`gs-use${armed ? "" : " is-dim"}`}
      onPointerDown={start}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {label}
    </button>
  );
}

function Hold({
  label,
  code,
  handleRef,
}: {
  label: string;
  code: string;
  handleRef: MutableRefObject<GameHandle | null>;
}) {
  const pid = useRef<number | null>(null);
  const start = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    pid.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    handleRef.current?.hold(code, true);
  };
  const end = (e: PointerEvent<HTMLButtonElement>) => {
    if (pid.current !== e.pointerId) return;
    pid.current = null;
    handleRef.current?.hold(code, false);
  };
  return (
    <button type="button" onPointerDown={start} onPointerUp={end} onPointerCancel={end}>
      {label}
    </button>
  );
}

type Pad = { ox: number; oy: number; x: number; y: number; prevX: number; prevY: number; mode: "move" | "look" };

function TouchStage({
  handleRef,
  blocked,
}: {
  handleRef: MutableRefObject<GameHandle | null>;
  blocked: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pads = useRef(new Map<number, Pad>());
  const [ghosts, setGhosts] = useState<Pad[]>([]);

  useEffect(() => {
    return () => {
      handleRef.current?.setTouchMove(0, 0);
    };
  }, [handleRef]);

  const publish = () => {
    let move: Pad | undefined;
    let look: Pad | undefined;
    for (const p of pads.current.values()) {
      if (p.mode === "move") move = p;
      else look = p;
    }
    const h = handleRef.current;
    if (move) {
      const nx = (move.x - move.ox) / 54;
      const ny = -((move.y - move.oy) / 54);
      h?.setTouchMove(nx, ny);
    } else h?.setTouchMove(0, 0);
    if (look) {
      const dx = look.x - look.prevX;
      const dy = look.y - look.prevY;
      look.prevX = look.x;
      look.prevY = look.y;
      if (dx !== 0 || dy !== 0) h?.setTouchLookDelta(dx, dy);
    }
    setGhosts([...pads.current.values()].filter((p) => p.mode === "move"));
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (blocked) return;
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const r = ref.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const mode: "move" | "look" = x < r.width * 0.46 ? "move" : "look";
    for (const p of pads.current.values()) {
      if (p.mode === mode) return;
    }
    pads.current.set(e.pointerId, { ox: x, oy: y, x, y, prevX: x, prevY: y, mode });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* */
    }
    publish();
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const p = pads.current.get(e.pointerId);
    if (!p) return;
    const r = ref.current!.getBoundingClientRect();
    p.x = e.clientX - r.left;
    p.y = e.clientY - r.top;
    publish();
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (!pads.current.has(e.pointerId)) return;
    pads.current.delete(e.pointerId);
    publish();
  };

  return (
    <div
      ref={ref}
      className={`gs-stage${blocked ? " is-off" : ""}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <span className="gs-stage-hint gs-stage-hint-l">Walk</span>
      <span className="gs-stage-hint gs-stage-hint-r">Look</span>
      {ghosts.map((g, i) => (
        <i
          key={i}
          className="gs-ghost gs-ghost-move"
          style={{
            left: g.ox,
            top: g.oy,
            ["--kx" as string]: `${g.x - g.ox}px`,
            ["--ky" as string]: `${g.y - g.oy}px`,
          }}
        />
      ))}
    </div>
  );
}
