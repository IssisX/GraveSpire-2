import { useEffect, useState, type ReactNode } from "react";
import { getSettings, resetSettings, setSettings, type Settings } from "../settings.ts";

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<Settings>(getSettings);

  useEffect(() => {
    setS(getSettings());
  }, []);

  const patch = (p: Partial<Settings>) => setS(setSettings(p));

  return (
    <div className="gs-settings" role="dialog" aria-label="Settings">
      <header className="gs-settings-head">
        <p className="gs-kicker">Local only</p>
        <h2>Settings</h2>
        <button type="button" className="gs-text-btn" onClick={onClose}>
          Close
        </button>
      </header>

      <section>
        <h3>Controls</h3>
        <Row label="Look sensitivity" value={s.lookSensitivity.toFixed(2)}>
          <input
            type="range"
            min={0.4}
            max={2.4}
            step={0.05}
            value={s.lookSensitivity}
            onChange={(e) => patch({ lookSensitivity: Number(e.target.value) })}
          />
        </Row>
        <Toggle label="Invert Y" on={s.invertY} onChange={(v) => patch({ invertY: v })} />
        <Row label="Move deadzone" value={s.moveDeadzone.toFixed(2)}>
          <input
            type="range"
            min={0.04}
            max={0.32}
            step={0.01}
            value={s.moveDeadzone}
            onChange={(e) => patch({ moveDeadzone: Number(e.target.value) })}
          />
        </Row>
        <Toggle label="Auto-sprint at full stick" on={s.autoSprint} onChange={(v) => patch({ autoSprint: v })} />
        <Row label="Hold-to-select" value={`${s.promptHoldMs} ms`}>
          <input
            type="range"
            min={160}
            max={520}
            step={20}
            value={s.promptHoldMs}
            onChange={(e) => patch({ promptHoldMs: Number(e.target.value) })}
          />
        </Row>
      </section>

      <section>
        <h3>Presentation</h3>
        <Toggle label="Reduced motion" on={s.reducedMotion} onChange={(v) => patch({ reducedMotion: v })} />
        <Row label="Camera shake" value={s.shake.toFixed(2)}>
          <input type="range" min={0} max={1} step={0.05} value={s.shake} onChange={(e) => patch({ shake: Number(e.target.value) })} />
        </Row>
        <Row label="Master volume" value={s.masterVolume.toFixed(2)}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={s.masterVolume}
            onChange={(e) => patch({ masterVolume: Number(e.target.value) })}
          />
        </Row>
        <Row label="Field of view" value={`${s.fov}°`}>
          <input type="range" min={58} max={90} step={1} value={s.fov} onChange={(e) => patch({ fov: Number(e.target.value) })} />
        </Row>
      </section>

      <section>
        <h3>Picture</h3>
        <p className="gs-note">These change the renderer. They do not change the authority.</p>
        <Row label="Pixel ratio cap" value={s.pixelRatioCap.toFixed(2)}>
          <input
            type="range"
            min={0.7}
            max={2}
            step={0.05}
            value={s.pixelRatioCap}
            onChange={(e) => patch({ pixelRatioCap: Number(e.target.value) })}
          />
        </Row>
        <Row label="Shadows">
          <div className="gs-seg">
            {(["off", "low", "high"] as const).map((v) => (
              <button key={v} type="button" className={s.shadows === v ? "is-on" : ""} onClick={() => patch({ shadows: v })}>
                {v}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Dynamic lights">
          <div className="gs-seg">
            {(["low", "high"] as const).map((v) => (
              <button key={v} type="button" className={s.lightQuality === v ? "is-on" : ""} onClick={() => patch({ lightQuality: v })}>
                {v}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Steam density" value={s.steamDensity.toFixed(2)}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={s.steamDensity}
            onChange={(e) => patch({ steamDensity: Number(e.target.value) })}
          />
        </Row>
      </section>

      <div className="gs-actions">
        <button
          type="button"
          className="gs-btn"
          onClick={() => {
            setS(resetSettings());
          }}
        >
          Reset
        </button>
        <button type="button" className="gs-btn gs-btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children: ReactNode;
}) {
  return (
    <label className="gs-set-row">
      <span>
        {label}
        {value ? <em>{value}</em> : null}
      </span>
      {children}
    </label>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className={`gs-set-row gs-toggle${on ? " is-on" : ""}`} onClick={() => onChange(!on)}>
      <span>{label}</span>
      <i />
    </button>
  );
}
