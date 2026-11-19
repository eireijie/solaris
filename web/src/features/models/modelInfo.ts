import type { ModelInfo, ModelKey } from "./types";

/** Facts from models/NOTES.md and CONTRACT.md. Keep in sync with the model packages. */
export const MODEL_INFO: Record<ModelKey, ModelInfo> = {
  aeros: {
    name: "Aeros",
    version: "4.0",
    tagline: "Seasonal station temperature projection to 2100",
    status: "ported",
    summary:
      "Projects a station's winter and summer (D-J-F / J-J-A) mean temperature to 2100 from its own record: a stacked ensemble of four trend models plus an AR(1) residual simulator, with 200 bootstrap paths giving a 2.5–97.5% range for single seasons. Ported from the team's notebook; port and original agree to within 0.0001 °C on identical input.",
  },
  core: {
    name: "CORe",
    version: "4.0",
    tagline: "Global CO₂ historical-continuation pathway to 2100",
    status: "ported",
    summary:
      "Continues the observed global CO₂ record (RCMIP 1940–1978, NOAA GML from 1979) to 2100 with a validation-weighted ensemble of ten candidate growth models, adds log CO₂ forcing and a simple one-box forcing response estimate. Ported from the team's notebook with exact parity (620.86 ppm in 2100, 560.53–681.18). Not an IPCC emissions scenario.",
  },
  catalyst: {
    name: "Catalyst",
    version: "1.0",
    tagline: "What-if CO₂ scenarios on CORe physics",
    status: "new",
    summary:
      "New, simplified scenario engine: edit an emissions pathway (peak year, decline rate, net-zero year, carbon removal) or pick a concentration pathway, then follow it through a FaIR-style carbon cycle, CO₂ forcing and a one-box or two-layer temperature model, with AR6 ECS ranges as bands. Conditional what-if output, not a prediction or policy assessment.",
  },
  nexus: {
    name: "Nexus",
    version: "1.0",
    tagline: "Validation and context for Aeros",
    status: "new",
    summary:
      "New, simplified validation layer: a strict hindcast audit of Aeros (trained to 2000, scored on 2001 onward against naive baselines), 1940–1979 vs 1980–latest trend statistics with confidence intervals, and station-set statistics. It never alters Aeros output.",
  },
};
