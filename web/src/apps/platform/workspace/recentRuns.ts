/**
 * Runs completed in this tab (not saved anywhere). Kept in memory only, so they survive
 * navigation between pages and disappear on reload.
 */
import { useSyncExternalStore } from "react";
import type { SavedRun } from "../../../features/models";

export type RecentRun = { id: string; at: number; run: SavedRun };

let items: RecentRun[] = [];
const subs = new Set<() => void>();
let seq = 0;

function emit() {
  subs.forEach((s) => s());
}

export function addRecentRun(run: SavedRun): RecentRun {
  // Collapse repeated runs of the same model + label (e.g. slider drags) into one entry.
  const prev = items.find((r) => r.run.model === run.model && r.run.label === run.label);
  const entry: RecentRun = { id: prev?.id ?? `r${Date.now().toString(36)}${(seq++).toString(36)}`, at: Date.now(), run };
  items = [entry, ...items.filter((r) => r.id !== entry.id)].slice(0, 12);
  emit();
  return entry;
}

export function getRecentRun(id: string): RecentRun | undefined {
  return items.find((r) => r.id === id);
}

export function useRecentRuns(): RecentRun[] {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => items,
    () => items,
  );
}
