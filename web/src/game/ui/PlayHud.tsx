import type { MutableRefObject } from "react";
import { useGame } from "../store.ts";
import type { GameHandle } from "../runtime.ts";
import { MachinePanel } from "./MachinePanel.tsx";
import { InspectPane } from "./Inspect.tsx";

/**
 * Traversal HUD.
 *
 * During ordinary movement this draws: the current objective, one contextual
 * action, exceptional warnings, and active work. Engineering telemetry is not
 * here — it lives in inspection and in the machine panels, where it is the
 * subject rather than decoration.
 */
export function PlayHud({ handleRef }: { handleRef: MutableRefObject<GameHandle | null> }) {
  const g = useGame();
  const h = () => handleRef.current;
  const machineOpen = Boolean(g.machine);
  const dense = g.settings.hudDensity === "full";

  const primary = g.action;
  const hasChoices = g.actionOptions.length > 1;
  const showPrompt = g.settings.promptMode === "always" || hasChoices || Boolean(primary?.refused);

  return (
    <>
      {/* ---- top: where you are, and the one thing worth doing ------------- */}
      <header className="gs-top">
        {g.guidance && !machineOpen && (
          <div className="gs-objective">
            <span className="gs-objective-line">{g.guidance.line}</span>
            {dense && <span className="gs-objective-detail">{g.guidance.detail}</span>}
          </div>
        )}
        {g.warnings.length > 0 && (
          <ul className="gs-warnings">
            {g.warnings.slice(0, 3).map((w) => (
              <li key={w.id} className={w.severity === "critical" ? "is-critical" : ""}>
                {w.text}
              </li>
            ))}
          </ul>
        )}
      </header>

      <div className={`gs-cross${primary ? " is-live" : ""}`} aria-hidden="true" />

      {/* ---- what you are looking at, when it is not what you can act on --- */}
      {!machineOpen && g.look && (!primary || primary.targetId !== g.look.id) && (
        <div className="gs-look">
          <span className="gs-look-k">Look</span>
          <span className="gs-look-id">{g.look.label}</span>
          <span className="gs-look-d">{g.look.dist.toFixed(1)} m</span>
        </div>
      )}

      {g.message && <div className="gs-toast">{g.message}</div>}

      {g.work && (
        <div className="gs-work">
          <span>{g.work.label}</span>
          <i style={{ width: `${Math.min(100, g.work.progress * 100)}%` }} />
        </div>
      )}

      {/* ---- the contextual action ----------------------------------------- */}
      {!machineOpen && primary && showPrompt && !g.selectorOpen && (
        <div className={`gs-action${primary.refused ? " is-refused" : ""}`}>
          <span className="gs-action-k">{g.touch ? "Action" : "E"}</span>
          <span className="gs-action-v">{primary.label}</span>
          {hasChoices && <span className="gs-action-more">{g.touch ? "hold · more" : "Q · more"}</span>}
          {primary.refused && <span className="gs-action-why">{primary.refused}</span>}
        </div>
      )}

      {!machineOpen && !primary && g.outOfReach && (
        <div className="gs-action is-far">
          <span className="gs-action-k">Reach</span>
          <span className="gs-action-v">
            {g.outOfReach.label} — {g.outOfReach.dist.toFixed(1)} m away
          </span>
        </div>
      )}

      {g.slingA && !machineOpen && (
        <div className="gs-rig">
          <span>Rigging</span> first attachment set — choose a compatible second
        </div>
      )}

      {/* ---- hold-to-choose selector --------------------------------------- */}
      {g.selectorOpen && g.actionOptions.length > 0 && (
        <div className="gs-selector" role="menu">
          <p className="gs-selector-head">{g.look?.label ?? "Actions"}</p>
          {g.actionOptions.map((o, i) => (
            <button
              key={`${o.kind}:${o.targetId}`}
              type="button"
              role="menuitem"
              className={o.refused ? "is-refused" : ""}
              onPointerUp={(e) => {
                e.stopPropagation();
                h()?.performOption(i);
              }}
            >
              <span>{o.label}</span>
              {o.refused && <em>{o.refused}</em>}
            </button>
          ))}
          <button type="button" className="gs-selector-close" onPointerUp={() => h()?.closeSelector()}>
            Close
          </button>
        </div>
      )}

      {machineOpen && <MachinePanel handleRef={handleRef} />}
      {g.inspectOpen && <InspectPane onClose={() => h()?.closeInspect()} />}

      {/* ---- opt-in engineering strip -------------------------------------- */}
      {dense && !machineOpen && <DenseStrip />}
    </>
  );
}

function DenseStrip() {
  const events = useGame((s) => s.events);
  const objectives = useGame((s) => s.objectives);
  return (
    <footer className="gs-dense">
      <ol className="gs-obj">
        {objectives.map((o) => (
          <li key={o.id} className={o.done ? "is-done" : ""}>
            <span className="gs-obj-mark" />
            <span>{o.title}</span>
          </li>
        ))}
      </ol>
      <ul className="gs-log">
        {events.slice(-3).map((e, i) => (
          <li key={`${e.t}-${i}`}>{e.text}</li>
        ))}
      </ul>
    </footer>
  );
}
