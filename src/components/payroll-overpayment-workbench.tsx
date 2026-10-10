"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type WorkerChoice = {
  id: number;
  employeeNo: string;
  firstName: string;
  lastName: string;
  status: string;
};
type ReleasedChoice = {
  id: number;
  periodLabel: string;
  periodEnd: string;
  status: string;
};
type Choices = {
  employees: WorkerChoice[];
  releasedRuns: ReleasedChoice[];
  readOnly: true;
};
type Finding = {
  code: string;
  severity: "blocker" | "review";
  message: string;
  nextAction: string;
};
type Investigation = {
  version: string;
  generatedAt: string;
  previewOnly: true;
  persisted: false;
  employee: { id: number; employeeNo: string; displayName: string; status: string };
  source: {
    payrollRunId: number;
    periodLabel: string;
    periodStart: string;
    periodEnd: string;
    payrollStatus: string;
    payrollEntryId: number | null;
    entryHashSha256: string | null;
    grossPay: string | null;
    deductions: string | null;
    netPay: string | null;
    bankCreditVerified: false;
  };
  allegation: {
    claimedAmount: string;
    evidenceReference: string;
    explanation: string;
    verified: false;
  };
  assessment: {
    status: "source_blocked" | "manual_review_only";
    findings: Finding[];
    deductionAuthorized: false;
    recoveryPosted: false;
    sourceConfirmsBankPayment: false;
    requiredIndependentEvidence: string[];
  };
  immutableWarning: string;
};

