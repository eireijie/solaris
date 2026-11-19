import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { DatasetLibrary } from "../../../features/models";

export default function DatasetsPage() {
  const navigate = useNavigate();
  useEffect(() => {
    document.title = "Datasets — Solaris workspace";
  }, []);
  return (
    <div className="ws-page">
      <header className="ws-model__head">
        <p className="sol-eyebrow">Datasets</p>
        <h1 className="ws-title">Ready-to-use datasets</h1>
        <p className="ws-lede">
          The Solaris sample station set — NOAA GHCN-M v4 (adjusted), the station record NASA GISTEMP is built on — plus global
          CO₂ and SSP pathway files. Download any of them, or use the CSV template to bring your own station.
        </p>
      </header>
      <section className="ws-bench" aria-label="Dataset library">
        <DatasetLibrary onOpenInAeros={(id) => navigate(`/app/aeros?station=${encodeURIComponent(id)}`)} />
      </section>
    </div>
  );
}
