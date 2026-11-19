/**
 * Projects + saved runs for the signed-in user, with optimistic updates and rollback,
 * and the "save this run" flow (sign in first if needed, then pick a project).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import * as db from "../../../lib/data";
import type { Project, RunSummary, RunToSave } from "../../../lib/data";
import { useAuth } from "../../../features/auth";
import { useToast } from "../../../features/site/toast";
import type { SavedRun } from "../../../features/models";
import { SaveRunDialog } from "./SaveRunDialog";

type State = { projects: Project[]; runs: RunSummary[]; loading: boolean; loaded: boolean; error: string | null };

type Ctx = State & {
  refresh: () => Promise<void>;
  createProject: (name: string) => Promise<Project | null>;
  renameProject: (id: string, name: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  deleteRun: (id: string) => Promise<void>;
  moveRun: (id: string, projectId: string | null) => Promise<void>;
  renameRun: (id: string, label: string) => Promise<void>;
  saveRun: (run: RunToSave, projectId: string | null) => Promise<RunSummary | null>;
  /** Called by workbenches' "Save to project". Handles sign-in first when needed. */
  requestSave: (run: SavedRun) => void;
};

const WsCtx = createContext<Ctx | null>(null);

export function useWorkspaceData(): Ctx {
  const c = useContext(WsCtx);
  if (!c) throw new Error("useWorkspaceData must be used inside <WorkspaceDataProvider>");
  return c;
}

const EMPTY: State = { projects: [], runs: [], loading: false, loaded: false, error: null };
const tempId = () => `temp-${Math.random().toString(36).slice(2)}`;

export function WorkspaceDataProvider({ children }: { children: ReactNode }) {
  const { status, user, openAuth, available } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [state, setState] = useState<State>(EMPTY);
  const [pending, setPending] = useState<SavedRun | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const fail = useCallback((title: string, e: unknown) => {
    toast.push({ tone: "danger", title, body: e instanceof Error ? e.message : String(e) });
  }, [toast]);

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [projects, runs] = await Promise.all([db.listProjects(), db.listRuns()]);
      setState({ projects, runs, loading: false, loaded: true, error: null });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }));
    }
  }, []);

  useEffect(() => {
    if (status === "signedIn") void refresh();
    else if (status === "signedOut" || status === "unavailable") setState(EMPTY);
  }, [status, user?.id, refresh]);

  const createProject = useCallback(
    async (name: string) => {
      const err = db.validateProjectName(name);
      if (err) {
        toast.push({ tone: "danger", title: err });
        return null;
      }
      const now = new Date().toISOString();
      const temp: Project = { id: tempId(), name: name.trim(), description: null, created_at: now, updated_at: now };
      setState((s) => ({ ...s, projects: [temp, ...s.projects] }));
      try {
        const p = await db.createProject(name);
        setState((s) => ({ ...s, projects: s.projects.map((x) => (x.id === temp.id ? p : x)) }));
        return p;
      } catch (e) {
        setState((s) => ({ ...s, projects: s.projects.filter((x) => x.id !== temp.id) }));
        fail("Project not created", e);
        return null;
      }
    },
    [fail, toast],
  );

  const renameProject = useCallback(
    async (id: string, name: string) => {
      const before = stateRef.current.projects.find((p) => p.id === id);
      if (!before) return;
      setState((s) => ({ ...s, projects: s.projects.map((p) => (p.id === id ? { ...p, name: name.trim() } : p)) }));
      try {
        const p = await db.renameProject(id, name);
        setState((s) => ({ ...s, projects: s.projects.map((x) => (x.id === id ? p : x)) }));
      } catch (e) {
        setState((s) => ({ ...s, projects: s.projects.map((x) => (x.id === id ? before : x)) }));
        fail("Rename failed", e);
      }
    },
    [fail],
  );

  const deleteProject = useCallback(
    async (id: string) => {
      const snapshot = stateRef.current;
      setState((s) => ({ ...s, projects: s.projects.filter((p) => p.id !== id), runs: s.runs.filter((r) => r.project_id !== id) }));
      try {
        await db.deleteProject(id);
        toast.push({ tone: "success", title: "Project deleted" });
      } catch (e) {
        setState((s) => ({ ...s, projects: snapshot.projects, runs: snapshot.runs }));
        fail("Project not deleted", e);
      }
    },
    [fail, toast],
  );

  const deleteRun = useCallback(
    async (id: string) => {
      const before = stateRef.current.runs;
      setState((s) => ({ ...s, runs: s.runs.filter((r) => r.id !== id) }));
      try {
        await db.deleteRun(id);
      } catch (e) {
        setState((s) => ({ ...s, runs: before }));
        fail("Run not deleted", e);
      }
    },
    [fail],
  );

  const patchRun = useCallback(
    async (id: string, patch: { label?: string; project_id?: string | null }, what: string) => {
      const before = stateRef.current.runs.find((r) => r.id === id);
      if (!before) return;
      setState((s) => ({ ...s, runs: s.runs.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
      try {
        const r = await db.updateRun(id, patch);
        setState((s) => ({ ...s, runs: s.runs.map((x) => (x.id === id ? r : x)) }));
      } catch (e) {
        setState((s) => ({ ...s, runs: s.runs.map((x) => (x.id === id ? before : x)) }));
        fail(what, e);
      }
    },
    [fail],
  );

  const moveRun = useCallback((id: string, projectId: string | null) => patchRun(id, { project_id: projectId }, "Run not moved"), [patchRun]);
  const renameRun = useCallback((id: string, label: string) => patchRun(id, { label }, "Run not renamed"), [patchRun]);

  const saveRun = useCallback(
    async (run: RunToSave, projectId: string | null) => {
      try {
        const r = await db.saveRun(run, projectId);
        setState((s) => ({ ...s, runs: [r, ...s.runs] }));
        const project = stateRef.current.projects.find((p) => p.id === projectId);
        toast.push({
          tone: "success",
          title: "Run saved",
          body: project ? `Saved to “${project.name}”.` : "Saved to Unsorted runs.",
          action: { label: "View in Projects", onClick: () => navigate("/app/projects") },
        });
        return r;
      } catch (e) {
        fail("Run not saved", e);
        return null;
      }
    },
    [fail, toast, navigate],
  );

  const requestSave = useCallback(
    (run: SavedRun) => {
      if (!available) {
        toast.push({ tone: "info", title: "Accounts unavailable in this build", body: "Use Export to keep a copy of this run." });
        return;
      }
      if (status === "signedIn") {
        setPending(run);
        return;
      }
      openAuth({
        mode: "signin",
        reason: "Sign in or create a free account to save this run. It stays on screen in the meantime.",
        onSuccess: () => setPending(run),
      });
    },
    [available, status, openAuth, toast],
  );

  const value = useMemo<Ctx>(
    () => ({ ...state, refresh, createProject, renameProject, deleteProject, deleteRun, moveRun, renameRun, saveRun, requestSave }),
    [state, refresh, createProject, renameProject, deleteProject, deleteRun, moveRun, renameRun, saveRun, requestSave],
  );

  return (
    <WsCtx.Provider value={value}>
      {children}
      <SaveRunDialog run={pending} onClose={() => setPending(null)} />
    </WsCtx.Provider>
  );
}