export function PayrollOverpaymentWorkbench({
  organizationId,
  setNotice,
}: {
  organizationId: number;
  setNotice: (notice: string) => void;
}) {
  const [choices, setChoices] = useState<Choices | null>(null);
  const [form, setForm] = useState({
    employeeId: "",
    sourcePayrollRunId: "",
    claimedAmount: "",
    evidenceReference: "",
    explanation: "",
  });
  const [investigation, setInvestigation] = useState<Investigation | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/payroll/overpayment-preflight?organizationId=${organizationId}`,
      { cache: "no-store" },
    );
    // Default-off feature or a person without privileged payroll permission.
    // Do not show the form without a successful permission-gated roster.
    if (!response.ok) return null;
    const data = await response.json() as Choices;
    return data.readOnly === true ? data : null;
  }, [organizationId]);

  useEffect(() => {
    let active = true;
    setChoices(null);
    setInvestigation(null);
    void load().then(data => {
      if (active) setChoices(data);
    }).catch(() => {
      if (active) setChoices(null);
    });
    return () => { active = false; };
  }, [load]);

  async function inspect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setInvestigation(null);
    try {
      const response = await fetch("/api/payroll/overpayment-preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ organizationId, ...form }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Payroll evidence review is unavailable.");
      setInvestigation(data as Investigation);
      setNotice("Read-only payroll discrepancy preview generated. Nothing was filed, deducted or paid.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not inspect payroll evidence.");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyEvidence() {
    if (!investigation) return;
    // A local clipboard copy, not a submission or case record. Operators
    // should save it only in the approved employer evidence repository.
    try {
      await navigator.clipboard.writeText(JSON.stringify(investigation, null, 2));
      setNotice("Investigation preview copied. Store sensitive payroll evidence only in the authorized HR/finance record system.");
    } catch {
      setNotice("Clipboard permission was denied. You can inspect the summary on this screen.");
    }
  }

  if (!choices) return null;

  const canInspect = choices.releasedRuns.length > 0 && choices.employees.length > 0;
  const peso = (amount: string | null) =>
    amount == null ? "Not available"
      : new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(amount));
  return (
    <article className="card" style={{ marginTop: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">HCM / PAYROLL EVIDENCE</div>
          <h2>Suspected overpayment investigation</h2>
          <p>Compare a reported discrepancy with one Released payroll register entry. This is a read-only review; it does not create a debt, deduct wages, change final pay or establish that money was received.</p>
        </div>
      </div>
      <div className="card-body">
        <div className="notice notice-amber">
          <span>
            <strong>Recovery is not authorized here.</strong> Philippine wage-deduction rules require separate legal and employee authorization checks. A payroll release is not a bank-credit receipt, and an evidence-reference field is not consent. Do not include bank account numbers or government IDs.
          </span>
        </div>
        <form className="setting-form" onSubmit={inspect} style={{ marginTop: 14 }}>
          <label>
            Employee
            <select required value={form.employeeId}
              onChange={event => setForm(current => ({ ...current, employeeId: event.target.value }))}>
              <option value="">Choose an employee</option>
              {choices.employees.map(worker => (
                <option key={worker.id} value={worker.id}>
                  {worker.firstName} {worker.lastName} · {worker.employeeNo} ({worker.status})
                </option>
              ))}
            </select>
          </label>
          <label>
            Original Released payroll
            <select required value={form.sourcePayrollRunId}
              onChange={event => setForm(current => ({ ...current, sourcePayrollRunId: event.target.value }))}>
              <option value="">Choose a released payroll period</option>
              {choices.releasedRuns.map(run => (
                <option key={run.id} value={run.id}>
                  #{run.id} · {run.periodLabel} · through {run.periodEnd}
                </option>
              ))}
            </select>
          </label>
          <label>
            Claimed difference (PHP) — for investigation only
            <input required type="number" min="0.01" step="0.01" inputMode="decimal"
              value={form.claimedAmount} onChange={event => setForm(current => ({
                ...current, claimedAmount: event.target.value,
              }))} />
          </label>
          <label>
            Evidence reference
            <input required minLength={8} maxLength={160}
              placeholder="Source pay-register/finance worksheet reference"
              value={form.evidenceReference} onChange={event => setForm(current => ({
                ...current, evidenceReference: event.target.value,
              }))} />
          </label>
          <label>
            Explanation of suspected difference
            <textarea required minLength={20} maxLength={500} rows={3}
              placeholder="Describe what should be independently reconciled, without entering government IDs or bank details."
              value={form.explanation} onChange={event => setForm(current => ({
                ...current, explanation: event.target.value,
              }))} />
          </label>
          <div className="run-actions">
            <button className="primary-button" type="submit" disabled={!canInspect || submitting}>
              {submitting ? "Reviewing source..." : "Generate read-only investigation"}
            </button>
          </div>
        </form>
        {!canInspect && (
          <p>No Released payroll source or employee records are available for an investigation preview.</p>
        )}
        {investigation && (
          <div style={{ marginTop: 18 }}>
            <div className="card-header" style={{ paddingLeft: 0, paddingRight: 0 }}>
              <div>
                <div className="card-kicker">UNSAVED EVIDENCE PREVIEW</div>
                <h3>{investigation.assessment.status === "source_blocked"
                  ? "Source reconciliation required"
                  : "Manual review only — no recovery approved"}</h3>
                <p>Generated {new Date(investigation.generatedAt).toLocaleString()}. This packet is not saved to a case register.</p>
              </div>
            </div>
            <div className="payslip-line">
              <span>Employee and source cutoff</span>
              <strong>{investigation.employee.displayName} · {investigation.source.periodLabel}</strong>
            </div>
            <div className="payslip-line">
              <span>Recorded source net pay (not proof of transfer)</span>
              <strong>{peso(investigation.source.netPay)}</strong>
            </div>
            <div className="payslip-line">
              <span>Claimed discrepancy (not validated)</span>
              <strong>{peso(investigation.allegation.claimedAmount)}</strong>
            </div>
            <div className="payslip-line">
              <span>Source payroll entry fingerprint</span>
              <code style={{ wordBreak: "break-all" }}>{investigation.source.entryHashSha256 ?? "Unavailable"}</code>
            </div>
            <h4 style={{ marginTop: 16 }}>Blocking and review findings</h4>
            {investigation.assessment.findings.map(finding => (
              <div key={finding.code} className={finding.severity === "blocker" ? "notice notice-amber" : "notice notice-blue"}
                style={{ marginTop: 8 }}>
                <span>
                  <strong>{finding.severity === "blocker" ? "Source blocker: " : "Review: "}{finding.message}</strong>
                  <small style={{ display: "block", marginTop: 4 }}>{finding.nextAction}</small>
                </span>
              </div>
            ))}
            <h4 style={{ marginTop: 16 }}>Evidence needed before any decision</h4>
            <ul>
              {investigation.assessment.requiredIndependentEvidence.map(item => <li key={item}>{item}</li>)}
            </ul>
            <p><strong>{investigation.immutableWarning}</strong></p>
            <div className="run-actions">
              <button className="secondary-button" type="button" onClick={() => void copyEvidence()}>
                Copy unsaved evidence preview
              </button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
