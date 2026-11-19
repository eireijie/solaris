/* Route-free dev harness for the model workbenches (owner: Workbench agent). */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles";
import { WorkbenchHarness } from "./features/models/dev/WorkbenchHarness";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WorkbenchHarness />
  </StrictMode>,
);
