"use client";

import { useEffect, useMemo, useState } from "react";
import { exportProjectedReportCsv, projectReportRows, type SavedRowFilter } from "@/lib/report-builder-view";

type ReportResult = { columns: string[]; rows: string[][] };
type Saved = { id: number; name: string; reportKey: string; selectedFields: string[]; rowFilters: SavedRowFilter[] };

export function CustomReportBuilder({ organizationId, active, report, onReport }: {
  organizationId: number; active: string; report: ReportResult | null;
  onReport: (key: string) => void;
}) {
  const [saved, setSaved] = useState<Saved[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [field, setField] = useState("");
  const [operator, setOperator] = useState<"contains" | "equals">("contains");
  const [term, setTerm] = useState("");
  const [filters, setFilters] = useState<SavedRowFilter[]>([]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [pending, setPending] = useState<Saved | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/report-builder/saved?organizationId=" + organizationId, { cache: "no-store" });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error ?? "Saved reports are unavailable.");
        if (alive) { setSaved(body.reports ?? []); setError(""); setStatus("ready"); }
      } catch (e) {
        if (alive) { setError(e instanceof Error ? e.message : "Could not load."); setStatus("error"); }
      }
    })();
    return () => { alive = false; };
  }, [organizationId, reload]);

  useEffect(() => {
    if (!report || !pending || pending.reportKey !== active) return;
    let alive = true;
    void Promise.resolve().then(() => {
      if (!alive) return;
      setSelectedFields(pending.selectedFields.filter(column => report.columns.includes(column)));
      setFilters(pending.rowFilters.filter(f => report.columns.includes(f.field)));
      setName(pending.name);
      setField(report.columns[0] ?? "");
      setChosen(pending.id);
      setPending(null);
    });
    return () => { alive = false; };
  }, [report, pending, active]);

  const projected = useMemo(() => report
    ? projectReportRows({ columns: report.columns, rows: report.rows,
      selectedFields, filters })
    : { columns: [], rows: [] },
    [report, selectedFields, filters]);

  function choose(item: Saved) {
    setPending(item);
    setName(item.name);
    if (item.reportKey !== active) onReport(item.reportKey);
  }
  async function save() {
    if (!report || !name.trim()) return;
    setStatus("saving"); setError(""); setNotice("");
    try {
      const r = await fetch("/api/report-builder/saved", {
        method: chosen ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId, ...(chosen ? { id: chosen } : {}),
          name, reportKey: active, selectedFields: selectedFields.length ? selectedFields : report.columns,
          rowFilters: filters,
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? "Could not save report.");
      setChosen(body.report?.id ?? null); setNotice("Report definition saved for your account.");
      setReload(n => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed."); setStatus("ready"); }
  }
  async function remove() {
    if (!chosen) return;
    setStatus("saving"); setError("");
    try {
      const r = await fetch("/api/report-builder/saved", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, id: chosen }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? "Delete rejected.");
      setChosen(null); setName(""); setFilters([]); setSelectedFields([]);
      setNotice("Saved report removed."); setReload(n => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "Delete failed."); setStatus("ready"); }
  }
  function download() {
    if (!projected.columns.length) return;
    const blob = new Blob([exportProjectedReportCsv(projected.columns, projected.rows)], { type: "text/csv;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = href; a.download = "custom-report-" + active + ".csv";
    document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(href);
  }
  return <section className="card" aria-label="Custom report builder" style={{ padding: 16, marginBottom: 16 }}>
    <div className="card-kicker">CUSTOM REPORTS</div>
    <h2>Build and save a report</h2>
    <p>Fields and filters only affect a report your account is already authorized to read. Saving does not grant additional reporting permissions.</p>
    {status === "loading" && <p role="status">Loading saved reports…</p>}
    {status === "error" && <div role="alert">{error}<button className="secondary-button" onClick={() => setReload(n => n+1)}>Retry</button></div>}
    {status !== "loading" && status !== "error" && saved.length === 0 && <p>No saved reports yet. Select fields and save a view.</p>}
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
      <label>Saved report
        <select aria-label="Saved report" value={chosen ?? ""} onChange={e=>{
          const item = saved.find(row => row.id === Number(e.target.value));
          if (item) choose(item);
          else { setChosen(null); setPending(null); setName(""); }
        }}>
          <option value="">New custom report</option>
          {saved.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label>Report name
        <input aria-label="Report name" maxLength={100} value={name} onChange={e=>setName(e.target.value)}/>
      </label>
    </div>
    <fieldset style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, marginBottom: 12 }}>
      <legend>Field picker</legend>
      {!report && <p role="status">Load a report to choose fields.</p>}
      {report && report.columns.length === 0 && <p>No fields available for this report.</p>}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {(report?.columns ?? []).map(column => <label key={column} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <input type="checkbox" checked={!selectedFields.length || selectedFields.includes(column)}
            onChange={event => setSelectedFields(previous => {
              const all = previous.length ? previous : report!.columns;
              if (event.target.checked) return [...new Set([...all, column])];
              // At least one field is required; [] means untouched/all.
              return all.length <= 1 ? all : all.filter(x=>x!==column);
            })}/>
          {column}
        </label>)}
      </div>
    </fieldset>
    <div className="setting-form">
      <label>Filter field
        <select value={report?.columns.includes(field) ? field : report?.columns[0] ?? ""} onChange={e=>setField(e.target.value)}>
          {(report?.columns ?? []).map(column=><option key={column} value={column}>{column}</option>)}
        </select>
      </label>
      <label>Condition
        <select value={operator} onChange={e=>setOperator(e.target.value as typeof operator)}>
          <option value="contains">Contains</option><option value="equals">Equals</option>
        </select>
      </label>
      <label>Value<input value={term} maxLength={120} onChange={e=>setTerm(e.target.value)}/></label>
    </div>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0" }}>
      <button type="button" className="secondary-button" disabled={!term.trim() || filters.length >= 6}
        onClick={() => { setFilters(rows=>[...rows, {field: field || report?.columns[0] || "", operator, value:term.trim()}]); setTerm(""); }}>Add filter</button>
      {filters.map((f,i)=><button type="button" className="secondary-button" key={i}
        onClick={() => setFilters(rows=>rows.filter((_,index)=>index!==i))}>{f.field} {f.operator} {f.value} ×</button>)}
    </div>
    {error && status !== "error" && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button type="button" className="primary-button" disabled={!report || !name.trim() || status === "saving"} onClick={() => void save()}>
        {status === "saving" ? "Saving…" : chosen ? "Update saved report" : "Save report"}
      </button>
      {chosen && <button type="button" className="secondary-button" disabled={status === "saving"} onClick={() => void remove()}>Delete saved report</button>}
      <button type="button" className="secondary-button" disabled={!report || projected.columns.length === 0} onClick={download}>Export filtered CSV</button>
    </div>
    <h3 style={{ marginTop: 14 }}>Preview · {projected.rows.length} row(s)</h3>
    {report && projected.rows.length === 0 && <p role="status">No rows match these filters.</p>}
    {projected.rows.length > 0 && <div className="data-table-wrap" style={{ overflowX: "auto", maxWidth: "100%" }}>
      <table className="data-table"><thead><tr>{projected.columns.map((x,i)=><th key={i}>{x}</th>)}</tr></thead>
      <tbody>{projected.rows.slice(0, 75).map((row,i)=><tr key={i}>{row.map((value,j)=><td key={j}>{value}</td>)}</tr>)}</tbody></table>
      {projected.rows.length > 75 && <p>Showing 75 rows. Export includes all filtered rows.</p>}
    </div>}
  </section>;
}
