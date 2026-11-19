import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Button, Callout, Modal, SegmentedControl } from "../../components/ui";
import { publicSiteUrl } from "../../lib/env";
import { TextField } from "../site/TextField";
import { useAuth } from "./AuthProvider";
import { friendlyAuthError, validateEmail, validatePassword } from "./errors";
import "./auth.css";

export type AuthMode = "signin" | "signup" | "reset" | "recovery" | "inbox" | "reset-sent";

const TITLES: Record<AuthMode, string> = {
  signin: "Sign in to Solaris",
  signup: "Create your free account",
  reset: "Reset your password",
  recovery: "Choose a new password",
  inbox: "Check your inbox",
  "reset-sent": "Check your inbox",
};

export function AuthDialog({
  open,
  mode,
  reason,
  onModeChange,
  onClose,
  onSignedIn,
}: {
  open: boolean;
  mode: AuthMode;
  reason?: string;
  onModeChange: (m: AuthMode) => void;
  onClose: () => void;
  onSignedIn: () => void;
}) {
  const { ensure, available } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);

  // Reset transient state when the dialog opens or the mode changes. Never keep the password around.
  useEffect(() => {
    setPassword("");
    setErrors({});
    setFormError(null);
    setBusy(false);
  }, [open, mode]);

  useEffect(() => {
    if (open) window.setTimeout(() => firstField.current?.focus(), 60);
  }, [open, mode]);

  const redirect = (kind: "confirmed" | "recovery") => `${publicSiteUrl()}?auth=${kind}`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const errs: Record<string, string | null> = {};
    if (mode !== "recovery") errs.email = validateEmail(email);
    if (mode === "signin") errs.password = validatePassword(password, false);
    if (mode === "signup" || mode === "recovery") errs.password = validatePassword(password, true);
    if (mode === "signup" && name.trim().length > 120) errs.name = "Keep your name under 120 characters.";
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;

    setBusy(true);
    try {
      const sb = await ensure();
      if (!sb) {
        setFormError("Accounts are unavailable in this build.");
        return;
      }
      const em = email.trim().toLowerCase();
      if (mode === "signin") {
        const { error } = await sb.auth.signInWithPassword({ email: em, password });
        if (error) throw error;
        setPassword("");
        onSignedIn();
      } else if (mode === "signup") {
        const { data, error } = await sb.auth.signUp({
          email: em,
          password,
          options: {
            emailRedirectTo: redirect("confirmed"),
            data: { display_name: name.trim() || null, organization: org.trim() || null },
          },
        });
        if (error) throw error;
        setPassword("");
        if (data.session) onSignedIn();
        else onModeChange("inbox");
      } else if (mode === "reset") {
        const { error } = await sb.auth.resetPasswordForEmail(em, { redirectTo: redirect("recovery") });
        if (error) throw error;
        onModeChange("reset-sent");
      } else if (mode === "recovery") {
        const { error } = await sb.auth.updateUser({ password });
        if (error) throw error;
        setPassword("");
        onSignedIn();
      }
    } catch (err) {
      setFormError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  const isForm = mode === "signin" || mode === "signup" || mode === "reset" || mode === "recovery";

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={TITLES[mode]}
      description={
        mode === "signup"
          ? "Save runs to projects and come back to them on any device. Every model also works without an account."
          : mode === "signin"
            ? "Welcome back. Your projects and saved runs are private to you."
            : undefined
      }
    >
      <div className="auth-dialog" data-testid="auth-dialog" data-mode={mode}>
        {!available ? (
          <Callout tone="info" title="Accounts unavailable in this build">
            This copy of Solaris was built without an account service. You can still run every model and export results.
          </Callout>
        ) : null}

        {(mode === "signin" || mode === "signup") && available ? (
          <SegmentedControl
            label="Account"
            block
            value={mode}
            onChange={(v) => onModeChange(v)}
            options={[
              { value: "signin", label: "Sign in" },
              { value: "signup", label: "Create account" },
            ]}
          />
        ) : null}

        {reason && (mode === "signin" || mode === "signup") ? <p className="auth-dialog__reason">{reason}</p> : null}

        {isForm && available ? (
          <form className="site-form" onSubmit={submit} noValidate>
            {mode === "signup" ? (
              <TextField ref={firstField} label="Name" value={name} onChange={setName} autoComplete="name" optional error={errors.name} maxLength={120} />
            ) : null}
            {mode !== "recovery" ? (
              <TextField
                ref={mode === "signup" ? undefined : firstField}
                label="Email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={setEmail}
                error={errors.email}
                maxLength={254}
                required
              />
            ) : null}
            {mode === "signup" ? (
              <TextField label="School or organization" value={org} onChange={setOrg} autoComplete="organization" optional maxLength={160} />
            ) : null}
            {mode !== "reset" ? (
              <TextField
                ref={mode === "recovery" ? firstField : undefined}
                label={mode === "recovery" ? "New password" : "Password"}
                type="password"
                reveal
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={setPassword}
                error={errors.password}
                hint={mode === "signup" || mode === "recovery" ? "At least 8 characters, with a number or symbol." : undefined}
                maxLength={72}
                required
              />
            ) : null}
            {formError ? (
              <p className="site-form__error" role="alert">
                {formError}
              </p>
            ) : null}
            <Button type="submit" block loading={busy}>
              {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : mode === "reset" ? "Send reset link" : "Save new password"}
            </Button>
            {mode === "signin" ? (
              <button type="button" className="auth-dialog__link" onClick={() => onModeChange("reset")}>
                Forgot your password?
              </button>
            ) : null}
            {mode === "reset" ? (
              <button type="button" className="auth-dialog__link" onClick={() => onModeChange("signin")}>
                Back to sign in
              </button>
            ) : null}
            {mode === "signup" ? (
              <p className="auth-dialog__fine">
                We store your email, the profile details you enter, and the runs you choose to save — nothing else. Runs you
                don’t save never leave your browser.
              </p>
            ) : null}
          </form>
        ) : null}

        {mode === "inbox" || mode === "reset-sent" ? (
          <div className="auth-dialog__sent" data-testid="auth-check-inbox">
            <div className="auth-dialog__envelope" aria-hidden="true">
              <svg viewBox="0 0 64 48" width="64" height="48">
                <rect x="2" y="2" width="60" height="44" rx="6" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M4 6l28 22L60 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              </svg>
            </div>
            <p>
              {mode === "inbox" ? (
                <>
                  If <strong>{email.trim() || "your address"}</strong> can be registered, we’ve sent a confirmation link to it.
                  Open it on this device to finish creating your account.
                </>
              ) : (
                <>
                  If an account exists for <strong>{email.trim()}</strong>, a password reset link is on its way.
                </>
              )}
            </p>
            <p className="auth-dialog__fine">
              No email after a few minutes? Check spam, or try again later — the account service limits how many emails it
              sends per hour. Meanwhile, everything in Solaris works without an account.
            </p>
            <Button variant="secondary" block onClick={onClose}>
              Keep exploring
            </Button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
