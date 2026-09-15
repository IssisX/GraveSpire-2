import { useEffect, useRef, useState, type MutableRefObject, type PointerEvent } from "react";
import { TOOLS, useGame, type Tool } from "../store.ts";
import type { GameHandle } from "../runtime.ts";

export function Hud({
  booted,
  handleRef,
  phase,
}: {
  booted: boolean;
  handleRef: MutableRefObject<GameHandle | null>;
  phase: string;
}) {
  const g = useGame();
  const h = () => handleRef.current;

  return (
    <div className="gs-hud" aria-live="polite">
      {phase === "title" && (
        <Title booted={booted} touch={g.touch} onEnter={() => h()?.start()} onContinue={() => h()?.continueSave()} />
      )}
      {phase === "playing" && <PlayChrome touch={g.touch} />}
      {phase === "paused" && (
        <Pause onResume={() => h()?.resume()} onSave={() => h()?.save()} onLoad={() => h()?.load()} onEnd={() => h()?.endAct()} />
      )}
      {phase === "dialogue" && g.dialogue && (
        <Dialogue
          name={g.dialogue.name}
          role={g.dialogue.role}
          text={g.dialogue.text}
          options={g.dialogue.options}
          onPick={(id) => h()?.chooseDialogue(id)}
        />
      )}
      {phase === "dead" && (
        <Banner
          kicker="No support"
          title="The well is real"
          body="Death loads an explicit save. Nothing else is rewound."
          action="Load last snapshot"
          onAction={() => h()?.respawn()}
        />
      )}
      {phase === "ending" && g.ending && <Ending e={g.ending} onAgain={() => h()?.newGame()} />}
      {g.touch && phase === "playing" && <Touch handleRef={handleRef} />}
    </div>
  );
}

function Title({
  booted,
  touch,
  onEnter,
  onContinue,
}: {
  booted: boolean;
  touch: boolean;
  onEnter: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="gs-overlay gs-title">
      <div className="gs-title-inner">
        <p className="gs-kicker">Freight Spine · Act I</p>
        <h1 className="gs-wordmark">GRAVESPIRE</h1>
        <p className="gs-lede">
          You are a reclamation specialist dropped into an inhabited machine. Restore enough movement to reach the Circ Shop,
          recover or sacrifice one drive, and decide who keeps power. The building will not reset.
        </p>
        <ul className="gs-verbs">
          <li>Walk the bay. Offset loads twist the frame.</li>
          <li>Inspect with units. Operate with limits.</li>
          <li>Brace, jack, cut, isolate. Live with the path you made.</li>
        </ul>
        <div className="gs-actions">
          <button type="button" className="gs-btn gs-btn-primary" disabled={!booted} onClick={onEnter}>
            {booted ? "Enter Bay 07" : "Aligning authority…"}
          </button>
          <button type="button" className="gs-btn" disabled={!booted} onClick={onContinue}>
            Continue snapshot
          </button>
        </div>
        <p className="gs-controls-hint">
          {touch
            ? "Left thumb walk · right thumb look · Use on what you face. Fold open or closed — both work."
            : "WASD move · mouse look · E interact · Q tools · I inspect · R/F hoist · Esc pause"}
        </p>
      </div>
    </div>
  );
}

