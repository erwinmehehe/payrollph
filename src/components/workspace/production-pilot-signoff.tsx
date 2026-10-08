"use client";

import { useMemo, useState } from "react";
import { Check, ClipboardCheck, ShieldCheck } from "lucide-react";
import type { DashboardData, Notify } from "@/components/workspace/types";
import { Status, money } from "@/components/workspace/ui";

const FIGURES = [
  ["grossPay", "Gross pay", "peso"],
  ["deductions", "Total deductions", "peso"],
  ["netPay", "Net pay", "peso"],
  ["withholdingTax", "Withholding tax", "peso"],
  ["statutoryContributions", "SSS / PhilHealth / Pag-IBIG", "peso"],
  ["payoutTotal", "Payout total", "peso"],
  ["employeeCount", "Employee count", "count"],
] as const;

type FigureKey = (typeof FIGURES)[number][0];

export function ProductionPilotSignoffCard({
  data,
  notify,
  onRefresh,
}: {
  data: DashboardData;
  notify: Notify;
  onRefresh: () => Promise<void>;
}) {
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const releasedRuns = data.payrollRuns
    .filter((run) => run.status === "Released")
    .sort((a, b) => b.id - a.id);
  const releasedRun = releasedRuns.find((run) => run.id === selectedRunId) ?? releasedRuns[0];
  const existing = useMemo(
    () => data.auditEvents.find((event) => {
      if (event.action !== "Production payroll pilot signed off") return false;
      if (!event.metadata || typeof event.metadata !== "object") return false;
      return Number((event.metadata as Record<string, unknown>).runId) === releasedRun?.id;
    }),
    [data.auditEvents, releasedRun?.id],
  );

  const [evidenceReference, setEvidenceReference] = useState("");
  const [independentPreparedBy, setIndependentPreparedBy] = useState("");
  const [reconciliationReportSha256, setReconciliationReportSha256] = useState("");
  const [reconciledEmployeeCount, setReconciledEmployeeCount] = useState("");
  const [independentSourceConfirmed, setIndependentSourceConfirmed] = useState(false);
  const [operatorCompletedWithoutDeveloper, setOperatorCompletedWithoutDeveloper] = useState(false);
  const [employeeLevelReconciliationConfirmed, setEmployeeLevelReconciliationConfirmed] = useState(false);
  const [figures, setFigures] = useState<Record<FigureKey, string>>({
    grossPay: "",
    deductions: "",
    netPay: "",
    withholdingTax: "",
    statutoryContributions: "",
    payoutTotal: "",
    employeeCount: "",
  });
  const [saving, setSaving] = useState(false);
  const [upgradeNoMoneyPilot, setUpgradeNoMoneyPilot] = useState(false);
  const recordedPilotMode = existing?.metadata && typeof existing.metadata === "object"
    ? (existing.metadata as Record<string, unknown>).payoutEvidenceMode
    : null;

  if (!releasedRun) return null;

  const runSelector = releasedRuns.length > 1 ? (
    <label>
      Select the exact released payroll period
      <select
        value={releasedRun.id}
        onChange={(event) => {
          setSelectedRunId(Number(event.target.value));
          setUpgradeNoMoneyPilot(false);
          setEvidenceReference("");
          setIndependentPreparedBy("");
          setReconciliationReportSha256("");
          setReconciledEmployeeCount("");
          setIndependentSourceConfirmed(false);
          setEmployeeLevelReconciliationConfirmed(false);
          setOperatorCompletedWithoutDeveloper(false);
          setFigures({
            grossPay: "", deductions: "", netPay: "", withholdingTax: "",
            statutoryContributions: "", payoutTotal: "", employeeCount: "",
          });
        }}
      >
        {releasedRuns.map((run) => (
          <option key={run.id} value={run.id}>#{run.id} — {run.periodLabel}</option>
        ))}
      </select>
    </label>
  ) : null;

  const allFiguresPresent = FIGURES.every(([key, , kind]) => {
    const value = figures[key].trim();
    if (!value) return false;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return false;
    return kind === "count" ? Number.isInteger(parsed) && parsed > 0 : true;
  });

  async function signOff() {
    if (!releasedRun) return;
    setSaving(true);
    try {
      const independentFigures = Object.fromEntries(
        FIGURES.map(([key]) => [key, Number(figures[key])]),
      );
      const response = await fetch(`/api/payroll-runs/${releasedRun.id}/pilot-signoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evidenceReference: evidenceReference.trim(),
          independentPreparedBy: independentPreparedBy.trim(),
          reconciliationReportSha256: reconciliationReportSha256.trim(),
          reconciledEmployeeCount: Number(reconciledEmployeeCount),
          independentSourceConfirmed,
          employeeLevelReconciliationConfirmed,
          operatorCompletedWithoutDeveloper,
          independentFigures,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(payload.error ?? "Production pilot sign-off could not be recorded.", "err");
        return;
      }
      notify(
        payload.alreadyRecorded
          ? "Production pilot sign-off was already recorded."
          : "Independent production payroll figures matched and the pilot was signed off.",
        "ok",
      );
      await onRefresh();
    } catch {
      notify("Production pilot sign-off could not reach the server.", "err");
    } finally {
      setSaving(false);
    }
  }

  if (existing && !(recordedPilotMode === "no-money-bank-file-dry-run" && upgradeNoMoneyPilot)) {
    const metadata = existing.metadata && typeof existing.metadata === "object"
      ? existing.metadata as Record<string, unknown>
      : {};
    return (
      <article className="card" data-production-pilot-signoff="complete" style={{ marginBottom: 16 }}>
        {runSelector && <div className="card-body">{runSelector}</div>}
        <div className="card-header">
          <div>
            <div className="card-kicker"><ShieldCheck size={14} /> PRODUCTION PILOT</div>
            <h2>{recordedPilotMode === "no-money-bank-file-dry-run"
              ? "No-money payroll pilot reconciled"
              : "Independent payroll pilot signed off"}</h2>
            <p>
              {recordedPilotMode === "no-money-bank-file-dry-run"
                ? "The payroll arithmetic and dry-run bank file were recorded. No bank transfer or settlement has been proven, so the broad-launch payout pilot gate remains blocked."
                : "The payroll evidence and completed-payout attestation were recorded. Government, bank, privacy and production recovery acceptance remain separate gates."}
            </p>
            {typeof metadata.evidenceReference === "string" && (
              <small>Evidence: {metadata.evidenceReference}</small>
            )}
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <Status value={recordedPilotMode === "no-money-bank-file-dry-run" ? "Pilot only" : "Signed off"} />
            {recordedPilotMode === "no-money-bank-file-dry-run" && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => setUpgradeNoMoneyPilot(true)}
              >
                Record completed-payout evidence
              </button>
            )}
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="card" data-production-pilot-signoff="required" style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker"><ClipboardCheck size={14} /> LAUNCH EVIDENCE</div>
          <h2>Reconcile and sign off the real payroll pilot</h2>
          <p>
            Enter totals from an independently prepared worksheet. Linaw will compare them to the released payroll server-side before accepting launch evidence.
          </p>
        </div>
        <Status value="Required" />
      </div>

      <div className="card-body" style={{ paddingTop: 0, display: "grid", gap: 14 }}>
        {runSelector}
        {upgradeNoMoneyPilot && (
          <div className="notice notice-amber">
            The previous no-money reconciliation remains intact. Only continue after the bank
            confirms settlement and an independent reviewer has verified the paid period.
            This form does not initiate any payment.
          </div>
        )}
        <div className="run-stats" style={{ margin: 0 }}>
          <div>
            <span>Run</span>
            <strong>#{releasedRun.id}</strong>
            <small>{releasedRun.periodLabel}</small>
          </div>
          <div>
            <span>Employees</span>
            <strong>{releasedRun.employeeCount}</strong>
            <small>Linaw released count</small>
          </div>
          <div>
            <span>Net payroll</span>
            <strong className="green-number">{money(releasedRun.netPay)}</strong>
            <small>Linaw released total</small>
          </div>
        </div>

        <div className="setting-form">
          <label>
            Independent evidence reference
            <input
              value={evidenceReference}
              maxLength={200}
              onChange={(event) => setEvidenceReference(event.target.value)}
              placeholder="External workbook / accountant review reference"
            />
          </label>
          <label>
            Independent figures prepared by
            <input
              value={independentPreparedBy}
              maxLength={120}
              onChange={(event) => setIndependentPreparedBy(event.target.value)}
              placeholder="Name or responsible reviewer"
            />
          </label>
          <label>
            Private reconciliation report SHA-256
            <input
              value={reconciliationReportSha256}
              maxLength={64}
              onChange={(event) => setReconciliationReportSha256(event.target.value)}
              placeholder="64-character SHA-256 of independently reviewed private report"
              autoComplete="off"
            />
          </label>
          <label>
            Employees covered by the independent reconciliation
            <input
              type="number"
              min={1}
              step={1}
              value={reconciledEmployeeCount}
              onChange={(event) => setReconciledEmployeeCount(event.target.value)}
              placeholder="Reconciled employee count"
            />
          </label>
        </div>

        <div>
          <div className="card-kicker" style={{ marginBottom: 8 }}>INDEPENDENT FIGURES</div>
          <div className="setting-form">
            {FIGURES.map(([key, label, kind]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min={kind === "count" ? 1 : 0}
                  step={kind === "count" ? 1 : "0.01"}
                  inputMode={kind === "count" ? "numeric" : "decimal"}
                  value={figures[key]}
                  onChange={(event) => setFigures((current) => ({ ...current, [key]: event.target.value }))}
                  placeholder={kind === "count" ? "Independent headcount" : "0.00"}
                />
              </label>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <label className="switch">
            <input
              type="checkbox"
              checked={independentSourceConfirmed}
              onChange={(event) => setIndependentSourceConfirmed(event.target.checked)}
            />
            <i aria-hidden />
            <span>These figures were prepared independently and were not copied from Linaw</span>
          </label>
          <label className="switch">
            <input
              type="checkbox"
              checked={employeeLevelReconciliationConfirmed}
              onChange={(event) => setEmployeeLevelReconciliationConfirmed(event.target.checked)}
            />
            <i aria-hidden />
            <span>Every employee was compared against the independent payroll source within ₱0.01, with all exceptions explained and recorded in the private evidence reference</span>
          </label>
          <label className="switch">
            <input
              type="checkbox"
              checked={operatorCompletedWithoutDeveloper}
              onChange={(event) => setOperatorCompletedWithoutDeveloper(event.target.checked)}
            />
            <i aria-hidden />
            <span>The payroll operator completed this cycle without developer intervention</span>
          </label>
        </div>

        <div className="notice notice-amber" style={{ margin: 0 }}>
          <ClipboardCheck size={15} />
          <span>
            Sign-off requires independently reconciled employee figures, matching totals and headcount, payslips, and an accounting journal export. A recorded bank-file dry-run is sufficient for this no-money pilot; actual bank acceptance is a separate launch gate.
          </span>
        </div>

        <div>
          <button
            className="primary-button brand"
            disabled={
              saving
              || evidenceReference.trim().length < 8
              || independentPreparedBy.trim().length < 3
              || !/^[0-9a-f]{64}$/.test(reconciliationReportSha256.trim().toLowerCase())
              || Number(reconciledEmployeeCount) !== releasedRun.employeeCount
              || !allFiguresPresent
              || !independentSourceConfirmed
              || !employeeLevelReconciliationConfirmed
              || !operatorCompletedWithoutDeveloper
            }
            onClick={() => void signOff()}
          >
            {saving ? "Verifying reconciliation…" : <><Check size={14} /> Verify figures & sign off pilot</>}
          </button>
        </div>
      </div>
    </article>
  );
}
