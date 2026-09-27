"use client";

import { useEffect, useState } from "react";
import { Check, CheckCircle2, Download, FileCheck, FileText, HelpCircle, Plus, Shield, UserX, X } from "lucide-react";

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
  unusedLeaveCredits: string;
  leaveMonetizationPay: string;
  taxAdjustment: string;
  loanDeductions: string;
  netFinalPay: string;
  status: string;
  coeIssued: boolean;
};

const peso = (value: string | number) =>
  `₱${Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function SeparationPanel({ organizationId, setNotice }: { organizationId: number; setNotice: (m: string) => void }) {
  const [separations, setSeparations] = useState<SeparationRecord[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<SeparationRecord | null>(null);
  const [showCoeModal, setShowCoeModal] = useState(false);

  const [form, setForm] = useState({
    employeeId: "",
    separationType: "resignation",
    noticeDate: new Date().toISOString().slice(0, 10),
    lastDay: new Date().toISOString().slice(0, 10),
    unusedLeaveCredits: "5.0",
  });

  async function load() {
    const [sepRes, empRes] = await Promise.all([
      fetch(`/api/separation?organizationId=${organizationId}`, { cache: "no-store" }),
      fetch(`/api/employees?organizationId=${organizationId}`, { cache: "no-store" }),
    ]);
    if (sepRes.ok) {
      const data = await sepRes.json();
      setSeparations(data.separations ?? []);
    }
    if (empRes.ok) {
      setEmployees(await empRes.json());
    }
    setLoaded(true);
  }

  useEffect(() => {
    void load();
  }, [organizationId]);

  async function initiateSeparation(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/separation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        organizationId,
        employeeId: Number(form.employeeId),
        unusedLeaveCredits: Number(form.unusedLeaveCredits),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setNotice(data.error ?? "Failed to calculate final pay.");
      return;
    }
    setNotice("Separation initiated and Final Pay calculated adhering to DOLE 30-day mandate.");
    setShowModal(false);
    await load();
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
      await load();
    }
  }

  async function approveFinalPay(id: number) {
    const res = await fetch("/api/separation", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "approve" }),
    });
    if (res.ok) {
      setNotice("Final Pay package approved for bank crediting.");
      await load();
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Separation, Clearance &amp; Final Pay (DOLE Advisory 06-20)</h2>
          <p className="heading-copy">Prorated 13th month, unused leave monetization, loan deductions, and 30-day final pay release compliance.</p>
        </div>
        <button className="primary-button" onClick={() => setShowModal(true)}>
          <UserX size={15} className="i-red" /> Initiate Employee Separation
        </button>
      </div>

      <div className="stats-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <article className="stat-card">
          <div className="stat-icon orange"><UserX size={19} className="i-red" /></div>
          <p>SEPARATING STAFF</p>
          <h3>{separations.filter((s) => s.status !== "released").length}</h3>
          <span>Under active clearance</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon purple"><FileCheck size={19} className="i-green" /></div>
          <p>CLEARED FOR FINAL PAY</p>
          <h3>{separations.filter((s) => s.clearanceStatus === "cleared").length}</h3>
          <span>All 4 departments signed</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon mint"><CheckCircle2 size={19} className="i-green" /></div>
          <p>COEs GENERATED</p>
          <h3>{separations.filter((s) => s.coeIssued).length}</h3>
          <span>Certificates issued</span>
        </article>
        <article className="stat-card">
          <div className="stat-icon blue"><FileText size={19} className="i-teal" /></div>
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
            <div className="setting-form">
              <label>Separating Employee
                <select required value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
                  <option value="">Select Employee…</option>
                  {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName} ({emp.employeeNo})</option>)}
                </select>
              </label>
              <label>Separation Category
                <select value={form.separationType} onChange={(e) => setForm({ ...form, separationType: e.target.value })}>
                  <option value="resignation">Voluntary Resignation (30d notice)</option>
                  <option value="retirement">Retirement (RA 7641)</option>
                  <option value="end_of_contract">End of Fixed-Term Contract</option>
                  <option value="authorized_cause">Authorized Cause (Retrenchment/Redundancy - 1mo separation pay)</option>
                  <option value="just_cause">Just Cause Termination (Art. 297)</option>
                </select>
              </label>
              <label>Notice / Tender Date
                <input required type="date" value={form.noticeDate} onChange={(e) => setForm({ ...form, noticeDate: e.target.value })} />
              </label>
              <label>Effective Last Day
                <input required type="date" value={form.lastDay} onChange={(e) => setForm({ ...form, lastDay: e.target.value })} />
              </label>
              <label>Unused Vacation / Service Incentive Leave Credits (Days)
                <input required type="number" step="0.5" min="0" max="60" value={form.unusedLeaveCredits} onChange={(e) => setForm({ ...form, unusedLeaveCredits: e.target.value })} />
              </label>
            </div>
            <div className="notice notice-blue" style={{ margin: "10px 0" }}>
              <span><strong>Automated Computation:</strong> Accrues 13th month from Jan 1 to Last Day, monetizes unused leave at daily rate (Basic &divide; 22), deducts active loan balances, and produces legal clearance checklist.</span>
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
                <span>Prorated 13th Month Pay</span>
                <strong>{peso(selectedRecord.prorated13thMonth)}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #edf2ee", fontSize: 11.5 }}>
                <span>Leave Monetization ({selectedRecord.unusedLeaveCredits} days)</span>
                <strong>{peso(selectedRecord.leaveMonetizationPay)}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 11.5 }}>
                <span>Tax Withholding Refund</span>
                <strong>{peso(selectedRecord.taxAdjustment)}</strong>
              </div>
            </div>

            <div style={{ background: "white", padding: 14, borderRadius: 10, border: "1px solid var(--line)" }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: "var(--danger)", textTransform: "uppercase" }}>DEDUCTIONS (LIABILITIES)</span>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #edf2ee", fontSize: 11.5, marginTop: 6 }}>
                <span>Outstanding Employee Loans</span>
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
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="secondary-button" onClick={() => setShowCoeModal(true)}><FileText size={15} className="i-teal" /> View COE Draft</button>
              {selectedRecord.status === "draft" && (
                <button className="primary-button" onClick={() => approveFinalPay(selectedRecord.id)}>Approve Final Pay</button>
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
              <button className="primary-button" onClick={() => { setNotice("COE generated and marked issued."); setShowCoeModal(false); }}>Print / Download COE</button>
            </div>
          </section>
        </div>
      )}

      <article className="card table-card">
        <div className="table-toolbar">
          <div><div className="card-kicker">FINAL PAY LEDGER</div><h2>Separating Employees</h2></div>
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
                  <td><span className={`status status-${sep.status === "approved" ? "verified" : sep.status === "draft" ? "needs-review" : "released"}`}>{sep.status}</span></td>
                  <td>
                    <button className="primary-button" style={{ height: 26, fontSize: 10, padding: "0 8px" }} onClick={() => setSelectedRecord(sep)}>
                      Breakdown
                    </button>
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
