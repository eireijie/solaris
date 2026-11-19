/**
 * Site copy and numbers in one place. Every number carries its source.
 * Poster numbers come from "Surface Air Temperature & Carbon Forecasting" (reference/poster.png);
 * model-run numbers come from models/NOTES.md (real runs of the code in this repo).
 * Never mix poster statistics and Solaris sample-set statistics in one figure without labels.
 */
import type { ModelId } from "../../components/ui";

export const POSTER_SOURCE = "Poster: Surface Air Temperature & Carbon Forecasting";
export const POSTER_SHORT = "Poster";

export const POSTER = {
  stations: 40,
  countries: "the United States and Argentina",
  periods: { early: "1940–1979", late: "1980–2026" },
  winter: { change: 0.189, ciLow: 0.085, ciHigh: 0.294, p: "p = 0.00071", increased: 29 },
  summer: { change: 0.211, ciLow: 0.132, ciHigh: 0.29, p: "p < 0.001", increased: 34 },
  rates1980: {
    us: { winter: 0.225, summer: 0.28 },
    argentina: { winter: 0.156, summer: 0.23 },
  },
  winterChangeByCountry: { us: 0.349, argentina: 0.03 },
  washington: { winter2100: 9.0, summer2100: 30.21 },
  co2: { mean2100: 620.86, low: 560.53, high: 681.18 },
  caveats: [
    "Long-range forecasts were treated as conditional model outputs rather than independently verified predictions of future climate.",
    "The long-range bounds have not been independently validated for nominal coverage.",
    "Confidence intervals assume independent stations and are not adjusted for spatial dependence or multiple comparisons.",
  ],
} as const;

export type ModelCopy = {
  id: ModelId;
  name: string;
  version: string;
  status: "ported" | "new";
  statusLabel: string;
  question: string;
  does: string;
  inputs: string;
  outputs: string;
  route: string;
};

export const MODELS: ModelCopy[] = [
  {
    id: "aeros",
    name: "Aeros",
    version: "4.0",
    status: "ported",
    statusLabel: "From the research notebook",
    question: "How might this station’s winters and summers change by 2100?",
    does:
      "An ensemble of trend models projects a station’s winter and summer means to 2100, with a 95% range from 200 bootstrap paths.",
    inputs: "A station’s seasonal record (bundled or your own CSV)",
    outputs: "Projection to 2100 · 95% range · trend slopes",
    route: "/app/aeros",
  },
  {
    id: "core",
    name: "CORe",
    version: "4.0",
    status: "ported",
    statusLabel: "From the research notebook",
    question: "Where does atmospheric CO₂ go if recent history continues?",
    does:
      "An ensemble of ten growth models continues the observed CO₂ record to 2100, then converts concentration to radiative forcing.",
    inputs: "Observed global CO₂ (NOAA GML, RCMIP before 1979)",
    outputs: "CO₂ pathway · backtest-based range · forcing",
    route: "/app/core",
  },
  {
    id: "catalyst",
    name: "Catalyst",
    version: "1.0",
    status: "new",
    statusLabel: "New · simplified",
    question: "What changes if emissions peak sooner, or fall faster?",
    does:
      "Edit an emissions pathway (peak year, decline rate, net zero, carbon removal) and follow it through a simple carbon cycle to CO₂, forcing and warming.",
    inputs: "SSP pathway, CORe pathway or your own edits",
    outputs: "Scenario CO₂ · forcing · warming vs baseline",
    route: "/app/catalyst",
  },
  {
    id: "nexus",
    name: "Nexus",
    version: "1.0",
    status: "new",
    statusLabel: "New · simplified",
    question: "Would Aeros have got the recent past right?",
    does:
      "A hindcast trains Aeros only on data up to 2000 and scores it on 2001 onward against simple baselines.",
    inputs: "An Aeros station and a cut-off year",
    outputs: "Hindcast errors · skill vs baselines · trend tests",
    route: "/app/nexus",
  },
];

