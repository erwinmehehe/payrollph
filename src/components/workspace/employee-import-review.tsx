"use client";

import { useMemo, useState } from "react";
import { makeEmployeeImportErrorCsv, parseEmployeeImportPreview, type EmployeeImportError } from "@/lib/employee-import-preview";

export function EmployeeImportReview({ csv, fileName, errors = [] }: {
  csv: string;
  fileName: string;
  errors?: EmployeeImportError[];
}) {
  const [filter, setFilter] = useState<"all" | "errors" | "valid">("all");
  const preview = useMemo(() => {
    try { return { value: parseEmployeeImportPreview(csv, errors), error: "" }; }
    catch (cause) { return { value: null, error: cause instanceof Error ? cause.message : "CSV preview unavailable." }; }
  }, [csv, errors]);
  const rows = preview.value?.rows.filter(row =>
    filter === "all" || (filter === "errors" ? row.problems.length > 0 : row.problems.length === 0)) ?? [];
  function downloadErrors() {
    try {
      const text = makeEmployeeImportErrorCsv(csv, errors);
      const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url; a.download = fileName.replace(/\.csv$/i, "") + "-errors.csv";
      document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch { /* Invalid CSV preview already displays the parsing error. */ }
  }
  return <section aria-label="Employee import preview" className="card" style={{
    boxShadow: "none", padding: 14, margin: "10px 16px 16px",
  }}>
    <h3>Preview and review rows</h3>
    {preview.error ? <p role="alert">{preview.error}</p> : preview.value && <>
      {preview.value.total === 0 && <p>No data rows in this file. Add employees before importing.</p>}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <label>Show
          <select aria-label="Import rows filter" value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>
            <option value="all">All rows</option>
            <option value="valid">Rows without reported errors</option>
            <option value="errors">Rows with errors</option>
          </select>
        </label>
        {errors.length > 0 && <button type="button" className="secondary-button" onClick={downloadErrors}>
          Download error CSV ({errors.length})
        </button>}
      </div>
      {rows.length === 0 && <div role="status" className="empty-state" style={{ padding: 12 }}>
        {filter === "errors" ? "No errors in the visible preview." : "No rows match this filter."}
      </div>}
      {rows.length > 0 && <div className="data-table-wrap" style={{ maxWidth: "100%", overflowX: "auto" }}>
        <table className="data-table" aria-label="Employee import row preview">
          <thead><tr><th>Source line</th>{preview.value.headers.map((heading,i)=><th key={i}>{heading || `Column ${i+1}`}</th>)}<th>Validation</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.line}>
            <th>{row.line}</th>
            {preview.value!.headers.map((_, i) => <td key={i}>{row.cells[i] ?? ""}</td>)}
            <td>{row.problems.length ? <span role="status" style={{ color: "var(--danger)" }}>{row.problems.join("; ")}</span>
              : <span>{errors.length ? "No error reported" : "Run validation for server checks"}</span>}</td>
          </tr>)}</tbody>
        </table>
      </div>}
      {preview.value.truncated && <p>Showing first {preview.value.rows.length} of {preview.value.total} rows. The downloaded error CSV contains every reported error.</p>}
    </>}
  </section>;
}
