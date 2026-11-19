/** Friendly messages for Supabase auth errors. Never echoes passwords. */
type AuthLikeError = { name?: string; code?: string; status?: number; message?: string } | null | undefined;

export function friendlyAuthError(e: unknown): string {
  const err = e as AuthLikeError;
  const code = err?.code ?? "";
  const msg = err?.message ?? "";
  const name = err?.name ?? "";

  if (name === "AuthRetryableFetchError" || /Failed to fetch|NetworkError|network|load failed/i.test(msg)) {
    return "We couldn’t reach the account service. Check your connection and try again.";
  }
  switch (code) {
    case "invalid_credentials":
      return "That email and password don’t match. Check both, or reset your password.";
    case "email_not_confirmed":
      return "Please confirm your email first — open the link we sent you, then sign in.";
    case "over_email_send_rate_limit":
      return "Too many emails were sent recently. Wait a few minutes and try again.";
    case "over_request_rate_limit":
      return "Too many attempts in a short time. Wait a minute and try again.";
    case "weak_password":
      return "That password is too easy to guess. Use at least 8 characters with a mix of letters, numbers or symbols.";
    case "user_already_exists":
    case "email_exists":
      return "An account with this email already exists. Sign in instead, or reset your password.";
    case "signup_disabled":
    case "email_provider_disabled":
      return "New sign-ups are turned off for this site right now. You can still use every model without an account.";
    case "email_address_invalid":
      return "That email address can’t be used. Please use a different one.";
    case "email_address_not_authorized":
      return "This site can’t send account emails to that address yet. You can still use every model without an account.";
    case "same_password":
      return "Choose a password different from your current one.";
    case "session_not_found":
    case "refresh_token_not_found":
      return "Your session has expired. Please sign in again.";
    case "flow_state_not_found":
    case "flow_state_expired":
    case "bad_code_verifier":
      return "This link was opened in a different browser or has expired. If you just confirmed your email, sign in to continue.";
    case "otp_expired":
      return "This email link has expired. Request a new one.";
  }
  if (err?.status === 429) return "Too many attempts. Wait a minute and try again.";
  if (/rate limit/i.test(msg)) return "Too many attempts. Wait a few minutes and try again.";
  if (/password/i.test(msg) && /(weak|short|least|characters)/i.test(msg)) {
    return "That password doesn’t meet the requirements. Use at least 8 characters with letters and numbers.";
  }
  return msg ? `Something went wrong: ${msg}` : "Something went wrong. Please try again.";
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateEmail(email: string): string | null {
  const e = email.trim();
  if (!e) return "Enter your email address.";
  if (e.length > 254 || !EMAIL_RE.test(e)) return "Enter a valid email address, like name@example.org.";
  return null;
}

export function validatePassword(pw: string, isNew: boolean): string | null {
  if (!pw) return "Enter a password.";
  if (!isNew) return null;
  if (pw.length < 8) return "Use at least 8 characters.";
  if (pw.length > 72) return "Use at most 72 characters.";
  if (!/[A-Za-z]/.test(pw) || !/[^A-Za-z]/.test(pw)) return "Mix letters with at least one number or symbol.";
  return null;
}
