import type { MutableRefObject } from "react";
import { useGame } from "../store.ts";
import type { GameHandle } from "../runtime.ts";
import { PlayHud } from "./PlayHud.tsx";
import { TouchControls } from "./TouchControls.tsx";
import { Boot, Dead, Dialogue, Ending, Intro, MainMenu, Pause, SettingsScreen } from "./Frontend.tsx";

/**
 * Phase router only. Each screen owns its own layout; this file exists so that
 * adding a screen never grows a single HUD component.
 */
export function Hud({
  booted,
  handleRef,
}: {
  booted: boolean;
  handleRef: MutableRefObject<GameHandle | null>;
}) {
  const phase = useGame((s) => s.phase);
  const touch = useGame((s) => s.touch);
  const h = () => handleRef.current;

  return (
    <div className="gs-hud" aria-live="polite">
      {phase === "boot" && <Boot booted={booted} onSkip={() => h()?.skipBoot()} />}
      {phase === "menu" && <MainMenu handleRef={handleRef} booted={booted} />}
      {phase === "intro" && <Intro onSkip={() => h()?.resume()} />}
      {phase === "settings" && <SettingsScreen handleRef={handleRef} />}
      {phase === "paused" && <Pause handleRef={handleRef} />}
      {phase === "dialogue" && <Dialogue onPick={(id) => h()?.chooseDialogue(id)} />}
      {phase === "dead" && <Dead onLoad={() => h()?.respawn()} onMenu={() => h()?.toMenu()} />}
      {phase === "ending" && <Ending onAgain={() => h()?.newGame()} onMenu={() => h()?.toMenu()} />}

      {phase === "playing" && <PlayHud handleRef={handleRef} />}
      {phase === "playing" && touch && <TouchControls handleRef={handleRef} />}
    </div>
  );
}
