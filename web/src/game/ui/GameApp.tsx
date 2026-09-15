import { useEffect, useRef, useState } from "react";
import { useGame } from "../store.ts";
import type { GameHandle } from "../runtime.ts";
import { Hud } from "./Hud.tsx";
import { detectTouch } from "../input.ts";

export function GameApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<GameHandle | null>(null);
  const [booted, setBooted] = useState(false);
  const phase = useGame((s) => s.phase);
  const touch = useGame((s) => s.touch);

  useEffect(() => {
    useGame.getState().patch({ touch: detectTouch() });
    const canvas = canvasRef.current;
    if (!canvas) return;
    let stopped = false;
    let handle: GameHandle | undefined;
    void import("../runtime.ts").then(({ mountGame }) => {
      if (stopped || !canvasRef.current) return;
      handle = mountGame(canvasRef.current);
      handleRef.current = handle;
      window.__game = handle;
      setBooted(true);
    });
    return () => {
      stopped = true;
      handle?.stop();
      handleRef.current = null;
    };
  }, []);

  return (
    <div className={touch ? "gs-root is-touch" : "gs-root"}>
      <canvas
        ref={canvasRef}
        className="gs-canvas"
        tabIndex={0}
        aria-label="GRAVESPIRE viewport"
      />
      <Hud booted={booted} handleRef={handleRef} phase={phase} />
    </div>
  );
}
