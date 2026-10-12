"use client";

import { EmployeeImportPreviewPanel } from "./employee-import-preview-panel";
import { useState } from "react";
import { FileSpreadsheet, Upload, UsersRound } from "lucide-react";
import { EmployeeImportReview } from "@/components/workspace/employee-import-review";
import { useWorkflowUi } from "@/components/workspace/workflow-ui-context";

type ImportResult = {
  batchId?: number;
  dryRun?: boolean;
  fileName?: string;
  totalRows?: number;
  createdCount?: number;
  updatedCount?: number;
  newEligibleCount?: number;
  skippedExistingCount?: number;
  errorCount?: number;
  errors?: { line: number; problems: string[] }[];
  unmappedColumns?: string[];
  seatUsage?: { used: number; limit: number | null };
  error?: string;
  plan?: string;
  seatLimit?: number;
  currentlyUsed?: number;
  rowsRequested?: number;
  upgradeRequired?: boolean;
};

export function ImportPanel({ organizationId, onImported, previewEnabled = false }: { organizationId: number; onImported: () => void; previewEnabled?: boolean }) {
  return previewEnabled ? <EmployeeImportPreviewPanel key={organizationId} organizationId={organizationId} onImported={onImported} /> : <LegacyImportPanel organizationId={organizationId} onImported={onImported} />;
}
function LegacyImportPanel({ organizationId, onImported }: { organizationId: number; onImported: () => void }) {
  const reviewEnabled = useWorkflowUi().importReview;
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("upload.csv");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [networkError, setNetworkError] = useState("");

  async function submit(dryRun: boolean) {
    setBusy(true); setNetworkError("");
    if (!dryRun) setResult(null);
    try {
      const response = await fetch("/api/employees/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, csv, fileName, dryRun }),
      });
      const payload = await response.json() as ImportResult;
      setResult(payload);
      if (response.ok && !dryRun) {
        if ((payload.errorCount ?? 0) === 0) setCsv("");
        if ((payload.createdCount ?? 0) > 0) onImported();
      }
    } catch {
      setNetworkError("The import server could not be reached. Nothing was confirmed; retry validation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">BULK ONBOARDING</div>
          <h2>Import employees from a spreadsheet</h2>
          <p>Import new employees only. Include each worker&#39;s actual employment Start Date (YYYY-MM-DD). Existing employee numbers are skipped; salary, bank details, positions and separations must use their approved change workflows.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="secondary-button" href="/api/employees/import/template" download><FileSpreadsheet size={15} className="i-teal" /> Template</a>
          <button className="primary-button" onClick={() => setOpen(!open)}><Upload size={15} className="i-teal" /> {open ? "Close" : "Import CSV"}</button>
        </div>
      </div>

      {open && (
        <>
          <div style={{ padding: "0 17px 12px" }}>
            <label className="input-label">CSV file
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  setFileName(file.name);
                  setResult(null); setNetworkError("");
                  setCsv(await file.text());
                }}
              />
            </label>
            {csv && <p className="auth-copy">{fileName} · {csv.trim().split(/\r?\n/).length - 1} data row(s) loaded</p>}
            {reviewEnabled && <p className="auth-copy">Review validation errors before submitting new employees.</p>}
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button className="secondary-button" onClick={() => submit(true)} disabled={busy || !csv}>{busy ? "Checking…" : "Validate only"}</button>
              <button className="primary-button" onClick={() => submit(false)} disabled={busy || !csv || (reviewEnabled && (!result?.dryRun || !!result.error || (result.errorCount ?? 0) > 0))}>{busy ? "Importing…" : "Import employees"}</button>
            </div>
          </div>

          {networkError && <div role="alert" className="notice notice-amber">{networkError}</div>}
          {reviewEnabled && csv && <EmployeeImportReview csv={csv} fileName={fileName} errors={result?.errors} />}
          {result && (
            <div style={{ padding: "0 17px 16px" }}>
              {result.error && !result.errors && (
                <div className="notice notice-amber"><UsersRound size={16} className="i-purple" /><span><strong>{result.error}</strong>{result.plan && <> Current plan: {result.plan}.</>}{result.seatLimit && <> Seats in use: {result.currentlyUsed} of {result.seatLimit}.</>}</span></div>
              )}
              {result.errorCount === 0 && result.error === undefined && (
                <div className="notice notice-green"><UsersRound size={16} className="i-purple" /><span><strong>{result.dryRun ? "Validation passed" : "Import complete"}.</strong> {result.dryRun ? `${result.newEligibleCount ?? 0} new employees eligible; no records changed.` : `${result.createdCount ?? 0} created; no existing records overwritten.`}</span></div>
              )}
              {(result.errorCount ?? 0) > 0 && (
                <div className="notice notice-amber"><UsersRound size={16} className="i-purple" /><div><strong>{result.errorCount} row(s) need fixing</strong><span>{result.dryRun ? "No employees created during validation." : `${result.createdCount ?? 0} new employees created. Existing records remain unchanged.`}</span></div></div>
              )}
              <div className="audit-list" style={{ marginTop: 8 }}>
                {(result.errors ?? []).slice(0, 10).map((row, index) => (
                  <div className="audit-row" key={index}>
                    <span className="audit-dot">{row.line || "-"}</span>
                    <div><strong>{row.problems.join("; ")}</strong></div>
                  </div>
                ))}
              </div>
              {(result.unmappedColumns ?? []).length > 0 && (
                <p className="auth-copy">Ignored extra columns: {result.unmappedColumns?.join(", ")}</p>
              )}
              {result.seatUsage && <p className="auth-copy">Seats in use: {result.seatUsage.used}{result.seatUsage.limit ? ` of ${result.seatUsage.limit}` : " (unlimited)"}</p>}
            </div>
          )}
        </>
      )}
    </article>
  );
}
