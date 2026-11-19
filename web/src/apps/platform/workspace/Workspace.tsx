/**
 * Workspace shell (/app/*): sidebar on desktop, bottom tab bar on phones.
 * Everything works signed out; saving needs an account.
 */
import { lazy, Suspense, useEffect } from "react";
import type { ReactNode } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Badge, SolarisMark, Spinner } from "../../../components/ui";
import { KEYS, readStore } from "../../../lib/storage";
import { AccountButton } from "../../../features/auth";
import { RuntimeStatusPill } from "../../../features/models";
import { IconBook, IconDatabase, IconFolder, IconGrid, IconHelp, IconHome, IconUser } from "../../../features/site/icons";
import { useSiteUi } from "../SiteUi";
import { WorkspaceDataProvider } from "./WorkspaceData";
import { MODEL_ORDER, MODEL_ROUTES } from "./models";
import "./workspace.css";

const Overview = lazy(() => import("./Overview"));
const ModelPage = lazy(() => import("./ModelPage"));
const DatasetsPage = lazy(() => import("./DatasetsPage"));
const ProjectsPage = lazy(() => import("./ProjectsPage"));
const AccountPage = lazy(() => import("./AccountPage"));

function SideLink({ to, icon, children, end }: { to: string; icon: ReactNode; children: ReactNode; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `ws-side__link ${isActive ? "is-active" : ""}`}>
      <span className="ws-side__icon" aria-hidden="true">
        {icon}
      </span>
      <span>{children}</span>
    </NavLink>
  );
}

function ModelDot({ id }: { id: string }) {
  return <span className={`ws-dot ws-dot--${id}`} aria-hidden="true" />;
}

function TabLink({ to, icon, label, match }: { to: string; icon: ReactNode; label: string; match?: (p: string) => boolean }) {
  const { pathname } = useLocation();
  const active = match ? match(pathname) : pathname === to;
  return (
    <Link to={to} className={`ws-tab ${active ? "is-active" : ""}`} aria-current={active ? "page" : undefined}>
      <span aria-hidden="true">{icon}</span>
      <span className="ws-tab__label">{label}</span>
    </Link>
  );
}

export default function Workspace() {
  const { openWelcome } = useSiteUi();
  const { pathname } = useLocation();
  const lastModel = readStore(KEYS.lastModel) ?? "aeros";
  const isModel = MODEL_ORDER.some((m) => pathname.startsWith(`/app/${m}`));

  useEffect(() => {
    document.documentElement.classList.add("ws-root");
    return () => document.documentElement.classList.remove("ws-root");
  }, []);

  return (
    <WorkspaceDataProvider>
      <div className="ws">
        <aside className="ws-side" aria-label="Workspace">
          <div className="ws-side__brand">
            <SolarisMark compact to="/" size={28} />
            <Badge tone="neutral">Workspace</Badge>
          </div>
          <nav className="ws-side__nav" aria-label="Workspace sections">
            <SideLink to="/app" end icon={<IconHome size={18} />}>
              Overview
            </SideLink>
            <p className="ws-side__group">Models</p>
            {MODEL_ORDER.map((m) => (
              <SideLink key={m} to={`/app/${m}`} icon={<ModelDot id={m} />}>
                {MODEL_ROUTES[m].label}
                {MODEL_ROUTES[m].isNew ? <span className="ws-side__new">New</span> : null}
              </SideLink>
            ))}
            <p className="ws-side__group">Your work</p>
            <SideLink to="/app/datasets" icon={<IconDatabase size={18} />}>
              Datasets
            </SideLink>
            <SideLink to="/app/projects" icon={<IconFolder size={18} />}>
              Projects
            </SideLink>
            <SideLink to="/app/account" icon={<IconUser size={18} />}>
              Account
            </SideLink>
          </nav>
          <div className="ws-side__foot">
            <RuntimeStatusPill />
            <Link className="ws-side__small" to="/guide">
              <IconBook size={16} /> How to use Solaris
            </Link>
            <button type="button" className="ws-side__small" onClick={openWelcome}>
              <IconHelp size={16} /> About the team
            </button>
          </div>
        </aside>

        <div className="ws-main">
          <header className="ws-top">
            <div className="ws-top__brand">
              <SolarisMark compact to="/" size={26} />
            </div>
            <div className="ws-top__status">
              <RuntimeStatusPill />
            </div>
            <div className="ws-top__actions">
              <Link to="/guide" className="ws-icon-btn" aria-label="How to use Solaris" title="How to use Solaris">
                <IconBook size={18} />
              </Link>
              <button type="button" className="ws-icon-btn" onClick={openWelcome} aria-label="About Solaris and the team" title="About Solaris and the team" data-testid="help-button">
                <IconHelp size={18} />
              </button>
              <AccountButton />
            </div>
          </header>

          <main id="main" tabIndex={-1} className="ws-content">
            <Suspense
              fallback={
                <div className="ws-loading">
                  <Spinner label="Loading" />
                </div>
              }
            >
              <Routes>
                <Route index element={<Overview />} />
                <Route path="datasets" element={<DatasetsPage />} />
                <Route path="projects" element={<ProjectsPage />} />
                <Route path="account" element={<AccountPage />} />
                {MODEL_ORDER.map((m) => (
                  <Route key={m} path={m} element={<ModelPage model={m} />} />
                ))}
                <Route path="*" element={<Navigate to="/app" replace />} />
              </Routes>
            </Suspense>
          </main>
        </div>

        <nav className="ws-tabs" aria-label="Workspace">
          <TabLink to="/app" icon={<IconHome size={20} />} label="Overview" />
          <TabLink to={`/app/${isModel ? pathname.split("/")[2] : lastModel}`} icon={<IconGrid size={20} />} label="Models" match={() => isModel} />
          <TabLink to="/app/datasets" icon={<IconDatabase size={20} />} label="Datasets" />
          <TabLink to="/app/projects" icon={<IconFolder size={20} />} label="Projects" />
          <TabLink to="/app/account" icon={<IconUser size={20} />} label="Account" />
        </nav>
      </div>
    </WorkspaceDataProvider>
  );
}
