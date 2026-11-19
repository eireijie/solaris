/**
 * Lazy Supabase client. `@supabase/supabase-js` is a separate chunk that is only
 * downloaded when an account feature is actually used (a stored session exists,
 * an auth link was opened, or the user opens sign-in / saves a run).
 *
 * Only the public publishable key is used; row-level security protects every table.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ACCOUNTS_CONFIGURED, SUPABASE_KEY, SUPABASE_URL } from "./env";
import { KEYS, readStore } from "./storage";

let clientPromise: Promise<SupabaseClient | null> | null = null;

export function loadSupabase(): Promise<SupabaseClient | null> {
  if (!ACCOUNTS_CONFIGURED) return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = import("@supabase/supabase-js")
      .then(({ createClient }) =>
        createClient(SUPABASE_URL, SUPABASE_KEY, {
          auth: {
            // PKCE puts `?code=` in the query string, so it does not collide with the
            // HashRouter's `#/route` (the implicit flow would put tokens in the hash).
            flowType: "pkce",
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            storageKey: KEYS.authStorage,
          },
        }),
      )
      .catch((e) => {
        clientPromise = null;
        throw e;
      });
  }
  return clientPromise;
}

/** Cheap check (no download): is there a persisted session in this browser? */
export function hasStoredSession(): boolean {
  return readStore(KEYS.authStorage) != null;
}

/** Did the user arrive from an account email link (`?code=` / `?error=`)? */
export function urlHasAuthParams(): boolean {
  if (typeof window === "undefined") return false;
  const q = new URLSearchParams(window.location.search);
  return q.has("code") || q.has("error_description") || q.has("auth");
}

/** Remove auth query params after they were handled, keeping the hash route. */
export function cleanAuthParams(): void {
  const url = new URL(window.location.href);
  ["code", "error", "error_code", "error_description", "auth"].forEach((k) => url.searchParams.delete(k));
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}
