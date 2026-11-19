/** localStorage / sessionStorage that never throws (private mode, blocked storage, SSR). */
function store(kind: "local" | "session"): Storage | null {
  try {
    return typeof window === "undefined" ? null : kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readStore(key: string, kind: "local" | "session" = "local"): string | null {
  try {
    return store(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStore(key: string, value: string | null, kind: "local" | "session" = "local"): void {
  try {
    const s = store(kind);
    if (!s) return;
    if (value == null) s.removeItem(key);
    else s.setItem(key, value);
  } catch {
    /* quota or blocked — non-essential */
  }
}

export function readJson<T>(key: string, fallback: T, kind: "local" | "session" = "local"): T {
  const raw = readStore(key, kind);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown, kind: "local" | "session" = "local"): void {
  writeStore(key, JSON.stringify(value), kind);
}

export const KEYS = {
  welcomeDismissed: "solaris.welcome.v1",
  recentRuns: "solaris.recent-runs.v1",
  lastModel: "solaris.last-model.v1",
  authStorage: "solaris-auth",
} as const;
