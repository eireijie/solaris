import type { JSX } from "react";

export type ModelKey = "aeros" | "core" | "catalyst" | "nexus";

export type SavedRun = {
  model: ModelKey;
  label: string;
  modelVersion?: string;
  payload: unknown;
  result: unknown;
};

export type WorkbenchProps = {
  /** Tighter layout for the one-page demo. */
  compact?: boolean;
  /** Restore a saved run (show result without re-running). */
  initialRun?: SavedRun;
  /** Fired after each successful run (payload without bulky data bundles). */
  onRunComplete?: (run: SavedRun) => void;
  /** If provided, show a "Save to project" button. */
  onSaveRequest?: (run: SavedRun) => void;
};

export type ModelInfo = {
  name: string;
  version: string;
  tagline: string;
  status: "ported" | "new";
  summary: string;
};

export type WorkbenchComponent<P = object> = (p: WorkbenchProps & P) => JSX.Element;
