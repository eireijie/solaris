/**
 * Typed data layer for projects, saved runs and profiles (Supabase, owner-only RLS).
 * Every function throws a `DataError` with a friendly message; callers decide how to show it.
 * See supabase/schema.sql for the tables.
 */
import { loadSupabase } from "./supabase";

export type ModelKey = "aeros" | "core" | "catalyst" | "nexus";

export type Project = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

/** A run row without its (larger) payload/result — what lists show. */
export type RunSummary = {
  id: string;
  project_id: string | null;
  model: ModelKey;
  model_version: string | null;
  label: string | null;
  created_at: string;
};

export type RunRecord = RunSummary & { payload: unknown; result: unknown };

export type Profile = {
  id: string;
  display_name: string | null;
  organization: string | null;
  role: string | null;
};

export type RunToSave = {
  model: ModelKey;
  label: string;
  modelVersion?: string;
  payload: unknown;
  result: unknown;
};

export class DataError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "DataError";
  }
}

/** Saved rows are capped so the database stays small and lists stay fast. */
export const MAX_RUN_BYTES = 1_000_000;

/** Always dropped before saving: Monte-Carlo sample paths and per-cutoff diagnostic rows. */
const ALWAYS_STRIP = new Set(["sample_paths", "rolling_cv_rows"]);
/** Dropped from payloads: whole input bundles (re-loadable from the site's bundled data). */
const PAYLOAD_BUNDLES = new Set(["bundle", "stations_bundle", "co2_bundle"]);
/** Payload keys kept only while small (e.g. a user's uploaded station series). */
const PAYLOAD_LARGE_DATA = new Set(["data", "historical_co2"]);
const LARGE_DATA_BYTES = 200_000;

