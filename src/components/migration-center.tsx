"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  History,
  RefreshCw,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import { MIGRATION_SOURCES, type MigrationKind, type MigrationSource } from "@/lib/migration-import";
import { PageHeading } from "@/components/workspace/ui";

type MigrationResult = {
  batchId?: number | null;
  dryRun?: boolean;
  source?: MigrationSource;
  kind?: MigrationKind;
  fileName?: string;
  totalRows?: number;
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
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<MigrationResult | null>(null);
  const [history, setHistory] = useState<Batch[]>([]);
  const [busy, setBusy] = useState(false);

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
    if (!csv) return;
    setBusy(true);
    if (dryRun) setPreview(null);
    try {
      const response = await fetch("/api/migrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, source, kind, csv, fileName, dryRun }),
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
    setCsv("");
    setFileName("");
    setPreview(null);
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
            <p>Presets recognize common headings, while the generic option handles other CSV exports.</p>
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
          <label className="input-label">
            CSV export
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setFileName(file.name);
                setCsv(await file.text());
                setPreview(null);
              }}
            />
          </label>

          {fileName && (
            <div className="notice notice-blue" style={{ marginTop: 10 }}>
              <UploadCloud size={16} className="i-teal" />
              <span>
                <strong>{fileName}</strong> · {Math.max(0, csv.trim().split(/\r?\n/).length - 1)} data row(s)
              </span>
            </div>
          )}

          <div className="run-actions" style={{ paddingLeft: 0, paddingRight: 0 }}>
            <button className="secondary-button" disabled={busy || !csv} onClick={() => void submit(true)}>
              <ShieldCheck size={14} /> {busy ? "Checking…" : "Validate migration"}
            </button>
            <button className="secondary-button" disabled={busy || !csv} onClick={resetFile}>
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
                <div className={preview.errorCount ? "notice notice-amber" : "notice notice-green"}>
                  <CheckCircle2 size={16} className={preview.errorCount ? "i-amber" : "i-green"} />
                  <span>
                    <strong>{preview.dryRun ? "Validation complete." : "Migration complete."}</strong>{" "}
                    {preview.createdCount ?? 0} new · {preview.updatedCount ?? 0} updates · {preview.errorCount ?? 0} errors.
                  </span>
                </div>

                <div className="run-stats" style={{ margin: "12px 0" }}>
                  <div><span>Rows</span><strong>{preview.totalRows ?? 0}</strong><small>in uploaded file</small></div>
                  <div><span>New</span><strong>{preview.createdCount ?? 0}</strong><small>records to create</small></div>
                  <div><span>Updates</span><strong>{preview.updatedCount ?? 0}</strong><small>matched by stable ID</small></div>
                  <div><span>Errors</span><strong>{preview.errorCount ?? 0}</strong><small>skipped until fixed</small></div>
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
                    <button className="primary-button brand" disabled={busy} onClick={() => void submit(false)}>
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
