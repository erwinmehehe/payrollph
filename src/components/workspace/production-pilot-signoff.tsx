"use client";

import { useMemo, useState } from "react";
import { Check, ClipboardCheck, ShieldCheck } from "lucide-react";
import type { DashboardData, Notify } from "@/components/workspace/types";
import { Status, money } from "@/components/workspace/ui";

const CHECKS = [
  ["grossPay", "Gross pay"],
  ["deductions", "Deductions"],
  ["netPay", "Net pay"],
  ["withholdingTax", "Withholding tax"],
  ["statutoryContributions", "SSS / PhilHealth / Pag-IBIG"],
  ["payoutTotal", "Payout total"],
  ["payslips", "Payslip values"],
  ["accountingExport", "Accounting export totals"],
] as const;

export function ProductionPilotSignoffCard({
  data,
  notify,
  onRefresh,
}: {
  data: DashboardData;
  notify: Notify;
  onRefresh: () => Promise<void>;
}) {
  const releasedRun = data.payrollRuns.find((run) => run.status === "Released");
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
  const [operatorCompletedWithoutDeveloper, setOperatorCompletedWithoutDeveloper] = useState(false);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  if (!releasedRun) return null;

  const allChecked = CHECKS.every(([key]) => checks[key] === true);

  async function signOff() {
    if (!releasedRun) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/payroll-runs/${releasedRun.id}/pilot-signoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evidenceReference: evidenceReference.trim(),
          independentPreparedBy: independentPreparedBy.trim(),
          operatorCompletedWithoutDeveloper,
          checks,
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
          : "Independent production payroll pilot evidence recorded.",
        "ok",
      );
      await onRefresh();
    } catch {
      notify("Production pilot sign-off could not reach the server.", "err");
    } finally {
      setSaving(false);
    }
  }

  if (existing) {
    return (
      <article className="card" data-production-pilot-signoff="complete" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker"><ShieldCheck size={14} /> PRODUCTION PILOT</div>
            <h2>Independent payroll pilot signed off</h2>
            <p>
              A released payroll cycle has independent reconciliation evidence on the audit trail.
            </p>
          </div>
          <Status value="Signed off" />
        </div>
      </article>
    );
  }

  return (
    <article className="card" data-production-pilot-signoff="required" style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker"><ClipboardCheck size={14} /> LAUNCH EVIDENCE</div>
          <h2>Sign off the real payroll pilot</h2>
          <p>
            Do this only after an independent calculation outside Linaw matches the released cycle and the operator completed it without developer intervention.
          </p>
        </div>
        <Status value="Required" />
      </div>

      <div className="card-body" style={{ paddingTop: 0, display: "grid", gap: 14 }}>
        <div className="run-stats" style={{ margin: 0 }}>
          <div>
            <span>Run</span>
            <strong>#{releasedRun.id}</strong>
            <small>{releasedRun.periodLabel}</small>
          </div>
          <div>
            <span>Employees</span>
            <strong>{releasedRun.employeeCount}</strong>
            <small>released entries</small>
          </div>
          <div>
            <span>Net payroll</span>
            <strong className="green-number">{money(releasedRun.netPay)}</strong>
            <small>must match independent proof</small>
          </div>
        </div>

        <div className="setting-form">
          <label>
            Independent evidence reference
            <input
              value={evidenceReference}
              maxLength={200}
              onChange={(event) => setEvidenceReference(event.target.value)}
              placeholder="e.g. External workbook / accountant review reference"
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
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {CHECKS.map(([key, label]) => (
            <label className="switch" key={key}>
              <input
                type="checkbox"
                checked={checks[key] === true}
                onChange={(event) => setChecks((current) => ({ ...current, [key]: event.target.checked }))}
              />
              <i aria-hidden />
              <span>{label} matches the independently prepared expected result</span>
            </label>
          ))}
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
            Linaw verifies that the selected run was released, has payout-completion evidence, payslips for every released entry, and an accounting journal export before accepting this sign-off.
          </span>
        </div>

        <div>
          <button
            className="primary-button brand"
            disabled={
              saving
              || evidenceReference.trim().length < 8
              || independentPreparedBy.trim().length < 3
              || !allChecked
              || !operatorCompletedWithoutDeveloper
            }
            onClick={() => void signOff()}
          >
            {saving ? "Recording evidence…" : <><Check size={14} /> Record production pilot sign-off</>}
          </button>
        </div>
      </div>
    </article>
  );
}
