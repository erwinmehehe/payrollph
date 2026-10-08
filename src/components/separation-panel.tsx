"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, CheckCircle2, Download, FileCheck, FileText, HelpCircle, Plus, Shield, UserX, X } from "lucide-react";

type ReadyTermHandoff = {
  employeeId: number;
  employeeNo: string;
  employeeName: string;
  action: string;
  dueDate: string | null;
  label: string;
  detail: string;
  decision: null | {
    id: number;
    decisionKind: string;
    status: string;
    effectiveDate: string;
    proposedSeparationLastDay?: string | null;
    separationHandoffStatus?: string | null;
    separationRecordId?: number | null;
  };
};

type HandoffReviewChain = { code: string; name: string; version: number };
type HandoffReviewStatus = {
  sourceId: number;
  approval: {
    id: number;
    status: string;
    sourceCurrent: boolean;
    policyCode: string;
  } | null;
};

type SeparationRecord = {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeNo: string;
  employeeTitle: string;
  basicRate: string;
  hireDate: string;
  separationType: string;
  noticeDate: string;
  lastDay: string;
  clearanceStatus: string;
  itCleared: boolean;
  adminCleared: boolean;
  financeCleared: boolean;
  hrCleared: boolean;
  prorated13thMonth: string;
  thirteenthEntitlement: string;
  thirteenthPaidYtd: string;
  basicSalaryEarnedYtd: string;
  historicalBasicSalaryEarned: string;
  unpaidBasicSalary: string;
  unusedLeaveCredits: string;
  leaveMonetizationPay: string;
  separationPay: string;
  retirementPay: string;
  otherBenefits: string;
  taxAdjustment: string;
  finalStatutoryDeductions: string;
  loanDeductions: string;
  grossFinalPay: string;
  netFinalPay: string;
  finalPayDueDate?: string | null;
  status: string;
  coeIssued: boolean;
  approvedAt?: string | null;
  releasedAt?: string | null;
  releaseReference?: string | null;
};