export const AUDIENCES = [
  {
    title: "Researchers",
    text: "Inspect every step and export the numbers behind each chart.",
  },
  {
    title: "Educators",
    text: "Show a class how a projection is built, why it has a range, and how to check it against the past.",
  },
  {
    title: "Students",
    text: "Run real models on a real station in minutes, on a laptop or a phone, with nothing to install.",
  },
  {
    title: "Policymakers",
    text: "Compare emissions pathways side by side, with the assumptions and limits stated next to every result.",
  },
] as const;

export const TRUST = [
  {
    title: "The research code runs on your device",
    text:
      "The models are a Python package that runs in the browser. Aeros reproduces the research notebook within 0.0001 °C on identical input, and CORe reproduces it exactly.",
    source: "Parity tests, models/NOTES.md",
  },
  {
    title: "Open data",
    text:
      "Station records come from NOAA GHCN-M v4 (adjusted), and CO₂ from NOAA Global Monitoring Laboratory and RCMIP. Every file can be downloaded.",
    source: "Bundled datasets",
  },
  {
    title: "Hindcast testing",
    text:
      "Nexus retrains Aeros as if it were the year 2000 and scores its projection for 2001–2026 against simple baselines.",
    source: "Nexus 1.0",
  },
  {
    title: "Ranges on every result",
    text:
      "Every projection is shown with its range and a note on what kind of range it is.",
    source: "All models",
  },
] as const;

export const NOT_LIST = [
  {
    title: "Not a forecast",
    text: "Projections are conditional model outputs: what the method gives under its stated assumptions.",
  },
  {
    title: "Not an IPCC scenario",
    text: "CORe continues historical CO₂ growth. Aeros extrapolates a station’s own record and has no emissions input yet.",
  },
  {
    title: "Not yet peer reviewed",
    text: "Long-range intervals have not been checked for nominal coverage.",
  },
  {
    title: "Not an Earth-system model",
    text: "Catalyst and Nexus are simplified first versions, small enough to run on a phone.",
  },
] as const;

/** Honest finding from our own validation layer (models/NOTES.md, Nexus 1.0 on the Washington sample station). */
export const OWN_LIMITATION = {
  title: "Mixed hindcast skill so far",
  text:
    "On the Washington, D.C. sample station, Nexus finds Aeros about as accurate as simple baselines in winter and somewhat better in summer, with summer ranges that are too narrow at decade horizons.",
  source: "Nexus 1.0 hindcast, Solaris sample station set",
};

export const ROADMAP = [
  {
    title: "More stations, more continents",
    text: "Extend the 40-station study beyond the United States and Argentina, with paired urban–rural sites on every continent.",
  },
  {
    title: "Rolling-origin validation at scale",
    text: "Run Nexus hindcasts at many cut-off years for every station, and publish error and coverage tables alongside each projection.",
  },
  {
    title: "Emissions-conditioned local projections",
    text: "Link station projections to CORe and Catalyst pathways through pattern scaling, so a local result answers “under which emissions?”.",
  },
  {
    title: "Hosted compute and collaboration",
    text: "A hosted tier for large ensembles and many stations, plus shared projects for classes and research groups.",
  },
  {
    title: "Independent scientific review",
    text: "Commission an outside review of the methods and write up the station study for peer review.",
  },
] as const;

export const DATA_SOURCES = [
  { label: "NOAA GHCN-M v4 (adjusted) station records", href: "https://www.ncei.noaa.gov/products/land-based-station/global-historical-climatology-network-monthly" },
  { label: "NASA GISS — GISTEMP v4", href: "https://data.giss.nasa.gov/gistemp/" },
  { label: "NOAA GML — global CO₂", href: "https://gml.noaa.gov/ccgg/trends/" },
  { label: "RCMIP — SSP pathways", href: "https://www.rcmip.org/" },
];

export const CONDITIONAL_NOTE =
  "Projections are conditional model outputs under stated assumptions, not verified predictions of future climate.";
