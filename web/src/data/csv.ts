/**
 * CSV parsing for user uploads in the Aeros input format, and CSV export.
 *
 * Accepted input (see data/stations/HOW_TO_FORMAT_YOUR_DATA.md):
 *   YEAR,D-J-F,J-J-A          (aliases: Year/year, DJF, JJA; case-insensitive)
 *   - NASA GISS station.csv works as-is: 999.9 / -999.9 / 9999 = missing,
 *     extra columns (monthly values, J-D, metANN …) are ignored.
 *   - Empty cells, "NA", "NaN", "-", "." = missing.
 *   - Comma, semicolon or tab separated; quoted fields; BOM; CRLF.
 *   - One season column is enough.
 */
import type { SeasonKey } from "./types";

export type AerosSeries = {
  years: number[];
  "D-J-F": (number | null)[] | null;
  "J-J-A": (number | null)[] | null;
};

export type CsvMessage = { level: "error" | "warning" | "info"; message: string; line?: number };

export type AerosParseResult = {
  /** null when the file cannot be used at all (see messages). */
  series: AerosSeries | null;
  messages: CsvMessage[];
  /** Valid (non-missing) value counts per season. */
  counts: Partial<Record<SeasonKey, number>>;
  ok: boolean;
};

const MISSING_TOKENS = new Set(["", "na", "nan", "null", "none", "-", ".", "--"]);
const MISSING_NUMBERS = [999.9, -999.9, 9999, -9999, 99.99, -99.99];
/** Plausible seasonal-mean surface air temperature range (°C). Outside → warning, kept as missing. */
const PLAUSIBLE = { min: -70, max: 50 };
export const MIN_RECOMMENDED_YEARS = 60;

