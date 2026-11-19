import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button, Callout, Modal, Select, Skeleton } from "../../../components/ui";
import { downloadText } from "../../../data/csv";
import { exportRuns } from "../../../lib/data";
import type { Project, RunSummary } from "../../../lib/data";
import { useAuth } from "../../../features/auth";
import { MODEL_INFO } from "../../../features/models";
import { TextField } from "../../../features/site/TextField";
import { useToast } from "../../../features/site/toast";
import { IconDownload } from "../../../components/ui";
import { IconEdit, IconFolder, IconPlus, IconTrash } from "../../../features/site/icons";
import { useWorkspaceData } from "./WorkspaceData";
import { fullDate } from "./time";

const UNSORTED = "__unsorted";

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "project";
}

export default function ProjectsPage() {
  const { status, openAuth, available } = useAuth();
  const data = useWorkspaceData();
  const toast = useToast();
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [renameText, setRenameText] = useState("");
  const [confirm, setConfirm] = useState<{ kind: "project"; project: Project } | { kind: "run"; run: RunSummary } | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Projects — Solaris workspace";
  }, []);

  const groups = useMemo(() => {
    const by = new Map<string, RunSummary[]>();
    for (const r of data.runs) {
      const k = r.project_id ?? UNSORTED;
      by.set(k, [...(by.get(k) ?? []), r]);
    }
    return by;
  }, [data.runs]);

  if (status === "unavailable" || !available) {
    return (
      <div className="ws-page">
        <PageHead />
        <Callout tone="info" title="Accounts unavailable in this build">
          Projects need an account, and this copy of Solaris was built without one. Every model still runs, and every result can
          be exported from its workbench.
        </Callout>
      </div>
    );
  }

  if (status !== "signedIn") {
    return (
      <div className="ws-page">
        <PageHead />
        <div className="ws-empty" data-testid="projects-signed-out">
          <span className="ws-empty__icon" aria-hidden="true">
            <IconFolder size={28} />
          </span>
          <h2>Keep your runs between visits</h2>
          <p>
            Projects hold saved runs — inputs and results — so you can reopen them on any device. You don’t need an account to
            run or export anything; you only need one to save.
          </p>
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

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    const p = await data.createProject(newName);
    setCreating(false);
    if (p) setNewName("");
  }

  async function doExport(projectId: string | null, name: string) {
    const key = projectId ?? UNSORTED;
    setExporting(key);
    try {
      const rows = await exportRuns(projectId);
      const doc = {
        exported_at: new Date().toISOString(),
        project: name,
        note: "Solaris saved runs. Projections are conditional model outputs under stated assumptions, not verified predictions.",
        runs: rows,
      };
      downloadText(`solaris-${slug(name)}.json`, JSON.stringify(doc, null, 2), "application/json");
    } catch (e) {
      toast.push({ tone: "danger", title: "Export failed", body: (e as Error).message });
    } finally {
      setExporting(null);
    }
  }

  const projectOptions = [{ value: UNSORTED, label: "Unsorted runs" }, ...data.projects.filter((p) => !p.id.startsWith("temp-")).map((p) => ({ value: p.id, label: p.name }))];

  const runList = (runs: RunSummary[]) =>
    runs.length === 0 ? (
      <p className="ws-muted ws-proj__empty">No runs yet. Use “Save to project” in any workbench.</p>
    ) : (
      <ul className="ws-runs">
        {runs.map((r) => (
          <li key={r.id} className="ws-run">
            <span className={`ws-dot ws-dot--${r.model}`} aria-hidden="true" />
            <div className="ws-run__main">
              <Link to={`/app/${r.model}?run=${r.id}`} className="ws-run__label">
                {r.label ?? "Untitled run"}
              </Link>
              <span className="ws-run__meta">
                {MODEL_INFO[r.model].name} {r.model_version ?? MODEL_INFO[r.model].version} · {fullDate(r.created_at)}
              </span>
            </div>
            <div className="ws-run__actions">
              <Select
                label={`Move “${r.label ?? "run"}” to`}
                hideLabel
                value={r.project_id ?? UNSORTED}
                onChange={(v) => void data.moveRun(r.id, v === UNSORTED ? null : v)}
                options={projectOptions}
              />
              <Button size="sm" variant="secondary" to={`/app/${r.model}?run=${r.id}`}>
                Open
              </Button>
              <button type="button" className="ws-icon-btn" aria-label={`Delete run “${r.label ?? "Untitled run"}”`} onClick={() => setConfirm({ kind: "run", run: r })}>
                <IconTrash size={16} />
              </button>
            </div>
          </li>
        ))}
      </ul>
    );

  const unsorted = groups.get(UNSORTED) ?? [];

  return (
    <div className="ws-page" data-testid="projects-page">
      <PageHead />
      <form className="ws-newproj" onSubmit={create}>
        <TextField label="New project" placeholder="e.g. Urban vs rural winters" value={newName} onChange={setNewName} maxLength={120} />
        <Button type="submit" iconLeft={<IconPlus size={16} />} loading={creating} disabled={!newName.trim()}>
          Create
        </Button>
      </form>

      {data.error ? (
        <Callout tone="danger" title="Couldn’t load your projects">
          {data.error}{" "}
          <button type="button" className="ws-linkbtn" onClick={() => void data.refresh()}>
            Try again
          </button>
        </Callout>
      ) : null}

      {data.loading && !data.loaded ? (
        <div className="ws-proj-list">
          <Skeleton height={120} />
          <Skeleton height={120} />
        </div>
      ) : (
        <div className="ws-proj-list">
          {data.projects.length === 0 && data.runs.length === 0 && data.loaded ? (
            <p className="ws-muted">No projects yet. Create one above, or save a run from any workbench.</p>
          ) : null}
          {data.projects.map((p) => {
            const runs = groups.get(p.id) ?? [];
            return (
              <section key={p.id} className={`ws-proj ${p.id.startsWith("temp-") ? "is-pending" : ""}`} aria-labelledby={`proj-${p.id}`}>
                <header className="ws-proj__head">
                  <div>
                    <h2 id={`proj-${p.id}`} className="ws-proj__name">
                      {p.name}
                    </h2>
                    <p className="ws-proj__meta">
                      {runs.length} saved run{runs.length === 1 ? "" : "s"} · updated {fullDate(p.updated_at)}
                    </p>
                  </div>
                  <div className="ws-proj__actions">
                    <Button size="sm" variant="ghost" iconLeft={<IconDownload size={14} />} loading={exporting === p.id} onClick={() => void doExport(p.id, p.name)}>
                      Export JSON
                    </Button>
                    <button
                      type="button"
                      className="ws-icon-btn"
                      aria-label={`Rename project “${p.name}”`}
                      onClick={() => {
                        setRenaming(p);
                        setRenameText(p.name);
                      }}
                    >
                      <IconEdit size={16} />
                    </button>
                    <button type="button" className="ws-icon-btn" aria-label={`Delete project “${p.name}”`} onClick={() => setConfirm({ kind: "project", project: p })}>
                      <IconTrash size={16} />
                    </button>
                  </div>
                </header>
                {runList(runs)}
              </section>
            );
          })}
          {unsorted.length || data.projects.length ? (
            <section className="ws-proj ws-proj--unsorted" aria-labelledby="proj-unsorted">
              <header className="ws-proj__head">
                <div>
                  <h2 id="proj-unsorted" className="ws-proj__name">
                    Unsorted runs
                  </h2>
                  <p className="ws-proj__meta">Runs saved without a project</p>
                </div>
                {unsorted.length ? (
                  <div className="ws-proj__actions">
                    <Button size="sm" variant="ghost" iconLeft={<IconDownload size={14} />} loading={exporting === UNSORTED} onClick={() => void doExport(null, "unsorted runs")}>
                      Export JSON
                    </Button>
                  </div>
                ) : null}
              </header>
              {runList(unsorted)}
            </section>
          ) : null}
        </div>
      )}

      <Modal
        open={!!renaming}
        onClose={() => setRenaming(null)}
        size="sm"
        title="Rename project"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              disabled={!renameText.trim()}
              onClick={() => {
                if (renaming) void data.renameProject(renaming.id, renameText);
                setRenaming(null);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <TextField label="Project name" value={renameText} onChange={setRenameText} maxLength={120} autoFocus />
      </Modal>

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        size="sm"
        title={confirm?.kind === "project" ? "Delete this project?" : "Delete this run?"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              className="ws-danger-btn"
              onClick={() => {
                if (confirm?.kind === "project") void data.deleteProject(confirm.project.id);
                else if (confirm?.kind === "run") void data.deleteRun(confirm.run.id);
                setConfirm(null);
              }}
            >
              Delete permanently
            </Button>
          </>
        }
      >
        {confirm?.kind === "project" ? (
          <p>
            “{confirm.project.name}” and its {(groups.get(confirm.project.id) ?? []).length} saved run(s) will be deleted. This
            can’t be undone — export it first if you want a copy.
          </p>
        ) : confirm?.kind === "run" ? (
          <p>“{confirm.run.label ?? "Untitled run"}” will be deleted. This can’t be undone.</p>
        ) : null}
      </Modal>
    </div>
  );
}

function PageHead() {
  return (
    <header className="ws-model__head">
      <p className="sol-eyebrow">Projects</p>
      <h1 className="ws-title">Projects and saved runs</h1>
      <p className="ws-lede">Group saved runs into projects, reopen them without re-running, and export everything as JSON.</p>
    </header>
  );
}
