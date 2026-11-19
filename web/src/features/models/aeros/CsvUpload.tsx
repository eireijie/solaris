/** "Use your own data": CSV upload with validation messages, template download and privacy note. */
import { useId, useRef, useState } from "react";
import type { DragEvent } from "react";
import { Badge, IconDownload, IconUpload, Select } from "../../../components/ui";
import { parseAerosFile } from "../../../data";
import type { AerosParseResult } from "../../../data";
import { publicUrl } from "../../../lib/paths";
import type { Upload } from "./aerosShared";

export function CsvUpload({ current, onUpload, onHemisphere }: { current: Upload | null; onUpload: (u: Upload) => void; onHemisphere: (h: Upload["hemisphere"]) => void }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [parse, setParse] = useState<{ file: string; result: AerosParseResult } | null>(null);
  const [drag, setDrag] = useState(false);

  const handle = async (file: File) => {
    const result = await parseAerosFile(file);
    setParse({ file: file.name, result });
    if (result.ok && result.series) {
      const stem = file.name.replace(/\.[^.]+$/, "") || "uploaded";
      onUpload({ name: stem, fileName: file.name, hemisphere: current?.hemisphere ?? "northern", series: result.series });
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void handle(f);
  };

  return (
    <div className="wb-upload">
      <div
        className={`wb-drop ${drag ? "is-drag" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
      >
        <IconUpload size={22} />
        <label htmlFor={id} className="wb-drop__label">
          <span className="wb-drop__cta">Choose a CSV file</span> <span className="sol-muted">or drop it here</span>
        </label>
        <input
          ref={input}
          id={id}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="wb-drop__input"
          data-testid="csv-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handle(f);
            e.target.value = "";
          }}
        />
        <p className="wb-drop__fmt sol-mono">YEAR,D-J-F,J-J-A · °C · empty cell = missing</p>
      </div>
      <p className="wb-upload__privacy">
        <Badge tone="success">Private</Badge> Your file is read and modelled entirely in this browser. It is never uploaded to a server.
      </p>
      <p className="wb-upload__links">
        <a className="wb-link" href={publicUrl("data/downloads/aeros_input_template.csv")} download="aeros_input_template.csv">
          <IconDownload size={14} /> Template CSV
        </a>
        <span className="sol-muted">D-J-F of year Y uses December of Y−1 (NASA GISS convention). NASA GISS station.csv files work as-is.</span>
      </p>
      {parse ? (
        <div className="wb-upload__result" aria-live="polite" data-testid="csv-messages">
          <p className="wb-upload__file">
            <strong>{parse.file}</strong> {parse.result.ok ? <Badge tone="success">Ready</Badge> : <Badge tone="danger">Cannot use this file</Badge>}
          </p>
          <ul className="wb-msgs">
            {parse.result.messages.map((m, i) => (
              <li key={i} className={`wb-msg wb-msg--${m.level}`}>
                <span className="wb-msg__level">{m.level}</span>
                {m.line ? <span className="sol-mono">line {m.line}: </span> : null}
                {m.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {current ? (
        <Select
          label="Hemisphere of this station"
          hint="Sets the winter/summer labels (D-J-F is summer in the Southern Hemisphere). It does not change the numbers."
          value={current.hemisphere}
          onChange={(v) => onHemisphere(v as Upload["hemisphere"])}
          options={[
            { value: "northern", label: "Northern Hemisphere" },
            { value: "southern", label: "Southern Hemisphere" },
            { value: "unknown", label: "Not specified (calendar labels only)" },
          ]}
        />
      ) : null}
    </div>
  );
}
