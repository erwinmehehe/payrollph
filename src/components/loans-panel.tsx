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
  const [summary, setSummary] = useState({ totalActiveLoans: 0, totalOutstanding: 0, totalPaidOff: 0 });
  const [loaded, setLoaded] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState<Loan | null>(null);
  const [manualPayAmount, setManualPayAmount] = useState("");

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
        setSummary(data.summary ?? { totalActiveLoans: 0, totalOutstanding: 0, totalPaidOff: 0 });
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
        principal: Number(form.principal),
        monthlyAmortization: Number(form.monthlyAmortization),
        cutoffDeduction: form.cutoffDeduction ? Number(form.cutoffDeduction) : undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setNotice(data.error ?? "Failed to register loan.");
      return;
    }
    setNotice("Loan registered. Cut-off deductions will automatically deduct during payroll calculation.");
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
    });
    reload();
  }

  async function recordManualPayment(loanId: number) {
    if (!manualPayAmount || Number(manualPayAmount) <= 0) {
      setNotice("Enter a valid payment amount.");
      return;
    }
    const res = await fetch("/api/loans", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: loanId, action: "record_payment", amount: Number(manualPayAmount), reference: "Direct Employee Remittance" }),
    });
    const data = await res.json();
    if (!res.ok) {
      setNotice(data.error ?? "Failed to record payment.");
      return;
    }
    setNotice(`Payment of ${peso(manualPayAmount)} credited. Balance updated.`);
    setManualPayAmount("");
    setSelectedLoan(null);
    reload();
  }

  async function toggleLoanStatus(loanId: number, currentStatus: string) {
    const action = currentStatus === "active" ? "pause" : "resume";
    const res = await fetch("/api/loans", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: loanId, action }),
    });
    if (res.ok) {
      setNotice(action === "pause" ? "Loan deductions paused." : "Loan deductions resumed.");
      reload();
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Employee Loan Ledger &amp; Amortization</h2>
          <p className="heading-copy">Manage SSS, Pag-IBIG, and company loan schedules with automated payroll cut-off deductions.</p>
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

      {showAddForm && (
        <article className="card" style={{ padding: 20, marginBottom: 18 }}>
          <div className="card-header" style={{ padding: 0, marginBottom: 14 }}>
            <div><div className="card-kicker">NEW LOAN REGISTRATION</div><h2 style={{ margin: 0 }}>Enroll Employee Loan Schedule</h2></div>
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
              <label style={{ gridColumn: "1 / -1" }}>Remarks / Notes
                <input placeholder="e.g. 24-month SSS loan endorsed by SSS portal" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </label>
            </div>
            <div className="run-actions">
              <button type="button" className="secondary-button" onClick={() => setShowAddForm(false)}>Cancel</button>
              <button className="primary-button">Register Loan &amp; Activate Deduction</button>
            </div>
          </form>
        </article>
      )}

      {selectedLoan && (
        <article className="card" style={{ padding: 18, marginBottom: 18, background: "#f8fbf9", border: "1.5px solid var(--green-border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <div className="card-kicker">MANUAL PAYMENT &amp; ADJUSTMENT</div>
              <h3 style={{ margin: 0, fontSize: 16 }}>{selectedLoan.employeeName} · {selectedLoan.loanType}</h3>
              <p style={{ margin: "2px 0 0", color: "var(--muted)", fontSize: 11 }}>Reference: {selectedLoan.referenceNo} · Remaining Balance: <strong>{peso(selectedLoan.remainingBalance)}</strong></p>
            </div>
            <button className="icon-button" onClick={() => setSelectedLoan(null)}><X size={16} /></button>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <label className="input-label" style={{ margin: 0 }}>Payment Amount
              <input type="number" min="1" step="0.01" placeholder="e.g. 520.83" value={manualPayAmount} onChange={(e) => setManualPayAmount(e.target.value)} />
            </label>
            <button className="primary-button" onClick={() => recordManualPayment(selectedLoan.id)}>Record Direct Remittance</button>
            <button className="secondary-button" onClick={() => toggleLoanStatus(selectedLoan.id, selectedLoan.status)}>
              {selectedLoan.status === "active" ? "Pause Deductions" : "Resume Deductions"}
            </button>
          </div>
        </article>
      )}

      <article className="card table-card">
        <div className="table-toolbar">
          <div><div className="card-kicker">ACTIVE SCHEDULES</div><h2>Employee Loan Accounts</h2></div>
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
                  <td><strong style={{ color: "var(--danger)" }}>-{peso(loan.cutoffDeduction)}</strong></td>
                  <td><span style={{ color: "var(--green)", fontWeight: 700 }}>{peso(loan.totalPaid)}</span></td>
                  <td><strong>{peso(loan.remainingBalance)}</strong></td>
                  <td><span className={`status status-${loan.status === "active" ? "tested" : loan.status === "paid_off" ? "verified" : "needs-review"}`}>{loan.status}</span></td>
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
