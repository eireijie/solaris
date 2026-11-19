/**
 * Platform app (entry: index.html, HashRouter). Routes:
 *   /                → Landing (Earth story + research, models, trust, roadmap, team)
 *   /guide           → How to use Solaris
 *   /app/*           → Workspace (lazy chunk): overview, model workbenches, datasets, projects, account
 *   /styleguide      → every UI component and chart with fake data
 *   /dev/runtime     → hidden Pyodide runtime self-test page
 * A welcome dialog (team + how to use) opens on the first visit and can be reopened from "About".
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Button, Header, IconArrowRight, Spinner } from "../../components/ui";
import type { NavItem } from "../../components/ui";
import { demoUrl } from "../../lib/paths";
import { KEYS, readStore, writeStore } from "../../lib/storage";
import { AccountButton, AuthProvider, useAuth } from "../../features/auth";
import { Landing } from "../../features/site/Landing";
import { SiteFooter } from "../../features/site/SiteFooter";
import { ToastProvider } from "../../features/site/toast";
import { WelcomeDialog } from "../../features/site/WelcomeDialog";
import { SiteUiCtx } from "./SiteUi";

const Styleguide = lazy(() => import("../shared/Styleguide"));
const RuntimeDevPage = lazy(() => import("../shared/RuntimeDevPage"));
const GuidePage = lazy(() => import("../../features/site/GuidePage"));
const Workspace = lazy(() => import("./workspace/Workspace"));

const NAV: NavItem[] = [
  { label: "Workspace", to: "/app" },
  { label: "Guide", to: "/guide" },
  { label: "Summit demo", href: demoUrl() },
];

const TITLES: Record<string, string> = {
  "/": "Solaris — Model the future. Test what changes it.",
  "/guide": "How to use Solaris",
};

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function DocumentTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (pathname.startsWith("/app")) return; // workspace sets its own titles
    document.title = TITLES[pathname] ?? "Solaris";
  }, [pathname]);
  return null;
}

const Fallback = () => (
  <div className="sol-container sol-section" style={{ display: "grid", placeItems: "center", minHeight: "60vh" }}>
    <Spinner label="Loading" />
  </div>
);

function Shell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { openAuth, available } = useAuth();
  const inWorkspace = pathname === "/app" || pathname.startsWith("/app/");
  const devRoute = pathname.startsWith("/dev") || pathname === "/styleguide";

  const [welcome, setWelcome] = useState(false);
  useEffect(() => {
    if (devRoute || pathname !== "/") return;
    if (readStore(KEYS.welcomeDismissed)) return;
    const id = window.setTimeout(() => setWelcome(true), 700);
    return () => window.clearTimeout(id);
    // Only on first mount: the dialog is a first-visit greeting, not per route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeWelcome = useCallback(() => {
    writeStore(KEYS.welcomeDismissed, new Date().toISOString());
    setWelcome(false);
  }, []);
  const ui = useMemo(() => ({ openWelcome: () => setWelcome(true) }), []);

  const routes = (
    <Suspense fallback={<Fallback />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/app/*" element={<Workspace />} />
        <Route path="/styleguide" element={<Styleguide />} />
        <Route path="/dev/runtime" element={<RuntimeDevPage />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </Suspense>
  );

  return (
    <SiteUiCtx.Provider value={ui}>
      <div className="sol-page">
        <a
          className="sol-skip-link"
          href="#main"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById("main")?.focus();
          }}
        >
          Skip to content
        </a>
        <ScrollToTop />
        <DocumentTitle />
        {inWorkspace ? (
          routes
        ) : (
          <>
            <Header
              overlay={pathname === "/"}
              nav={NAV}
              actions={
                <>
                  <Button size="sm" variant="ghost" onClick={() => setWelcome(true)} data-testid="about-button">
                    About
                  </Button>
                  <AccountButton />
                  <Button size="sm" to="/app" iconRight={<IconArrowRight size={14} />}>
                    Launch Solaris
                  </Button>
                </>
              }
            />
            <main id="main" tabIndex={-1}>
              {routes}
            </main>
            <SiteFooter />
          </>
        )}
      </div>
      <WelcomeDialog
        open={welcome}
        onClose={closeWelcome}
        accountsAvailable={available}
        onGuide={() => {
          closeWelcome();
          navigate("/guide");
        }}
        onCreateAccount={() => {
          closeWelcome();
          window.setTimeout(() => openAuth({ mode: "signup" }), 50);
        }}
      />
    </SiteUiCtx.Provider>
  );
}

export function PlatformApp() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </ToastProvider>
  );
}
