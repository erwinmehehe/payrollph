
"use client";
import { useCallback, useEffect, useState } from "react";
import { ExpensesPanel } from "@/components/wallet-panel";

type Employee = { id: number; firstName: string; lastName: string };
type Claim = { id: number; employeeId: number; description: string; amount: string; incurredOn: string; category: string };
type Card = { id: number; issuer: string; lastFour: string; employeeId: number | null; status: string };
type Charge = { id: number; cardId: number; merchant: string; amount: string; spentOn: string };
type Report = { id: number; title: string; employeeId: number; status: string; totalAmount: string; claimIds: number[]; reimbursementStatus: string };
type ExpensePolicy = { id: number; category: string; taxable: boolean; reviewReference: string };
type Data = {
  employees: Employee[]; cards: Card[]; transactions: Charge[]; reports: Report[];
  unreportedClaims: Claim[]; categoryPolicies?: ExpensePolicy[];
  spendPayrollEnabled?: boolean; canReviewCategories?: boolean;
};
const currency = (v: string) => "₱" + Number(v).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function SpendOperationsPanel({ organizationId, setNotice, canLoadEmployeeDirectory = true }: { organizationId: number; setNotice: (text: string) => void; canLoadEmployeeDirectory?: boolean }) {
  const [data, setData] = useState<Data>({ employees: [], cards: [], transactions: [], reports: [], unreportedClaims: [] });
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [issuer, setIssuer] = useState("");
  const [lastFour, setLastFour] = useState("");
  const [cardEmployeeId, setCardEmployeeId] = useState("");
  const [cardId, setCardId] = useState("");
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [spentOn, setSpentOn] = useState("");
  const [reference, setReference] = useState("");
  const [title, setTitle] = useState("");
  const [claimIds, setClaimIds] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [policyCategory, setPolicyCategory] = useState("");
  const [policyTaxable, setPolicyTaxable] = useState(false);
  const [policyReviewReference, setPolicyReviewReference] = useState("");
  const load = useCallback(() => setReload(n => n + 1), []);
  useEffect(() => {
    let active = true;
    fetch("/api/spend?organizationId=" + organizationId).then(async r => {
      const body = await r.json(); if (!r.ok) throw new Error(body.error || "Spend data could not load."); return body;
    }).then(body => { if (active) { setData(body); setError(""); } })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [organizationId, reload]);
  async function write(method: "POST" | "PATCH", body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/spend", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId, ...body }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Action failed.");
      setError("");
      setNotice("Spend record updated.");
      load();
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Action failed."); return false; }
    finally { setBusy(false); }
  }
  const name = (id: number | null) => data.employees.find(e => e.id === id)?.firstName + " " + data.employees.find(e => e.id === id)?.lastName;
  const pending = data.unreportedClaims.filter(c => String(c.employeeId) === employeeId);
  return <section className="spend-workspace">
    <header><h2>Spend management</h2><p>Track employer cards and charges separately from employee-paid expenses reimbursed in payroll. These cards are records, not issued payment instruments.</p></header>
    {error && <p role="alert" style={{ color: "#b42318" }}>{error}</p>}
    {data.spendPayrollEnabled && <div className="card" style={{ padding: 18 }}>
      <h3>Reviewed expense category tax treatments</h3>
      <p>Finance reviews the tax treatment, stores evidence and locks the category for future claims.</p>
      <div className="spend-table-wrap" role="region" aria-label="Expense category policies" tabIndex={0}><table className="data-table">
        <thead><tr><th>Category</th><th>Tax treatment</th><th>Review reference</th></tr></thead>
        <tbody>{(data.categoryPolicies ?? []).map(policy =>
          <tr key={policy.id}><td>{policy.category}</td>
            <td>{policy.taxable ? "Taxable" : "Non-taxable"}</td>
            <td>{policy.reviewReference}</td></tr>)}</tbody>
      </table></div>
      {data.canReviewCategories && <form className="spend-form"
        onSubmit={async event => {
          event.preventDefault();
          if (await write("POST", { action: "category_policy",
            category: policyCategory.trim(), taxable: policyTaxable,
            reviewReference: policyReviewReference.trim() })) {
            setPolicyCategory(""); setPolicyReviewReference("");
          }
        }}>
        <label>Category <input required minLength={2} maxLength={60}
          value={policyCategory} onChange={event => setPolicyCategory(event.target.value)}
          placeholder="Travel" /></label>
        <label>Tax treatment <select value={policyTaxable ? "taxable" : "non-taxable"}
          onChange={event => setPolicyTaxable(event.target.value === "taxable")}>
          <option value="non-taxable">Non-taxable (review evidence required)</option>
          <option value="taxable">Taxable</option>
        </select></label>
        <label>Review reference <input required minLength={8} maxLength={200}
          value={policyReviewReference}
          onChange={event => setPolicyReviewReference(event.target.value)}
          placeholder="Approved tax treatment reference" /></label>
        <button type="submit" className="primary-button" disabled={busy}>
          Approve category policy
        </button>
      </form>}
    </div>}
    <ExpensesPanel organizationId={organizationId} setNotice={setNotice} reviewModeEnabled={data.spendPayrollEnabled === true} canLoadEmployeeDirectory={canLoadEmployeeDirectory} />
    <div className="card" style={{ padding: 18 }}>
      <h3>Corporate card register</h3>
      <form onSubmit={async e => { e.preventDefault(); if (await write("POST", { action: "card", issuer, lastFour, employeeId: cardEmployeeId || null })) { setIssuer(""); setLastFour(""); } }} className="spend-form">
        <label>Issuer <input required value={issuer} onChange={e => setIssuer(e.target.value)} placeholder="Issuer name" /></label>
        <label>Last 4 digits <input required maxLength={4} minLength={4} pattern="[0-9]{4}" value={lastFour} onChange={e => setLastFour(e.target.value)} placeholder="1234" /></label>
        <label>Cardholder <select value={cardEmployeeId} onChange={e => setCardEmployeeId(e.target.value)}><option value="">Company card</option>{data.employees.map(e => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}</select></label>
        <button className="primary-button" disabled={busy}>Register card</button>
      </form>
      <div className="spend-table-wrap" role="region" aria-label="Corporate card register" tabIndex={0}><table className="data-table"><thead><tr><th>Card</th><th>Employee</th><th>Status</th></tr></thead><tbody>{data.cards.length === 0 && <tr><td colSpan={3}><p className="spend-empty">No company cards recorded yet. Add an issuer and cardholder above.</p></td></tr>}{data.cards.map(c => <tr key={c.id}><td>{c.issuer} •••• {c.lastFour}</td><td>{c.employeeId ? name(c.employeeId) : "Company"}</td><td>{c.status}</td></tr>)}</tbody></table></div>
    </div>
    <div className="card" style={{ padding: 18 }}>
      <h3>Record company-paid transaction</h3>
      <form onSubmit={async e => { e.preventDefault(); if (await write("POST", { action: "transaction", cardId: Number(cardId), merchant, amount, spentOn, externalReference: reference })) { setMerchant(""); setAmount(""); setReference(""); } }} className="spend-form">
        <label>Card <select required value={cardId} onChange={e => setCardId(e.target.value)}><option value="">Choose card</option>{data.cards.map(c => <option key={c.id} value={c.id}>{c.issuer} ••••{c.lastFour}</option>)}</select></label>
        <label>Merchant <input required value={merchant} onChange={e => setMerchant(e.target.value)} /></label>
        <label>Amount (PHP) <input required inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" /></label>
        <label>Date <input required type="date" value={spentOn} onChange={e => setSpentOn(e.target.value)} /></label>
        <label>Statement reference <input required value={reference} onChange={e => setReference(e.target.value)} /></label>
        <button className="primary-button" disabled={busy}>Record charge</button>
      </form>
      <div className="spend-table-wrap" role="region" aria-label="Company-paid transactions" tabIndex={0}><table className="data-table"><thead><tr><th>Date</th><th>Merchant</th><th>Amount</th></tr></thead><tbody>{data.transactions.length === 0 && <tr><td colSpan={3}><p className="spend-empty">No company-paid charges recorded yet.</p></td></tr>}{data.transactions.map(t => <tr key={t.id}><td>{t.spentOn}</td><td>{t.merchant}</td><td>{currency(t.amount)}</td></tr>)}</tbody></table></div>
    </div>
    <div className="card" style={{ padding: 18 }}>
      <h3>Employee expense reports</h3>
      <p>Submit pending claims as one report. A different admin must approve before the existing payroll reimbursement flow can pay them.</p>
      <label>Employee <select value={employeeId} onChange={e => { setEmployeeId(e.target.value); setClaimIds([]); }}><option value="">Select employee</option>{data.employees.map(e => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}</select></label>
      <div style={{ display: "grid", gap: 8, margin: "12px 0" }}>{pending.map(c => <label key={c.id}><input type="checkbox" checked={claimIds.includes(c.id)} onChange={e => setClaimIds(ids => e.target.checked ? [...ids, c.id] : ids.filter(id => id !== c.id))} /> {c.incurredOn} · {c.description} · {currency(c.amount)}</label>)}</div>
      <form onSubmit={async e => { e.preventDefault(); if (await write("POST", { action: "report", employeeId: Number(employeeId), title, claimIds })) { setTitle(""); setClaimIds([]); } }} className="spend-form spend-report-form">
        <label>Report title<input required value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. October travel expenses" /></label>
        <button className="primary-button" disabled={busy || claimIds.length === 0}>Submit report</button>
      </form>
      <div className="spend-table-wrap" role="region" aria-label="Employee expense reports" tabIndex={0}><table className="data-table"><thead><tr><th>Report</th><th>Employee</th><th>Amount</th><th>Decision status</th><th>Reimbursement</th><th>Actions</th></tr></thead><tbody>{data.reports.length === 0 && <tr><td colSpan={6}><p className="spend-empty">No expense reports yet. Select an employee and their pending claims to prepare one.</p></td></tr>}{data.reports.map(r => <tr key={r.id}><td>{r.title}</td><td>{name(r.employeeId)}</td><td>{currency(r.totalAmount)}</td><td>{r.status}</td><td>{r.reimbursementStatus.replaceAll("_", " ")}</td><td>{r.status === "submitted" && <span><button disabled={busy} onClick={() => write("PATCH", { id: r.id, status: "approved" })}>Approve</button> <button disabled={busy} onClick={() => write("PATCH", { id: r.id, status: "rejected" })}>Reject</button></span>}</td></tr>)}</tbody></table></div>
    </div>
  </section>;
}
