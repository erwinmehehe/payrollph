"use client";

import { useCallback, useEffect, useState } from "react";
import { Banknote, Check, DollarSign, Pause, Play, Plus, ReceiptText, ShieldCheck, X } from "lucide-react";
import { GovernmentLoanRemittancePanel } from "@/components/government-loan-remittance-panel";

type Loan = {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeNo: string;
  loanType: string;
  referenceNo: string;
  principal: string;
  monthlyAmortization: string;
  cutoffDeduction: string;
  remainingBalance: string;
  totalPaid: string;
  status: string;
  startDate: string;
  endDate: string;
  notes: string;
  requestedByUserId: number | null;
  reviewedByUserId: number | null;
  deductionAuthorizationReference: string | null;
  reviewEvidenceReference: string | null;
  payments: Array<{ id: number; amount: string; paymentDate: string; reference: string }>;
};

const peso = (value: string | number) =>
  `₱${Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const LOAN_TYPES = [
  "SSS Salary Loan",
  "SSS Calamity Loan",
  "Pag-IBIG Multi-Purpose Loan (MPL)",
  "Pag-IBIG Calamity Loan",
  "Company Emergency Loan",
  "Educational Assistance Loan",
  "Appliance / Gadget Loan",
];

export function LoansPanel({ organizationId, setNotice }: { organizationId: number; setNotice: (m: string) => void }) {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [summary, setSummary] = useState({ totalActiveLoans: 0, totalPendingApproval: 0, totalOutstanding: 0, totalPaidOff: 0 });
  const [viewer, setViewer] = useState({ currentUserId: 0, reviewerEligible: false, companyWide: false });
  const [loaded, setLoaded] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState<Loan | null>(null);
  const [manualPayAmount, setManualPayAmount] = useState("");
  const [manualPaymentReference, setManualPaymentReference] = useState("");
  const [reviewEvidenceReference, setReviewEvidenceReference] = useState("");
  const [reviewReason, setReviewReason] = useState("");

  const [form, setForm] = useState({
    employeeId: "",
    loanType: "SSS Salary Loan",
    referenceNo: "",
    principal: "",
    monthlyAmortization: "",
    cutoffDeduction: "",
    startDate: new Date().toISOString().slice(0, 10),
    endDate: "",
    notes: "",
    deductionAuthorizationReference: "",
  });

  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((current) => current + 1), []);

  // The fetch lives in the effect so every state update happens after an await,
  // and `alive` stops a slow response for one client overwriting a newer one.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [loanRes, empRes] = await Promise.all([
        fetch(`/api/loans?organizationId=${organizationId}`, { cache: "no-store" }),
        fetch(`/api/employees?organizationId=${organizationId}`, { cache: "no-store" }),
      ]);
      if (loanRes.ok) {
        const data = await loanRes.json();
        if (!alive) return;
        setLoans(data.loans ?? []);
        setViewer({
          currentUserId: data.currentUserId ?? 0,
          reviewerEligible: data.reviewerEligible === true,
          companyWide: data.companyWide === true,
        });
        setSummary(data.summary ?? { totalActiveLoans: 0, totalPendingApproval: 0, totalOutstanding: 0, totalPaidOff: 0 });
      }
      if (empRes.ok) {
        const staff = await empRes.json();
        if (!alive) return;
        setEmployees(staff);
      }
      if (!alive) return;
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [organizationId, nonce]);

  async function createLoan(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/loans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        organizationId,
        employeeId: Number(form.employeeId),
        principal: form.principal,
        monthlyAmortization: form.monthlyAmortization,
        cutoffDeduction: form.cutoffDeduction || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setNotice(data.error ?? "Failed to register loan.");
      return;
    }
    setNotice("Loan submitted for independent review. No payroll deductions will start until a separate reviewer approves its authority.");
    setShowAddForm(false);
    setForm({
      employeeId: "",
      loanType: "SSS Salary Loan",
      referenceNo: "",
      principal: "",
      monthlyAmortization: "",
      cutoffDeduction: "",
      startDate: new Date().toISOString().slice(0, 10),
      endDate: "",
      notes: "",
      deductionAuthorizationReference: "",
    });
    reload();
  }

  async function recordManualPayment(loanId: number) {
    if (!manualPayAmount || Number(manualPayAmount) <= 0 || manualPaymentReference.trim().length < 8) {
      setNotice("Enter a positive centavo-exact external payment and an 8-120 character bank/agency evidence reference.");
      return;
    }
    const res = await fetch("/api/loans", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: loanId, action: "record_payment", amount: manualPayAmount, reference: manualPaymentReference.trim() }),
    });
    const data = await res.json();
    if (!res.ok) {
      setNotice(data.error ?? "Failed to record payment.");
      return;
    }
    setNotice(`External payment of ${peso(manualPayAmount)} attested. Verify the bank/agency evidence; loan balance was updated atomically.`);
    setManualPayAmount("");
    setManualPaymentReference("");
    setSelectedLoan(null);
    reload();
  }

  async function changeLoanStatus(loanId: number, action: "approve" | "reject" | "pause" | "resume" | "close") {
    const needsReview = ["approve", "reject", "resume"].includes(action);
    if (reviewReason.trim().length < (needsReview ? 20 : 8)) {
      setNotice(needsReview ? "Enter a 20-500 character independent review rationale." : "Enter an 8-character pause/close reason.");
      return;
    }
    if (["approve", "resume"].includes(action) && reviewEvidenceReference.trim().length < 8) {
      setNotice("Independent approval requires a reviewed source/authorization reference.");
      return;
    }
    const response = await fetch("/api/loans", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: loanId, action, reviewReason: reviewReason.trim(),
        reviewEvidenceReference: reviewEvidenceReference.trim(),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(data.error ?? "The loan status could not be changed.");
      return;
    }
    setNotice(data.message ?? "Loan decision recorded.");
    setReviewReason("");
    setReviewEvidenceReference("");
    setSelectedLoan(null);
    reload();
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Employee Loan Ledger &amp; Amortization</h2>
          <p className="heading-copy">Review source loan authorization before scheduling deductions. Newly submitted loans stay inactive until a different payroll checker approves them.</p>
        </div>
        <button className="primary-button" onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? <X size={15} /> : <Plus size={15} className="i-green" />} {showAddForm ? "Cancel" : "Register Loan"}
        </button>
      </div>

      <div className="stats-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <article className="stat-card">
          <div className="stat-icon mint"><Banknote size={19} /></div>
          <p>ACTIVE LOANS</p>
          <h3>{summary.totalActiveLoans}</h3>
          <span>Under ongoing deduction</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon orange"><ReceiptText size={19} /></div>
          <p>TOTAL OUTSTANDING BALANCE</p>
          <h3>{peso(summary.totalOutstanding)}</h3>
          <span>Across all employee portfolios</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon purple"><Check size={19} /></div>
          <p>LOANS PAID OFF</p>
          <h3>{summary.totalPaidOff}</h3>
          <span>Fully amortized accounts</span>
        </article>
      </div>

      {summary.totalPendingApproval > 0 && (
        <div className="notice notice-amber" style={{ marginBottom: 14 }}>
          <span><strong>{summary.totalPendingApproval} loan(s) awaiting independent review.</strong> Unapproved schedules are excluded from payroll.</span>
        </div>
      )}

      {showAddForm && (
        <article className="card" style={{ padding: 20, marginBottom: 18 }}>
          <div className="card-header" style={{ padding: 0, marginBottom: 14 }}>
            <div><div className="card-kicker">NEW LOAN REQUEST</div><h2 style={{ margin: 0 }}>Submit Loan for Independent Review</h2></div>
          </div>
          <form onSubmit={createLoan}>
            <div className="setting-form">
              <label>Employee
                <select required value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
                  <option value="">Select Employee…</option>
                  {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName} ({emp.employeeNo})</option>)}
                </select>
              </label>
              <label>Loan Type
                <select value={form.loanType} onChange={(e) => setForm({ ...form, loanType: e.target.value })}>
                  {LOAN_TYPES.map((lt) => <option key={lt} value={lt}>{lt}</option>)}
                </select>
              </label>
              <label>Reference / SSS PN / Pag-IBIG App No.
                <input required placeholder="e.g. SSS-SL-2026-0091" value={form.referenceNo} onChange={(e) => setForm({ ...form, referenceNo: e.target.value })} />
              </label>
              <label>Principal Amount
                <input required type="number" min="1000" step="0.01" placeholder="25000.00" value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} />
              </label>
              <label>Monthly Amortization
                <input required type="number" min="100" step="0.01" placeholder="1041.67" value={form.monthlyAmortization} onChange={(e) => {
                  const monthly = Number(e.target.value);
                  setForm({ ...form, monthlyAmortization: e.target.value, cutoffDeduction: (monthly / 2).toFixed(2) });
                }} />
              </label>
              <label>Deduction Per Cut-Off (Semi-Monthly)
                <input required type="number" min="50" step="0.01" value={form.cutoffDeduction} onChange={(e) => setForm({ ...form, cutoffDeduction: e.target.value })} />
              </label>
              <label>Amortization Start Date
                <input required type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </label>
              <label>Estimated Maturity / End Date
                <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              </label>
              <label style={{ gridColumn: "1 / -1" }}>Deduction authorization evidence reference
                <input required minLength={8} maxLength={200}
                  placeholder="Agency loan authorization, signed employee agreement or verified case ID"
                  value={form.deductionAuthorizationReference}
                  onChange={(e) => setForm({ ...form, deductionAuthorizationReference: e.target.value })} />
              </label>
              <label style={{ gridColumn: "1 / -1" }}>Remarks / Notes
                <input placeholder="e.g. Loan agreement period and evidence review notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </label>
            </div>
            <div className="run-actions">
              <button type="button" className="secondary-button" onClick={() => setShowAddForm(false)}>Cancel</button>
              <button className="primary-button">Submit for Review — No Deduction Yet</button>
            </div>
          </form>
        </article>
      )}

      {selectedLoan && (
        <article className="card" style={{ padding: 18, marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <div className="card-kicker">LOAN REVIEW &amp; PAYMENTS</div>
              <h3 style={{ margin: 0, fontSize: 16 }}>{selectedLoan.employeeName} · {selectedLoan.loanType}</h3>
              <p style={{ margin: "2px 0 0", color: "var(--muted)", fontSize: 11 }}>
                Source: {selectedLoan.referenceNo} · Status: {selectedLoan.status.replaceAll("_", " ")} · Remaining: <strong>{peso(selectedLoan.remainingBalance)}</strong>
              </p>
            </div>
            <button className="icon-button" onClick={() => setSelectedLoan(null)} aria-label="Close loan management"><X size={16} /></button>
          </div>
          <p>Original authorization: <strong>{selectedLoan.deductionAuthorizationReference ?? "Legacy record — unverified"}</strong></p>
          {viewer.companyWide && (
            <div className="setting-form">
              <label>Reason / reviewer justification
                <textarea rows={2} maxLength={500} value={reviewReason}
                  placeholder="Describe source evidence, wage-deduction authorization or why payroll should pause"
                  onChange={(event) => setReviewReason(event.target.value)} />
              </label>
              {(selectedLoan.status === "pending_approval" || selectedLoan.status === "paused") && (
                <label>Independent approval evidence reference
                  <input value={reviewEvidenceReference} maxLength={200}
                    placeholder="Independent payroll checker sign-off / agency confirmation"
                    onChange={(event) => setReviewEvidenceReference(event.target.value)} />
                </label>
              )}
            </div>
          )}
          {selectedLoan.status === "pending_approval" && (
            <div className="run-actions">
              {viewer.reviewerEligible && viewer.currentUserId !== selectedLoan.requestedByUserId ? (
                <>
                  <button className="primary-button" onClick={() => void changeLoanStatus(selectedLoan.id, "approve")}>Approve &amp; Activate</button>
                  <button className="secondary-button" onClick={() => void changeLoanStatus(selectedLoan.id, "reject")}>Reject Request</button>
                </>
              ) : <small>Independent payroll checker action required. The requester cannot approve their own loan.</small>}
            </div>
          )}
          {(selectedLoan.status === "active" || selectedLoan.status === "paused") && viewer.companyWide && (
            <>
              <div className="setting-form" style={{ marginTop: 12 }}>
                <label>Verified external repayment amount (PHP)
                  <input type="number" min="0.01" step="0.01" value={manualPayAmount}
                    onChange={(event) => setManualPayAmount(event.target.value)} />
                </label>
                <label>External bank / agency payment reference
                  <input value={manualPaymentReference} minLength={8} maxLength={120}
                    placeholder="Confirmed remittance or receipt reference"
                    onChange={(event) => setManualPaymentReference(event.target.value)} />
                </label>
              </div>
              <div className="run-actions">
                <button className="primary-button" onClick={() => void recordManualPayment(selectedLoan.id)}>Record Verified External Repayment</button>
                {selectedLoan.status === "active" && (
                  <button className="secondary-button" onClick={() => void changeLoanStatus(selectedLoan.id, "pause")}>Pause Deductions</button>
                )}
                {selectedLoan.status === "paused" && viewer.reviewerEligible
                  && viewer.currentUserId !== selectedLoan.requestedByUserId && (
                    <button className="secondary-button" onClick={() => void changeLoanStatus(selectedLoan.id, "resume")}>Independently Reapprove / Resume</button>
                  )}
              </div>
              <small>Only confirmed external repayments belong here. Payroll-calculated deductions and bank remittances are tracked separately. Evidence reference alone is not independent bank verification.</small>
            </>
          )}
          {["rejected", "paid_off"].includes(selectedLoan.status) && (
            <p>This request is not available for further deductions. Corrections require separately reviewed accounting evidence.</p>
          )}
        </article>
      )}

      <article className="card table-card">
        <div className="table-toolbar">
          <div><div className="card-kicker">DEDUCTION REVIEW &amp; SCHEDULES</div><h2>Employee Loan Accounts</h2></div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>EMPLOYEE</th>
                <th>LOAN TYPE &amp; REF</th>
                <th>PRINCIPAL</th>
                <th>CUT-OFF DEDUCT</th>
                <th>TOTAL REPAID</th>
                <th>REMAINING BALANCE</th>
                <th>STATUS</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {loans.length === 0 && <tr><td colSpan={8}><div className="empty-state">No loans on record.</div></td></tr>}
              {loans.map((loan) => (
                <tr key={loan.id}>
                  <td><strong>{loan.employeeName}</strong><small style={{ display: "block", color: "var(--muted)" }}>{loan.employeeNo}</small></td>
                  <td><strong>{loan.loanType}</strong><span style={{ display: "block", color: "var(--muted)", fontSize: 10 }}>{loan.referenceNo}</span></td>
                  <td>{peso(loan.principal)}</td>
                  <td><strong style={{ color: loan.status === "active" ? "var(--danger)" : "var(--muted)" }}>{loan.status === "active" ? "-" : "Pending — "}{peso(loan.cutoffDeduction)}</strong></td>
                  <td><span style={{ color: "var(--green)", fontWeight: 700 }}>{peso(loan.totalPaid)}</span></td>
                  <td><strong>{peso(loan.remainingBalance)}</strong></td>
                  <td><span className={`status status-${loan.status === "active" ? "tested" : loan.status === "paid_off" ? "verified" : "needs-review"}`}>{loan.status.replaceAll("_", " ")}</span></td>
                  <td>
                    <button className="secondary-button" style={{ height: 28, fontSize: 11, padding: "0 8px" }} onClick={() => { setSelectedLoan(loan); setManualPayAmount(loan.cutoffDeduction); }}>
                      Manage
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    
      <GovernmentLoanRemittancePanel organizationId={organizationId} setNotice={setNotice} />
</div>
  );
}
