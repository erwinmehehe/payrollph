"use client";

import { useEffect, useState } from "react";
import { Banknote, CheckCircle2, Plus, ReceiptText, X } from "lucide-react";

type Employee = { id: number; firstName: string; lastName: string };

const peso = (v: number | string) =>
  `₱${Number(v).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const CATEGORIES = ["Travel", "Meals", "Equipment", "Internet", "Training", "Other"];

function useEmployees(organizationId: number) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  useEffect(() => {
    fetch(`/api/employees?organizationId=${organizationId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setEmployees)
      .catch(() => setEmployees([]));
  }, [organizationId]);
  return employees;
}

export function ExpensesPanel({ organizationId, setNotice }: { organizationId: number; setNotice: (m: string) => void }) {
  const employees = useEmployees(organizationId);
  const [claims, setClaims] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ employeeId: "", category: "Travel", description: "", amount: "", incurredOn: new Date().toISOString().slice(0, 10) });

  const [nonce, setNonce] = useState(0);
  // Fetch is issued inside the effect so no state is set synchronously in the
  // effect body; `load()` schedules a re-read and `alive` drops stale results.
  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch(`/api/expenses?organizationId=${organizationId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (alive) setClaims(data.claims ?? []);
    })();
    return () => { alive = false; };
  }, [organizationId, nonce]);

  function load() {
    setNonce((n) => n + 1);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, organizationId, employeeId: Number(form.employeeId) }),
    });
    const data = await res.json();
    if (!res.ok) return setNotice(data.error ?? "Could not submit claim.");
    setOpen(false);
    setForm({ ...form, description: "", amount: "" });
    setNotice("Claim submitted for approval.");
    await load();
  }

  async function decide(id: number, status: "approved" | "rejected") {
    const res = await fetch("/api/expenses", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    const data = await res.json();
    if (!res.ok) return setNotice(data.error ?? "Could not update claim.");
    setNotice(`Claim ${status}. Approved claims reimburse on the next payroll run.`);
    await load();
  }

  const pendingTotal = claims.filter((c) => c.status === "approved" && c.payrollRunId == null)
    .reduce((s, c) => s + Number(c.amount), 0);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Expense claims</h2>
        <button className="primary-button" onClick={() => setOpen(!open)}>
          {open ? <X size={14} /> : <Plus size={14} className="i-green" />} {open ? "Cancel" : "New claim"}
        </button>
      </div>

      <div className="stats-grid" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
        <div className="stat-card"><div className="stat-icon mint"><ReceiptText size={18} /></div><p>TOTAL CLAIMS</p><h3>{claims.length}</h3><span>submitted</span></div>
        <div className="stat-card"><div className="stat-icon amber"><ReceiptText size={18} /></div><p>AWAITING REVIEW</p><h3>{claims.filter((c) => c.status === "pending").length}</h3><span>pending approval</span></div>
        <div className="stat-card"><div className="stat-icon blue"><ReceiptText size={18} /></div><p>TO REIMBURSE</p><h3>{peso(pendingTotal)}</h3><span>approved, unpaid</span></div>
      </div>

      {open && (
        <div className="card" style={{ padding: 20, marginBottom: 16 }}>
          <form onSubmit={submit}>
            <div className="setting-form">
              <label>Employee
                <select required value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
                  <option value="">Choose…</option>
                  {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName}</option>)}
                </select>
              </label>
              <label>Category
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
              <label>Amount
                <input type="number" step="0.01" min="0" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </label>
              <label>Incurred on
                <input type="date" required value={form.incurredOn} onChange={(e) => setForm({ ...form, incurredOn: e.target.value })} />
              </label>
              <label style={{ gridColumn: "1 / -1" }}>Description
                <input required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Client visit, Grab fare" />
              </label>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button type="button" className="secondary-button" onClick={() => setOpen(false)}>Cancel</button>
              <button className="primary-button">Submit claim</button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        <table className="data-table">
          <thead><tr><th>EMPLOYEE</th><th>CATEGORY</th><th>DESCRIPTION</th><th>AMOUNT</th><th>STATUS</th><th></th></tr></thead>
          <tbody>
            {claims.length === 0 && <tr><td colSpan={6}><div className="empty-state">No claims yet.</div></td></tr>}
            {claims.map((c) => {
              const emp = employees.find((e) => e.id === c.employeeId);
              return (
                <tr key={c.id}>
                  <td><strong>{emp ? `${emp.firstName} ${emp.lastName}` : c.employeeId}</strong></td>
                  <td>{c.category}</td>
                  <td>{c.description}</td>
                  <td>{peso(c.amount)}</td>
                  <td><span className={`status status-${c.status}`}>{c.status}</span></td>
                  <td>
                    {c.status === "pending" && (
                      <button className="icon-button" title="Approve" onClick={() => decide(c.id, "approved")}>
                        <CheckCircle2 size={15} className="i-green" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function EwaPanel({ organizationId, setNotice }: { organizationId: number; setNotice: (m: string) => void }) {
  const employees = useEmployees(organizationId);
  const [employeeId, setEmployeeId] = useState("");
  const [eligibility, setEligibility] = useState<any>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [amount, setAmount] = useState("");

  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      const query = `organizationId=${organizationId}${employeeId ? `&employeeId=${employeeId}` : ""}`;
      const res = await fetch(`/api/earned-wage?${query}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!alive) return;
      setRequests(data.requests ?? []);
      setEligibility(data.eligibility ?? null);
    })();
    return () => { alive = false; };
  }, [organizationId, employeeId, nonce]);

  function load() {
    setNonce((n) => n + 1);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/earned-wage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, employeeId: Number(employeeId), requestedAmount: Number(amount) }),
    });
    const data = await res.json();
    if (!res.ok) return setNotice(data.reasons?.join(" ") ?? data.error ?? "Advance not permitted.");
    setNotice(`Advance requested. Repaid automatically on the next payroll run.`);
    setAmount("");
    await load();
  }

  async function decide(id: number, status: "approved" | "rejected") {
    const res = await fetch("/api/earned-wage", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    const data = await res.json();
    if (!res.ok) return setNotice(data.error ?? "Could not update request.");
    setNotice(`Advance ${status}.`);
    await load();
  }

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Earned wage access</h2>
        <p className="heading-copy">Let employees draw part of wages already earned before payday, capped at 50% of accrued net and recovered on the next run.</p>
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <label className="input-label">Employee
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Choose…</option>
            {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName}</option>)}
          </select>
        </label>

        {eligibility && (
          <>
            <div className="stats-grid" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
              <div className="stat-card"><p>DAYS WORKED</p><h3>{eligibility.daysWorked}</h3><span>this period</span></div>
              <div className="stat-card"><p>ACCRUED NET</p><h3>{peso(eligibility.accruedNet)}</h3><span>after statutory</span></div>
              <div className="stat-card"><p>MAX ADVANCE</p><h3>{peso(eligibility.maxAdvance)}</h3><span>50% cap</span></div>
              <div className="stat-card"><p>ELIGIBLE</p><h3>{eligibility.eligible ? "Yes" : "No"}</h3><span>{eligibility.reasons[0] ?? "clear"}</span></div>
            </div>
            <form onSubmit={submit} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <label className="input-label" style={{ margin: 0 }}>
                Requested amount
                <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              </label>
              <button className="primary-button" disabled={!eligibility.eligible}>Request advance</button>
            </form>
          </>
        )}
      </div>

      <div className="card">
        <table className="data-table">
          <thead><tr><th>EMPLOYEE</th><th>AMOUNT</th><th>FEE</th><th>STATUS</th><th></th></tr></thead>
          <tbody>
            {requests.length === 0 && <tr><td colSpan={5}><div className="empty-state">No advance requests.</div></td></tr>}
            {requests.map((r) => {
              const emp = employees.find((e) => e.id === r.employeeId);
              return (
                <tr key={r.id}>
                  <td><strong>{emp ? `${emp.firstName} ${emp.lastName}` : r.employeeId}</strong></td>
                  <td>{peso(r.requestedAmount)}</td>
                  <td>{peso(r.fee)}</td>
                  <td><span className={`status status-${r.status}`}>{r.status}</span></td>
                  <td>
                    {r.status === "pending" && (
                      <button className="icon-button" title="Approve" onClick={() => decide(r.id, "approved")}>
                        <Banknote size={15} className="i-green" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
