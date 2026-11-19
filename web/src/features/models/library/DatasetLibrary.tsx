/**
 * Dataset library: browse the 45 bundled stations, download per-station CSVs, the full zip,
 * the input template and the formatting guide; "Open in Aeros".
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";
import { Badge, Button, Callout, IconDownload, IconExternal, Select, Skeleton } from "../../../components/ui";
import { Sparkline } from "../../../components/charts";
import type { SeasonKey, Station } from "../../../data";
import { publicUrl } from "../../../lib/paths";
import { classLabel, GROUP_ORDER, STATION_PROVENANCE, stationGroup, useAvailability, useStationsBundle } from "../lib/bundles";
import { capital } from "../lib/fmt";
import { requestOpenInAeros } from "../lib/selection";
import { ClassBadge } from "../components/StationPicker";
import { Disclosure } from "../components/common";
import "../models.css";

function kb(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`;
}

function Spark({ s, season }: { s: Station; season: SeasonKey }) {
  const data = s.series.years.map((x, i) => ({ x, y: s.series[season][i] }));
  const local = s.local_season?.[season];
  return (
    <div className="wb-spark">
      <span>
        {capital(local)} ({season}) · {s.valid_counts?.[season] ?? "—"} yrs
      </span>
      <Sparkline data={data} width={140} height={30} showLast={false} color={local === "winter" ? "var(--sol-data-2)" : "var(--sol-data-1)"} />
    </div>
  );
}

export function DatasetLibrary({ compact, onOpenInAeros }: { compact?: boolean; onOpenInAeros?: (stationId: string) => void }): JSX.Element {
  const bundle = useStationsBundle();
  const avail = useAvailability();
  const [group, setGroup] = useState("all");
  const [cls, setCls] = useState("all");
  const [q, setQ] = useState("");
  const [opened, setOpened] = useState<string | null>(null);
  const stations = bundle.data?.stations ?? [];
  const byId = useMemo(() => new Map(stations.map((s) => [s.id, s])), [stations]);

  const filtered = useMemo(() => {
    const nq = q.trim().toLowerCase();
    return stations.filter(
      (s) =>
        (group === "all" || stationGroup(s) === group) &&
        (cls === "all" || s.urban_rural === cls) &&
        (!nq || `${s.display_name} ${s.id} ${s.country} ${s.region ?? ""}`.toLowerCase().includes(nq)),
    );
  }, [stations, group, cls, q]);

  const zip = avail.data?.downloads.find((d) => d.name === "solaris_sample_stations.zip");
  const template = avail.data?.downloads.find((d) => d.name === "aeros_input_template.csv");
  const csvDir = avail.data?.stationCsvDir ?? "data/stations-csv/";
  const counts = GROUP_ORDER.map((g) => [g, stations.filter((s) => stationGroup(s) === g).length] as const);

  const open = (id: string) => {
    if (onOpenInAeros) onOpenInAeros(id);
    else requestOpenInAeros(id);
    setOpened(id);
  };

  return (
    <section className={`wb ${compact ? "wb--compact" : ""}`} data-workbench="library" aria-label="Dataset library">
      <header className="wb-head">
        <div className="wb-head__badges">
          <Badge tone="neutral">Data</Badge>
          <Badge tone="info">{stations.length || 45} stations</Badge>
        </div>
        <h2 className={`wb-head__title ${compact ? "is-compact" : ""}`}>Solaris sample station set</h2>
        <p className="wb-head__summary">
          {STATION_PROVENANCE}. Seasonal means (°C) for {counts.map(([g, n]) => `${n} ${g === "World" ? "world" : g}`).join(", ")} stations, ready to run in Aeros. This is our own comparable
          sample set, assembled with documented rules; it is <strong>not</strong> the 40-station list used in the research poster.
        </p>
      </header>

      <div className="wb-downloads">
        {zip ? (
          <Button size="sm" variant="primary" href={publicUrl(zip.path)} download={zip.name} iconLeft={<IconDownload size={16} />}>
            Download all ({kb(zip.bytes)} zip)
          </Button>
        ) : null}
        {template ? (
          <Button size="sm" variant="secondary" href={publicUrl(template.path)} download={template.name} iconLeft={<IconDownload size={16} />}>
            Input template CSV
          </Button>
        ) : null}
        {bundle.data?.source_url ? (
          <Button size="sm" variant="ghost" href={bundle.data.source_url} iconRight={<IconExternal size={14} />}>
            NOAA GHCN-M v4 source file
          </Button>
        ) : null}
      </div>

      <Disclosure summary="How to format your own data for Aeros">
        <pre className="wb-note sol-mono" style={{ margin: 0 }}>
          {"YEAR,D-J-F,J-J-A\n1940,1.93,24.87\n1941,,25.10\n1942,0.47,"}
        </pre>
        <ul className="wb-list">
          <li>One row per year; temperatures in °C. Leave a cell empty when a value is missing (NASA's 999.9 is also recognised). Do not fill gaps yourself.</li>
          <li>D-J-F of year Y uses December of Y−1 plus January and February of Y (NASA GISS convention). J-J-A is June–August of Y.</li>
          <li>Aliases accepted: Year, DJF, JJA. Extra columns are ignored, so a NASA GISS station.csv works as-is. One season column is enough.</li>
          <li>Southern Hemisphere: keep the calendar labels; the site labels D-J-F as summer there.</li>
          <li>Recommended: about 60+ valid years per season, with data before and after 1980.</li>
        </ul>
      </Disclosure>

      <div className="wb-filters" role="search" aria-label="Filter stations">
        <div className="sol-field">
          <label className="sol-field__label" htmlFor="wb-lib-search">
            Search
          </label>
          <input id="wb-lib-search" className="wb-input" type="search" placeholder="City, id, region…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select
          label="Set / country"
          value={group}
          onChange={setGroup}
          options={[{ value: "all", label: "All stations" }, ...counts.map(([g, n]) => ({ value: g, label: `${g} (${n})` }))]}
        />
        <Select
          label="Class (night-light index)"
          value={cls}
          onChange={setCls}
          options={[
            { value: "all", label: "All classes" },
            { value: "urban", label: "Urban (BI ≥ 36)" },
            { value: "periurban", label: "Peri-urban (BI 11–35)" },
            { value: "rural", label: "Rural (BI ≤ 10)" },
          ]}
        />
      </div>

      {bundle.error ? (
        <Callout tone="danger" title="Could not load the station list">
          {bundle.error} <Button size="sm" variant="ghost" onClick={bundle.retry}>Retry</Button>
        </Callout>
      ) : null}
      {!bundle.data && !bundle.error ? <Skeleton height={240} /> : null}

      <p className="wb-note" aria-live="polite">
        Showing {filtered.length} of {stations.length} stations.
      </p>
      <ul className="wb-lib-list" data-testid="library-list">
        {filtered.map((s) => {
          const partner = s.pair_partner_id ? byId.get(s.pair_partner_id) : undefined;
          return (
            <li key={s.id} className="wb-lib-card">
              <div>
                <p className="wb-lib-card__name">{s.display_name}</p>
                <p className="wb-lib-card__meta">
                  <ClassBadge value={s.urban_rural} />
                  <span>{s.country}</span>
                  <span className="sol-mono">{s.id}</span>
                  {s.brightness_index != null ? <span>BI {s.brightness_index}</span> : null}
                </p>
                <p className="wb-lib-card__meta" style={{ marginTop: 4 }}>
                  {s.first_year}–{s.last_year} · {s.lat.toFixed(2)}°, {s.lon.toFixed(2)}°{s.elevation_m != null ? ` · ${Math.round(s.elevation_m)} m` : ""}
                  {partner ? ` · pair: ${partner.display_name} (${Math.round(s.pair_distance_km ?? 0)} km, ${classLabel(partner.urban_rural)})` : ""}
                </p>
                {s.coverage_note ? <p className="wb-note">{s.coverage_note}</p> : null}
              </div>
              <div className="wb-lib-card__sparks">
                <Spark s={s} season="D-J-F" />
                <Spark s={s} season="J-J-A" />
              </div>
              <div className="wb-lib-card__actions">
                <Button size="sm" variant="secondary" onClick={() => open(s.id)} data-testid={`open-${s.id}`}>
                  Open in Aeros
                </Button>
                <a className="wb-link" href={publicUrl(`${csvDir}${s.id}.csv`)} download={`${s.id}.csv`}>
                  <IconDownload size={14} /> CSV
                </a>
                <a className="wb-link" href={`https://data.giss.nasa.gov/cgi-bin/gistemp/stdata_show_v4.cgi?id=${s.id}&ds=14&dt=1`} target="_blank" rel="noreferrer">
                  GISS station page <IconExternal size={12} />
                </a>
              </div>
              {opened === s.id && !onOpenInAeros ? (
                <p className="wb-note" role="status">
                  {document.querySelector('[data-workbench="aeros"]') ? "Opened in the Aeros workbench above." : "Open the Aeros workbench to run this station."}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="wb-note">
        Data: NOAA NCEI GHCN-M v4 TAVG adjusted ({bundle.data?.source_file ?? "qcf"}); station inventory and night-light brightness index from NASA GISS GISTEMP v4. Seasonal means computed by the
        Solaris build script with all three months required and no gap filling. Values can differ by a few tenths of a °C from series shown on GISS station pages.
      </p>
    </section>
  );
}
