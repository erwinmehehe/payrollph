"use client";

import { useState } from "react";
import { FileCheck2, FileSpreadsheet, Upload } from "lucide-react";
import type { Notify } from "./types";
import { Spinner } from "./ui";

type ImportResult = {
  dryRun?: boolean;
  fileName?: string;
  batchId?: number;
  fileHash?: string;
  validRows?: number;
  errorCount?: number;
  errors?: { line: number; problems: string[] }[];
  unmappedColumns?: string[];
  applied?: boolean;
  reconciled?: boolean;
  pendingPostingCount?: number;
  exceptionCount?: number;
  message?: string;
  error?: string;
  validationFailed?: boolean;
  amountMismatchCount?: number;
  autoCaseIds?: number[];
  casesOpened?: boolean;
};

export function StatutoryPostingImport({
  organizationId,
  batchId,
  agency,
  applicableMonth,
  notify,
  onImported,
}: {
  organizationId: number;
  batchId: number;
  agency: string;
  applicableMonth: string;
  notify: Notify;
  onImported: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("posting-evidence.csv");
  const [busy, setBusy] = useState<"validate" | "apply" | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function submit(dryRun: boolean, openMismatchCases = false) {
    setBusy(dryRun ? "validate" : "apply");
    setResult(null);
    try {
      const response = await fetch("/api/compliance/statutory-remittances/posting-import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId,
          batchId,
          csv,
          fileName,
          dryRun,
          openMismatchCases,
        }),
      });
      const body = await response.json().catch(() => ({})) as ImportResult;
      setResult(body);
      if (!response.ok) {
        notify(body.error ?? body.message ?? "Posting evidence did not pass validation.", "err");
        return;
      }
      if (openMismatchCases) {
        notify(
          body.message ?? `${body.autoCaseIds?.length ?? 0} compliance case(s) opened from posting mismatches.`,
          "ok",
        );
        return;
      }
      notify(
        dryRun
          ? `${body.validRows ?? 0} posting rows validated. Nothing changed yet.`
          : `${body.validRows ?? 0} posting rows applied.`,
        "ok",
      );
      if (!dryRun) {
        await onImported();
        window.dispatchEvent(new Event("statutory-remittance-changed"));
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Posting evidence import failed.", "err");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: 8 }} data-statutory-posting-import>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="secondary-button" type="button" onClick={() => setOpen((value) => !value)}>
          <Upload size={14} /> {open ? "Close bulk reconcile" : "Bulk reconcile CSV"}
        </button>
        <a
          className="secondary-button"
          href="/api/compliance/statutory-remittances/posting-import"
          download="statutory-posting-template.csv"
        >
          <FileSpreadsheet size={14} /> Template
        </a>
      </div>

      {open && (
        <div className="leave-request" style={{ display: "grid", gap: 10 }}>
          <div>
            <strong>{agency} · {applicableMonth} posting evidence</strong>
            <p style={{ margin: "3px 0 0" }}>
              Required columns: employee_no, posted_amount, posting_reference, posted_at. Apply is all-or-nothing.
            </p>
          </div>
          <label className="input-label">
            Agency posting CSV
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setFileName(file.name);
                setCsv(await file.text());
                setResult(null);
              }}
            />
          </label>
          {csv && (
            <p className="auth-copy">
              {fileName} · {Math.max(0, csv.trim().split(/\r?\n/).length - 1)} data row(s)
            </p>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="secondary-button"
              type="button"
              disabled={!csv || busy !== null}
              onClick={() => void submit(true)}
            >
              {busy === "validate" ? <Spinner label="Validating" /> : <FileCheck2 size={14} />} Validate only
            </button>
            <button
              className="primary-button brand"
              type="button"
              disabled={!csv || busy !== null || !result?.dryRun || (result.errorCount ?? 1) > 0}
              onClick={() => void submit(false)}
            >
              {busy === "apply" ? <Spinner label="Applying" /> : <Upload size={14} />} Apply validated file
            </button>
          </div>

          {result && (
            <div style={{ display: "grid", gap: 8 }}>
              {result.errorCount === 0 && !result.error ? (
                <div className="notice notice-green" style={{ margin: 0 }}>
                  <FileCheck2 size={15} />
                  <span>
                    <strong>{result.applied ? "Import applied" : "Validation passed"}.</strong>{" "}
                    {result.validRows ?? 0} row(s) matched exactly.
                    {result.reconciled ? " The batch is now fully reconciled." : ""}
                  </span>
                </div>
              ) : (
                <div className="notice notice-red" style={{ margin: 0 }}>
                  <FileCheck2 size={15} />
                  <span>
                    <strong>{result.errorCount ?? 1} issue(s) found.</strong>{" "}
                    No rows were applied.
                  </span>
                </div>
              )}

              {(result.amountMismatchCount ?? 0) > 0 && !result.casesOpened && (
                <div className="notice notice-amber" style={{ margin: 0 }}>
                  <FileCheck2 size={15} />
                  <span>
                    <strong>{result.amountMismatchCount} agency amount mismatch{result.amountMismatchCount === 1 ? "" : "es"} detected.</strong>{" "}
                    These can be opened as employee contribution compliance cases without applying the invalid posting file.
                  </span>
                </div>
              )}
              {(result.amountMismatchCount ?? 0) > 0 && !result.casesOpened && (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void submit(true, true)}
                >
                  Open {result.amountMismatchCount} compliance case{result.amountMismatchCount === 1 ? "" : "s"}
                </button>
              )}
              {result.casesOpened && (
                <div className="notice notice-green" style={{ margin: 0 }}>
                  <FileCheck2 size={15} />
                  <span>
                    <strong>{result.autoCaseIds?.length ?? 0} compliance case(s) opened.</strong>{" "}
                    The invalid posting file was not applied.
                  </span>
                </div>
              )}

              {(result.errors ?? []).slice(0, 12).map((error, index) => (
                <div className="audit-row" key={`${error.line}-${index}`}>
                  <span className="audit-dot">{error.line}</span>
                  <div><strong>{error.problems.join("; ")}</strong></div>
                </div>
              ))}
              {(result.unmappedColumns ?? []).length > 0 && (
                <p className="auth-copy">
                  Ignored extra columns: {result.unmappedColumns?.join(", ")}
                </p>
              )}
              {result.fileHash && (
                <p className="auth-copy">Evidence file hash: {result.fileHash.slice(0, 16)}…</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
