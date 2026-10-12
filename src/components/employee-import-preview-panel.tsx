"use client";
import { useRef, useState } from "react";
import type { ImportPreviewRow } from "@/lib/employee-import-preview";

type Result = { rows: ImportPreviewRow[]; totalRows: number; errorCount: number; warningCount: number; blockingErrorCount: number; skippedCount: number; fileErrors: string[]; previewToken?: string; errorCsv: string; error?: string; createdCount?: number; dryRun?: boolean };
export function EmployeeImportPreviewPanel({ organizationId, onImported }: { organizationId: number; onImported: () => void }) {
  const uploadVersion = useRef(0);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [skips, setSkips] = useState<number[]>([]);
  const [receipt, setReceipt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState("all");
  async function submit(action: "preview" | "commit") {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/employees/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId, csv, fileName, action, skipLines: skips, previewToken: receipt }) });
      const body = await response.json();
      if (body.rows) setResult(body);
      if (!response.ok) { setReceipt(""); throw new Error(body.error ?? "Import failed."); }
      if (action === "preview") { setReceipt(body.previewToken); setPage(0); }
      else { setReceipt(""); onImported(); }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not reach the server."); }
    finally { setBusy(false); }
  }
  function skip(lines: number[]) { setSkips(lines); setReceipt(""); }
  const committed = result?.dryRun === false;
  const visibleRows = result?.rows.filter(row => filter === "all" || row.status === filter) ?? [];
  return <section className="card" aria-label="Employee CSV import preview">
    <h2>Import employees</h2>
    <p>Upload → Preview → Commit. A batch commits only when every error row is fixed or explicitly skipped. Existing employees are never overwritten.</p>
    <label>CSV file<input type="file" accept=".csv,text/csv" disabled={busy} onChange={async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const version = ++uploadVersion.current;
      setError(""); setCsv(""); setReceipt(""); setResult(null); setSkips([]); setPage(0); setFilter("all");
      if (file.size > 2 * 1024 * 1024) { setCsv(""); setError("CSV exceeds 2 MB."); return; }
      try {
        const contents = await file.text();
        if (version !== uploadVersion.current) return;
        setCsv(contents); setFileName(file.name);
      } catch { if (version === uploadVersion.current) setError("The file could not be read. Select it again."); }
    }} /></label>
    <a href="/api/employees/import/template" download className="secondary-button">Download CSV template</a>
    <button type="button" className="primary-button" disabled={busy || !csv} onClick={() => void submit("preview")}>{busy ? "Working…" : result ? "Refresh preview" : "Preview upload"}</button>
    {error && <p role="alert">{error}</p>}
    {result && <>
      <p role="status">{committed ? `${result.createdCount} employees imported.` : `${result.totalRows} rows · ${result.errorCount} errors · ${result.warningCount} warnings · ${result.skippedCount} skipped`}</p>
      {result.fileErrors.map(reason => <p role="alert" key={reason}>{reason}</p>)}
      <a download="employee-import-errors.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(result.errorCsv)}`} className="secondary-button">Download error CSV</a>
      {!committed && <button type="button" disabled={busy} className="secondary-button" onClick={() => skip([...new Set([...skips, ...result.rows.filter(r => r.status === "error").map(r => r.line)])])}>Skip all error rows</button>}
      <label>Filter results<select value={filter} onChange={event => { setFilter(event.target.value); setPage(0); }}><option value="all">All rows</option><option value="error">Errors</option><option value="warning">Warnings</option><option value="valid">Valid</option></select></label>
      <div style={{ overflowX: "auto" }}><table><caption>Row-by-row import preview</caption><thead><tr><th>Row</th><th>Employee no.</th><th>Name</th><th>Result</th><th>Reason</th><th>Skip</th></tr></thead><tbody>
        {visibleRows.slice(page * 50, page * 50 + 50).map(row => <tr key={row.line}><td>{row.line}</td><td>{row.employeeNo}</td><td>{row.name}</td><td>{row.status}</td><td>{row.reasons.join("; ") || "Validated"}</td><td><input type="checkbox" aria-label={`Skip row ${row.line}`} checked={skips.includes(row.line)} disabled={busy || committed} onChange={e => skip(e.target.checked ? [...skips, row.line] : skips.filter(n => n !== row.line))} /></td></tr>)}
      </tbody></table></div>
      <button type="button" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous rows</button>
      <span> Page {page + 1} of {Math.max(1, Math.ceil(visibleRows.length / 50))} </span>
      <button type="button" disabled={(page + 1) * 50 >= visibleRows.length} onClick={() => setPage(p => p + 1)}>Next rows</button>
      {!committed && <><p>After changing skips or fixing the CSV, refresh the preview before committing. Warnings may be committed; errors may not.</p><button type="button" className="primary-button" disabled={busy || !receipt || result.blockingErrorCount > 0 || result.fileErrors.length > 0} onClick={() => void submit("commit")}>Commit selected rows</button></>}
    </>}
  </section>;
}
