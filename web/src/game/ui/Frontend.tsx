import type { MutableRefObject, ReactNode } from "react";
import { useGame } from "../store.ts";
import type { GameHandle } from "../runtime.ts";
import type { Settings } from "../settings.ts";

/* ------------------------------------------------------------------ boot --- */

export function Boot({ booted, onSkip }: { booted: boolean; onSkip: () => void }) {
  return (
    <div className="gs-overlay gs-boot" onPointerDown={onSkip}>
      <div className="gs-boot-inner">
        <h1 className="gs-wordmark">GRAVESPIRE</h1>
        <p className="gs-boot-sub">{booted ? "Freight Spine · Act I" : "Aligning authority…"}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- main menu --- */

export function MainMenu({
  handleRef,
  booted,
}: {
  handleRef: MutableRefObject<GameHandle | null>;
  booted: boolean;
}) {
  const hasSave = useGame((s) => s.hasSave);
  const touch = useGame((s) => s.touch);
  const h = () => handleRef.current;

  return (
    <div className="gs-overlay gs-menu">
      <div className="gs-menu-inner">
        <p className="gs-kicker">Freight Spine · Act I</p>
        <h1 className="gs-wordmark">GRAVESPIRE</h1>
        <p className="gs-lede">
          You are a reclamation specialist inside an inhabited machine. Restore enough movement to reach the Circ
          Shop, recover or sacrifice one drive, and decide who keeps power. The building will not reset.
        </p>
        <div className="gs-menu-actions">
          {hasSave && (
            <button type="button" className="gs-btn gs-btn-primary" disabled={!booted} onClick={() => h()?.continueSave()}>
              Continue
            </button>
          )}
          <button
            type="button"
            className={hasSave ? "gs-btn" : "gs-btn gs-btn-primary"}
            disabled={!booted}
            onClick={() => h()?.newGame()}
          >
            New game
          </button>
          <button type="button" className="gs-btn" disabled={!booted} onClick={() => h()?.openSettings()}>
            Settings
          </button>
        </div>
        <p className="gs-controls-hint">
          {touch
            ? "Left thumb walks. Right side looks. One Action button does what the world offers — hold it when there is more than one choice."
            : "WASD move · mouse look · E action (hold for choices) · I inspect · Esc pause"}
        </p>
        <p className="gs-note gs-menu-note">
          Act I runs on a declared reduced mechanical model in a WebView. It is not the Godot/C++ structural core on
          `main`, and it is not the GDD §16 acceptance table.
        </p>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- intro --- */

export function Intro({ onSkip }: { onSkip: () => void }) {
  const intro = useGame((s) => s.intro);
  const touch = useGame((s) => s.touch);
  if (!intro) return null;
  return (
    <div className="gs-intro">
      <div className="gs-intro-copy" key={intro.index}>
        <p className="gs-kicker">{intro.kicker}</p>
        <p className="gs-intro-text">{intro.text}</p>
      </div>
      <div className="gs-intro-dots" aria-hidden="true">
        {Array.from({ length: intro.total }, (_, i) => (
          <i key={i} className={i <= intro.index ? "is-on" : ""} />
        ))}
      </div>
      <button type="button" className="gs-skip" onClick={onSkip}>
        {touch ? "Skip" : "Skip · Esc"}
      </button>
    </div>
  );
}

/* ----------------------------------------------------------------- pause --- */

export function Pause({ handleRef }: { handleRef: MutableRefObject<GameHandle | null> }) {
  const objectives = useGame((s) => s.objectives);
  const modelClass = useGame((s) => s.modelClass);
  const hasSave = useGame((s) => s.hasSave);
  const h = () => handleRef.current;

  return (
    <div className="gs-overlay">
      <div className="gs-panel">
        <p className="gs-kicker">Paused · authority still holds</p>
        <h2>Freight Spine Bay 07</h2>
        <ul className="gs-obj gs-obj-block">
          {objectives.map((o) => (
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
          <button type="button" className="gs-btn gs-btn-primary" onClick={() => h()?.resume()}>
            Resume
          </button>
          <button type="button" className="gs-btn" onClick={() => h()?.save()}>
            Write snapshot
          </button>
          <button type="button" className="gs-btn" disabled={!hasSave} onClick={() => h()?.load()}>
            Load snapshot
          </button>
          <button type="button" className="gs-btn" onClick={() => h()?.openSettings()}>
            Settings
          </button>
          <button type="button" className="gs-btn" onClick={() => h()?.endAct()}>
            Close Act I
          </button>
          <button type="button" className="gs-btn" onClick={() => h()?.toMenu()}>
            Main menu
          </button>
        </div>
        <p className="gs-note">{modelClass}</p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- settings --- */

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="gs-set-row">
      <div className="gs-set-label">
        <strong>{label}</strong>
        {hint && <span>{hint}</span>}
      </div>
      <div className="gs-set-control">{children}</div>
    </div>
  );
}

function Slider({
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="gs-slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
      <b>{format(value)}</b>
    </label>
  );
}

function Toggle({ on, onChange, labels }: { on: boolean; onChange: (v: boolean) => void; labels?: [string, string] }) {
  const [off, onLabel] = labels ?? ["Off", "On"];
  return (
    <button type="button" className={`gs-toggle${on ? " is-on" : ""}`} onClick={() => onChange(!on)}>
      {on ? onLabel : off}
    </button>
  );
}

function Choice<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="gs-choice" role="group">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className={o.value === value ? "is-on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsScreen({ handleRef }: { handleRef: MutableRefObject<GameHandle | null> }) {
  const s = useGame((g) => g.settings);
  const h = () => handleRef.current;
  const set = (p: Partial<Settings>) => h()?.setSetting(p);

  return (
    <div className="gs-overlay">
      <div className="gs-panel gs-settings">
        <header className="gs-set-head">
          <div>
            <p className="gs-kicker">Settings</p>
            <h2>Controls, presentation, audio</h2>
          </div>
          <button type="button" className="gs-btn gs-btn-primary" onClick={() => h()?.closeSettings()}>
            Done
          </button>
        </header>

        <div className="gs-set-scroll">
          <section>
            <h3>Controls</h3>
            <Row label="Look sensitivity" hint="Mouse and gamepad">
              <Slider value={s.lookSensitivity} min={0.25} max={3} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => set({ lookSensitivity: v })} />
            </Row>
            <Row label="Touch look sensitivity" hint="Right-side drag">
              <Slider value={s.touchLookSensitivity} min={0.25} max={3} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => set({ touchLookSensitivity: v })} />
            </Row>
            <Row label="Invert Y">
              <Toggle on={s.invertY} onChange={(v) => set({ invertY: v })} />
            </Row>
            <Row label="Movement deadzone" hint="Thumbstick slack before you move">
              <Slider value={s.moveDeadzone} min={0.02} max={0.35} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ moveDeadzone: v })} />
            </Row>
            <Row label="Auto sprint" hint="Full stick deflection sprints">
              <Toggle on={s.autoSprint} onChange={(v) => set({ autoSprint: v })} />
            </Row>
          </section>

          <section>
            <h3>Presentation</h3>
            <Row label="Gait motion" hint="Procedural walking weight. 0 removes every camera offset.">
              <Slider value={s.gaitIntensity} min={0} max={1.5} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ gaitIntensity: v })} />
            </Row>
            <Row label="Field of view">
              <Slider value={s.fov} min={60} max={100} step={1} format={(v) => `${v.toFixed(0)}°`} onChange={(v) => set({ fov: v })} />
            </Row>
            <Row label="HUD density" hint="Full restores the engineering strip during traversal">
              <Choice
                value={s.hudDensity}
                options={[
                  { value: "sparse", label: "Sparse" },
                  { value: "full", label: "Full" },
                ]}
                onChange={(v) => set({ hudDensity: v })}
              />
            </Row>
            <Row label="Action prompt">
              <Choice
                value={s.promptMode}
                options={[
                  { value: "always", label: "Always" },
                  { value: "minimal", label: "Minimal" },
                ]}
                onChange={(v) => set({ promptMode: v })}
              />
            </Row>
          </section>

          <section>
            <h3>Graphics</h3>
            <p className="gs-note">
              Only controls this renderer actually implements are listed. There is no texture-resolution, reflection,
              volumetric, or post-processing setting here, because none of those systems exist in this build.
            </p>
            <Row label="Render scale" hint="Device pixel ratio cap">
              <Slider value={s.renderScale} min={0.5} max={1.6} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ renderScale: v })} />
            </Row>
            <Row label="Shadows" hint="Sun shadow map">
              <Toggle on={s.shadows} onChange={(v) => set({ shadows: v })} />
            </Row>
            <Row label="Shadow resolution">
              <Choice
                value={s.shadowResolution}
                options={[
                  { value: 512, label: "512" },
                  { value: 1024, label: "1024" },
                  { value: 2048, label: "2048" },
                ]}
                onChange={(v) => set({ shadowResolution: v })}
              />
            </Row>
            <Row label="Secondary lights" hint="Catwalk, gallery and shop fill fixtures">
              <Choice
                value={s.lightQuality}
                options={[
                  { value: "low", label: "Off" },
                  { value: "high", label: "On" },
                ]}
                onChange={(v) => set({ lightQuality: v })}
              />
            </Row>
            <Row label="Steam density" hint="Discharge particle budget">
              <Slider value={s.effectDensity} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ effectDensity: v })} />
            </Row>
          </section>

          <section>
            <h3>Audio</h3>
            <Row label="Master volume">
              <Slider value={s.masterVolume} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ masterVolume: v })} />
            </Row>
          </section>

          <div className="gs-actions">
            <button type="button" className="gs-btn" onClick={() => h()?.resetSettings()}>
              Restore defaults
            </button>
          </div>
          <p className="gs-note">
            Visual and control settings never change mechanical world truth: no option here alters load paths, machine
            capacity, failure, or which actions are legal.
          </p>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- dialogue --- */