function PlayChrome({ touch }: { touch: boolean }) {
  const g = useGame();
  const setTool = (t: Tool) => window.__game?.setTool(t);
  return (
    <>
      <header className="gs-top">
        <div className="gs-chip">
          <span className="gs-chip-k">GRAVESPIRE</span>
          <span className="gs-chip-v">{g.snap?.districtShort ?? "FS-07"}</span>
          <span className="gs-chip-m">{g.snap?.district ?? "Freight Spine Bay 07"}</span>
        </div>
        {touch && g.snap && (
          <dl className="gs-strip gs-strip-top">
            <div>
              <dt>Tension</dt>
              <dd>{g.snap.tension_kn.toFixed(0)} kN</dd>
            </div>
            <div>
              <dt>Deflect</dt>
              <dd>{g.snap.deflection_mm.toFixed(1)} mm</dd>
            </div>
            <div>
              <dt>Set</dt>
              <dd>{g.snap.set_mm.toFixed(1)} mm</dd>
            </div>
            <div>
              <dt>Gate</dt>
              <dd>{g.snap.pressure_kpa.toFixed(0)} kPa</dd>
            </div>
            <div>
              <dt>Shop</dt>
              <dd>{g.snap.shop_v.toFixed(0)} V</dd>
            </div>
          </dl>
        )}
        <ol className="gs-obj">
          {g.objectives.map((o) => (
            <li key={o.id} className={o.done ? "is-done" : ""}>
              <span className="gs-obj-mark" />
              <span>{o.title}</span>
            </li>
          ))}
        </ol>
      </header>

      <div className="gs-cross" aria-hidden="true" />

      {g.look && (
        <div className="gs-look">
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

      <footer className={`gs-bottom${touch ? " is-touch" : ""}`}>
        {!touch && (
          <div className="gs-tool">
            <span className="gs-chip-k">Tool</span>
            <strong>{TOOLS.find((t) => t.id === g.tool)?.label}</strong>
            <span className="gs-chip-m">{TOOLS.find((t) => t.id === g.tool)?.hint}</span>
          </div>
        )}
        <div className="gs-context">
          {g.prompt ||
            (g.look ? `${touch ? "Use" : "E"}  ${g.look.label}` : "Observe → interpret → prepare → intervene")}
        </div>
        {!touch && g.snap && (
          <dl className="gs-strip">
            <div>
              <dt>Tension</dt>
              <dd>{g.snap.tension_kn.toFixed(0)} kN</dd>
            </div>
            <div>
              <dt>Deflect</dt>
              <dd>{g.snap.deflection_mm.toFixed(1)} mm</dd>
            </div>
            <div>
              <dt>Set</dt>
              <dd>{g.snap.set_mm.toFixed(1)} mm</dd>
            </div>
            <div>
              <dt>Gate</dt>
              <dd>{g.snap.pressure_kpa.toFixed(0)} kPa</dd>
            </div>
            <div>
              <dt>Shop</dt>
              <dd>{g.snap.shop_v.toFixed(0)} V</dd>
            </div>
          </dl>
        )}
      </footer>

      {g.toolWheel && !touch && (
        <div className="gs-wheel">
          {TOOLS.map((t, i) => (
            <button key={t.id} type="button" className={t.id === g.tool ? "is-on" : ""} onClick={() => setTool(t.id)}>
              <span>{i + 1}</span>
              {t.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function Pause({
  onResume,
  onSave,
  onLoad,
  onEnd,
}: {
  onResume: () => void;
  onSave: () => void;
  onLoad: () => void;
  onEnd: () => void;
}) {
  const g = useGame();
  return (
    <div className="gs-overlay">
      <div className="gs-panel">
        <p className="gs-kicker">Paused · authority still holds</p>
        <h2>Freight Spine</h2>
        <p className="gs-note">{g.modelClass}</p>
        <ul className="gs-obj gs-obj-block">
          {g.objectives.map((o) => (
            <li key={o.id} className={o.done ? "is-done" : ""}>
              <span className="gs-obj-mark" />
              <div>
                <strong>{o.title}</strong>
                <p>{o.note}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="gs-actions">
          <button type="button" className="gs-btn gs-btn-primary" onClick={onResume}>
            Resume
          </button>
          <button type="button" className="gs-btn" onClick={onSave}>
            Write snapshot
          </button>
          <button type="button" className="gs-btn" onClick={onLoad}>
            Load snapshot
          </button>
          <button type="button" className="gs-btn" onClick={onEnd}>
            Close Act I
          </button>
        </div>
      </div>
    </div>
  );
}

function Dialogue({
  name,
  role,
  text,
  options,
  onPick,
}: {
  name: string;
  role: string;
  text: string;
  options: { id: string; label: string }[];
  onPick: (id: string) => void;
}) {
  return (
    <div className="gs-overlay gs-overlay-soft">
      <div className="gs-panel gs-talk">
        <p className="gs-kicker">{role}</p>
        <h2>{name}</h2>
        <p className="gs-talk-body">{text}</p>
        <div className="gs-actions gs-actions-col">
          {options.map((o) => (
            <button key={o.id} type="button" className="gs-btn" onClick={() => onPick(o.id)}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Banner({
  kicker,
  title,
  body,
  action,
  onAction,
}: {
  kicker: string;
  title: string;
  body: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="gs-overlay">
      <div className="gs-panel">
        <p className="gs-kicker">{kicker}</p>
        <h2>{title}</h2>
        <p className="gs-lede">{body}</p>
        <button type="button" className="gs-btn gs-btn-primary" onClick={onAction}>
          {action}
        </button>
      </div>
    </div>
  );
}

function Ending({
  e,
  onAgain,
}: {
  e: { title: string; body: string; freight: string; power: string; people: string };
  onAgain: () => void;
}) {
  return (
    <div className="gs-overlay">
      <div className="gs-panel gs-end">
        <p className="gs-kicker">Act I closed</p>
        <h2>{e.title}</h2>
        <p className="gs-lede">{e.body}</p>
        <dl className="gs-end-grid">
          <div>
            <dt>Freight</dt>
            <dd>{e.freight}</dd>
          </div>
          <div>
            <dt>Power</dt>
            <dd>{e.power}</dd>
          </div>
          <div>
            <dt>People</dt>
            <dd>{e.people}</dd>
          </div>
        </dl>
        <p className="gs-note">The building was not restored for a cutscene.</p>
        <button type="button" className="gs-btn gs-btn-primary" onClick={onAgain}>
          Return to the well
        </button>
      </div>
    </div>
  );
}

function Touch({ handleRef }: { handleRef: MutableRefObject<GameHandle | null> }) {
  const g = useGame();
  const setTool = (t: Tool) => handleRef.current?.setTool(t);
  const lookId = g.look?.id ?? "";
  const carrier = lookId === "carrier" || lookId === "cable" || lookId === "dock";
  const gate = lookId === "gate";
  const frame = lookId === "frame" || lookId === "neck_brace";
  const showOps = g.tool === "operate";

  return (
    <div className="gs-touch">
      <TouchStage handleRef={handleRef} blocked={g.inspectOpen} />
      <button type="button" className="gs-pause-fab" onClick={() => handleRef.current?.pause()}>
        Pause
      </button>
      <div className="gs-tools-rail" role="toolbar" aria-label="Tools">
        {TOOLS.map((t) => (
          <button key={t.id} type="button" className={t.id === g.tool ? "is-on" : ""} onClick={() => setTool(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {showOps && (
        <div className="gs-ops">
          {carrier && (
            <>
              <Hold label="Raise" code="KeyR" handleRef={handleRef} />
              <Hold label="Lower" code="KeyF" handleRef={handleRef} />
              <Hold label="Left" code="KeyZ" handleRef={handleRef} />
              <Hold label="Right" code="KeyX" handleRef={handleRef} />
              <Hold label="Brake" code="KeyB" handleRef={handleRef} />
            </>
          )}
          {gate && (
            <>
              <Hold label="Open" code="KeyG" handleRef={handleRef} />
              <Hold label="Close" code="KeyT" handleRef={handleRef} />
              <Hold label="Vent" code="KeyV" handleRef={handleRef} />
            </>
          )}
          {frame && <Hold label="Jack" code="KeyR" handleRef={handleRef} />}
          {!carrier && !gate && !frame && <p className="gs-ops-hint">Face the carrier, gate, or frame.</p>}
        </div>
      )}
      <div className="gs-touch-actions">
        <Hold label="Sprint" code="ShiftLeft" handleRef={handleRef} />
        <Hold label="Jump" code="Space" handleRef={handleRef} />
        <button type="button" className="gs-use" onPointerUp={() => handleRef.current?.pulse("KeyE")}>
          Use
        </button>
        <button type="button" onPointerUp={() => handleRef.current?.inspectNow()}>
          Inspect
        </button>
      </div>
    </div>
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

type Pad = { ox: number; oy: number; x: number; y: number; mode: "move" | "look" };

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
      handleRef.current?.setTouchLook(0, 0);
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
      const nx = (look.x - look.ox) / 42;
      const ny = (look.y - look.oy) / 42;
      h?.setTouchLook(nx, ny);
    } else h?.setTouchLook(0, 0);
    setGhosts([...pads.current.values()]);
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
    pads.current.set(e.pointerId, { ox: x, oy: y, x, y, mode });
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
          className={`gs-ghost gs-ghost-${g.mode}`}
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
