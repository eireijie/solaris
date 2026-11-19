import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "./styles";
import { DemoApp } from "./apps/demo/DemoApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <DemoApp />
    </HashRouter>
  </StrictMode>,
);
