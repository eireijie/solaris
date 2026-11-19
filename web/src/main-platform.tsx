import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "./styles";
import { PlatformApp } from "./apps/platform/PlatformApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <PlatformApp />
    </HashRouter>
  </StrictMode>,
);
