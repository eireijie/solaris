/**
 * Tiny shared store for "Open in Aeros" from the DatasetLibrary (within this feature).
 * AerosWorkbench instances subscribe and switch station when a request arrives.
 */
import { useEffect } from "react";

type Listener = (stationId: string) => void;
const listeners = new Set<Listener>();

export function requestOpenInAeros(stationId: string): boolean {
  listeners.forEach((l) => l(stationId));
  return listeners.size > 0;
}

export function useOpenInAeros(cb: Listener) {
  useEffect(() => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }, [cb]);
}