const peso = (value: string | number) =>
  `₱${Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function SeparationPanel({ organizationId, setNotice }: { organizationId: number; setNotice: (m: string) => void }) {
  const [separations, setSeparations] = useState<SeparationRecord[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [handoffs, setHandoffs] = useState<ReadyTermHandoff[]>([]);
  const [reviewChains, setReviewChains] = useState<HandoffReviewChain[]>([]);
  const [reviewChainCode, setReviewChainCode] = useState("");
  const [reviewBySeparationId, setReviewBySeparationId] = useState<Record<number, HandoffReviewStatus>>({});
  const [routingReviewId, setRoutingReviewId] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<SeparationRecord | null>(null);
  const [showCoeModal, setShowCoeModal] = useState(false);
  const [releaseReference, setReleaseReference] = useState("");

  const [form, setForm] = useState({
    employeeId: "",
    employmentTermDecisionId: "",
    separationType: "resignation",
    noticeDate: new Date().toISOString().slice(0, 10),
    lastDay: new Date().toISOString().slice(0, 10),
    historicalBasicSalaryEarned: "0",
    unpaidBasicSalary: "0",
    finalStatutoryDeductions: "0",
    finalStatutoryReviewed: false,
    unusedLeaveCredits: "0",
    leaveTaxReviewed: false,
    leaveMonetizationTaxExempt: false,
    separationPay: "0",
    retirementPay: "0",
    otherBenefits: "0",
    deductOutstandingLoans: false,
    specialPayTaxReviewed: false,
    separationPayTaxExempt: false,
    retirementPayTaxExempt: false,
  });

  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((current) => current + 1), []);

  // The fetch lives in the effect so every state update happens after an await,
  // and `alive` stops a slow response for one client overwriting a newer one.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [sepRes, empRes, lifecycleRes] = await Promise.all([
        fetch(`/api/separation?organizationId=${organizationId}`, { cache: "no-store" }),
        fetch(`/api/employees?organizationId=${organizationId}`, { cache: "no-store" }),
        fetch(`/api/hcm/lifecycle-readiness?organizationId=${organizationId}`, { cache: "no-store" }),
      ]);
      if (sepRes.ok) {
        const data = await sepRes.json();
        if (!alive) return;
        const records = (data.separations ?? []) as SeparationRecord[];
        setSeparations(records);
        const ids = records.filter((row) => row.status === "draft").map((row) => row.id);
        const query = new URLSearchParams({
          organizationId: String(organizationId),
          sourceType: "hcm_separation_readiness",
        });
        if (ids.length) query.set("sourceIds", ids.slice(0, 40).join(","));
        const reviewResponse = await fetch(`/api/governed-handoffs?${query.toString()}`, { cache: "no-store" });
        if (!alive) return;
        if (reviewResponse.ok) {
          const review = await reviewResponse.json().catch(() => ({}));
          if (!alive) return;
          const chains = (review.approvalChains ?? []) as HandoffReviewChain[];
          setReviewChains(chains);
          setReviewChainCode((current) => chains.some((row) => row.code === current)
            ? current : chains[0]?.code ?? "");
          setReviewBySeparationId(Object.fromEntries(
            ((review.handoffs ?? []) as HandoffReviewStatus[]).map((row) => [row.sourceId, row]),
          ));
        }
      }
      if (empRes.ok) {
        const staff = await empRes.json();
        if (!alive) return;
        setEmployees(staff);
      }
      if (lifecycleRes.ok) {
        const lifecycle = await lifecycleRes.json();
        if (!alive) return;
        setHandoffs((lifecycle.rows ?? []).filter((row: ReadyTermHandoff) => row.action === "start_separation"));
      } else if (alive) {
        setHandoffs([]);
      }
      if (!alive) return;
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [organizationId, nonce]);

  async function initiateSeparation(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/separation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        organizationId,
        employeeId: Number(form.employeeId),
        employmentTermDecisionId: form.employmentTermDecisionId
          ? Number(form.employmentTermDecisionId)
          : undefined,
        historicalBasicSalaryEarned: Number(form.historicalBasicSalaryEarned),
        unpaidBasicSalary: Number(form.unpaidBasicSalary),
        finalStatutoryDeductions: Number(form.finalStatutoryDeductions),
        unusedLeaveCredits: Number(form.unusedLeaveCredits),
        separationPay: Number(form.separationPay),
        retirementPay: Number(form.retirementPay),
        otherBenefits: Number(form.otherBenefits),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setNotice(data.error ?? "Failed to calculate final pay.");
      return;
    }
    setNotice("Final Pay package computed from the payroll ledger. Complete clearance before approval and release.");
    setShowModal(false);
    reload();
  }

  function openGenericSeparation() {
    setForm((current) => ({
      ...current,
      employeeId: "",
      employmentTermDecisionId: "",
      separationType: "resignation",
      noticeDate: new Date().toISOString().slice(0, 10),
      lastDay: new Date().toISOString().slice(0, 10),
    }));
    setShowModal(true);
  }

  function startGovernedHandoff(row: ReadyTermHandoff) {
    const approvedLastDay = row.decision?.proposedSeparationLastDay ?? row.dueDate;
    if (!row.decision?.id || !approvedLastDay) {
      setNotice("The approved non-renewal is missing its decision id or proposed last day.");
      return;
    }
    setForm((current) => ({
      ...current,
      employeeId: String(row.employeeId),
      employmentTermDecisionId: String(row.decision!.id),
      separationType: "end_of_contract",
      noticeDate: new Date().toISOString().slice(0, 10),
      lastDay: approvedLastDay,
    }));
    setShowModal(true);
  }

  async function updateClearance(id: number, dept: "it" | "admin" | "finance" | "hr", value: boolean) {
    const payload: any = { id, action: "clearance" };
    if (dept === "it") payload.itCleared = value;
    if (dept === "admin") payload.adminCleared = value;
    if (dept === "finance") payload.financeCleared = value;
    if (dept === "hr") payload.hrCleared = value;

    const res = await fetch("/api/separation", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      setNotice(`${dept.toUpperCase()} clearance updated.`);
      reload();
    }
  }

  async function requestSeparationReadinessReview(id: number) {
    if (!reviewChainCode) {
      setNotice("Configure an active Automation Studio approval chain for the separation review first.");
      return;
    }
    setRoutingReviewId(id);
    try {
      const response = await fetch("/api/governed-handoffs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          sourceType: "hcm_separation_readiness",
          sourceId: id,
          chainCode: reviewChainCode,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not request separation readiness review.");
      setNotice(`Human separation readiness review requested for package #${id}. Existing clearance and final-pay decisions remain separate.`);
      reload();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Separation review request failed.");
    } finally {
      setRoutingReviewId(null);
    }
  }

  async function issueCoe(id: number) {
    const res = await fetch("/api/separation", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "issue_coe" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice(data.error ?? "Could not mark the COE as issued.");
      return;
    }
    setNotice("COE marked issued in the separation record.");
    setShowCoeModal(false);
    setSelectedRecord(null);
    reload();
  }

  async function transitionFinalPay(id: number, action: "approve" | "release") {
    const res = await fetch("/api/separation", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, ...(action === "release" ? { releaseReference } : {}) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice(data.error ?? `Could not ${action} Final Pay.`);
      return;
    }
    setNotice(action === "approve" ? "Final Pay package approved." : "Final Pay marked released and employee marked separated.");
    if (action === "release") setReleaseReference("");
    setSelectedRecord(null);
    reload();
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Separation, Clearance &amp; Final Pay (DOLE Advisory 06-20)</h2>
          <p className="heading-copy">Ledger-based 13th month, unpaid salary, leave conversion, tax adjustment, approved deductions, clearance, and controlled final-pay release.</p>
        </div>
        <button className="primary-button" onClick={openGenericSeparation}>
          <UserX size={15} className="i-red" /> Initiate Employee Separation
        </button>
      </div>

      {handoffs.length > 0 && (
        <article className="card" style={{ marginBottom: 18 }}>
          <div className="card-header">
            <div>
              <div className="card-kicker">GOVERNED NON-RENEWAL HANDOFFS</div>
              <h2>Approved contract endings ready for Separation</h2>
              <p>
                These workers have an approved non-renewal decision. Starting the package below preserves the decision id,
                end-of-contract category, and approved last day.
              </p>
            </div>
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>EMPLOYEE</th><th>APPROVED LAST DAY</th><th>DECISION</th><th>ACTION</th></tr>
              </thead>
              <tbody>
                {handoffs.map((row) => (
                  <tr key={row.decision?.id ?? row.employeeId}>
                    <td><strong>{row.employeeName}</strong><small style={{ display: "block", color: "var(--muted)" }}>{row.employeeNo}</small></td>
                    <td>{row.decision?.proposedSeparationLastDay ?? row.dueDate ?? "—"}</td>
                    <td>{row.decision ? `#${row.decision.id} · non-renewal` : row.label}</td>
                    <td>
                      <button className="primary-button" onClick={() => startGovernedHandoff(row)}>
                        Start linked Separation
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      )}

      <div className="stats-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <article className="stat-card">
          <div className="stat-icon orange"><UserX size={19} /></div>
          <p>SEPARATING STAFF</p>
          <h3>{separations.filter((s) => s.status !== "released").length}</h3>
          <span>Under active clearance</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon purple"><FileCheck size={19} /></div>
          <p>CLEARED FOR FINAL PAY</p>
          <h3>{separations.filter((s) => s.clearanceStatus === "cleared").length}</h3>
          <span>All 4 departments signed</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon mint"><CheckCircle2 size={19} /></div>
          <p>COEs GENERATED</p>
          <h3>{separations.filter((s) => s.coeIssued).length}</h3>
          <span>Certificates issued</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon blue"><FileText size={19} /></div>
          <p>DOLE MANDATE</p>
          <h3>30 Days</h3>
          <span>Statutory release window</span>
        </article>
      </div>

      {showModal && (
        <article className="card" style={{ padding: 20, marginBottom: 18 }}>
          <div className="card-header" style={{ padding: 0, marginBottom: 14 }}>
            <div><div className="card-kicker">FINAL PAY WORKFLOW</div><h2 style={{ margin: 0 }}>Compute Final Pay &amp; Start Clearance</h2></div>
            <button className="icon-button" onClick={() => setShowModal(false)}><X size={16} /></button>
          </div>
          <form onSubmit={initiateSeparation}>
            {form.employmentTermDecisionId && (
              <div className="notice notice-blue" style={{ marginBottom: 12 }}>
                <Shield size={15} />
                <span>
                  <strong>This package is linked to governed employment decision #{form.employmentTermDecisionId}.</strong>
                  {" "}Employee, end-of-contract category, and approved last day are locked to the non-renewal evidence.
                </span>
              </div>
            )}
            <div className="setting-form">
              <label>Separating Employee
                <select required disabled={Boolean(form.employmentTermDecisionId)} value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
                  <option value="">Select Employee…</option>
                  {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName} ({emp.employeeNo})</option>)}
                </select>
              </label>
              <label>Separation Category
                <select disabled={Boolean(form.employmentTermDecisionId)} value={form.separationType} onChange={(e) => setForm({ ...form, separationType: e.target.value })}>
                  <option value="resignation">Voluntary Resignation (30d notice)</option>
                  <option value="retirement">Retirement</option>
                  <option value="end_of_contract">End of Fixed-Term Contract</option>
                  <option value="authorized_cause">Authorized Cause</option>
                  <option value="just_cause">Just Cause Termination</option>
                </select>
              </label>
              <label>Notice / Tender Date
                <input required type="date" value={form.noticeDate} onChange={(e) => setForm({ ...form, noticeDate: e.target.value })} />
              </label>
              <label>Effective Last Day
                <input required disabled={Boolean(form.employmentTermDecisionId)} type="date" value={form.lastDay} onChange={(e) => setForm({ ...form, lastDay: e.target.value })} />
              </label>
              <label>Legacy imported basic salary, if prompted
                <input type="number" step="0.01" min="0" value={form.historicalBasicSalaryEarned} onChange={(e) => setForm({ ...form, historicalBasicSalaryEarned: e.target.value })} />
                <small>New payroll-history imports store basic salary directly. Use this only for older imported rows that predate that field.</small>
              </label>
              <label>Unpaid basic salary through last day
                <input type="number" step="0.01" min="0" value={form.unpaidBasicSalary} onChange={(e) => setForm({ ...form, unpaidBasicSalary: e.target.value })} />
                <small>Earned basic salary not already in a Released Linaw payroll.</small>
              </label>
              {Number(form.unpaidBasicSalary) > 0 && (
                <>
                  <label>Final employee statutory deductions
                    <input type="number" step="0.01" min="0" value={form.finalStatutoryDeductions} onChange={(e) => setForm({ ...form, finalStatutoryDeductions: e.target.value })} />
                    <small>Reviewed SSS, PhilHealth and Pag-IBIG employee share still due from the unpaid salary.</small>
                  </label>
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="checkbox" checked={form.finalStatutoryReviewed} onChange={(e) => setForm({ ...form, finalStatutoryReviewed: e.target.checked })} />
                    Final statutory contribution treatment reviewed
                  </label>
                </>
              )}
              <label>Convertible unused leave credits (days)
                <input type="number" step="0.5" min="0" max="365" value={form.unusedLeaveCredits} onChange={(e) => setForm({ ...form, unusedLeaveCredits: e.target.value })} />
              </label>
              {Number(form.unusedLeaveCredits) > 0 && (
                <>
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="checkbox" checked={form.leaveTaxReviewed} onChange={(e) => setForm({ ...form, leaveTaxReviewed: e.target.checked })} />
                    Leave monetization tax treatment reviewed
                  </label>
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="checkbox" checked={form.leaveMonetizationTaxExempt} onChange={(e) => setForm({ ...form, leaveMonetizationTaxExempt: e.target.checked })} />
                    Reviewed leave monetization is tax-exempt
                  </label>
                </>
              )}
              <label>Separation pay, if applicable
                <input type="number" step="0.01" min="0" value={form.separationPay} onChange={(e) => setForm({ ...form, separationPay: e.target.value })} />
              </label>
              <label>Retirement pay, if applicable
                <input type="number" step="0.01" min="0" value={form.retirementPay} onChange={(e) => setForm({ ...form, retirementPay: e.target.value })} />
              </label>
              <label>Other final-pay benefits
                <input type="number" step="0.01" min="0" value={form.otherBenefits} onChange={(e) => setForm({ ...form, otherBenefits: e.target.value })} />
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={form.deductOutstandingLoans} onChange={(e) => setForm({ ...form, deductOutstandingLoans: e.target.checked })} />
                Deduct authorized outstanding loan balances
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={form.specialPayTaxReviewed} onChange={(e) => setForm({ ...form, specialPayTaxReviewed: e.target.checked })} />
                Tax treatment reviewed for separation / retirement pay
              </label>
              {Number(form.separationPay) > 0 && (
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="checkbox" checked={form.separationPayTaxExempt} onChange={(e) => setForm({ ...form, separationPayTaxExempt: e.target.checked })} />
                  Reviewed separation pay is tax-exempt
                </label>
              )}
              {Number(form.retirementPay) > 0 && (
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="checkbox" checked={form.retirementPayTaxExempt} onChange={(e) => setForm({ ...form, retirementPayTaxExempt: e.target.checked })} />
                  Reviewed retirement pay is tax-exempt
                </label>
              )}
            </div>
            <div className="notice notice-blue" style={{ margin: "10px 0" }}>
              <span><strong>Ledger-based computation:</strong> 13th month uses actual basic salary earned in the calendar year, subtracts any 13th month already paid, and keeps released payroll immutable. Linaw does not guess imported basic salary or special separation/retirement entitlements.</span>
            </div>
            <div className="run-actions">
              <button type="button" className="secondary-button" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="primary-button">Compute Final Pay Package</button>
            </div>
          </form>
        </article>
      )}

      {/* Selected final pay breakdown drawer */}
      {selectedRecord && (
        <article className="card" style={{ padding: 20, marginBottom: 18, border: "1.5px solid var(--green-border)", background: "#f8fbf9" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div>
              <div className="card-kicker">FINAL PAY COMPUTATION SHEET</div>
              <h3 style={{ margin: 0, fontSize: 16 }}>{selectedRecord.employeeName} ({selectedRecord.employeeNo})</h3>
              <p style={{ margin: "2px 0 0", color: "var(--muted)", fontSize: 11 }}>Position: {selectedRecord.employeeTitle} · Monthly Basic: {peso(selectedRecord.basicRate)} · Last Day: {selectedRecord.lastDay}</p>
            </div>
            <button className="icon-button" onClick={() => setSelectedRecord(null)}><X size={16} /></button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div style={{ background: "white", padding: 14, borderRadius: 10, border: "1px solid var(--line)" }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: "var(--green)", textTransform: "uppercase" }}>ADDITIONS (EARNINGS)</span>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #edf2ee", fontSize: 11.5, marginTop: 6 }}>
                <span>Unpaid basic salary</span>
                <strong>{peso(selectedRecord.unpaidBasicSalary)}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #edf2ee", fontSize: 11.5 }}>
                <span>13th Month Due</span>
                <strong>{peso(selectedRecord.prorated13thMonth)}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #edf2ee", fontSize: 11.5 }}>
                <span>13th entitlement / already paid</span>
                <strong>{peso(selectedRecord.thirteenthEntitlement)} / {peso(selectedRecord.thirteenthPaidYtd)}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #edf2ee", fontSize: 11.5 }}>
                <span>Leave Monetization ({selectedRecord.unusedLeaveCredits} days)</span>
                <strong>{peso(selectedRecord.leaveMonetizationPay)}</strong>
              </div>
              {Number(selectedRecord.separationPay) > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #edf2ee", fontSize: 11.5 }}><span>Separation Pay</span><strong>{peso(selectedRecord.separationPay)}</strong></div>}
              {Number(selectedRecord.retirementPay) > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #edf2ee", fontSize: 11.5 }}><span>Retirement Pay</span><strong>{peso(selectedRecord.retirementPay)}</strong></div>}
              {Number(selectedRecord.otherBenefits) > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #edf2ee", fontSize: 11.5 }}><span>Other Benefits</span><strong>{peso(selectedRecord.otherBenefits)}</strong></div>}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 11.5 }}>
                <span>{Number(selectedRecord.taxAdjustment) >= 0 ? "Tax refund" : "Tax collection"}</span>
                <strong>{peso(Math.abs(Number(selectedRecord.taxAdjustment)))}</strong>
              </div>
            </div>

            <div style={{ background: "white", padding: 14, borderRadius: 10, border: "1px solid var(--line)" }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: "var(--danger)", textTransform: "uppercase" }}>DEDUCTIONS (LIABILITIES)</span>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #edf2ee", fontSize: 11.5, marginTop: 6 }}>
                <span>Final statutory deductions</span>
                <strong style={{ color: "var(--danger)" }}>-{peso(selectedRecord.finalStatutoryDeductions)}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #edf2ee", fontSize: 11.5 }}>
                <span>Authorized Outstanding Employee Loans</span>
                <strong style={{ color: "var(--danger)" }}>-{peso(selectedRecord.loanDeductions)}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 11.5 }}>
                <span>Other Accounts Due</span>
                <span>₱0.00</span>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 14, padding: "12px 16px", borderRadius: 10, background: "var(--green-light)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span style={{ fontSize: 10, textTransform: "uppercase", fontWeight: 800, color: "#0e3e34" }}>NET FINAL PAY DUE</span>
              <strong style={{ display: "block", fontSize: 22, color: "var(--green)" }}>{peso(selectedRecord.netFinalPay)}</strong>
              <small style={{ color: "var(--muted)" }}>Gross {peso(selectedRecord.grossFinalPay)} · due by {selectedRecord.finalPayDueDate ?? "not set"}</small>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="secondary-button" onClick={() => setShowCoeModal(true)}><FileText size={15} className="i-teal" /> View COE Draft</button>
              {selectedRecord.status === "draft" && (
                <button className="primary-button" onClick={() => transitionFinalPay(selectedRecord.id, "approve")}>Approve Final Pay</button>
              )}
              {selectedRecord.status === "approved" && (
                <div style={{ display: "grid", gap: 8, minWidth: 240 }}>
                  <input
                    value={releaseReference}
                    onChange={(event) => setReleaseReference(event.target.value)}
                    placeholder="Bank / payout reference"
                    aria-label="Final pay payout reference"
                  />
                  <button className="primary-button" disabled={!releaseReference.trim()} onClick={() => transitionFinalPay(selectedRecord.id, "release")}>
                    Mark Final Pay Released
                  </button>
                </div>
              )}
              {selectedRecord.status === "released" && selectedRecord.releaseReference && (
                <span className="mono" style={{ fontSize: 11 }}>Payout ref: {selectedRecord.releaseReference}</span>
              )}
            </div>
          </div>
        </article>
      )}

      {/* Certificate of Employment Modal */}
      {showCoeModal && selectedRecord && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal large" role="dialog" aria-modal="true" aria-label="Certificate of Employment">
            <button className="modal-close" onClick={() => setShowCoeModal(false)}><X size={18} /></button>
            <div className="modal-icon"><FileCheck size={22} className="i-green" /></div>
            <div className="card-kicker">DOLE COMPLIANCE · LABOR ADVISORY 06-20</div>
            <h2>Certificate of Employment (COE)</h2>
            <p>Mandatory issuance within 3 days of employee request:</p>
            <div style={{ background: "white", padding: 24, border: "1px solid var(--line)", borderRadius: 10, fontFamily: "serif", fontSize: 13, lineHeight: 1.8, color: "#222" }}>
              <div style={{ textAlign: "center", marginBottom: 16 }}>
                <strong style={{ fontSize: 16, textTransform: "uppercase" }}>CERTIFICATE OF EMPLOYMENT</strong>
              </div>
              <p>TO WHOM IT MAY CONCERN:</p>
              <p>
                This is to certify that <strong>{selectedRecord.employeeName}</strong> was employed with this company from{" "}
                <strong>{selectedRecord.hireDate}</strong> to <strong>{selectedRecord.lastDay}</strong>, holding the position of{" "}
                <strong>{selectedRecord.employeeTitle}</strong>.
              </p>
              <p>
                During the period of tenure, the employee was compensated at a monthly basic rate of{" "}
                <strong>{peso(selectedRecord.basicRate)}</strong>.
              </p>
              <p>
                This certification is issued upon the request of the above-named employee for whatever legal purpose it may serve.
              </p>
              <div style={{ marginTop: 28 }}>
                <strong>PEOPLE OPERATIONS &amp; HUMAN RESOURCES</strong><br />
                <span>Authorized Signatory</span>
              </div>
            </div>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setShowCoeModal(false)}>Close</button>
              <button className="primary-button" onClick={() => void issueCoe(selectedRecord.id)}>Mark COE Issued</button>
            </div>
          </section>
        </div>
      )}

      <article className="card table-card">
        <div className="table-toolbar">
          <div><div className="card-kicker">FINAL PAY LEDGER</div><h2>Separating Employees</h2></div>
          <label>
            <span className="sr-only">Human separation review approval policy</span>
            <select
              aria-label="Human separation review approval policy"
              value={reviewChainCode}
              onChange={(event) => setReviewChainCode(event.target.value)}
              disabled={reviewChains.length === 0}
            >
              {reviewChains.length === 0 && <option value="">No active approval chain</option>}
              {reviewChains.map((chain) => (
                <option value={chain.code} key={chain.code}>{chain.name} · v{chain.version}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>EMPLOYEE</th>
                <th>CATEGORY</th>
                <th>LAST DAY</th>
                <th>CLEARANCES (IT / ADM / FIN / HR)</th>
                <th>NET FINAL PAY</th>
                <th>STATUS</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {separations.length === 0 && <tr><td colSpan={7}><div className="empty-state">No separating employees on record.</div></td></tr>}
              {separations.map((sep) => (
                <tr key={sep.id}>
                  <td><strong>{sep.employeeName}</strong><small style={{ display: "block", color: "var(--muted)" }}>{sep.employeeNo} · {sep.employeeTitle}</small></td>
                  <td><span style={{ fontSize: 11, textTransform: "capitalize" }}>{sep.separationType.replace("_", " ")}</span></td>
                  <td>{sep.lastDay}</td>
                  <td>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className={`secondary-button ${sep.itCleared ? "active" : ""}`} style={{ height: 22, fontSize: 9, padding: "0 5px" }} onClick={() => updateClearance(sep.id, "it", !sep.itCleared)}>
                        IT {sep.itCleared ? "✓" : "-"}
                      </button>
                      <button className={`secondary-button ${sep.adminCleared ? "active" : ""}`} style={{ height: 22, fontSize: 9, padding: "0 5px" }} onClick={() => updateClearance(sep.id, "admin", !sep.adminCleared)}>
                        ADM {sep.adminCleared ? "✓" : "-"}
                      </button>
                      <button className={`secondary-button ${sep.financeCleared ? "active" : ""}`} style={{ height: 22, fontSize: 9, padding: "0 5px" }} onClick={() => updateClearance(sep.id, "finance", !sep.financeCleared)}>
                        FIN {sep.financeCleared ? "✓" : "-"}
                      </button>
                      <button className={`secondary-button ${sep.hrCleared ? "active" : ""}`} style={{ height: 22, fontSize: 9, padding: "0 5px" }} onClick={() => updateClearance(sep.id, "hr", !sep.hrCleared)}>
                        HR {sep.hrCleared ? "✓" : "-"}
                      </button>
                    </div>
                  </td>
                  <td><strong style={{ color: "var(--green)" }}>{peso(sep.netFinalPay)}</strong></td>
                  <td>
                    <span className={`status status-${sep.status === "approved" ? "verified" : sep.status === "draft" ? "needs-review" : "released"}`}>{sep.status}</span>
                    {reviewBySeparationId[sep.id]?.approval && (
                      <small style={{ display: "block", color: "var(--muted)" }}>
                        Review #{reviewBySeparationId[sep.id].approval?.id} ·
                        {" "}{reviewBySeparationId[sep.id].approval?.sourceCurrent
                          ? reviewBySeparationId[sep.id].approval?.status
                          : "stale; request fresh review"}
                      </small>
                    )}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button className="primary-button" style={{ height: 26, fontSize: 10, padding: "0 8px" }} onClick={() => setSelectedRecord(sep)}>
                        Breakdown
                      </button>
                      {sep.status === "draft" && (
                        <button
                          className="secondary-button"
                          style={{ height: 26, fontSize: 10, padding: "0 8px" }}
                          disabled={!reviewChainCode || routingReviewId !== null}
                          onClick={() => void requestSeparationReadinessReview(sep.id)}
                        >
                          {routingReviewId === sep.id ? "Routing..." : "Request human readiness review"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}
