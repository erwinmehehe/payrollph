"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Database,
  Download,
  FileSpreadsheet,
  History,
  RefreshCw,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import {
  MIGRATION_SOURCES,
  MIGRATION_TEMPLATE_HEADERS,
  type MigrationKind,
  type MigrationSource,
} from "@/lib/migration-import";
import { PageHeading } from "@/components/workspace/ui";

type MigrationResult = {
  batchId?: number | null;
  dryRun?: boolean;
  source?: MigrationSource;
  kind?: MigrationKind;
  fileName?: string;
  totalRows?: number;
  readyCount?: number;
  attentionCount?: number;
  duplicateCount?: number;
  createdCount?: number;
  updatedCount?: number;
  errorCount?: number;
  errors?: { line: number; problems: string[] }[];
  mappings?: Record<string, string>;
  unmappedColumns?: string[];
  seatUsage?: { used: number; limit: number | null };
  error?: string;
  plan?: string;
  seatLimit?: number;
  currentlyUsed?: number;
  newEmployees?: number;
};

type Batch = {
  id: number;
  fileName: string;
  sourceSystem: string;
  importKind: string;
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  errorCount: number;
  status: string;
  createdBy: string;
  createdAt: string;
};

const KINDS: Array<{ id: MigrationKind; label: string; copy: string }> = [
  { id: "employees", label: "Employees", copy: "People, salary, government IDs and payout details" },
  { id: "payroll_history", label: "Payroll history / YTD", copy: "Prior gross, net, tax and statutory totals" },
  { id: "leave_balances", label: "Leave balances", copy: "Opening, accrued, used and pending balances" },
  { id: "loans", label: "Loans", copy: "Outstanding balances and payroll deductions" },
];

function kindLabel(kind: string) {
  return KINDS.find((item) => item.id === kind)?.label ?? kind.replaceAll("_", " ");
}

function sourceLabel(source: string) {
  return MIGRATION_SOURCES.find((item) => item.id === source)?.label ?? source;
}