function strip(value: unknown, inPayload = false, depth = 0): unknown {
  if (Array.isArray(value)) return value.map((v) => strip(v, inPayload, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (ALWAYS_STRIP.has(k)) continue;
      if (inPayload && depth === 0 && PAYLOAD_BUNDLES.has(k)) continue;
      if (inPayload && depth === 0 && PAYLOAD_LARGE_DATA.has(k) && safeSize(v) > LARGE_DATA_BYTES) continue;
      out[k] = strip(v, inPayload, depth + 1);
    }
    return out;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

/**
 * Prepare a run for storage: drop sample paths and input data bundles, replace
 * NaN/Infinity with null, and enforce MAX_RUN_BYTES. Returns the cleaned run and its size.
 */
export function compactRun(run: RunToSave): { run: RunToSave; bytes: number; stripped: boolean } {
  const payload = strip(run.payload, true);
  const result = strip(run.result, false);
  const before = safeSize(run.payload) + safeSize(run.result);
  const bytes = safeSize(payload) + safeSize(result);
  if (bytes > MAX_RUN_BYTES) {
    throw new DataError(
      `This run is too large to save (${Math.round(bytes / 1000)} kB, limit ${MAX_RUN_BYTES / 1000} kB). Export it as JSON instead.`,
    );
  }
  return { run: { ...run, payload, result }, bytes, stripped: bytes < before };
}

function safeSize(v: unknown): number {
  try {
    return new Blob([JSON.stringify(v) ?? ""]).size;
  } catch {
    return 0;
  }
}

/* ------------------------------------------------------------------ helpers */

async function client() {
  let sb;
  try {
    sb = await loadSupabase();
  } catch (e) {
    throw new DataError("Could not load the account service. Check your connection and try again.", e);
  }
  if (!sb) throw new DataError("Accounts are unavailable in this build.");
  return sb;
}

function friendly(e: { message?: string; code?: string } | null | undefined, action: string): DataError {
  const msg = e?.message ?? "";
  if (/fetch|network|Failed to fetch|NetworkError/i.test(msg)) {
    return new DataError(`Could not ${action}: you appear to be offline. Try again when you are connected.`, e);
  }
  if (e?.code === "42501" || /row-level security|permission/i.test(msg)) {
    return new DataError(`Could not ${action}: your session may have expired. Sign in again.`, e);
  }
  if (e?.code === "23514") return new DataError(`Could not ${action}: a value is too long or empty.`, e);
  if (e?.code === "PGRST116") return new DataError(`Could not ${action}: it no longer exists.`, e);
  return new DataError(`Could not ${action}. ${msg ? `(${msg})` : "Please try again."}`, e);
}

async function userId(): Promise<string> {
  const sb = await client();
  const { data } = await sb.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new DataError("You need to be signed in to do that.");
  return id;
}

const RUN_SUMMARY_COLS = "id, project_id, model, model_version, label, created_at";

/* ------------------------------------------------------------------ projects */

export async function listProjects(): Promise<Project[]> {
  const sb = await client();
  const { data, error } = await sb
    .from("projects")
    .select("id, name, description, created_at, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw friendly(error, "load your projects");
  return (data ?? []) as Project[];
}

export function validateProjectName(name: string): string | null {
  const n = name.trim();
  if (!n) return "Give the project a name.";
  if (n.length > 120) return "Keep the name under 120 characters.";
  return null;
}

export async function createProject(name: string, description?: string): Promise<Project> {
  const err = validateProjectName(name);
  if (err) throw new DataError(err);
  const sb = await client();
  const owner = await userId();
  const { data, error } = await sb
    .from("projects")
    .insert({ name: name.trim(), description: description?.trim() || null, owner })
    .select("id, name, description, created_at, updated_at")
    .single();
  if (error) throw friendly(error, "create the project");
  return data as Project;
}

export async function renameProject(id: string, name: string): Promise<Project> {
  const err = validateProjectName(name);
  if (err) throw new DataError(err);
  const sb = await client();
  const { data, error } = await sb
    .from("projects")
    .update({ name: name.trim() })
    .eq("id", id)
    .select("id, name, description, created_at, updated_at")
    .single();
  if (error) throw friendly(error, "rename the project");
  return data as Project;
}

/** Deletes the project and (via ON DELETE CASCADE) every run saved in it. */
export async function deleteProject(id: string): Promise<void> {
  const sb = await client();
  const { error } = await sb.from("projects").delete().eq("id", id);
  if (error) throw friendly(error, "delete the project");
}

/* ------------------------------------------------------------------ runs */

export async function listRuns(): Promise<RunSummary[]> {
  const sb = await client();
  const { data, error } = await sb.from("runs").select(RUN_SUMMARY_COLS).order("created_at", { ascending: false }).limit(500);
  if (error) throw friendly(error, "load your saved runs");
  return (data ?? []) as RunSummary[];
}

export async function getRun(id: string): Promise<RunRecord> {
  const sb = await client();
  await userId(); // "sign in" message instead of a confusing "not found" when signed out
  const { data, error } = await sb.from("runs").select(`${RUN_SUMMARY_COLS}, payload, result`).eq("id", id).single();
  if (error) throw friendly(error, "open the saved run");
  return data as RunRecord;
}

export async function saveRun(run: RunToSave, projectId: string | null): Promise<RunSummary> {
  const { run: clean } = compactRun(run);
  const label = (clean.label || "Untitled run").trim().slice(0, 200);
  const sb = await client();
  const owner = await userId();
  const { data, error } = await sb
    .from("runs")
    .insert({
      owner,
      project_id: projectId,
      model: clean.model,
      model_version: clean.modelVersion ?? null,
      label,
      payload: clean.payload ?? {},
      result: clean.result ?? {},
    })
    .select(RUN_SUMMARY_COLS)
    .single();
  if (error) throw friendly(error, "save the run");
  return data as RunSummary;
}

export async function updateRun(id: string, patch: { label?: string; project_id?: string | null }): Promise<RunSummary> {
  const sb = await client();
  const body: Record<string, unknown> = {};
  if (patch.label !== undefined) body.label = patch.label.trim().slice(0, 200) || "Untitled run";
  if (patch.project_id !== undefined) body.project_id = patch.project_id;
  const { data, error } = await sb.from("runs").update(body).eq("id", id).select(RUN_SUMMARY_COLS).single();
  if (error) throw friendly(error, "update the run");
  return data as RunSummary;
}

export async function deleteRun(id: string): Promise<void> {
  const sb = await client();
  const { error } = await sb.from("runs").delete().eq("id", id);
  if (error) throw friendly(error, "delete the run");
}

/** Full export (payloads + results) of one project, or of unsorted runs when projectId is null. */
export async function exportRuns(projectId: string | null): Promise<RunRecord[]> {
  const sb = await client();
  let q = sb.from("runs").select(`${RUN_SUMMARY_COLS}, payload, result`).order("created_at", { ascending: true });
  q = projectId ? q.eq("project_id", projectId) : q.is("project_id", null);
  const { data, error } = await q;
  if (error) throw friendly(error, "export the runs");
  return (data ?? []) as RunRecord[];
}

/* ------------------------------------------------------------------ profile */

export async function getProfile(): Promise<Profile | null> {
  const sb = await client();
  const id = await userId();
  const { data, error } = await sb.from("profiles").select("id, display_name, organization, role").eq("id", id).maybeSingle();
  if (error) throw friendly(error, "load your profile");
  return (data as Profile | null) ?? null;
}

export async function updateProfile(p: { display_name: string; organization: string; role: string }): Promise<Profile> {
  const sb = await client();
  const id = await userId();
  const clean = {
    id,
    display_name: p.display_name.trim().slice(0, 120) || null,
    organization: p.organization.trim().slice(0, 160) || null,
    role: p.role.trim().slice(0, 60) || null,
  };
  // upsert: covers accounts created before the profile trigger existed.
  const { data, error } = await sb.from("profiles").upsert(clean).select("id, display_name, organization, role").single();
  if (error) throw friendly(error, "save your profile");
  return data as Profile;
}

/** Delete every run and project the signed-in user owns. The auth account itself remains. */
export async function deleteAllMyData(): Promise<{ runs: number; projects: number }> {
  const sb = await client();
  const owner = await userId();
  const r = await sb.from("runs").delete({ count: "exact" }).eq("owner", owner);
  if (r.error) throw friendly(r.error, "delete your runs");
  const p = await sb.from("projects").delete({ count: "exact" }).eq("owner", owner);
  if (p.error) throw friendly(p.error, "delete your projects");
  return { runs: r.count ?? 0, projects: p.count ?? 0 };
}
