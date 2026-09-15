import { useGame } from "../store.ts";
import { operateHint } from "../operate.ts";

export function PlayHud() {
  const g = useGame();
  const obj = g.objectives.find((o) => !o.done) ?? g.objectives[0];
  const doneAll = g.objectives.length > 0 && g.objectives.every((o) => o.done);

  return (
    <>
      <header className="gs-top">
        <div className="gs-chip">
          <span className="gs-chip-k">GRAVESPIRE</span>
          <span className="gs-chip-v">{g.snap?.districtShort ?? "FS-07"}</span>
          <span className="gs-chip-m">{g.snap?.district ?? "Freight Spine Bay 07"}</span>
        </div>
        {obj && (
          <ol className="gs-obj gs-obj-one">
            <li className={doneAll ? "is-done" : ""}>
              <span className="gs-obj-mark" />
              <span>{doneAll ? "Act I closed on world state" : obj.title}</span>
            </li>
          </ol>
        )}
      </header>

      <div className="gs-cross" aria-hidden="true" />

      {g.look && (
        <div className="gs-look">
          <span className="gs-look-id">{g.look.label}</span>
          <span className="gs-look-d">{g.look.dist.toFixed(1)} m</span>
        </div>
      )}

      {g.warning && <div className="gs-warn-banner">{g.warning}</div>}
      {g.message && <div className="gs-toast">{g.message}</div>}
      {g.hint && !g.message && <div className="gs-hint">{g.hint}</div>}
      {g.work && (
        <div className="gs-work">
          <span>{g.work.label}</span>
          <i style={{ width: `${Math.min(100, g.work.progress * 100)}%` }} />
        </div>
      )}
      {g.slingA && <div className="gs-toast">Sling first attachment set. Find a compatible second.</div>}

      {g.inspectOpen && g.inspect && (
        <aside className="gs-inspect">
          <header>
            <p>{g.inspect.district}</p>
            <h2>{g.inspect.title}</h2>
            <button type="button" className="gs-text-btn" onClick={() => useGame.getState().patch({ inspectOpen: false })}>
              Close
            </button>
          </header>
          <ul>
            {g.inspect.lines.map((ln) => (
              <li key={ln.label}>
                <span>{ln.label}</span>
                <strong>
                  {ln.value}
                  {ln.unit ? ` ${ln.unit}` : ""}
                </strong>
                <em>
                  {ln.source} · {Math.round(ln.confidence * 100)}%
                </em>
              </li>
            ))}
          </ul>
          {g.inspect.warning && <p className="gs-warn">{g.inspect.warning}</p>}
        </aside>
      )}

      {g.operateKind && g.snap && (
        <aside className="gs-machine">
          <p className="gs-kicker">{g.operateKind === "carrier" ? "Pendant · Carrier 07-A" : g.operateKind === "gate" ? "Gate G-07" : "Transfer frame"}</p>
          {g.operateKind === "carrier" && (
            <dl>
              <div>
                <dt>Height</dt>
                <dd>{g.snap.height_m.toFixed(2)} m</dd>
              </div>
              <div>
                <dt>Traverse</dt>
                <dd>{g.snap.lateral_m.toFixed(2)} m</dd>
              </div>
              <div>
                <dt>Brake</dt>
                <dd>{g.snap.brake ? "holding" : "open"}</dd>
              </div>
            </dl>
          )}
          {g.operateKind === "gate" && (
            <dl>
              <div>
                <dt>Pressure</dt>
                <dd>{g.snap.pressure_kpa.toFixed(0)} kPa</dd>
              </div>
              <div>
                <dt>Misalign</dt>
                <dd>{g.snap.misalign_mm.toFixed(1)} mm</dd>
              </div>
            </dl>
          )}
          {g.operateKind === "frame" && (
            <dl>
              <div>
                <dt>Deflect</dt>
                <dd>{g.snap.deflection_mm.toFixed(1)} mm</dd>
              </div>
              <div>
                <dt>Twist</dt>
                <dd>{g.snap.twist_deg.toFixed(2)}°</dd>
              </div>
              <div>
                <dt>Set</dt>
                <dd>{g.snap.set_mm.toFixed(1)} mm</dd>
              </div>
            </dl>
          )}
          <p className="gs-machine-hint">{operateHint(g.operateKind, g.touch)}</p>
        </aside>
      )}

      <footer className={`gs-bottom${g.touch ? " is-touch" : ""}`}>
        <div className="gs-context">
          {g.selectorOpen && g.choices.length > 1
            ? "Choose"
            : g.primary
              ? g.primary.prompt
              : g.look
                ? g.look.label
                : ""}
        </div>
      </footer>

      {g.selectorOpen && g.choices.length > 1 && (
        <div className="gs-selector" role="menu">
          {g.choices.map((c) => (
            <button
              key={c.id}
              type="button"
              role="menuitem"
              className={c.id === g.primary?.id ? "is-on" : ""}
              onClick={() => window.__game?.commitChoice(c.id)}
            >
              {c.verb} {c.noun}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export function OpeningOverlay({ onSkip }: { onSkip: () => void }) {
  const opening = useGame((s) => s.opening);
  const index = useGame((s) => s.openingIndex);
  if (!opening) return null;
  return (
    <button type="button" className="gs-opening" onClick={onSkip}>
      <div className="gs-opening-inner">
        <p className="gs-kicker">{opening.kicker}</p>
        <h2>{opening.title}</h2>
        <p>{opening.body}</p>
        <ol className="gs-opening-pips" aria-hidden="true">
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i} className={i === index ? "is-on" : i < index ? "is-done" : ""} />
          ))}
        </ol>
        <span className="gs-opening-skip">Take the deck</span>
      </div>
    </button>
  );
}
