import type { ModelKey } from "../../../features/models";

export const MODEL_ORDER: ModelKey[] = ["aeros", "nexus", "core", "catalyst"];

export const MODEL_ROUTES: Record<ModelKey, { label: string; isNew: boolean; intro: string }> = {
  aeros: {
    label: "Aeros 4.0",
    isNew: false,
    intro: "Pick a station or upload a CSV. Aeros projects its winter and summer means to 2100, with a 95% range from 200 bootstrap paths.",
  },
  nexus: {
    label: "Nexus 1.0",
    isNew: true,
    intro: "Would Aeros have got the recent past right? Nexus trains it on data up to a cut-off year and scores the years after against simple baselines.",
  },
  core: {
    label: "CORe 4.0",
    isNew: false,
    intro: "Continue the observed global CO₂ record to 2100 with a validation-weighted ensemble, then see the radiative forcing it implies.",
  },
  catalyst: {
    label: "Catalyst 1.0",
    isNew: true,
    intro: "Change an emissions or concentration pathway — peak year, decline rate, net zero, carbon removal — and compare the outcome with the baseline.",
  },
};
