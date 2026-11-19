import { Footer } from "../../components/ui";
import type { FooterColumn } from "../../components/ui";
import { demoUrl, platformUrl } from "../../lib/paths";
import { DATA_SOURCES } from "./content";
import { PRESENTED_AT } from "./team";

/** Footer with Solaris data sources and links. Wraps the foundation Footer (keeps the NASA SVS credit). */
export function SiteFooter({ inDemo = false }: { inDemo?: boolean }) {
  const columns: FooterColumn[] = [
    {
      title: "Platform",
      links: inDemo
        ? [
            { label: "Full platform", href: platformUrl("/") },
            { label: "Workspace", href: platformUrl("/app") },
            { label: "How to use Solaris", href: platformUrl("/guide") },
          ]
        : [
            { label: "Workspace", to: "/app" },
            { label: "How to use Solaris", to: "/guide" },
            { label: "Summit demo", href: demoUrl() },
          ],
    },
    { title: "Data sources", links: DATA_SOURCES.map((d) => ({ label: d.label, href: d.href })) },
  ];
  return (
    <Footer columns={columns}>
      <p className="site-footer__note">
        Station data: Solaris sample station set — NOAA GHCN-M v4 (adjusted), the station record NASA GISTEMP is built on.
      </p>
      <p className="site-footer__note">{PRESENTED_AT}.</p>
    </Footer>
  );
}
