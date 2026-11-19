import { Link } from "react-router-dom";
import { Button, Spinner } from "../../components/ui";
import { useAuth } from "./AuthProvider";
import "./auth.css";

function initialsOf(name: string | null | undefined, email: string | null | undefined): string {
  const src = (name || email || "?").trim();
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (name && parts[1] ? parts[1][0] : "")).toUpperCase();
}

/** Header control: "Sign in" when signed out, an initials chip linking to Account when signed in. */
export function AccountButton({ size = "sm" }: { size?: "sm" | "md" }) {
  const { status, user, profile, openAuth } = useAuth();
  if (status === "unavailable") return null;
  if (status === "loading")
    return (
      <span className="auth-chip auth-chip--loading" aria-label="Checking your account">
        <Spinner size={14} label="" />
      </span>
    );
  if (status === "signedIn" && user)
    return (
      <Link to="/app/account" className="auth-chip" title={user.email ?? "Account"} aria-label={`Account: ${profile?.display_name || user.email}`}>
        <span className="auth-chip__avatar" aria-hidden="true">
          {initialsOf(profile?.display_name, user.email)}
        </span>
        <span className="auth-chip__name">{profile?.display_name || "Account"}</span>
      </Link>
    );
  return (
    <Button size={size} variant="ghost" onClick={() => openAuth({ mode: "signin" })} data-testid="sign-in-button">
      Sign in
    </Button>
  );
}
