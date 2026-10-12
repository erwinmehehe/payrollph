"use client";

import { useEffect, useState } from "react";

type Field = { dataset: string; key: string; label: string; salary: boolean; groupable: boolean };
type Dataset = "people" | "time" | "payroll";
type Preview = { columns: string[]; rows: Array<Record<string, string | number>>; rowCount: number };
const defaults: Record<Dataset, string[]> = {
  people: ["department", "headcount", "turnover"],
  time: ["department", "absenceDays", "overtimeHours"],
  payroll: ["department", "grossPay", "overtimeCost"],
};
const today = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

export function HcmReportBuilderPanel({ organizationId }: { organizationId: number }) {
  const [fieldsAvailable, setFieldsAvailable] = useState<Field[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [dataset, setDataset] = useState<Dataset>("people");
  const [fields, setFields] = useState<string[]>(defaults.people);
  const [groupBy, setGroupBy] = useState("department");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [startDate, setStartDate] = useState(() => today().slice(0, 8) + "01");
  const [endDate, setEndDate] = useState(today);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/hcm-report-builder?organizationId=${organizationId}`, { cache: "no-store" });
        if (!alive) return;
        if (res.status === 404) return;
        const json = await res.json();
        if (!res.ok) {
          setError(String(json.error ?? "Report builder could not open."));
          setEnabled(true);
          return;
        }
        setFieldsAvailable(json.fields as Field[]);
        setEnabled(true);
        setError("");
      } catch {
        if (alive) { setError("Report builder is unavailable."); setEnabled(true); }
      }
    })();
    return () => { alive = false; };
  }, [organizationId]);

  if (!enabled) return null;
  const options = fieldsAvailable.filter(f => f.dataset === dataset);
  const visibleFields = fields.filter(f => options.some(option => option.key === f));
  const execute = async (format: "csv" | "json") => {
    if (visibleFields.length === 0) { setError("Select at least one field."); return; }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/hcm-report-builder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId, dataset, fields: visibleFields,
          groupBy: groupBy || null,
          filters: departmentFilter ? { department: departmentFilter.trim() } : {},
          startDate, endDate, format,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(String(json.error ?? "Could not run the custom report."));
      }
      if (format === "json") {
        setPreview(await res.json() as Preview);
      } else {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `linaw-${dataset}-report.csv`;
        document.body.append(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Report failed.");
    } finally { setBusy(false); }
  };

  return (
    <article className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">Custom analytics</div>
          <h2>Report builder</h2>
          <p>Choose approved fields and preview results. Salary data is available only to authorized People and payroll roles.</p>
        </div>
      </div>
      <div style={{ padding: "0 18px 18px", display: "grid", gap: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <label>Dataset
            <select aria-label="Report dataset" value={dataset} onChange={e => {
              const next = e.target.value as Dataset;
              setDataset(next); setFields(defaults[next]); setPreview(null);
            }}>
              <option value="people">People</option><option value="time">Time</option><option value="payroll">Payroll</option>
            </select>
          </label>
          <label>Start date
            <input aria-label="Report start date" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </label>
          <label>End date
            <input aria-label="Report end date" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </label>
          <label>Group by
            <select aria-label="Group report by" value={groupBy} onChange={e => setGroupBy(e.target.value)}>
              <option value="">No grouping</option><option value="department">Department / payroll unit</option>
              {dataset === "people" && <option value="status">Employment status</option>}
            </select>
          </label>
          <label>Department filter (exact)
            <input aria-label="Department filter" value={departmentFilter} onChange={e => setDepartmentFilter(e.target.value)} placeholder="Optional" maxLength={120} />
          </label>
        </div>
        <fieldset style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12 }}>
          <legend>Select report fields</legend>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 15 }}>
            {options.map(field => (
              <label key={field.key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <input type="checkbox" checked={visibleFields.includes(field.key)}
                  onChange={e => setFields(current => e.target.checked ? [...new Set([...current, field.key])] : current.filter(v => v !== field.key))} />
                {field.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void execute("json")}>Preview report</button>
          <button type="button" className="secondary-button" disabled={busy || !preview} onClick={() => void execute("csv")}>Export audited CSV</button>
        </div>
        {error && <p role="alert" style={{ color: "var(--danger, #a22)" }}>{error}</p>}
        {preview && (
          <div className="data-table-wrap slim-scroll">
            <p>{preview.rowCount} grouped result{preview.rowCount === 1 ? "" : "s"}</p>
            <table className="data-table">
              <thead><tr>{preview.columns.map(column => <th key={column}>{options.find(f => f.key === column)?.label ?? column}</th>)}</tr></thead>
              <tbody>{preview.rows.map((row, index) => <tr key={index}>{preview.columns.map(col => <td key={col}>{String(row[col] ?? "")}</td>)}</tr>)}</tbody>
            </table>
          </div>
        )}
        <p style={{ fontSize: 12, opacity: 0.8 }}>Historical turnover is not reassigned to a worker’s current department. Payroll department costs require released, unit-scoped payroll evidence; unattributed company-wide runs are blocked.</p>
      </div>
    </article>
  );
}
