import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button, Callout, Skeleton } from "../../../components/ui";
import { getRun } from "../../../lib/data";
import { KEYS, writeStore } from "../../../lib/storage";
import { AerosWorkbench, CatalystWorkbench, CoreWorkbench, MODEL_INFO, NexusWorkbench } from "../../../features/models";
import type { ModelKey, SavedRun } from "../../../features/models";
import { useAuth } from "../../../features/auth";
import { addRecentRun, getRecentRun } from "./recentRuns";
import { useWorkspaceData } from "./WorkspaceData";
import { MODEL_ORDER, MODEL_ROUTES } from "./models";

type Loaded = { key: string; run?: SavedRun; source?: "saved" | "recent"; error?: string; loading?: boolean };

export default function ModelPage({ model }: { model: ModelKey }) {
  const info = MODEL_INFO[model];
  const [params, setParams] = useSearchParams();
  const runId = params.get("run");
  const recentId = params.get("recent");
  const station = params.get("station") ?? undefined;
  const { requestSave } = useWorkspaceData();
  const { status, ensure } = useAuth();
  const [loaded, setLoaded] = useState<Loaded>({ key: "fresh" });

  useEffect(() => {
    writeStore(KEYS.lastModel, model);
    document.title = `${info.name} ${info.version} — Solaris workspace`;
  }, [model, info]);

  useEffect(() => {
    if (recentId) {
      const r = getRecentRun(recentId);
      setLoaded(r ? { key: `recent-${recentId}`, run: r.run, source: "recent" } : { key: "fresh", error: "That unsaved run is no longer in memory — runs that are not saved disappear when the page reloads." });
      return;
    }
    if (!runId) {
      setLoaded({ key: "fresh" });
      return;
    }
    let live = true;
    setLoaded({ key: `saved-${runId}`, loading: true });
    // Make sure the auth client is loaded (direct links to saved runs).
    ensure()
      .then(() => getRun(runId))
      .then((r) => {
        if (!live) return;
        if (r.model !== model) {
          setLoaded({ key: "fresh", error: `That saved run belongs to ${MODEL_INFO[r.model].name}.` });
          return;
        }
        setLoaded({
          key: `saved-${runId}`,
          source: "saved",
          run: { model: r.model, label: r.label ?? "Saved run", modelVersion: r.model_version ?? undefined, payload: r.payload, result: r.result },
        });
      })
      .catch((e: Error) => live && setLoaded({ key: "fresh", error: e.message }));
    return () => {
      live = false;
    };
  }, [runId, recentId, model, ensure, status]);

  const onRunComplete = useCallback((run: SavedRun) => {
    addRecentRun(run);
  }, []);

  const clearRun = () => {
    const next = new URLSearchParams(params);
    next.delete("run");
    next.delete("recent");
    setParams(next, { replace: true });
  };

  const props = { initialRun: loaded.run, onRunComplete, onSaveRequest: requestSave };
  const workbench =
    model === "aeros" ? (
      <AerosWorkbench key={loaded.key} {...props} initialStationId={station} />
    ) : model === "nexus" ? (
      <NexusWorkbench key={loaded.key} {...props} initialStationId={station} />
    ) : model === "core" ? (
      <CoreWorkbench key={loaded.key} {...props} catalystHref="#/app/catalyst" />
    ) : (
      <CatalystWorkbench key={loaded.key} {...props} />
    );

  return (
    <div className="ws-page ws-model" data-model={model}>
      <nav className="ws-switch" aria-label="Models">
        {MODEL_ORDER.map((m) => (
          <Link key={m} to={`/app/${m}`} className={`ws-switch__item ${m === model ? "is-active" : ""}`} aria-current={m === model ? "page" : undefined}>
            <span className={`ws-dot ws-dot--${m}`} aria-hidden="true" />
            {MODEL_ROUTES[m].label}
          </Link>
        ))}
      </nav>

      {loaded.error ? (
        <Callout tone="warning" title="Couldn’t open that run">
          {loaded.error}
        </Callout>
      ) : null}
      {loaded.run ? (
        <div className="ws-restored" role="status">
          <span>
            Showing {loaded.source === "saved" ? "saved" : "unsaved"} run <strong>“{loaded.run.label}”</strong>
          </span>
          <Button size="sm" variant="secondary" onClick={clearRun}>
            Start a new run
          </Button>
        </div>
      ) : null}

      <section className="ws-bench" aria-label={`${info.name} workbench`}>
        {loaded.loading ? <Skeleton height={520} /> : workbench}
      </section>

    </div>
  );
}
