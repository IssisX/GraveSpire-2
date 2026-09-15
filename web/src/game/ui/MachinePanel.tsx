import { useRef, type MutableRefObject, type PointerEvent } from "react";
import { useGame } from "../store.ts";
import type { GameHandle } from "../runtime.ts";

/**
 * Temporary machine mode surface.
 *
 * These controls exist only while the player is deliberately operating this
 * machine, and they are a presentation of that machine's real commands. Every
 * refusal shown here comes from the machine definition asking the authority,
 * not from the UI deciding what the player may do.
 */
export function MachinePanel({ handleRef }: { handleRef: MutableRefObject<GameHandle | null> }) {
  const m = useGame((s) => s.machine);
  const touch = useGame((s) => s.touch);
  const h = () => handleRef.current;
  if (!m) return null;

  return (
    <section className="gs-machine" aria-label={`${m.title} controls`}>
      <header>
        <div>
          <p className="gs-kicker">{m.subtitle}</p>
          <h2>{m.title}</h2>
        </div>
        <button type="button" className="gs-machine-exit" onPointerUp={() => h()?.exitMachine()}>
          {touch ? "Leave controls" : "Leave · E"}
        </button>
      </header>

      <dl className="gs-machine-read">
        {m.readouts.map((r) => (
          <div key={r.label} className={r.alert ? "is-alert" : ""}>
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>

      <div className="gs-machine-controls">
        {m.controls.map((c) =>
          c.mode === "hold" ? (
            <HoldButton
              key={c.id}
              id={c.id}
              label={c.label}
              keyLabel={c.keyLabel}
              engaged={c.engaged}
              refused={c.refused}
              handleRef={handleRef}
            />
          ) : (
            <button
              key={c.id}
              type="button"
              className={`gs-mbtn${c.engaged ? " is-on" : ""}${c.refused ? " is-refused" : ""}`}
              title={c.refused ?? undefined}
              onPointerUp={(e) => {
                e.stopPropagation();
                h()?.machineTrigger(c.id);
              }}
            >
              <span>{c.label}</span>
              <em>{c.keyLabel}</em>
            </button>
          ),
        )}
      </div>

      {m.controls.some((c) => c.refused) && (
        <p className="gs-machine-why">{m.controls.find((c) => c.refused)?.refused}</p>
      )}
    </section>
  );
}

function HoldButton({
  id,
  label,
  keyLabel,
  engaged,
  refused,
  handleRef,
}: {
  id: string;
  label: string;
  keyLabel: string;
  engaged: boolean;
  refused: string | null;
  handleRef: MutableRefObject<GameHandle | null>;
}) {
  const pid = useRef<number | null>(null);

  const start = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (refused) return;
    pid.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture unavailable */
    }
    handleRef.current?.machineHold(id, true);
  };
  const end = (e: PointerEvent<HTMLButtonElement>) => {
    if (pid.current !== e.pointerId) return;
    pid.current = null;
    handleRef.current?.machineHold(id, false);
  };

  return (
    <button
      type="button"
      className={`gs-mbtn is-hold${engaged ? " is-on" : ""}${refused ? " is-refused" : ""}`}
      title={refused ?? undefined}
      onPointerDown={start}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    >
      <span>{label}</span>
      <em>{keyLabel}</em>
    </button>
  );
}
