"use client";

import { useCallback, useEffect, useState } from "react";

type EmployeeOption = {
  id: number; employeeNo: string; firstName: string; lastName: string; status: string;
};
type RunOption = {
  id: number; periodLabel: string; periodEnd: string; status: string;
};
type OptionsResponse = {
  employees: EmployeeOption[];
  releasedRuns: RunOption[];
};
type PreviewResult = {
  reviewOnly: true;
  saved: false;
  employee: { id: number; employeeNo: string; displayName: string };
  source: {
    runId: number; periodLabel: string; periodStart: string; periodEnd: string;
    originalEntryId: number; sourceFingerprint: string;
    legalEntityChangedSinceSource: boolean;
  };
  variance: {
    reviewStatus: "possible_overpayment" | "possible_underpayment" | "mixed_variance" | "no_variance";
    sourceGross: string; sourceDeductions: string; sourceNet: string;
    verifiedGross: string; verifiedNet: string;
    grossDifference: string; netDifference: string;
    verifiedImpliedDeductions: string;
    hasSourceArithmeticWarning: boolean;
    automatedRecoveryAllowed: false;
  };
  evidenceReference: string;
  reason: string;
  requiredReviews: string[];
  warning: string;
};
type FormValues = {
  employeeId: string;
  payrollRunId: string;
  verifiedGrossPay: string;
  verifiedNetPay: string;
  evidenceReference: string;
  reason: string;
};

const INITIAL: FormValues = {
  employeeId: "", payrollRunId: "",
  verifiedGrossPay: "", verifiedNetPay: "",
  evidenceReference: "", reason: "",
};

const STATUS_LABELS: Record<PreviewResult["variance"]["reviewStatus"], string> = {
  possible_overpayment: "Possible overpayment — not verified or recoverable",
  possible_underpayment: "Possible underpayment — review other correction process",
  mixed_variance: "Mixed gross/net differences — review manually",
  no_variance: "No gross or net difference in the entered amounts",
};

