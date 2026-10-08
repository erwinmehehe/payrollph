"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Plus, X } from "lucide-react";

const peso = (value: number | string) =>
  `₱${Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Employee = { id: number; firstName: string; lastName: string };
type Rule = {
  type: string;
  label: string;
  ceiling?: number;
  ceilingRate?: number;
  ceilingBasis?: string;
  period: string;
};
type Grant = {
  id: number;
  employeeId: number;
  employeeName: string;
  benefitType: string;
  amount: string;
  frequency: string;
  basisDailyMinimumWage?: string | null;
  basisWageOrder?: string | null;
  active: boolean;
  effectiveOn: string;
  treatment: {
    exempt: number;
    excess: number;
    ceiling: number;
    treatment: string;
    dailyCeiling?: number;
    dailyMinimumWage?: number;
    eligibleDays?: number;
  };
};

export function DeMinimisPanel({ organizationId, setNotice }: { organizationId: number; setNotice: (message: string) => void }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    employeeId: "",
    benefitType: "riceSubsidy",
    amount: "2500",
    effectiveOn: new Date().toISOString().slice(0, 10),
    basisDailyMinimumWage: "",
    basisWageOrder: "",
  });

  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((current) => current + 1), []);

  // The fetch lives in the effect so every state update happens after an await,
  // and `alive` stops a slow response for one client overwriting a newer one.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [grantRes, staffRes] = await Promise.all([
        fetch(`/api/de-minimis?organizationId=${organizationId}`, { cache: "no-store" }),
        fetch(`/api/employees?organizationId=${organizationId}`, { cache: "no-store" }),
      ]);
      if (grantRes.ok) {
        const data = await grantRes.json();
        if (!alive) return;
        setRules(data.rules ?? []);
        setGrants(data.grants ?? []);
      }
      if (staffRes.ok) {
        const staff = await staffRes.json();
        if (!alive) return;
        setEmployees(staff);
      }
    })();
    return () => {
      alive = false;
    };
  }, [organizationId, nonce]);

  const selectedRule = rules.find((rule) => rule.type === form.benefitType);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/de-minimis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, organizationId, employeeId: Number(form.employeeId), amount: Number(form.amount) }),
    });
    const data = await res.json();
    if (!res.ok) return setNotice(data.error ?? "Could not grant benefit.");
    setOpen(false);
    setNotice(form.benefitType === "otNightMealAllowance"
      ? `OT/night meal allowance saved. Payroll will pay it only on qualifying attendance days and cap the exempt amount at 30% of the verified daily minimum wage.`
      : data.treatment.excess > 0
        ? `Benefit granted. ${peso(data.treatment.excess)} excess enters the PHP 90,000 other-benefits pool.`
        : "De minimis benefit granted as tax-exempt within its ceiling.");
    reload();
  }

  async function end(id: number) {
    const res = await fetch(`/api/de-minimis?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setNotice("Benefit ended. It will not appear in future payroll runs.");
      reload();
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>De minimis benefits</h2>
          <p className="heading-copy">RR 29-2025 ceilings effective 6 January 2026. Within-ceiling amounts are tax-exempt; excess enters the annual PHP 90,000 other-benefits pool.</p>
        </div>
        <button className="primary-button" onClick={() => setOpen(!open)}>{open ? <X size={14} /> : <Plus size={14} className="i-green" />} {open ? "Cancel" : "Grant benefit"}</button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="table-toolbar"><div><div className="card-kicker">2026 RR 29-2025 CEILINGS</div><h2>Tax-exempt benefit catalogue</h2></div></div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>BENEFIT</th><th>CEILING</th><th>PERIOD</th><th>TAX TREATMENT</th></tr></thead>
            <tbody>{rules.map((rule) => <tr key={rule.type}><td><strong>{rule.label}</strong></td><td>{rule.period === "eligible_day"
  ? `${Math.round(Number(rule.ceilingRate ?? 0) * 100)}% of applicable daily minimum wage`
  : rule.type === "monetizedVacationLeaveDays"
    ? `${rule.ceiling} days`
    : peso(rule.ceiling ?? 0)}</td><td>{rule.period}</td><td><span className="status status-tested">Exempt to ceiling</span></td></tr>)}</tbody>
          </table>
        </div>
      </div>

      {open && (
        <div className="card" style={{ padding: 20, marginBottom: 16 }}>
          <form onSubmit={save}>
            <div className="setting-form">
              <label>Employee<select required value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}><option value="">Choose…</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</select></label>
              <label>Benefit type<select value={form.benefitType} onChange={(e) => {
                const rule = rules.find((r) => r.type === e.target.value);
                setForm({
                  ...form,
                  benefitType: e.target.value,
                  amount: rule?.period === "eligible_day" ? "" : String(rule?.ceiling ?? ""),
                  basisDailyMinimumWage: rule?.period === "eligible_day" ? form.basisDailyMinimumWage : "",
                  basisWageOrder: rule?.period === "eligible_day" ? form.basisWageOrder : "",
                });
              }}>{rules.map((rule) => <option key={rule.type} value={rule.type}>{rule.label}</option>)}</select></label>
              <label>Amount per {selectedRule?.period === "eligible_day" ? "qualifying day" : selectedRule?.period ?? "period"}<input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
              {selectedRule?.period === "eligible_day" && <>
                <label>Applicable daily minimum wage<input required type="number" min="0.01" step="0.01" value={form.basisDailyMinimumWage} onChange={(e) => setForm({ ...form, basisDailyMinimumWage: e.target.value })} /></label>
                <label>Wage order / verified reference<input required value={form.basisWageOrder} onChange={(e) => setForm({ ...form, basisWageOrder: e.target.value })} placeholder="e.g. WO-NCR-28, applicable tier" /></label>
              </>}
              <label>Effective on<input type="date" value={form.effectiveOn} onChange={(e) => setForm({ ...form, effectiveOn: e.target.value })} /></label>
            </div>
            {selectedRule && <div className="notice notice-blue"><span>{selectedRule.period === "eligible_day"
              ? <>Exempt ceiling: <strong>30% of the verified applicable daily minimum wage</strong> for each attendance day with overtime or night/graveyard work. The configured amount is paid only on qualifying days.</>
              : <>Ceiling: <strong>{selectedRule.type === "monetizedVacationLeaveDays" ? `${selectedRule.ceiling} days` : peso(selectedRule.ceiling ?? 0)}</strong> per {selectedRule.period}. Amount paid in each semi-monthly run is prorated.</>}</span></div>}
            <div className="run-actions"><button className="primary-button">Grant benefit</button></div>
          </form>
        </div>
      )}

      <div className="card">
        <div className="table-toolbar"><div><div className="card-kicker">ACTIVE GRANTS</div><h2>Payroll-linked benefits</h2></div></div>
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>EMPLOYEE</th><th>BENEFIT</th><th>GRANT</th><th>EXEMPT</th><th>EXCESS</th><th></th></tr></thead><tbody>
          {grants.filter((g) => g.active).length === 0 && <tr><td colSpan={6}><div className="empty-state">No active de minimis grants.</div></td></tr>}
          {grants.filter((g) => g.active).map((grant) => <tr key={grant.id}><td><strong>{grant.employeeName}</strong></td><td>{rules.find((r) => r.type === grant.benefitType)?.label ?? grant.benefitType}</td><td>{peso(grant.amount)} / {grant.frequency === "eligible_day" ? "qualifying day" : grant.frequency}{grant.basisWageOrder ? <div className="muted">{grant.basisWageOrder} · wage basis {peso(grant.basisDailyMinimumWage ?? 0)}</div> : null}</td><td>{peso(grant.treatment.exempt)}</td><td>{grant.treatment.excess > 0 ? peso(grant.treatment.excess) : "-"}</td><td><button className="icon-button" title="End benefit" onClick={() => end(grant.id)}><X size={14} /></button></td></tr>)}
        </tbody></table></div>
        <div className="notice notice-green"><Check size={16} className="i-green" /><span>Active grants are included in payroll with ceiling and taxable-excess evidence. OT/night meal allowances are attendance-linked and pay only for qualifying work dates.</span></div>
      </div>
    </div>
  );
}
