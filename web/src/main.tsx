import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GameApp } from "./game/ui/GameApp.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GameApp />
  </StrictMode>,
);
