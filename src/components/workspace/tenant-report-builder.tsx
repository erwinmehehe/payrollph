"use client";
import { useEffect, useState } from "react";

type Dataset = "people" | "time" | "payroll";
const DEFAULT_FIELDS: Record<Dataset, string[]> = {
  people: ["department", "headcount"],
  time: ["department", "overtimeMinutes", "absenceDays"],
  payroll: ["department", "payrollCost"],
};

export function TenantReportBuilder({ organizationId }: { organizationId: number }) {
  const [available, setAvailable] = useState<Record<Dataset, string[]> | null>(null);
  const [dataset, setDataset] = useState<Dataset>("people");
  const [fields, setFields] = useState<string[]>(DEFAULT_FIELDS.people);
  const [groupBy, setGroupBy] = useState("department");
  const [startDate, setStartDate] = useState("2026-10-01");
  const [endDate, setEndDate] = useState("2026-10-31");
  const [rows, setRows] = useState<string[][]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/reports/builder?organizationId=${organizationId}`, {
      signal: controller.signal, cache: "no-store",
    }).then(async res => {
      if (!res.ok) throw Error("This report builder is unavailable for your role.");
      return res.json() as Promise<{ fields: Record<Dataset, string[]> }>;
    }).then(data => {
      if (!controller.signal.aborted) setAvailable(data.fields);
    }).catch(() => {
      if (!controller.signal.aborted) setError("Report fields are unavailable.");
    });
    return () => controller.abort();
  }, [organizationId]);
  function selectDataset(next: Dataset) {
    setDataset(next); setRows([]); setColumns([]);
    const allowed = available?.[next] ?? [];
    setFields(DEFAULT_FIELDS[next].filter(field => allowed.includes(field)));
    setGroupBy(allowed.includes("department") ? "department" : "");
  }
  async function run(format: "json" | "csv") {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/reports/builder", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, startDate, endDate, format,
          spec: { dataset, fields, groupBy: groupBy || null } }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw Error(data.error ?? "Report request failed.");
      }
      if (format === "csv") {
        const csv = await res.blob();
        const link = document.createElement("a");
        const href = URL.createObjectURL(csv); link.href = href;
        link.download = "linaw-tenant-report.csv";
        link.click(); URL.revokeObjectURL(href);
      } else {
        const data = await res.json() as { columns: string[]; rows: string[][] };
        setRows(data.rows); setColumns(data.columns);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Report failed."); }
    finally { setBusy(false); }
  }
  return <section className="mx-auto max-w-5xl space-y-6 p-6">
    <h1 className="text-2xl font-semibold">Custom reports</h1>
    <p>Choose approved fields, group rows, preview, or export an audited CSV. No SQL editing.</p>
    <div className="flex flex-wrap gap-4">
      <label>Dataset <select value={dataset} onChange={event => selectDataset(event.target.value as Dataset)}
        className="border rounded p-2">
        {(Object.keys(available ?? DEFAULT_FIELDS) as Dataset[]).map(value =>
          <option value={value} key={value}>{value}</option>)}
      </select></label>
      <label>From <input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} className="border rounded p-2"/></label>
      <label>To <input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} className="border rounded p-2"/></label>
      <label>Group by <select value={groupBy} onChange={event => {
        const next = event.target.value;
        setGroupBy(next);
        setFields(prev => prev.filter(field => field !== "status" && field !== "employmentType" && field !== "department")
          .concat(next ? [next] : []));
      }} className="border rounded p-2">
        <option value="">No grouping</option>
        {(available?.[dataset] ?? []).filter(field => ["department", "status", "employmentType"].includes(field))
          .map(field => <option key={field} value={field}>{field}</option>)}
      </select></label>
    </div>
    <fieldset className="border rounded p-4"><legend>Columns</legend>
      <div className="flex flex-wrap gap-4">
        {(available?.[dataset] ?? []).map(field => <label key={field} className="flex items-center gap-2">
          <input type="checkbox" checked={fields.includes(field)}
            disabled={Boolean(groupBy) && ["department", "status", "employmentType"].includes(field) && field !== groupBy}
            onChange={event => setFields(prev => event.target.checked
              ? [...prev, field] : prev.filter(v => v !== field))}/>
          {field}
        </label>)}
      </div>
    </fieldset>
    <div className="flex gap-3">
      <button disabled={busy || !available || fields.length === 0} onClick={() => void run("json")} className="rounded border px-4 py-2">Preview</button>
      <button disabled={busy || !available || fields.length === 0} onClick={() => void run("csv")} className="rounded border px-4 py-2">Export CSV</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {columns.length > 0 && <div className="overflow-auto"><table className="w-full border-collapse text-sm">
      <thead><tr>{columns.map(column => <th key={column} scope="col" className="border p-2 text-left">{column}</th>)}</tr></thead>
      <tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell,j) => <td key={j} className="border p-2">{cell}</td>)}</tr>)}</tbody>
    </table></div>}
  </section>;
}
