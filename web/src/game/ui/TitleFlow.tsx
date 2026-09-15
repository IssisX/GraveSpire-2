import { useEffect, useState } from "react";
import { useGame } from "../store.ts";
import { SettingsPanel } from "./SettingsPanel.tsx";

export function TitleFlow({
  booted,
  onNew,
  onContinue,
}: {
  booted: boolean;
  onNew: () => void;
  onContinue: () => void;
}) {
  const touch = useGame((s) => s.touch);
  const hasSave = useGame((s) => s.hasSave);
  const settingsOpen = useGame((s) => s.settingsOpen);
  const [splash, setSplash] = useState(true);

  useEffect(() => {
    const t = window.setTimeout(() => setSplash(false), 1500);
    return () => window.clearTimeout(t);
  }, []);

  if (splash) {
    return (
      <button type="button" className="gs-splash" onClick={() => setSplash(false)}>
        <p className="gs-kicker">Freight Spine · Act I</p>
        <h1 className="gs-wordmark">GRAVESPIRE</h1>
        <p className="gs-splash-sub">An inhabited machine</p>
      </button>
    );
  }

  return (
    <div className="gs-overlay gs-title">
      {settingsOpen ? (
        <SettingsPanel onClose={() => useGame.getState().patch({ settingsOpen: false })} />
      ) : (
        <div className="gs-title-inner">
          <p className="gs-kicker">Freight Spine · Act I</p>
          <h1 className="gs-wordmark">GRAVESPIRE</h1>
          <p className="gs-lede">
            You are a reclamation specialist. Bay 07 still has people in it. Offset freight is already in the transfer
            frame. The building will not reset.
          </p>
          <div className="gs-actions">
            <button type="button" className="gs-btn gs-btn-primary" disabled={!booted} onClick={onNew}>
              {booted ? "New Game" : "Aligning authority…"}
            </button>
            <button type="button" className="gs-btn" disabled={!booted || !hasSave} onClick={onContinue}>
              Continue
            </button>
            <button type="button" className="gs-btn" onClick={() => useGame.getState().patch({ settingsOpen: true })}>
              Settings
            </button>
          </div>
          <p className="gs-controls-hint">
            {touch
              ? "Left thumb walks. Right side looks. One Action on what you can reach."
              : "WASD move · mouse look · E action · hold E or Q to choose · Esc pause"}
          </p>
        </div>
      )}
    </div>
  );
}