function detectDelimiter(headerLine: string): string {
  const counts = [",", ";", "\t"].map((d) => [d, headerLine.split(d).length] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 1 ? counts[0][0] : ",";
}

/** Minimal RFC-4180-ish line splitter (handles quotes and escaped quotes). */
export function splitCsvLine(line: string, delim = ","): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function normHeader(h: string): string {
  return h.replace(/^﻿/, "").trim().toUpperCase().replace(/[\s_]/g, "").replace(/–|—/g, "-");
}

const YEAR_KEYS = ["YEAR", "YR"];
const DJF_KEYS = ["D-J-F", "DJF"];
const JJA_KEYS = ["J-J-A", "JJA"];

function parseValue(raw: string): { value: number | null; missing: boolean; invalid: boolean } {
  const s = raw.trim().replace(/^"|"$/g, "");
  if (MISSING_TOKENS.has(s.toLowerCase())) return { value: null, missing: true, invalid: false };
  const n = Number(s);
  if (!Number.isFinite(n)) return { value: null, missing: false, invalid: true };
  if (MISSING_NUMBERS.some((m) => Math.abs(n - m) < 1e-9)) return { value: null, missing: true, invalid: false };
  return { value: n, missing: false, invalid: false };
}

/** Parse an Aeros-format CSV string. Never throws; problems are reported in `messages`. */
export function parseAerosCsv(text: string): AerosParseResult {
  const messages: CsvMessage[] = [];
  const lines = text.replace(/^﻿/, "").split(/\r\n|\n|\r/);
  // Find the header: first non-empty line containing a YEAR column.
  let headerIdx = -1;
  let delim = ",";
  let cols: string[] = [];
  for (let i = 0; i < Math.min(lines.length, 50); i++) {
    if (!lines[i].trim()) continue;
    delim = detectDelimiter(lines[i]);
    const c = splitCsvLine(lines[i], delim).map(normHeader);
    if (c.some((h) => YEAR_KEYS.includes(h))) {
      headerIdx = i;
      cols = c;
      break;
    }
  }
  if (headerIdx < 0) {
    return {
      series: null,
      ok: false,
      counts: {},
      messages: [{ level: "error", message: 'No header row with a "YEAR" column was found. Expected: YEAR,D-J-F,J-J-A' }],
    };
  }
  const yi = cols.findIndex((h) => YEAR_KEYS.includes(h));
  const di = cols.findIndex((h) => DJF_KEYS.includes(h));
  const ji = cols.findIndex((h) => JJA_KEYS.includes(h));
  if (di < 0 && ji < 0) {
    return {
      series: null,
      ok: false,
      counts: {},
      messages: [{ level: "error", message: 'Found YEAR but no season column. Add "D-J-F" and/or "J-J-A" (or DJF / JJA).', line: headerIdx + 1 }],
    };
  }
  const extra = cols.filter((_, i) => i !== yi && i !== di && i !== ji && cols[i]);
  if (extra.length) messages.push({ level: "info", message: `Ignored ${extra.length} extra column(s): ${extra.slice(0, 6).join(", ")}${extra.length > 6 ? "…" : ""}` });

  const rows = new Map<number, { d: number | null; j: number | null }>();
  let missing = 0;
  let implausible = 0;
  let badRows = 0;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = splitCsvLine(line, delim);
    const yRaw = cells[yi] ?? "";
    const year = Number(yRaw);
    if (!Number.isInteger(year) || year < 1700 || year > 2200) {
      badRows++;
      if (badRows <= 3) messages.push({ level: "warning", message: `Skipped row with invalid year "${yRaw}"`, line: i + 1 });
      continue;
    }
    const read = (idx: number) => {
      if (idx < 0) return null;
      const v = parseValue(cells[idx] ?? "");
      if (v.invalid) {
        if (badRows < 3) messages.push({ level: "warning", message: `Non-numeric value "${cells[idx]}" treated as missing`, line: i + 1 });
        badRows++;
        return null;
      }
      if (v.missing) {
        missing++;
        return null;
      }
      if (v.value! < PLAUSIBLE.min || v.value! > PLAUSIBLE.max) {
        implausible++;
        return null;
      }
      return v.value;
    };
    if (rows.has(year)) messages.push({ level: "warning", message: `Duplicate year ${year}; the last row wins`, line: i + 1 });
    rows.set(year, { d: read(di), j: read(ji) });
  }
  if (badRows > 3) messages.push({ level: "warning", message: `${badRows} problem rows/cells in total were skipped or treated as missing` });
  if (implausible) messages.push({ level: "warning", message: `${implausible} value(s) outside ${PLAUSIBLE.min}…${PLAUSIBLE.max} °C were treated as missing (wrong units?)` });

  if (!rows.size) return { series: null, ok: false, counts: {}, messages: [...messages, { level: "error", message: "No data rows found." }] };

  // Build a contiguous year axis so gaps are explicit.
  const ys = [...rows.keys()].sort((a, b) => a - b);
  const years: number[] = [];
  for (let y = ys[0]; y <= ys[ys.length - 1]; y++) years.push(y);
  const djf = di >= 0 ? years.map((y) => rows.get(y)?.d ?? null) : null;
  const jja = ji >= 0 ? years.map((y) => rows.get(y)?.j ?? null) : null;
  const counts: Partial<Record<SeasonKey, number>> = {};
  if (djf) counts["D-J-F"] = djf.filter((v) => v != null).length;
  if (jja) counts["J-J-A"] = jja.filter((v) => v != null).length;
  if (missing) messages.push({ level: "info", message: `${missing} missing value(s) (empty or 999.9) left as gaps` });

  let ok = true;
  for (const [k, n] of Object.entries(counts)) {
    if (n === 0) {
      messages.push({ level: "error", message: `${k} has no valid values.` });
      ok = Object.values(counts).some((c) => (c ?? 0) > 0) && ok;
    } else if (n < MIN_RECOMMENDED_YEARS) {
      messages.push({ level: "warning", message: `${k} has ${n} valid years; at least ~${MIN_RECOMMENDED_YEARS} are recommended.` });
    }
  }
  const before = years.filter((y, i) => y < 1980 && ((djf?.[i] ?? null) != null || (jja?.[i] ?? null) != null)).length;
  const after = years.filter((y, i) => y >= 1980 && ((djf?.[i] ?? null) != null || (jja?.[i] ?? null) != null)).length;
  if (!before || !after) messages.push({ level: "warning", message: "Data should span both before and after 1980 for the 1940–1979 vs 1980–present comparison." });
  if (!Object.values(counts).some((c) => (c ?? 0) > 0)) ok = false;

  messages.unshift({ level: "info", message: `Read ${rows.size} year(s), ${years[0]}–${years[years.length - 1]}.` });
  return { series: { years, "D-J-F": djf, "J-J-A": jja }, messages, counts, ok };
}

/* ---------------- export ---------------- */

type Cell = string | number | null | undefined;

function esc(v: Cell): string {
  if (v == null || (typeof v === "number" && !Number.isFinite(v))) return "";
  const s = typeof v === "number" ? String(Math.round(v * 1e6) / 1e6) : v;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build CSV text from rows of objects (column order = `columns`). Optional `#` comment lines on top. */
export function toCsv<T extends Record<string, Cell>>(rows: T[], columns: (keyof T & string)[], comments: string[] = []): string {
  const head = comments.map((c) => `# ${c.replace(/\n/g, " ")}`);
  const body = [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))];
  return [...head, ...body].join("\n") + "\n";
}

/** Columns of equal length → CSV, e.g. seriesToCsv({ year: years, lower: lo, mean, upper: hi }). */
export function seriesToCsv(columns: Record<string, Cell[]>, comments: string[] = []): string {
  const keys = Object.keys(columns);
  const n = Math.max(...keys.map((k) => columns[k].length));
  const rows = Array.from({ length: n }, (_, i) => Object.fromEntries(keys.map((k) => [k, columns[k][i]])));
  return toCsv(rows, keys, comments);
}

/** Trigger a browser download of text content. */
export function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Read a File (from <input type=file>) and parse it. */
export async function parseAerosFile(file: File): Promise<AerosParseResult> {
  if (file.size > 5 * 1024 * 1024) {
    return { series: null, ok: false, counts: {}, messages: [{ level: "error", message: "File is larger than 5 MB — is this the right file?" }] };
  }
  return parseAerosCsv(await file.text());
}
