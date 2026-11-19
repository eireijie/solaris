import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Button, Callout, Modal, Select } from "../../../components/ui";
import { deleteAllMyData, updateProfile } from "../../../lib/data";
import { useAuth } from "../../../features/auth";
import { friendlyAuthError, validatePassword } from "../../../features/auth/errors";
import { TextField } from "../../../features/site/TextField";
import { useToast } from "../../../features/site/toast";
import { IconLogout, IconUser } from "../../../features/site/icons";
import { useWorkspaceData } from "./WorkspaceData";

const ROLES = ["", "Researcher", "Educator", "Student", "Policymaker", "Journalist", "Other"];

export default function AccountPage() {
  const { status, user, profile, setProfile, openAuth, signOut, ensure, available } = useAuth();
  const toast = useToast();
  const { refresh } = useWorkspaceData();
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");
  const [role, setRole] = useState("");
  const [saving, setSaving] = useState(false);
  const [pw, setPw] = useState("");
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    document.title = "Account — Solaris workspace";
  }, []);

  useEffect(() => {
    setName(profile?.display_name ?? "");
    setOrg(profile?.organization ?? "");
    setRole(profile?.role ?? "");
  }, [profile]);

  if (!available || status === "unavailable") {
    return (
      <div className="ws-page">
        <Head />
        <Callout tone="info" title="Accounts unavailable in this build">
          This copy of Solaris was built without an account service. You can still run every model and export results.
        </Callout>
      </div>
    );
  }

  if (status !== "signedIn" || !user) {
    return (
      <div className="ws-page">
        <Head />
        <div className="ws-empty" data-testid="account-signed-out">
          <span className="ws-empty__icon" aria-hidden="true">
            <IconUser size={28} />
          </span>
          <h2>You’re exploring without an account</h2>
          <p>That’s fine — every model, dataset and export works. A free account adds saved runs and projects.</p>
          <div className="ws-empty__actions">
            <Button onClick={() => openAuth({ mode: "signup" })}>Create a free account</Button>
            <Button variant="secondary" onClick={() => openAuth({ mode: "signin" })} loading={status === "loading"}>
              Sign in
            </Button>
          </div>
        </div>
      </div>
    );
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const p = await updateProfile({ display_name: name, organization: org, role });
      setProfile(p);
      toast.push({ tone: "success", title: "Profile saved" });
    } catch (err) {
      toast.push({ tone: "danger", title: "Profile not saved", body: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    const err = validatePassword(pw, true);
    setPwErr(err);
    if (err) return;
    setPwBusy(true);
    try {
      const sb = await ensure();
      if (!sb) throw new Error("Accounts are unavailable.");
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) throw error;
      setPw("");
      toast.push({ tone: "success", title: "Password changed" });
    } catch (e2) {
      setPwErr(friendlyAuthError(e2));
    } finally {
      setPwBusy(false);
    }
  }

  async function wipe() {
    setDeleting(true);
    try {
      const r = await deleteAllMyData();
      toast.push({ tone: "success", title: "Your data was deleted", body: `${r.runs} run(s) and ${r.projects} project(s) removed.` });
      await refresh();
    } catch (e) {
      toast.push({ tone: "danger", title: "Delete failed", body: (e as Error).message });
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="ws-page ws-account" data-testid="account-page">
      <Head />
      <div className="ws-account__grid">
        <section className="ws-panel" aria-labelledby="profile-title">
          <h2 id="profile-title" className="ws-h2">
            Profile
          </h2>
          <p className="ws-muted ws-small">Signed in as {user.email}</p>
          <form className="site-form" onSubmit={saveProfile}>
            <TextField label="Display name" value={name} onChange={setName} autoComplete="name" maxLength={120} />
            <TextField label="School or organization" value={org} onChange={setOrg} autoComplete="organization" maxLength={160} optional />
            <Select label="Role" value={role} onChange={setRole} options={ROLES.map((r) => ({ value: r, label: r || "Prefer not to say" }))} />
            <div>
              <Button type="submit" loading={saving}>
                Save profile
              </Button>
            </div>
          </form>
        </section>

        <div className="ws-account__side">
          <section className="ws-panel" aria-labelledby="pw-title">
            <h2 id="pw-title" className="ws-h2">
              Password
            </h2>
            <form className="site-form" onSubmit={changePassword}>
              <TextField label="New password" type="password" reveal autoComplete="new-password" value={pw} onChange={setPw} error={pwErr} maxLength={72} hint="At least 8 characters, with a number or symbol." />
              <div>
                <Button type="submit" variant="secondary" loading={pwBusy}>
                  Change password
                </Button>
              </div>
            </form>
          </section>

          <section className="ws-panel" aria-labelledby="session-title">
            <h2 id="session-title" className="ws-h2">
              Session
            </h2>
            <Button variant="secondary" iconLeft={<IconLogout size={16} />} onClick={() => void signOut()} data-testid="sign-out">
              Sign out
            </Button>
          </section>

          <section className="ws-panel ws-panel--danger" aria-labelledby="danger-title">
            <h2 id="danger-title" className="ws-h2">
              Delete my data
            </h2>
            <p className="ws-muted ws-small">
              Permanently deletes every project and saved run in your account. Your sign-in remains; to remove the account itself,
              ask the Solaris team.
            </p>
            <Button variant="secondary" className="ws-danger-btn" onClick={() => setConfirmDelete(true)}>
              Delete all projects and runs
            </Button>
          </section>
        </div>
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        size="sm"
        title="Delete all your projects and runs?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button className="ws-danger-btn" loading={deleting} onClick={() => void wipe()}>
              Delete everything
            </Button>
          </>
        }
      >
        <p>This removes every project and saved run in your account. It can’t be undone. Export anything you want to keep first.</p>
      </Modal>
    </div>
  );
}

function Head() {
  return (
    <header className="ws-model__head">
      <p className="sol-eyebrow">Account</p>
      <h1 className="ws-title">Your account</h1>
    </header>
  );
}