export function Dialogue({ onPick }: { onPick: (id: string) => void }) {
  const d = useGame((s) => s.dialogue);
  if (!d) return null;
  return (
    <div className="gs-overlay gs-overlay-soft">
      <div className="gs-panel gs-talk">
        <p className="gs-kicker">{d.role}</p>
        <h2>{d.name}</h2>
        <p className="gs-talk-body">{d.text}</p>
        <div className="gs-actions gs-actions-col">
          {d.options.map((o) => (
            <button key={o.id} type="button" className="gs-btn" onClick={() => onPick(o.id)}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ dead --- */

export function Dead({ onLoad, onMenu }: { onLoad: () => void; onMenu: () => void }) {
  return (
    <div className="gs-overlay">
      <div className="gs-panel">
        <p className="gs-kicker">No support</p>
        <h2>The well is real</h2>
        <p className="gs-lede">Death loads an explicit save. Every coupled system returns to that state, not just you.</p>
        <div className="gs-actions">
          <button type="button" className="gs-btn gs-btn-primary" onClick={onLoad}>
            Load last snapshot
          </button>
          <button type="button" className="gs-btn" onClick={onMenu}>
            Main menu
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- ending --- */

export function Ending({ onAgain, onMenu }: { onAgain: () => void; onMenu: () => void }) {
  const e = useGame((s) => s.ending);
  if (!e) return null;
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
        <div className="gs-actions">
          <button type="button" className="gs-btn gs-btn-primary" onClick={onAgain}>
            Return to the well
          </button>
          <button type="button" className="gs-btn" onClick={onMenu}>
            Main menu
          </button>
        </div>
      </div>
    </div>
  );
}
