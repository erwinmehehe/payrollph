"use client";

import { useCallback, useEffect, useState } from "react";

type Worker = {
  id: number; employeeNo: string; firstName: string; lastName: string; status: string;
};
type ReleasedRun = { id: number; periodLabel: string; periodEnd: string; status: string };
type RequestRow = {
  id: number; employeeId: number; sourcePayrollRunId: number; amount: string;
  effectiveDate: string; status: string; evidenceReference: string; reason: string;
  requestedByUserId: number; requestedBy: string; reviewedBy: string | null;
  postedEarning: { status: string; payrollRunId: number | null } | null;
};
type CorrectionPayload = {
  postingEnabled: boolean;
  currentUserId: number;
  employees: Worker[];
  releasedRuns: ReleasedRun[];
  requests: RequestRow[];
};

export function PayrollUnderpaymentPanel({
  organizationId,
  setNotice,
}: {
  organizationId: number;
  setNotice: (text: string) => void;
}) {
  const [data, setData] = useState<CorrectionPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState({
    employeeId: "", sourcePayrollRunId: "", amount: "",
    effectiveDate: "", reason: "", evidenceReference: "",
  });
  const [reviewId, setReviewId] = useState<number | null>(null);
  const [reviewReason, setReviewReason] = useState("");
  const [taxVerificationReference, setTaxVerificationReference] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/payroll-underpayments?organizationId=${organizationId}`, {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setData(null);
      return; // Payroll correction view may be unavailable to a scoped People user.
    }
    setData(payload as CorrectionPayload);
  }, [organizationId]);

  useEffect(() => {
    let mounted = true;
    void load().finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [load]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch("/api/payroll-underpayments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, ...request }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Underpayment request could not be submitted.");
      setRequest({
        employeeId: "", sourcePayrollRunId: "", amount: "",
        effectiveDate: "", reason: "", evidenceReference: "",
      });
      setNotice("Historical pay underpayment submitted for independent review. No payroll or salary state changed.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to submit correction.");
    } finally {
      setBusy(false);
    }
  }

  async function review(action: "approve" | "reject") {
    if (reviewId == null) return;
    setBusy(true);
    try {
      const response = await fetch("/api/payroll-underpayments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId, id: reviewId, action, reviewReason,
          taxVerificationReference,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Review could not be completed.");
      setNotice(result.message ?? "Review saved.");
      setReviewId(null);
      setReviewReason("");
      setTaxVerificationReference("");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to complete review.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (loading || !data) return null;

  const sourceRuns = data.releasedRuns;
  const workerName = (id: number) => {
    const worker = data.employees.find(row => row.id === id);
    return worker ? `${worker.firstName} ${worker.lastName} (${worker.employeeNo})` : `Employee #${id}`;
  };
  const pending = data.requests.filter(row => row.status === "pending_review");
  return (
    <article className="card" style={{ marginTop: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">HISTORICAL PAYROLL CORRECTIONS</div>
          <h2>Reviewed basic-pay underpayments</h2>
          <p>
            For a positive, taxable shortfall in a Released payroll period. This
            submits evidence for an independent payroll checker; approval creates
            one earnings adjustment in a later uncalculated cutoff. It does not
            rewrite the released register or change the employee base salary.
          </p>
        </div>
      </div>
      <div className="notice notice-amber" style={{ margin: "12px 16px" }}>
        <span>
          <strong>Scope:</strong> Positive earned-pay shortfalls only. Tax, SSS,
          PhilHealth and Pag-IBIG classification require independent review.
          Negative recoveries, final pay, and retroactive base-salary changes are
          not processed here. Do not enter raw bank details or IDs in references.
        </span>
      </div>
      {!data.postingEnabled && (
        <div className="notice notice-amber" style={{ margin: "12px 16px" }}>
          <span><strong>Posting disabled.</strong> Requests and rejection reviews remain available, but approval cannot post money until independent payroll/tax validation and controlled-pilot sign-off enable this feature.</span>
        </div>
      )}
      <form onSubmit={submit} style={{ padding: "0 16px 12px" }}>
        <div className="setting-form">
          <label>Employee
            <select required value={request.employeeId} onChange={event => setRequest(s => ({ ...s, employeeId: event.target.value }))}>
              <option value="">Select an active worker</option>
              {data.employees.filter(row => ["Active", "On leave"].includes(row.status)).map(row => (
                <option key={row.id} value={row.id}>{row.firstName} {row.lastName} · {row.employeeNo}</option>
              ))}
            </select>
          </label>
          <label>Original Released payroll
            <select required value={request.sourcePayrollRunId} onChange={event => setRequest(s => ({ ...s, sourcePayrollRunId: event.target.value }))}>
              <option value="">Select source run</option>
              {sourceRuns.map(row => <option key={row.id} value={row.id}>#{row.id} · {row.periodLabel}</option>)}
            </select>
          </label>
          <label>Unpaid amount (PHP)
            <input required min="0.01" max="1000000" step="0.01" type="number"
              value={request.amount} onChange={event => setRequest(s => ({ ...s, amount: event.target.value }))} />
          </label>
          <label>Upcoming open-cutoff date
            <input required type="date" value={request.effectiveDate}
              onChange={event => setRequest(s => ({ ...s, effectiveDate: event.target.value }))} />
          </label>
          <label>Source evidence reference
            <input required minLength={8} maxLength={200} placeholder="Reviewed payroll worksheet / case ID"
              value={request.evidenceReference} onChange={event => setRequest(s => ({ ...s, evidenceReference: event.target.value }))} />
          </label>
          <label>Reason and calculation
            <textarea required minLength={20} maxLength={500} rows={3}
              placeholder="Explain the missing basic-pay amount and how it was independently calculated"
              value={request.reason} onChange={event => setRequest(s => ({ ...s, reason: event.target.value }))} />
          </label>
        </div>
        <div className="run-actions">
          <button className="primary-button" type="submit" disabled={busy || sourceRuns.length === 0}>
            {busy ? "Submitting..." : "Submit for independent review"}
          </button>
        </div>
      </form>

      <div className="card-header">
        <div><div className="card-kicker">MAKER-CHECKER</div><h2>Independent review queue</h2></div>
      </div>
      <div className="card-body">
        {data.requests.length === 0 && <p>No historical underpayment reviews have been requested.</p>}
        {data.requests.map(row => (
          <div key={row.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
            <strong>#{row.id} · {workerName(row.employeeId)} · PHP {Number(row.amount).toFixed(2)}</strong>
            <p style={{ margin: "5px 0" }}>
              Source run #{row.sourcePayrollRunId} · Pay in cutoff {row.effectiveDate} · {row.status}
              {row.postedEarning ? ` · Earnings ${row.postedEarning.status}` : ""}
              {row.postedEarning?.payrollRunId ? ` · Settled run #${row.postedEarning.payrollRunId}` : ""}
            </p>
            <small>Requested by {row.requestedBy} · Evidence: {row.evidenceReference}</small>
            <p style={{ margin: "6px 0" }}>{row.reason}</p>
            {row.status === "pending_review" && row.requestedByUserId !== data.currentUserId && (
              <button className="secondary-button" onClick={() => setReviewId(reviewId === row.id ? null : row.id)} type="button">
                {reviewId === row.id ? "Close review" : "Independent reviewer action"}
              </button>
            )}
            {reviewId === row.id && (
              <div className="setting-form" style={{ marginTop: 8 }}>
                <label>Reviewer rationale
                  <textarea minLength={20} maxLength={500} rows={2} value={reviewReason}
                    placeholder="How was the source payroll shortfall reconciled?"
                    onChange={event => setReviewReason(event.target.value)} />
                </label>
                <label>Tax/statutory classification verification reference (for approval)
                  <input minLength={8} maxLength={200} value={taxVerificationReference}
                    placeholder="Finance/CPA review record ID"
                    onChange={event => setTaxVerificationReference(event.target.value)} />
                </label>
                <div className="run-actions">
                  <button type="button" className="primary-button" disabled={busy || !data.postingEnabled || reviewReason.trim().length < 20 || taxVerificationReference.trim().length < 8}
                    onClick={() => void review("approve")}>Approve &amp; post once</button>
                  <button type="button" className="secondary-button" disabled={busy || reviewReason.trim().length < 20}
                    onClick={() => void review("reject")}>Reject without posting</button>
                </div>
              </div>
            )}
          </div>
        ))}
        {pending.length > 0 && <small>{pending.length} request(s) awaiting independent review.</small>}
      </div>
    </article>
  );
}
