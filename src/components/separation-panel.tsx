"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Calculator,
  Check,
  CheckCircle2,
  FileCheck,
  FileText,
  RefreshCw,
  ShieldCheck,
  UserX,
  WalletCards,
  X,
} from "lucide-react";

type FinalPayBreakdown = {
  inputs?: Record<string, unknown>;
  calculationKey?: string;
  blockers?: string[];
  earnings?: number;
  netFinalPay?: number;
  payrollCoverage?: {
    releasedThrough?: string | null;
    payrollPastLastDay?: string | null;
    finalPayrollVerified?: boolean;
    unpaidBasicSalary?: number;
    otherUnpaidTaxableEarnings?: number;
  };
  thirteenthMonth?: {
    eligible?: boolean;
    exclusionReason?: string | null;
    basicSalaryEarned?: number;
    alreadyPaid?: number;
    entitlement?: number;
    balanceDue?: number;
    overpaid?: number;
    additionalBasicSalary?: number;
  };
  retro?: {
    pendingIds?: number[];
    pendingTotal?: number;
    currentYearBasic?: number;
  };
  leave?: {
    availableDays?: number;
    convertibleDays?: number;
    basisNote?: string;
    monetizationPay?: number;
  };
  separationPay?: {
    years?: number;
    basis?: string;
    amount?: number;
    taxExemptConfirmed?: boolean;
  };
  retirement?: {
    eligible?: boolean;
    blocker?: string | null;
    years?: number;
    age?: number;
    amount?: number;
    planBenefit?: number;
    planReference?: string;
    taxExempt?: boolean;
  };
  companyBenefit?: {
    amount?: number;
    taxable?: boolean;
  };
  loans?: {
    ids?: number[];
    outstandingBalance?: number;
    deductFromFinalPay?: boolean;
    deduction?: number;
  };
  tax?: {
    grossCompensationBeforeFinalPay?: number;
    statutoryContributions?: number;
    taxWithheld?: number;
    otherNonTaxable?: number;
    adjustment?: number;
    annualized?: {
      taxableIncome?: number;
      taxDue?: number;
      taxWithheld?: number;
      outcome?: "refund" | "collect" | "balanced";
    };
  };
};

type SeparationRecord = {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeNo: string;
  employeeTitle: string;
  basicRate: string;
  hireDate: string;
  birthDate?: string | null;
  thirteenthMonthEligible?: boolean;
  thirteenthMonthExclusionReason?: string | null;
  separationType: string;
  noticeDate: string;
  lastDay: string;
  finalPayDueDate?: string | null;
  clearanceStatus: string;
  itCleared: boolean;
  adminCleared: boolean;
  financeCleared: boolean;
  hrCleared: boolean;
  prorated13thMonth: string;
  unusedLeaveCredits: string;
  leaveMonetizationPay: string;
  taxAdjustment: string;
  loanDeductions: string;
  netFinalPay: string;
  finalPayBreakdown?: FinalPayBreakdown | null;
  status: string;
  coeIssued: boolean;
  releasedAt?: string | null;
  releasedBy?: string | null;
  legacyCalculation?: boolean;
};

type EmployeeOption = {
  id: number;
  employeeNo: string;
  firstName: string;
  lastName: string;
  status: string;
  thirteenthMonthEligible?: boolean;
  thirteenthMonthExclusionReason?: string | null;
};

type FormState = {
  employeeId: string;
  separationType: string;
  noticeDate: string;
  lastDay: string;
  unusedLeaveCredits: string;
  leaveBasisNote: string;
  finalPayrollVerified: boolean;
  unpaidBasicSalary: string;
  otherUnpaidTaxableEarnings: string;
  additionalThirteenthMonthBasic: string;
  deductOutstandingLoans: boolean;
  separationPayTaxExemptConfirmed: boolean;
  retirementPlanBenefit: string;
  retirementPlanReference: string;
  retirementTaxExemptConfirmed: boolean;
  additionalCompanyBenefit: string;
  additionalCompanyBenefitTaxable: boolean;
};