export function PayrollOverpaymentPreviewPanel({ organizationId }: { organizationId: number }) {
  const [available, setAvailable] = useState(false);
  const [options, setOptions] = useState<OptionsResponse | null>(null);
  const [values, setValues] = useState<FormValues>(INITIAL);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        "/api/payroll-overpayment-preview?organizationId=" + organizationId,
        { cache: "no-store" },
      );
      if (!response.ok) return;
      const result = await response.json() as OptionsResponse;
      setOptions(result);
      setAvailable(true);
    } catch {
      // Do not show a restricted payroll review panel on disconnected,
      // unauthorized or disabled workspaces.
      setAvailable(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (field: keyof FormValues, value: string) => {
    setValues(previous => ({ ...previous, [field]: value }));
    setPreview(null); // A previous source fingerprint is stale after edits.
    setError("");
  };

  async function reconcile() {
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const response = await fetch("/api/payroll-overpayment-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, ...values }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "The historical evidence could not be reconciled.");
      setPreview(body as PreviewResult);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to complete this preview.");
    } finally {
      setBusy(false);
    }
  }

  if (!available || !options) return null;
  return (
    <article className="card" style={{ marginTop: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">HISTORICAL PAYROLL · READ-ONLY</div>
          <h2>Overpayment reconciliation preview</h2>
          <p>
            Compare an original Released payroll entry against separately verified
            gross and net amounts. This helps prepare a review packet. It does
            not create a recovery claim, change payroll, deduct final pay or
            authorize a repayment.
          </p>
        </div>
      </div>
      <div className="notice notice-amber" style={{ margin: "12px 16px" }}>
        <span>
          <strong>Controlled preview only.</strong> Results are not saved.
          The difference between two payroll amounts is not automatically a
          recoverable debt or lawful employee deduction. Independent bank,
          payroll, statutory and employment-law review is required.
        </span>
      </div>
      <form
        onSubmit={(event) => { event.preventDefault(); void reconcile(); }}
        style={{ padding: "0 16px 16px" }}
      >
        <div className="setting-form">
          <label>
            Employee, including separated workers
            <select required value={values.employeeId} onChange={(event) => update("employeeId", event.target.value)}>
              <option value="">Select employee</option>
              {options.employees.map(person => (
                <option value={person.id} key={person.id}>
                  {person.firstName} {person.lastName} · {person.employeeNo} · {person.status}
                </option>
              ))}
            </select>
          </label>
          <label>
            Original Released payroll
            <select required value={values.payrollRunId} onChange={(event) => update("payrollRunId", event.target.value)}>
              <option value="">Select Released payroll run</option>
              {options.releasedRuns.map(run => (
                <option value={run.id} key={run.id}>
                  {run.periodLabel} · run #{run.id} · ended {run.periodEnd}
                </option>
              ))}
            </select>
          </label>
          <label>
            Independently verified gross (PHP)
            <input required inputMode="decimal" placeholder="20000.00"
              value={values.verifiedGrossPay}
              onChange={(event) => update("verifiedGrossPay", event.target.value)}
            />
          </label>
          <label>
            Independently verified net (PHP)
            <input required inputMode="decimal" placeholder="17000.00"
              value={values.verifiedNetPay}
              onChange={(event) => update("verifiedNetPay", event.target.value)}
            />
          </label>
          <label>
            Source evidence reference
            <input required minLength={8} maxLength={200}
              placeholder="Signed payroll reconciliation worksheet/case reference"
              value={values.evidenceReference}
              onChange={(event) => update("evidenceReference", event.target.value)}
            />
          </label>
          <label>
            Independent calculation and discrepancy reason
            <textarea required minLength={20} maxLength={500} rows={3}
              placeholder="Describe how the verified amounts were obtained. Do not enter bank numbers, TIN or other government IDs."
              value={values.reason} onChange={(event) => update("reason", event.target.value)}
            />
          </label>
        </div>
        <div className="run-actions">
          <button className="primary-button" type="submit"
            disabled={busy || options.releasedRuns.length === 0}>
            {busy ? "Comparing payroll evidence..." : "Preview discrepancy — no payroll changes"}
          </button>
        </div>
      </form>

      {error && (
        <div className="notice notice-amber" style={{ margin: "12px 16px" }} role="alert">
          <span>{error}</span>
        </div>
      )}

      {preview && (
        <div className="card-body" aria-live="polite">
          <div className="card-kicker">RECONCILIATION RESULTS · NOT A RECOVERY APPROVAL</div>
          <h3>{STATUS_LABELS[preview.variance.reviewStatus]}</h3>
          <p>
            <strong>{preview.employee.displayName}</strong> · Original Released
            run #{preview.source.runId} ({preview.source.periodLabel})
          </p>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Measure</th><th>Original released</th><th>Verified independently</th><th>Difference</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>Gross pay</td>
                  <td>PHP {preview.variance.sourceGross}</td>
                  <td>PHP {preview.variance.verifiedGross}</td>
                  <td>PHP {preview.variance.grossDifference}</td>
                </tr>
                <tr>
                  <td>Net pay</td>
                  <td>PHP {preview.variance.sourceNet}</td>
                  <td>PHP {preview.variance.verifiedNet}</td>
                  <td>PHP {preview.variance.netDifference}</td>
                </tr>
                <tr>
                  <td>Deduction arithmetic</td>
                  <td>PHP {preview.variance.sourceDeductions}</td>
                  <td>PHP {preview.variance.verifiedImpliedDeductions}</td>
                  <td>Not a recovery amount</td>
                </tr>
              </tbody>
            </table>
          </div>
          {preview.variance.hasSourceArithmeticWarning && (
            <div className="notice notice-amber">
              <span>The source gross, deductions and net totals do not reconcile within one centavo. Review the original register and any net credits before using this worksheet.</span>
            </div>
          )}
          {preview.source.legalEntityChangedSinceSource && (
            <div className="notice notice-amber">
              <span>Current legal-entity assignment differs from the original run. Reconcile historical employer scope before relying on this preview.</span>
            </div>
          )}
          <p><strong>Source entry:</strong> #{preview.source.originalEntryId}</p>
          <p style={{ overflowWrap: "anywhere" }}>
            <strong>Evidence fingerprint (SHA-256):</strong> <code>{preview.source.sourceFingerprint}</code>
          </p>
          <p><strong>Reference:</strong> {preview.evidenceReference}</p>
          <p><strong>Reason:</strong> {preview.reason}</p>
          <h4>Required independent review</h4>
          <ul>
            {preview.requiredReviews.map((item, index) => <li key={index}>{item}</li>)}
          </ul>
          <p><strong>{preview.warning}</strong></p>
        </div>
      )}
    </article>
  );
}
