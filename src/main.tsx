import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { warmup } from "./lib/warmup";
import Canvas from "./views/Canvas";

warmup();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Canvas />
  </StrictMode>
);
