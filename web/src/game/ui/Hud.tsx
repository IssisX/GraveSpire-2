import type { MutableRefObject } from "react";
import { useGame } from "../store.ts";
import type { GameHandle } from "../runtime.ts";
import { TitleFlow } from "./TitleFlow.tsx";
import { PlayHud, OpeningOverlay } from "./PlayHud.tsx";
import { TouchControls } from "./TouchControls.tsx";
import { SettingsPanel } from "./SettingsPanel.tsx";

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
        <TitleFlow booted={booted} onNew={() => h()?.start()} onContinue={() => h()?.continueSave()} />
      )}
      {phase === "opening" && <OpeningOverlay onSkip={() => h()?.skipOpening()} />}
      {phase === "playing" && <PlayHud />}
      {phase === "paused" && (
        <Pause
          onResume={() => h()?.resume()}
          onSave={() => h()?.save()}
          onLoad={() => h()?.load()}
          onEnd={() => h()?.endAct()}
        />
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
      {g.touch && phase === "playing" && <TouchControls handleRef={handleRef} />}
      {g.settingsOpen && phase !== "title" && (
        <div className="gs-overlay">
          <SettingsPanel onClose={() => useGame.getState().patch({ settingsOpen: false })} />
        </div>
      )}
    </div>
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
          <button type="button" className="gs-btn" onClick={() => useGame.getState().patch({ settingsOpen: true })}>
            Settings
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