export function MigrationCenter({
  organizationId,
  onImported,
}: {
  organizationId: number;
  onImported?: () => Promise<void> | void;
}) {
  const [source, setSource] = useState<MigrationSource>("sprout");
  const [kind, setKind] = useState<MigrationKind>("employees");
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<MigrationResult | null>(null);
  const [history, setHistory] = useState<Batch[]>([]);
  const [busy, setBusy] = useState(false);
  const [evidenceReference, setEvidenceReference] = useState("");

  const selectedSource = useMemo(
    () => MIGRATION_SOURCES.find((item) => item.id === source) ?? MIGRATION_SOURCES.at(-1)!,
    [source],
  );

  async function loadHistory() {
    const response = await fetch(`/api/migrations?organizationId=${organizationId}`, { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json().catch(() => ({}));
    setHistory(Array.isArray(payload.batches) ? payload.batches : []);
  }

  useEffect(() => {
    void loadHistory();
  }, [organizationId]);

  async function submit(dryRun: boolean) {
    if (!file) return;
    setBusy(true);
    if (dryRun) setPreview(null);
    try {
      const form = new FormData();
      form.set("organizationId", String(organizationId));
      form.set("source", source);
      form.set("kind", kind);
      form.set("dryRun", String(dryRun));
      if (kind === "employees") form.set("evidenceReference", evidenceReference.trim());
      form.set("file", file, file.name);

      const response = await fetch("/api/migrations", {
        method: "POST",
        body: form,
      });
      const payload = (await response.json().catch(() => ({}))) as MigrationResult;
      setPreview(payload);
      if (response.ok && !dryRun) {
        await loadHistory();
        await onImported?.();
      }
    } finally {
      setBusy(false);
    }
  }

  function resetFile() {
    setFile(null);
    setFileName("");
    setPreview(null);
  }

  function downloadTemplate() {
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const csv = `${MIGRATION_TEMPLATE_HEADERS[kind].map(escape).join(",")}\n`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `linaw-${kind.replaceAll("_", "-")}-migration-template.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const validPreview = preview && !preview.error && preview.dryRun === true;

  return (
    <>
      <PageHeading
        eyebrow="Migration"
        title="Switch payroll without rebuilding everything."
        copy="Import data from another payroll or HRIS, validate it first, then commit only the rows that pass. Prior payroll stays historical and is never recalculated with today's rules."
      />

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">1 · CURRENT SYSTEM</div>
            <h2>Where are you switching from?</h2>
            <p>Presets recognize common headings, while the generic option handles other CSV or Excel exports.</p>
          </div>
          <Database size={20} className="i-purple" />
        </div>
        <div style={{ padding: "0 17px 17px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8 }}>
          {MIGRATION_SOURCES.map((item) => (
            <button
              key={item.id}
              className={source === item.id ? "primary-button" : "secondary-button"}
              style={{ minHeight: 58, textAlign: "left", justifyContent: "flex-start" }}
              onClick={() => {
                setSource(item.id);
                setPreview(null);
              }}
            >
              <span>
                <strong style={{ display: "block" }}>{item.label}</strong>
                <small style={{ display: "block", marginTop: 3, opacity: 0.75 }}>{item.note}</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">2 · DATA TO BRING OVER</div>
            <h2>Import in a safe order</h2>
            <p>Employees first. History, balances and loans can then match against the original employee ID.</p>
          </div>
        </div>
        <div style={{ padding: "0 17px 17px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(205px, 1fr))", gap: 8 }}>
          {KINDS.map((item, index) => (
            <button
              key={item.id}
              className={kind === item.id ? "primary-button" : "secondary-button"}
              style={{ minHeight: 68, textAlign: "left", justifyContent: "flex-start" }}
              onClick={() => {
                setKind(item.id);
                setPreview(null);
              }}
            >
              <span>
                <strong style={{ display: "block" }}>{index + 1}. {item.label}</strong>
                <small style={{ display: "block", marginTop: 3, opacity: 0.75 }}>{item.copy}</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">3 · UPLOAD & VALIDATE</div>
            <h2>{selectedSource.label} · {kindLabel(kind)}</h2>
            <p>Nothing is written during validation. We show matched columns, ignored columns and row-level errors first.</p>
          </div>
          <FileSpreadsheet size={20} className="i-teal" />
        </div>

        <div style={{ padding: "0 17px 17px" }}>
          <div className="run-actions" style={{ paddingLeft: 0, paddingRight: 0, paddingTop: 0 }}>
            <button className="secondary-button" type="button" onClick={downloadTemplate}>
              <Download size={14} className="i-teal" /> Download {kindLabel(kind)} template
            </button>
          </div>

          <label className="input-label">
            CSV or Excel export
            <input
              key={fileName || "migration-file"}
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null;
                if (!selected) return;
                setFile(selected);
                setFileName(selected.name);
                setPreview(null);
              }}
            />
          </label>
          <p className="auth-copy" style={{ marginTop: 6 }}>
            Upload a .csv or modern Excel .xlsx export up to 15 MB. The first worksheet is used for Excel files.
          </p>

          {fileName && file && (
            <div className="notice notice-blue" style={{ marginTop: 10 }}>
              <UploadCloud size={16} className="i-teal" />
              <span>
                <strong>{fileName}</strong> · {Math.max(1, Math.ceil(file.size / 1024)).toLocaleString("en-PH")} KB
              </span>
            </div>
          )}

          {kind === "employees" && (
            <div style={{ marginTop: 12 }}>
              <label className="input-label">
                HR migration evidence reference (required before commit)
                <input
                  value={evidenceReference}
                  maxLength={200}
                  placeholder="Approved migration workbook / owner sign-off reference"
                  onChange={(event) => setEvidenceReference(event.target.value)}
                />
              </label>
              <p className="auth-copy">
                Initial employee-master migration is available only before payroll, governed HR activity,
                pay revisions and position assignments exist. Existing records may be overwritten only
                through an authorized, evidenced first migration; do not use it for live HR corrections.
              </p>
            </div>
          )}
          <div className="run-actions" style={{ paddingLeft: 0, paddingRight: 0 }}>
            <button className="secondary-button" disabled={busy || !file} onClick={() => void submit(true)}>
              <ShieldCheck size={14} /> {busy ? "Checking…" : "Validate migration"}
            </button>
            <button className="secondary-button" disabled={busy || !file} onClick={resetFile}>
              <RefreshCw size={14} /> Clear
            </button>
          </div>
        </div>

        {preview && (
          <div style={{ padding: "0 17px 17px" }}>
            {preview.error ? (
              <div className="notice notice-amber">
                <span><strong>{preview.error}</strong></span>
              </div>
            ) : (
              <>
                <div className={(preview.attentionCount ?? 0) > 0 || (preview.duplicateCount ?? 0) > 0 ? "notice notice-amber" : "notice notice-green"}>
                  <CheckCircle2
                    size={16}
                    className={(preview.attentionCount ?? 0) > 0 || (preview.duplicateCount ?? 0) > 0 ? "i-amber" : "i-green"}
                  />
                  <span>
                    <strong>{preview.dryRun ? "Validation complete." : "Migration complete."}</strong>{" "}
                    {preview.readyCount ?? ((preview.createdCount ?? 0) + (preview.updatedCount ?? 0))} ready ·{" "}
                    {preview.attentionCount ?? preview.errorCount ?? 0} need attention ·{" "}
                    {preview.duplicateCount ?? 0} duplicates.
                  </span>
                </div>

                <div className="run-stats" style={{ margin: "12px 0" }}>
                  <div><span>Rows</span><strong>{preview.totalRows ?? 0}</strong><small>in uploaded file</small></div>
                  <div><span>Ready</span><strong>{preview.readyCount ?? 0}</strong><small>{preview.createdCount ?? 0} new · {preview.updatedCount ?? 0} updates</small></div>
                  <div><span>Need attention</span><strong>{preview.attentionCount ?? preview.errorCount ?? 0}</strong><small>fix before they can import</small></div>
                  <div><span>Duplicates</span><strong>{preview.duplicateCount ?? 0}</strong><small>skipped from this batch</small></div>
                </div>

                {Object.keys(preview.mappings ?? {}).length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div className="card-kicker">DETECTED COLUMN MAPPING</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                      {Object.entries(preview.mappings ?? {}).map(([target, sourceColumn]) => (
                        <span key={target} className="status-chip active">{sourceColumn} → {target}</span>
                      ))}
                    </div>
                  </div>
                )}

                {(preview.unmappedColumns ?? []).length > 0 && (
                  <p className="auth-copy">
                    Ignored for this import: {(preview.unmappedColumns ?? []).join(", ")}
                  </p>
                )}

                {(preview.errors ?? []).length > 0 && (
                  <div className="audit-list" style={{ marginTop: 8 }}>
                    {(preview.errors ?? []).slice(0, 12).map((row, index) => (
                      <div className="audit-row" key={`${row.line}-${index}`}>
                        <span className="audit-dot">{row.line || "-"}</span>
                        <div><strong>{row.problems.join("; ")}</strong></div>
                      </div>
                    ))}
                  </div>
                )}

                {kind === "employees" && (preview.migrationBlockers ?? []).length > 0 && (
                  <div className="notice notice-amber" style={{ marginTop: 12 }}>
                    <span><strong>Initial employee migration is locked.</strong> {(preview.migrationBlockers ?? []).join(" ")}</span>
                  </div>
                )}

                {kind === "payroll_history" && (
                  <div className="notice notice-blue" style={{ marginTop: 12 }}>
                    <History size={16} className="i-purple" />
                    <span>
                      Historical payroll is preserved exactly as imported. Gross, statutory contributions, tax withheld and 13th-month values feed year-end annualization, but old periods are not rerun through the current payroll engine.
                    </span>
                  </div>
                )}

                {validPreview && (
                  <div className="run-actions" style={{ paddingLeft: 0, paddingRight: 0 }}>
                    <button
                      className="primary-button brand"
                      disabled={busy || (kind === "employees" && (
                        evidenceReference.trim().length < 8
                        || evidenceReference.trim().length > 200
                        || (preview.migrationBlockers ?? []).length > 0
                      ))}
                      onClick={() => void submit(false)}
                    >
                      <ArrowRight size={15} /> {busy ? "Importing…" : "Complete migration"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-header">
          <div>
            <div className="card-kicker">MIGRATION HISTORY</div>
            <h2>Recent imports</h2>
            <p>Every committed migration records the source, file, counts and operator for auditability.</p>
          </div>
        </div>
        <div className="audit-list" style={{ padding: "0 17px 17px" }}>
          {history.length === 0 ? (
            <p className="auth-copy">No committed migration batches yet.</p>
          ) : history.slice(0, 10).map((batch) => (
            <div className="audit-row" key={batch.id}>
              <span className="audit-dot">{batch.id}</span>
              <div>
                <strong>{sourceLabel(batch.sourceSystem)} · {kindLabel(batch.importKind)}</strong>
                <span>{batch.fileName} · {batch.createdCount} new · {batch.updatedCount} updated · {batch.errorCount} errors</span>
              </div>
              <small>{new Date(batch.createdAt).toLocaleDateString("en-PH")}</small>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