const peso = (value: string | number | null | undefined) =>
  `₱${Number(value ?? 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function phDateToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function initialForm(): FormState {
  const today = phDateToday();
  return {
    employeeId: "",
    separationType: "resignation",
    noticeDate: today,
    lastDay: today,
    unusedLeaveCredits: "0",
    leaveBasisNote: "",
    finalPayrollVerified: false,
    unpaidBasicSalary: "0",
    otherUnpaidTaxableEarnings: "0",
    additionalThirteenthMonthBasic: "0",
    deductOutstandingLoans: false,
    separationPayTaxExemptConfirmed: false,
    retirementPlanBenefit: "0",
    retirementPlanReference: "",
    retirementTaxExemptConfirmed: false,
    additionalCompanyBenefit: "0",
    additionalCompanyBenefitTaxable: true,
  };
}

function separationLabel(value: string) {
  const labels: Record<string, string> = {
    resignation: "Voluntary resignation",
    end_of_contract: "End of fixed-term contract",
    just_cause: "Just-cause termination",
    labor_saving_device: "Labor-saving device",
    redundancy: "Redundancy",
    retrenchment: "Retrenchment to prevent losses",
    closure_not_serious_losses: "Closure not due to serious losses",
    closure_serious_losses: "Closure due to serious losses",
    disease: "Termination due to disease",
    retirement: "Retirement",
  };
  return labels[value] ?? value.replaceAll("_", " ");
}

function statusClass(status: string) {
  if (status === "released") return "status-released";
  if (status === "approved") return "status-verified";
  return "status-needs-review";
}

function signedTaxLabel(adjustment: number) {
  if (adjustment < 0) return "Tax refund";
  if (adjustment > 0) return "Tax to collect";
  return "Tax adjustment";
}

function KeyValue({
  label,
  value,
  note,
  danger = false,
}: {
  label: string;
  value: string;
  note?: string;
  danger?: boolean;
}) {
  return (
    <div style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{label}</span>
        <strong style={{ fontSize: 12.5, color: danger ? "var(--danger)" : "var(--text)" }}>{value}</strong>
      </div>
      {note && <small style={{ display: "block", marginTop: 3, color: "var(--muted)" }}>{note}</small>}
    </div>
  );
}

export function SeparationPanel({
  organizationId,
  setNotice,
}: {
  organizationId: number;
  setNotice: (message: string) => void;
}) {
  const [separations, setSeparations] = useState<SeparationRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<SeparationRecord | null>(null);
  const [showCoeModal, setShowCoeModal] = useState(false);
  const [form, setForm] = useState<FormState>(initialForm);
  const [formError, setFormError] = useState("");
  const [formBlockers, setFormBlockers] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((current) => current + 1), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [sepRes, empRes] = await Promise.all([
        fetch(`/api/separation?organizationId=${organizationId}`, { cache: "no-store" }),
        fetch(`/api/employees?organizationId=${organizationId}`, { cache: "no-store" }),
      ]);
      if (!alive) return;

      if (sepRes.ok) {
        const data = await sepRes.json();
        setSeparations(data.separations ?? []);
      }
      if (empRes.ok) {
        const staff = await empRes.json();
        setEmployees(Array.isArray(staff) ? staff : []);
      }
      setLoaded(true);
    })().catch(() => {
      if (alive) setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [organizationId, nonce]);

  useEffect(() => {
    if (!selectedRecord) return;
    const fresh = separations.find((row) => row.id === selectedRecord.id);
    if (fresh) setSelectedRecord(fresh);
  }, [separations, selectedRecord?.id]);

  const selectedEmployee = useMemo(
    () => employees.find((employee) => String(employee.id) === form.employeeId) ?? null,
    [employees, form.employeeId],
  );

  async function responseProblem(response: Response) {
    const payload = await response.json().catch(() => ({}));
    const blockers = Array.isArray(payload.blockers)
      ? payload.blockers.filter((item: unknown): item is string => typeof item === "string")
      : [];
    return {
      payload,
      blockers,
      message: typeof payload.error === "string" ? payload.error : "The action could not be completed.",
    };
  }

  async function initiateSeparation(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError("");
    setFormBlockers([]);
    try {
      const response = await fetch("/api/separation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          organizationId,
          employeeId: Number(form.employeeId),
          unusedLeaveCredits: Number(form.unusedLeaveCredits),
          unpaidBasicSalary: Number(form.unpaidBasicSalary),
          otherUnpaidTaxableEarnings: Number(form.otherUnpaidTaxableEarnings),
          additionalThirteenthMonthBasic: Number(form.additionalThirteenthMonthBasic),
          retirementPlanBenefit: Number(form.retirementPlanBenefit),
          additionalCompanyBenefit: Number(form.additionalCompanyBenefit),
        }),
      });
      if (!response.ok) {
        const problem = await responseProblem(response);
        setFormError(problem.message);
        setFormBlockers(problem.blockers);
        return;
      }
      const created = await response.json();
      const blockers = Array.isArray(created.blockers) ? created.blockers : [];
      setNotice(
        blockers.length
          ? `Final-pay draft created with ${blockers.length} item(s) to resolve before approval.`
          : "Final-pay draft created from payroll history and employee records.",
      );
      setShowModal(false);
      setForm(initialForm());
      reload();
    } finally {
      setSubmitting(false);
    }
  }

  async function patchSeparation(id: number, body: Record<string, unknown>) {
    const response = await fetch("/api/separation", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    if (!response.ok) {
      const problem = await responseProblem(response);
      setNotice(
        problem.blockers.length
          ? `${problem.message} ${problem.blockers.join(" ")}`
          : problem.message,
      );
      return null;
    }
    const payload = await response.json();
    reload();
    return payload;
  }

  async function updateClearance(
    id: number,
    department: "it" | "admin" | "finance" | "hr",
    value: boolean,
  ) {
    const payload: Record<string, unknown> = { action: "clearance" };
    payload[`${department}Cleared`] = value;
    setBusyAction(`clearance-${id}-${department}`);
    try {
      const updated = await patchSeparation(id, payload);
      if (updated) setNotice(`${department.toUpperCase()} clearance updated.`);
    } finally {
      setBusyAction("");
    }
  }

  async function recomputeFinalPay(id: number) {
    setBusyAction(`recompute-${id}`);
    try {
      const updated = await patchSeparation(id, { action: "recompute" });
      if (updated) {
        const blockers = Array.isArray(updated.blockers) ? updated.blockers.length : 0;
        setNotice(blockers ? `Final pay recomputed. ${blockers} blocker(s) remain.` : "Final pay recomputed from current records.");
      }
    } finally {
      setBusyAction("");
    }
  }

  async function approveFinalPay(id: number) {
    setBusyAction(`approve-${id}`);
    try {
      const updated = await patchSeparation(id, { action: "approve" });
      if (updated) setNotice("Final pay approved. It is now locked for release.");
    } finally {
      setBusyAction("");
    }
  }

  async function releaseFinalPay(id: number) {
    setBusyAction(`release-${id}`);
    try {
      const updated = await patchSeparation(id, { action: "release" });
      if (updated) setNotice("Final pay released. Linked retro and approved loan deductions were settled atomically.");
    } finally {
      setBusyAction("");
    }
  }

  async function issueCoe(id: number) {
    setBusyAction(`coe-${id}`);
    try {
      const updated = await patchSeparation(id, { action: "issue_coe" });
      if (updated) {
        setNotice("Certificate of Employment marked issued.");
        setShowCoeModal(false);
        window.print();
      }
    } finally {
      setBusyAction("");
    }
  }

  const recordBreakdown = selectedRecord?.finalPayBreakdown ?? {};
  const blockers = recordBreakdown.blockers ?? [];
  const allCleared = selectedRecord
    ? selectedRecord.itCleared && selectedRecord.adminCleared && selectedRecord.financeCleared && selectedRecord.hrCleared
    : false;
  const taxAdjustment = Number(selectedRecord?.taxAdjustment ?? 0);

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          marginBottom: 18,
        }}
      >
        <div>
          <div className="card-kicker">OFFBOARDING CONTROL CENTER</div>
          <h2 style={{ margin: "4px 0 4px", fontSize: 20, fontWeight: 750 }}>Separation, clearance &amp; final pay</h2>
          <p className="heading-copy" style={{ maxWidth: 760 }}>
            Build the final-pay package from released payroll, actual 13th-month basic salary, pending retro, leave conversion,
            tax annualization, and only the deductions you explicitly approve.
          </p>
        </div>
        <button
          className="primary-button"
          onClick={() => {
            setForm(initialForm());
            setFormError("");
            setFormBlockers([]);
            setShowModal(true);
          }}
        >
          <UserX size={15} /> Start separation
        </button>
      </div>

      <div className="stats-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
        <article className="stat-card">
          <div className="stat-icon orange"><UserX size={19} /></div>
          <p>OPEN SEPARATIONS</p>
          <h3>{separations.filter((row) => row.status !== "released").length}</h3>
          <span>draft or approved</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon purple"><ShieldCheck size={19} /></div>
          <p>FULLY CLEARED</p>
          <h3>{separations.filter((row) => row.clearanceStatus === "cleared" && row.status !== "released").length}</h3>
          <span>IT · Admin · Finance · HR</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon mint"><CheckCircle2 size={19} /></div>
          <p>RELEASED FINAL PAY</p>
          <h3>{separations.filter((row) => row.status === "released").length}</h3>
          <span>financially settled</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon blue"><FileText size={19} /></div>
          <p>FINAL PAY WINDOW</p>
          <h3>30 days</h3>
          <span>from separation, absent a better policy</span>
        </article>
      </div>

      {showModal && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal large" role="dialog" aria-modal="true" aria-label="Create final-pay package">
            <button className="modal-close" onClick={() => setShowModal(false)} aria-label="Close">
              <X size={18} />
            </button>
            <div className="modal-icon"><Calculator size={21} className="i-purple" /></div>
            <div className="card-kicker">FINAL PAY DRAFT</div>
            <h2>Compute from actual payroll records</h2>
            <p>
              Linaw will not estimate 13th-month pay from the current monthly salary. It rebuilds the balance from actual
              basic salary earned in released and imported payroll, then flags anything that still requires human verification.
            </p>

            <form onSubmit={initiateSeparation}>
              <div className="setting-form" style={{ marginTop: 14 }}>
                <label>
                  Employee
                  <select
                    required
                    value={form.employeeId}
                    onChange={(event) => setForm({ ...form, employeeId: event.target.value })}
                  >
                    <option value="">Select employee…</option>
                    {employees
                      .filter((employee) => employee.status !== "Separated")
                      .map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.firstName} {employee.lastName} ({employee.employeeNo})
                        </option>
                      ))}
                  </select>
                </label>

                <label>
                  Separation category
                  <select
                    value={form.separationType}
                    onChange={(event) => setForm({ ...form, separationType: event.target.value })}
                  >
                    <option value="resignation">Voluntary resignation</option>
                    <option value="end_of_contract">End of fixed-term contract</option>
                    <option value="just_cause">Just-cause termination</option>
                    <option value="labor_saving_device">Labor-saving device</option>
                    <option value="redundancy">Redundancy</option>
                    <option value="retrenchment">Retrenchment to prevent losses</option>
                    <option value="closure_not_serious_losses">Closure not due to serious losses</option>
                    <option value="closure_serious_losses">Closure due to serious losses</option>
                    <option value="disease">Termination due to disease</option>
                    <option value="retirement">Retirement</option>
                  </select>
                </label>

                <label>
                  Notice / tender date
                  <input
                    required
                    type="date"
                    value={form.noticeDate}
                    onChange={(event) => setForm({ ...form, noticeDate: event.target.value })}
                  />
                </label>

                <label>
                  Effective last day
                  <input
                    required
                    type="date"
                    value={form.lastDay}
                    onChange={(event) => setForm({ ...form, lastDay: event.target.value })}
                  />
                </label>
              </div>

              {selectedEmployee?.thirteenthMonthEligible === false && (
                <div className="notice notice-amber" style={{ marginTop: 10 }}>
                  <AlertTriangle size={15} />
                  <span>
                    This employee is marked excluded from statutory 13th-month pay.
                    {selectedEmployee.thirteenthMonthExclusionReason
                      ? ` Recorded reason: ${selectedEmployee.thirteenthMonthExclusionReason}`
                      : " An exclusion reason must be recorded before approval."}
                  </span>
                </div>
              )}

              <div className="card" style={{ margin: "14px 0 0", boxShadow: "none" }}>
                <div className="card-header">
                  <div>
                    <div className="card-kicker">FINAL PAYROLL GAP</div>
                    <h3 style={{ margin: "3px 0", fontSize: 14 }}>Amounts not yet in a released payroll</h3>
                    <p>Leave these at zero when payroll already covers the employee through the last day.</p>
                  </div>
                </div>
                <div className="setting-form">
                  <label>
                    Unpaid basic salary
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.unpaidBasicSalary}
                      onChange={(event) => setForm({ ...form, unpaidBasicSalary: event.target.value })}
                    />
                  </label>
                  <label>
                    Other unpaid taxable earnings
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.otherUnpaidTaxableEarnings}
                      onChange={(event) => setForm({ ...form, otherUnpaidTaxableEarnings: event.target.value })}
                    />
                  </label>
                  <label>
                    Extra basic salary for 13th-month basis
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.additionalThirteenthMonthBasic}
                      onChange={(event) => setForm({ ...form, additionalThirteenthMonthBasic: event.target.value })}
                    />
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}>
                    <input
                      type="checkbox"
                      checked={form.finalPayrollVerified}
                      onChange={(event) => setForm({ ...form, finalPayrollVerified: event.target.checked })}
                      style={{ width: 16, height: 16 }}
                    />
                    I verified the final payroll gap and entered any unpaid amounts above
                  </label>
                </div>
              </div>

              <div className="card" style={{ margin: "12px 0 0", boxShadow: "none" }}>
                <div className="card-header">
                  <div>
                    <div className="card-kicker">LEAVE &amp; LIABILITIES</div>
                    <h3 style={{ margin: "3px 0", fontSize: 14 }}>Only convert or deduct what is actually due</h3>
                  </div>
                </div>
                <div className="setting-form">
                  <label>
                    Cash-convertible unused leave days
                    <input
                      type="number"
                      min="0"
                      max="365"
                      step="0.5"
                      value={form.unusedLeaveCredits}
                      onChange={(event) => setForm({ ...form, unusedLeaveCredits: event.target.value })}
                    />
                  </label>
                  <label>
                    Leave conversion basis / policy
                    <input
                      value={form.leaveBasisNote}
                      placeholder="e.g. unused SIL, company policy section 4.2"
                      onChange={(event) => setForm({ ...form, leaveBasisNote: event.target.value })}
                    />
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}>
                    <input
                      type="checkbox"
                      checked={form.deductOutstandingLoans}
                      onChange={(event) => setForm({ ...form, deductOutstandingLoans: event.target.checked })}
                      style={{ width: 16, height: 16 }}
                    />
                    Deduct active loan balances from final pay
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}>
                    <input
                      type="checkbox"
                      checked={form.separationPayTaxExemptConfirmed}
                      onChange={(event) => setForm({ ...form, separationPayTaxExemptConfirmed: event.target.checked })}
                      style={{ width: 16, height: 16 }}
                    />
                    Tax exemption for statutory separation pay has been confirmed
                  </label>
                </div>
              </div>

              {form.separationType === "retirement" && (
                <div className="card" style={{ margin: "12px 0 0", boxShadow: "none" }}>
                  <div className="card-header">
                    <div>
                      <div className="card-kicker">RETIREMENT</div>
                      <h3 style={{ margin: "3px 0", fontSize: 14 }}>Statutory minimum or better company plan</h3>
                    </div>
                  </div>
                  <div className="setting-form">
                    <label>
                      Better-plan retirement benefit
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.retirementPlanBenefit}
                        onChange={(event) => setForm({ ...form, retirementPlanBenefit: event.target.value })}
                      />
                    </label>
                    <label>
                      Plan / CBA / agreement reference
                      <input
                        value={form.retirementPlanReference}
                        placeholder="Leave blank when only the statutory minimum applies"
                        onChange={(event) => setForm({ ...form, retirementPlanReference: event.target.value })}
                      />
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}>
                      <input
                        type="checkbox"
                        checked={form.retirementTaxExemptConfirmed}
                        onChange={(event) => setForm({ ...form, retirementTaxExemptConfirmed: event.target.checked })}
                        style={{ width: 16, height: 16 }}
                      />
                      Tax exemption for the better-plan retirement benefit has been confirmed
                    </label>
                  </div>
                </div>
              )}

              <div className="card" style={{ margin: "12px 0 0", boxShadow: "none" }}>
                <div className="card-header">
                  <div>
                    <div className="card-kicker">OTHER COMPANY BENEFIT</div>
                    <h3 style={{ margin: "3px 0", fontSize: 14 }}>Optional policy/CBA benefit</h3>
                  </div>
                </div>
                <div className="setting-form">
                  <label>
                    Additional company benefit
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.additionalCompanyBenefit}
                      onChange={(event) => setForm({ ...form, additionalCompanyBenefit: event.target.value })}
                    />
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}>
                    <input
                      type="checkbox"
                      checked={form.additionalCompanyBenefitTaxable}
                      onChange={(event) => setForm({ ...form, additionalCompanyBenefitTaxable: event.target.checked })}
                      style={{ width: 16, height: 16 }}
                    />
                    Treat this additional company benefit as taxable compensation
                  </label>
                </div>
              </div>

              {formError && (
                <div className="notice notice-amber" style={{ marginTop: 12 }}>
                  <AlertTriangle size={15} />
                  <span>{formError}</span>
                </div>
              )}
              {formBlockers.length > 0 && (
                <div className="notice notice-amber" style={{ marginTop: 8 }}>
                  <span>{formBlockers.join(" ")}</span>
                </div>
              )}

              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button className="primary-button" disabled={submitting || !form.employeeId}>
                  <Calculator size={15} /> {submitting ? "Computing…" : "Create final-pay draft"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {selectedRecord && (
        <article
          className="card"
          style={{
            padding: 20,
            marginBottom: 18,
            border: "1.5px solid var(--green-border)",
            background: "#fbfcff",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
            <div>
              <div className="card-kicker">FINAL PAY COMPUTATION</div>
              <h3 style={{ margin: "4px 0 2px", fontSize: 17 }}>
                {selectedRecord.employeeName} · {selectedRecord.employeeNo}
              </h3>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 11.5 }}>
                {separationLabel(selectedRecord.separationType)} · Last day {selectedRecord.lastDay}
                {selectedRecord.finalPayDueDate ? ` · Due by ${selectedRecord.finalPayDueDate}` : ""}
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className={`status ${statusClass(selectedRecord.status)}`}>{selectedRecord.status}</span>
              <button className="icon-button" onClick={() => setSelectedRecord(null)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
          </div>

          {selectedRecord.legacyCalculation && (
            <div className="notice notice-amber" style={{ marginTop: 14 }}>
              <AlertTriangle size={15} />
              <span>This is a legacy final-pay calculation. Recreate it before approval or release.</span>
            </div>
          )}

          {blockers.length > 0 && (
            <div className="notice notice-amber" style={{ marginTop: 14 }}>
              <AlertTriangle size={15} />
              <span>
                <strong>{blockers.length} blocker{blockers.length === 1 ? "" : "s"}:</strong> {blockers.join(" ")}
              </span>
            </div>
          )}

          <div className="run-stats" style={{ margin: "16px 0" }}>
            <div>
              <span>13th month balance</span>
              <strong>{peso(recordBreakdown.thirteenthMonth?.balanceDue ?? selectedRecord.prorated13thMonth)}</strong>
              <small>
                {peso(recordBreakdown.thirteenthMonth?.basicSalaryEarned ?? 0)} qualifying basic earned
              </small>
            </div>
            <div>
              <span>Pending retro</span>
              <strong>{peso(recordBreakdown.retro?.pendingTotal ?? 0)}</strong>
              <small>{recordBreakdown.retro?.pendingIds?.length ?? 0} open adjustment(s)</small>
            </div>
            <div>
              <span>Tax adjustment</span>
              <strong>{peso(Math.abs(taxAdjustment))}</strong>
              <small>{signedTaxLabel(taxAdjustment)}</small>
            </div>
            <div>
              <span>Net final pay</span>
              <strong className="green-number">{peso(selectedRecord.netFinalPay)}</strong>
              <small>{selectedRecord.status === "released" ? "released" : "pending release"}</small>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
            <div style={{ background: "white", padding: 14, borderRadius: 12, border: "1px solid var(--line)" }}>
              <div className="card-kicker">PAYROLL &amp; 13TH MONTH</div>
              <KeyValue
                label="Released payroll through"
                value={recordBreakdown.payrollCoverage?.releasedThrough ?? "None"}
                note={recordBreakdown.payrollCoverage?.finalPayrollVerified ? "final gap verified" : "final gap not yet verified"}
              />
              <KeyValue
                label="Unpaid basic salary"
                value={peso(recordBreakdown.payrollCoverage?.unpaidBasicSalary ?? 0)}
                note="included in 13th-month basic salary basis"
              />
              <KeyValue
                label="13th month entitlement"
                value={peso(recordBreakdown.thirteenthMonth?.entitlement ?? 0)}
                note={`Already paid ${peso(recordBreakdown.thirteenthMonth?.alreadyPaid ?? 0)}`}
              />
              <KeyValue
                label="13th month balance due"
                value={peso(recordBreakdown.thirteenthMonth?.balanceDue ?? selectedRecord.prorated13thMonth)}
                note={recordBreakdown.thirteenthMonth?.eligible === false ? "employee marked ineligible" : "actual basic salary earned ÷ 12, less amount already paid"}
              />
              <KeyValue
                label="Retro pay"
                value={peso(recordBreakdown.retro?.pendingTotal ?? 0)}
                note="pending monthly corrections are settled here only on final release"
              />
            </div>

            <div style={{ background: "white", padding: 14, borderRadius: 12, border: "1px solid var(--line)" }}>
              <div className="card-kicker">LEAVE, SEPARATION &amp; RETIREMENT</div>
              <KeyValue
                label="Leave conversion"
                value={peso(recordBreakdown.leave?.monetizationPay ?? selectedRecord.leaveMonetizationPay)}
                note={`${recordBreakdown.leave?.convertibleDays ?? selectedRecord.unusedLeaveCredits} day(s) · ${recordBreakdown.leave?.basisNote || "basis not recorded"}`}
              />
              <KeyValue
                label="Statutory separation pay"
                value={peso(recordBreakdown.separationPay?.amount ?? 0)}
                note={
                  recordBreakdown.separationPay?.basis
                    ? `${recordBreakdown.separationPay.years ?? 0} rounded service year(s) · ${recordBreakdown.separationPay.basis.replaceAll("_", " ")}`
                    : "not applicable"
                }
              />
              <KeyValue
                label="Retirement pay"
                value={peso(recordBreakdown.retirement?.amount ?? 0)}
                note={
                  recordBreakdown.retirement?.planReference
                    ? `plan: ${recordBreakdown.retirement.planReference}`
                    : recordBreakdown.retirement?.eligible
                      ? "statutory minimum basis"
                      : "not applicable"
                }
              />
              <KeyValue
                label="Other company benefit"
                value={peso(recordBreakdown.companyBenefit?.amount ?? 0)}
                note={recordBreakdown.companyBenefit?.taxable === false ? "recorded as non-taxable" : "taxable when paid"}
              />
            </div>

            <div style={{ background: "white", padding: 14, borderRadius: 12, border: "1px solid var(--line)" }}>
              <div className="card-kicker">TAX RECONCILIATION</div>
              <KeyValue label="YTD gross compensation" value={peso(recordBreakdown.tax?.grossCompensationBeforeFinalPay ?? 0)} />
              <KeyValue label="YTD tax withheld" value={peso(recordBreakdown.tax?.taxWithheld ?? 0)} />
              <KeyValue label="Annualized taxable income" value={peso(recordBreakdown.tax?.annualized?.taxableIncome ?? 0)} />
              <KeyValue label="Annualized tax due" value={peso(recordBreakdown.tax?.annualized?.taxDue ?? 0)} />
              <KeyValue
                label={signedTaxLabel(taxAdjustment)}
                value={peso(Math.abs(taxAdjustment))}
                danger={taxAdjustment > 0}
                note={taxAdjustment < 0 ? "refund adds to final pay" : taxAdjustment > 0 ? "collection reduces final pay" : "balanced"}
              />
            </div>

            <div style={{ background: "white", padding: 14, borderRadius: 12, border: "1px solid var(--line)" }}>
              <div className="card-kicker">LIABILITIES &amp; RELEASE</div>
              <KeyValue
                label="Outstanding active loans"
                value={peso(recordBreakdown.loans?.outstandingBalance ?? selectedRecord.loanDeductions)}
                note={recordBreakdown.loans?.deductFromFinalPay ? "approved for final-pay deduction" : "not deducted from this final pay"}
              />
              <KeyValue
                label="Loan deduction"
                value={peso(recordBreakdown.loans?.deduction ?? selectedRecord.loanDeductions)}
                danger={Number(recordBreakdown.loans?.deduction ?? selectedRecord.loanDeductions) > 0}
              />
              <KeyValue
                label="Clearance"
                value={allCleared ? "Complete" : "Incomplete"}
                note="IT · Admin · Finance · HR"
              />
              <KeyValue
                label="Calculation snapshot"
                value={recordBreakdown.calculationKey ? recordBreakdown.calculationKey.slice(0, 12) : "Legacy"}
                note="approval/release fails if payroll or liabilities change"
              />
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div className="card-kicker">CLEARANCE</div>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 7 }}>
              {([
                ["it", "IT", selectedRecord.itCleared],
                ["admin", "Admin", selectedRecord.adminCleared],
                ["finance", "Finance", selectedRecord.financeCleared],
                ["hr", "HR", selectedRecord.hrCleared],
              ] as const).map(([key, label, cleared]) => (
                <button
                  key={key}
                  className="secondary-button"
                  disabled={selectedRecord.status === "released" || busyAction === `clearance-${selectedRecord.id}-${key}`}
                  onClick={() => void updateClearance(selectedRecord.id, key, !cleared)}
                  style={{ opacity: cleared ? 1 : 0.72 }}
                >
                  {cleared ? <Check size={14} className="i-green" /> : <X size={14} className="i-red" />}
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div
            style={{
              marginTop: 16,
              padding: "14px 16px",
              borderRadius: 12,
              background: "var(--green-light)",
              display: "flex",
              justifyContent: "space-between",
              gap: 14,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div>
              <span style={{ fontSize: 10, textTransform: "uppercase", fontWeight: 800, color: "#0e3e34" }}>
                NET FINAL PAY
              </span>
              <strong style={{ display: "block", fontSize: 24, color: "var(--green)" }}>
                {peso(selectedRecord.netFinalPay)}
              </strong>
              <small style={{ color: "var(--muted)" }}>
                {selectedRecord.finalPayDueDate ? `target release on or before ${selectedRecord.finalPayDueDate}` : ""}
              </small>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="secondary-button"
                disabled={selectedRecord.status === "released" || busyAction === `recompute-${selectedRecord.id}`}
                onClick={() => void recomputeFinalPay(selectedRecord.id)}
              >
                <RefreshCw size={14} /> Recompute
              </button>
              <button className="secondary-button" onClick={() => setShowCoeModal(true)}>
                <FileText size={14} /> COE
              </button>
              {selectedRecord.status === "draft" && (
                <button
                  className="primary-button"
                  disabled={!allCleared || blockers.length > 0 || busyAction === `approve-${selectedRecord.id}`}
                  onClick={() => void approveFinalPay(selectedRecord.id)}
                >
                  <ShieldCheck size={14} /> Approve final pay
                </button>
              )}
              {selectedRecord.status === "approved" && (
                <button
                  className="primary-button"
                  disabled={!allCleared || blockers.length > 0 || busyAction === `release-${selectedRecord.id}`}
                  onClick={() => void releaseFinalPay(selectedRecord.id)}
                >
                  <WalletCards size={14} /> Release final pay
                </button>
              )}
            </div>
          </div>
        </article>
      )}

      {showCoeModal && selectedRecord && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal large" role="dialog" aria-modal="true" aria-label="Certificate of Employment">
            <button className="modal-close" onClick={() => setShowCoeModal(false)} aria-label="Close">
              <X size={18} />
            </button>
            <div className="modal-icon"><FileCheck size={21} className="i-green" /></div>
            <div className="card-kicker">CERTIFICATE OF EMPLOYMENT</div>
            <h2>{selectedRecord.employeeName}</h2>
            <p>Employment dates and position are generated from the employee record. Salary is shown only because this internal draft includes it.</p>

            <div
              style={{
                background: "white",
                padding: 28,
                border: "1px solid var(--line)",
                borderRadius: 12,
                fontFamily: "serif",
                fontSize: 13,
                lineHeight: 1.8,
                color: "#222",
              }}
            >
              <div style={{ textAlign: "center", marginBottom: 18 }}>
                <strong style={{ fontSize: 16, textTransform: "uppercase" }}>Certificate of Employment</strong>
              </div>
              <p>TO WHOM IT MAY CONCERN:</p>
              <p>
                This certifies that <strong>{selectedRecord.employeeName}</strong> was employed by the company from{" "}
                <strong>{selectedRecord.hireDate}</strong> to <strong>{selectedRecord.lastDay}</strong> as{" "}
                <strong>{selectedRecord.employeeTitle}</strong>.
              </p>
              <p>
                Internal payroll records show a final configured monthly equivalent of{" "}
                <strong>{peso(selectedRecord.basicRate)}</strong>.
              </p>
              <p>This certificate is issued upon the employee&apos;s request for whatever lawful purpose it may serve.</p>
              <div style={{ marginTop: 28 }}>
                <strong>PEOPLE OPERATIONS &amp; HUMAN RESOURCES</strong><br />
                <span>Authorized Signatory</span>
              </div>
            </div>

            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setShowCoeModal(false)}>Close</button>
              <button
                className="primary-button"
                disabled={busyAction === `coe-${selectedRecord.id}`}
                onClick={() => void issueCoe(selectedRecord.id)}
              >
                <FileCheck size={14} /> Mark issued &amp; print
              </button>
            </div>
          </section>
        </div>
      )}

      <article className="card table-card">
        <div className="table-toolbar">
          <div>
            <div className="card-kicker">FINAL PAY LEDGER</div>
            <h2>Separating employees</h2>
          </div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>EMPLOYEE</th>
                <th>CATEGORY</th>
                <th>LAST DAY</th>
                <th>DUE DATE</th>
                <th>CLEARANCE</th>
                <th>NET FINAL PAY</th>
                <th>STATUS</th>
                <th>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {!loaded && (
                <tr><td colSpan={8}><div className="empty-state">Loading final-pay ledger…</div></td></tr>
              )}
              {loaded && separations.length === 0 && (
                <tr><td colSpan={8}><div className="empty-state">No separation records yet.</div></td></tr>
              )}
              {separations.map((row) => {
                const clearCount = [row.itCleared, row.adminCleared, row.financeCleared, row.hrCleared].filter(Boolean).length;
                const rowBlockers = row.finalPayBreakdown?.blockers?.length ?? 0;
                return (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.employeeName}</strong>
                      <small style={{ display: "block", color: "var(--muted)" }}>
                        {row.employeeNo} · {row.employeeTitle}
                      </small>
                    </td>
                    <td>{separationLabel(row.separationType)}</td>
                    <td>{row.lastDay}</td>
                    <td>{row.finalPayDueDate ?? "—"}</td>
                    <td>
                      <strong>{clearCount}/4</strong>
                      <small style={{ display: "block", color: rowBlockers ? "var(--danger)" : "var(--muted)" }}>
                        {rowBlockers ? `${rowBlockers} blocker(s)` : row.clearanceStatus}
                      </small>
                    </td>
                    <td><strong style={{ color: "var(--green)" }}>{peso(row.netFinalPay)}</strong></td>
                    <td><span className={`status ${statusClass(row.status)}`}>{row.status}</span></td>
                    <td>
                      <button className="secondary-button" style={{ height: 28 }} onClick={() => setSelectedRecord(row)}>
                        Breakdown
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}
