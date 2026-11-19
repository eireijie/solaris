import { Link } from "react-router-dom";
import { Badge, Button, IconArrowRight, ModelBadge } from "../../../components/ui";
import { useRuntimeStatus } from "../../../runtime";
import { fmtMs } from "../../../lib/format";
import { MODEL_INFO, RuntimeStatusPill } from "../../../features/models";
import { useAuth } from "../../../features/auth";
import { PreviewCharts } from "../../../features/site/PreviewCharts";
import { IconBook, IconDatabase, IconFolder } from "../../../features/site/icons";
import { useRecentRuns } from "./recentRuns";
import { useWorkspaceData } from "./WorkspaceData";
import { MODEL_ORDER, MODEL_ROUTES } from "./models";
import { timeAgo } from "./time";

export default function Overview() {
  const { status: auth, profile, user, openAuth, available } = useAuth();
  const rt = useRuntimeStatus();
  const recent = useRecentRuns();
  const { runs, projects, loading } = useWorkspaceData();
  const name = profile?.display_name?.split(" ")[0];

  return (
    <div className="ws-page ws-overview">
      <header className="ws-overview__head">
        <p className="sol-eyebrow">Workspace</p>
        <h1 className="ws-title ws-title--xl">{auth === "signedIn" ? `Welcome back${name ? `, ${name}` : ""}.` : "Start with a real station."}</h1>
        <p className="ws-lede">
          Run any model right here — Python executes on this device, nothing to install. Results are conditional model outputs;
          every chart shows its range and source.
        </p>
      </header>

      <section aria-labelledby="qs-title" className="ws-block">
        <h2 id="qs-title" className="ws-h2">
          Quick start
        </h2>
        <div className="ws-quick">
          {MODEL_ORDER.map((m) => (
            <Link key={m} to={`/app/${m}`} className={`ws-quick__card ws-quick__card--${m}`}>
              <span className="ws-quick__top">
                <ModelBadge model={m} />
                {MODEL_ROUTES[m].isNew ? <Badge tone="new">New</Badge> : null}
              </span>
              <span className="ws-quick__title">{MODEL_INFO[m].tagline}</span>
              <span className="ws-quick__go">
                Open <IconArrowRight size={14} />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <div className="ws-overview__grid">
        <section aria-labelledby="feat-title" className="ws-block ws-panel">
          <div className="ws-panel__head">
            <h2 id="feat-title" className="ws-h2">
              Featured result
            </h2>
            <Button to="/app/aeros?station=USW00013743" size="sm" variant="secondary" iconRight={<IconArrowRight size={14} />}>
              Open in Aeros
            </Button>
          </div>
          <PreviewCharts />
        </section>

        <div className="ws-overview__side">
          <section aria-labelledby="rt-title" className="ws-block ws-panel">
            <h2 id="rt-title" className="ws-h2">
              Model runtime
            </h2>
            <RuntimeStatusPill />
            <p className="ws-muted">
              {rt.state === "ready"
                ? `Python, numpy and scipy are loaded${rt.elapsedMs ? ` (took ${fmtMs(rt.elapsedMs)})` : ""}. Runs now take about a second.`
                : rt.state === "loading"
                  ? "Downloading a Python runtime with numpy and scipy into this tab. This happens once per visit."
                  : rt.state === "error"
                    ? "The runtime failed to load. Saved results still display; check your connection and reload to run models."
                    : "The Python runtime loads the first time you run a model — a download of a few tens of megabytes that your browser can cache."}
            </p>
          </section>

          <section aria-labelledby="recent-title" className="ws-block ws-panel">
            <h2 id="recent-title" className="ws-h2">
              Recent runs
            </h2>
            {recent.length === 0 && runs.length === 0 ? (
              <p className="ws-muted">{loading ? "Loading your saved runs…" : "Runs you make in this tab and runs you save will appear here."}</p>
            ) : (
              <ul className="ws-runlist">
                {recent.slice(0, 4).map((r) => (
                  <li key={r.id}>
                    <Link to={`/app/${r.run.model}?recent=${r.id}`}>
                      <span className={`ws-dot ws-dot--${r.run.model}`} aria-hidden="true" />
                      <span className="ws-runlist__label">{r.run.label}</span>
                      <span className="ws-runlist__meta">This tab · {timeAgo(r.at)}</span>
                    </Link>
                  </li>
                ))}
                {runs.slice(0, 5).map((r) => (
                  <li key={r.id}>
                    <Link to={`/app/${r.model}?run=${r.id}`}>
                      <span className={`ws-dot ws-dot--${r.model}`} aria-hidden="true" />
                      <span className="ws-runlist__label">{r.label ?? "Untitled run"}</span>
                      <span className="ws-runlist__meta">
                        Saved · {projects.find((p) => p.id === r.project_id)?.name ?? "Unsorted"} · {timeAgo(Date.parse(r.created_at))}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {auth !== "signedIn" && available ? (
              <p className="ws-muted ws-small">
                <button type="button" className="ws-linkbtn" onClick={() => openAuth({ mode: "signup" })}>
                  Create a free account
                </button>{" "}
                to keep runs between visits.
              </p>
            ) : null}
            {user && auth === "signedIn" ? (
              <Link to="/app/projects" className="ws-linkbtn ws-small">
                All projects →
              </Link>
            ) : null}
          </section>

          <section aria-label="More" className="ws-block ws-links">
            <Link to="/app/datasets">
              <IconDatabase size={18} /> Ready-to-use datasets
            </Link>
            <Link to="/app/projects">
              <IconFolder size={18} /> Projects and saved runs
            </Link>
            <Link to="/guide">
              <IconBook size={18} /> How to use Solaris
            </Link>
          </section>
        </div>
      </div>
    </div>
  );
}
