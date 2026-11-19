/**
 * Account state for the platform. Supabase is loaded lazily:
 *  - immediately only if this browser has a stored session or arrived from an account email link;
 *  - otherwise on first use (opening sign-in, saving a run).
 * Without VITE_SUPABASE_* env vars the status is "unavailable" and everything else still works.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { ACCOUNTS_CONFIGURED } from "../../lib/env";
import { cleanAuthParams, hasStoredSession, loadSupabase, urlHasAuthParams } from "../../lib/supabase";
import { getProfile } from "../../lib/data";
import type { Profile } from "../../lib/data";
import { useToast } from "../site/toast";
import { friendlyAuthError } from "./errors";
import { AuthDialog } from "./AuthDialog";
import type { AuthMode } from "./AuthDialog";

export type AuthStatus = "unavailable" | "signedOut" | "loading" | "signedIn";
export type AuthUser = { id: string; email: string | null };

export type OpenAuthOptions = {
  mode?: AuthMode;
  /** Shown above the form, e.g. "Sign in to save this run to a project." */
  reason?: string;
  /** Called once after a successful sign-in in this dialog. */
  onSuccess?: () => void;
};

type AuthCtx = {
  status: AuthStatus;
  available: boolean;
  user: AuthUser | null;
  profile: Profile | null;
  setProfile: (p: Profile | null) => void;
  openAuth: (opts?: OpenAuthOptions) => void;
  signOut: () => Promise<void>;
  /** Load the client (and subscribe to session changes). Resolves null when accounts are unavailable. */
  ensure: () => Promise<SupabaseClient | null>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used inside <AuthProvider>");
  return c;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [status, setStatus] = useState<AuthStatus>(ACCOUNTS_CONFIGURED ? "signedOut" : "unavailable");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; mode: AuthMode; reason?: string }>({ open: false, mode: "signin" });
  const successRef = useRef<(() => void) | null>(null);
  const initRef = useRef<Promise<SupabaseClient | null> | null>(null);
  const prevUser = useRef<string | null>(null);

  const applySession = useCallback((s: Session | null) => {
    const u = s?.user ? { id: s.user.id, email: s.user.email ?? null } : null;
    setUser((old) => (old?.id === u?.id && old?.email === u?.email ? old : u));
    setStatus(u ? "signedIn" : "signedOut");
  }, []);

  const ensure = useCallback((): Promise<SupabaseClient | null> => {
    if (!ACCOUNTS_CONFIGURED) return Promise.resolve(null);
    if (!initRef.current) {
      initRef.current = (async () => {
        const sb = await loadSupabase();
        if (!sb) return null;
        sb.auth.onAuthStateChange((event, session) => {
          // Keep this callback synchronous (supabase-js guidance): only update React state.
          applySession(session);
          if (event === "PASSWORD_RECOVERY") setDialog({ open: true, mode: "recovery" });
        });
        const { data } = await sb.auth.getSession();
        applySession(data.session);
        return sb;
      })().catch((e) => {
        initRef.current = null;
        throw e;
      });
    }
    return initRef.current;
  }, [applySession]);

  // Startup: only touch Supabase when there is a reason to.
  useEffect(() => {
    if (!ACCOUNTS_CONFIGURED) return;
    const fromLink = urlHasAuthParams();
    if (!hasStoredSession() && !fromLink) return;
    setStatus("loading");
    ensure()
      .then(async (sb) => {
        if (!fromLink || !sb) return;
        const q = new URLSearchParams(window.location.search);
        const kind = q.get("auth");
        const errDesc = q.get("error_description");
        const { data } = await sb.auth.getSession();
        if (errDesc) {
          toast.push({ tone: "danger", title: "That link didn’t work", body: friendlyAuthError({ code: q.get("error_code") ?? undefined, message: errDesc }) });
        } else if (kind === "recovery") {
          if (data.session) setDialog({ open: true, mode: "recovery" });
          else toast.push({ tone: "danger", title: "Reset link expired", body: "Request a new password reset email." });
        } else if (kind === "confirmed") {
          if (data.session) toast.push({ tone: "success", title: "Email confirmed", body: "You’re signed in. Runs you save will be kept in your account." });
          else {
            toast.push({ tone: "info", title: "Email confirmed", body: "Sign in to continue." });
            setDialog({ open: true, mode: "signin" });
          }
        }
        cleanAuthParams();
      })
      .catch(() => {
        setStatus("signedOut");
        toast.push({ tone: "danger", title: "Accounts are offline", body: "We couldn’t reach the account service. You can keep using every model." });
      });
  }, [ensure, toast]);

  // Load the profile for the signed-in user; fire pending success callbacks.
  useEffect(() => {
    const id = user?.id ?? null;
    if (id === prevUser.current) return;
    prevUser.current = id;
    if (!id) {
      setProfile(null);
      return;
    }
    getProfile()
      .then(setProfile)
      .catch(() => setProfile(null));
    const cb = successRef.current;
    successRef.current = null;
    if (cb) window.setTimeout(cb, 0);
  }, [user?.id]);

  const openAuth = useCallback(
    (opts: OpenAuthOptions = {}) => {
      successRef.current = opts.onSuccess ?? null;
      setDialog({ open: true, mode: opts.mode ?? "signin", reason: opts.reason });
      void ensure().catch(() => {});
    },
    [ensure],
  );

  const signOut = useCallback(async () => {
    const sb = await ensure().catch(() => null);
    if (!sb) return;
    const { error } = await sb.auth.signOut({ scope: "local" });
    if (error) {
      toast.push({ tone: "danger", title: "Sign-out failed", body: friendlyAuthError(error) });
      return;
    }
    applySession(null);
    toast.push({ tone: "info", title: "Signed out", body: "Your saved runs stay in your account." });
  }, [ensure, applySession, toast]);

  const value = useMemo<AuthCtx>(
    () => ({ status, available: ACCOUNTS_CONFIGURED, user, profile, setProfile, openAuth, signOut, ensure }),
    [status, user, profile, openAuth, signOut, ensure],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <AuthDialog
        open={dialog.open}
        mode={dialog.mode}
        reason={dialog.reason}
        onModeChange={(mode) => setDialog((d) => ({ ...d, mode, reason: mode === "signin" || mode === "signup" ? d.reason : undefined }))}
        onClose={() => {
          successRef.current = null;
          setDialog((d) => ({ ...d, open: false }));
        }}
        onSignedIn={() => setDialog((d) => ({ ...d, open: false }))}
      />
    </Ctx.Provider>
  );
}
