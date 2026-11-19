import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Button, ModelBadge, Modal, Select } from "../../../components/ui";
import { compactRun } from "../../../lib/data";
import { TextField } from "../../../features/site/TextField";
import type { SavedRun } from "../../../features/models";
import { useWorkspaceData } from "./WorkspaceData";

const UNSORTED = "__unsorted";
const NEW = "__new";

export function SaveRunDialog({ run, onClose }: { run: SavedRun | null; onClose: () => void }) {
  const { projects, saveRun, createProject, loading } = useWorkspaceData();
  const [label, setLabel] = useState("");
  const [target, setTarget] = useState(UNSORTED);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!run) return;
    setLabel(run.label);
    setTarget(projects[0] && !projects[0].id.startsWith("temp-") ? projects[0].id : projects.length ? UNSORTED : NEW);
    setNewName(projects.length ? "" : "My first project");
    setError(null);
    setBusy(false);
    // Only when a new run arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  const size = useMemo(() => {
    if (!run) return null;
    try {
      return compactRun({ model: run.model, label: run.label, modelVersion: run.modelVersion, payload: run.payload, result: run.result });
    } catch (e) {
      return e as Error;
    }
  }, [run]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!run) return;
    if (size instanceof Error) {
      setError(size.message);
      return;
    }
    setBusy(true);
    setError(null);
    let projectId: string | null = target === UNSORTED ? null : target;
    if (target === NEW) {
      if (!newName.trim()) {
        setError("Give the new project a name.");
        setBusy(false);
        return;
      }
      const p = await createProject(newName);
      if (!p) {
        setBusy(false);
        return;
      }
      projectId = p.id;
    }
    const saved = await saveRun({ model: run.model, label: label.trim() || run.label, modelVersion: run.modelVersion, payload: run.payload, result: run.result }, projectId);
    setBusy(false);
    if (saved) onClose();
  }

  return (
    <Modal open={!!run} onClose={onClose} size="sm" title="Save run to a project" description="Saved runs keep their inputs and results, so you can reopen them later without re-running.">
      {run ? (
        <form className="site-form" onSubmit={submit} data-testid="save-run-dialog">
          <p className="ws-save__model">
            <ModelBadge model={run.model} />
          </p>
          <TextField label="Label" value={label} onChange={setLabel} maxLength={200} required />
          <Select
            label="Project"
            value={target}
            onChange={setTarget}
            options={[
              ...projects.filter((p) => !p.id.startsWith("temp-")).map((p) => ({ value: p.id, label: p.name })),
              { value: UNSORTED, label: "Unsorted runs" },
              { value: NEW, label: "New project…" },
            ]}
            hint={loading ? "Loading your projects…" : undefined}
          />
          {target === NEW ? <TextField label="New project name" value={newName} onChange={setNewName} maxLength={120} /> : null}
          {size && !(size instanceof Error) ? (
            <p className="ws-save__size">
              {Math.max(1, Math.round(size.bytes / 1000))} kB
              {size.stripped ? " · sample paths and bundled input data are not stored (they can be re-created from the inputs)" : ""}
            </p>
          ) : null}
          {error || size instanceof Error ? (
            <p className="site-form__error" role="alert">
              {error ?? (size as Error).message}
            </p>
          ) : null}
          <div className="ws-save__actions">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={size instanceof Error}>
              Save run
            </Button>
          </div>
        </form>
      ) : null}
    </Modal>
  );
}
