"use client";

import { useEffect, useMemo, useState } from "react";
import { Database, Download, FileJson2, ShieldCheck } from "lucide-react";
import type { Notify } from "@/components/workspace/types";

type Definition = {
  key: string;
  name: string;
  description: string;
  schemaVersion: string;
  columns: Array<{ key: string; label: string; description: string }>;
};

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function EnterpriseBiExportPanel({
  organizationId,
  notify,
}: {
  organizationId: number;
  notify: Notify;
}) {
  const today = useMemo(() => new Date(), []);
  const ninetyDaysAgo = useMemo(() => {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - 89);
    return date;
  }, [today]);

  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [dataset, setDataset] = useState("payroll_runs");
  const [format, setFormat] = useState("csv");
  const [startDate, setStartDate] = useState(isoDate(ninetyDaysAgo));
  const [endDate, setEndDate] = useState(isoDate(today));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch(`/api/bi-exports?organizationId=${organizationId}`, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!alive) return;
        if (!response.ok) throw new Error(payload.error ?? "Could not load BI export definitions.");
        setDefinitions(Array.isArray(payload.datasets) ? payload.datasets : []);
      } catch (error) {
        if (alive) notify(error instanceof Error ? error.message : "Could not load BI export definitions.", "err");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [organizationId, notify]);

  const selected = definitions.find((definition) => definition.key === dataset);

  function requestExport() {
    if (!startDate || !endDate) {
      notify("Choose a start and end date for the BI export.", "err");
      return;
    }
    if (startDate > endDate) {
      notify("BI export end date must be on or after the start date.", "err");
      return;
    }
    const params = new URLSearchParams({
      organizationId: String(organizationId),
      key: dataset,
      format,
      startDate,
      endDate,
    });
    window.open(`/api/bi-exports?${params.toString()}`, "_blank", "noopener");
    notify("BI export requested. The generated file is integrity-hashed and recorded in the audit trail.", "info");
  }

  return (
    <article className="card" style={{ marginBottom: 16 }} data-enterprise-bi-export>
      <div className="card-header">
        <div>
          <div className="card-kicker">ENTERPRISE DATA</div>
          <h2>BI exports</h2>
          <p>Versioned machine-readable payroll and workforce datasets for governed downstream reporting.</p>
        </div>
        <Database size={19} className="i-purple" />
      </div>
      <div className="card-body">
        <div className="notice notice-slate" style={{ marginBottom: 14 }}>
          <ShieldCheck size={15} className="i-purple" />
          <span>
            Company-wide access and recent MFA are required. Bank accounts and government-member identifiers are excluded. Each export records row count, filters, schema version and SHA-256 evidence.
          </span>
        </div>

        <div className="setting-form" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr" }}>
          <label>
            Dataset
            <select value={dataset} disabled={loading} onChange={(event) => setDataset(event.target.value)}>
              {definitions.map((definition) => (
                <option key={definition.key} value={definition.key}>{definition.name}</option>
              ))}
            </select>
          </label>
          <label>
            Start date
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </label>
          <label>
            End date
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </label>
          <label>
            Format
            <select value={format} onChange={(event) => setFormat(event.target.value)}>
              <option value="csv">CSV</option>
              <option value="ndjson">NDJSON</option>
              <option value="json">JSON + manifest</option>
            </select>
          </label>
        </div>

        {selected && (
          <div style={{ marginTop: 12 }}>
            <div className="line-title" style={{ marginBottom: 6 }}>
              <div>
                <strong>{selected.name}</strong>
                <span>{selected.description}</span>
              </div>
              <span className="status-badge">Schema {selected.schemaVersion}</span>
            </div>
            <small className="muted-copy">
              {selected.columns.length} stable fields · maximum 366-day window · maximum 50,000 rows per export
            </small>
          </div>
        )}

        <div className="run-actions" style={{ marginTop: 14 }}>
          <button type="button" className="primary-button brand" disabled={loading || !definitions.length} onClick={requestExport}>
            {format === "json" || format === "ndjson" ? <FileJson2 size={14} /> : <Download size={14} />}
            Export {format.toUpperCase()}
          </button>
        </div>
      </div>
    </article>
  );
}
