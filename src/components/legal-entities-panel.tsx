"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Landmark, Plus, RefreshCw, Save, ShieldCheck, UsersRound } from "lucide-react";

type LegalEntity = {
  id: number;
  code: string;
  legalName: string;
  displayName: string;
  birTin: string | null;
  birBranchCode: string | null;
  sssEmployerNo: string | null;
  philHealthEmployerNo: string | null;
  pagIbigEmployerNo: string | null;
  statutoryDeductionTiming: string;
  payrollCalendarMode: string;
  disbursementBankCode: string | null;
  disbursementAccountName: string | null;
  disbursementAccount: string | null;
  primaryEntity: boolean;
  active: boolean;
  employeeCount: number;
  releasedPayrollRuns: number;
};

type EmployeeRow = {
  id: number;
  employeeNo: string;
  firstName: string;
  lastName: string;
  status: string;
  legalEntityId: number | null;
};

type FormState = {
  code: string;
  legalName: string;
  displayName: string;
  birTin: string;
  birBranchCode: string;
  sssEmployerNo: string;
  philHealthEmployerNo: string;
  pagIbigEmployerNo: string;
  statutoryDeductionTiming: string;
  payrollCalendarMode: string;
  disbursementBankCode: string;
  disbursementAccountName: string;
  disbursementAccount: string;
};

const blank: FormState = {
  code: "",
  legalName: "",
  displayName: "",
  birTin: "",
  birBranchCode: "",
  sssEmployerNo: "",
  philHealthEmployerNo: "",
  pagIbigEmployerNo: "",
  statutoryDeductionTiming: "split",
  payrollCalendarMode: "flexible",
  disbursementBankCode: "",
  disbursementAccountName: "",
  disbursementAccount: "",
};

function fromEntity(entity: LegalEntity): FormState {
  return {
    code: entity.code,
    legalName: entity.legalName,
    displayName: entity.displayName,
    birTin: entity.birTin ?? "",
    birBranchCode: entity.birBranchCode ?? "",
    sssEmployerNo: entity.sssEmployerNo ?? "",
    philHealthEmployerNo: entity.philHealthEmployerNo ?? "",
    pagIbigEmployerNo: entity.pagIbigEmployerNo ?? "",
    statutoryDeductionTiming: entity.statutoryDeductionTiming,
    payrollCalendarMode: entity.payrollCalendarMode,
    disbursementBankCode: entity.disbursementBankCode ?? "",
    disbursementAccountName: entity.disbursementAccountName ?? "",
    disbursementAccount: "",
  };
}

export function LegalEntitiesPanel({
  organizationId,
  setNotice,
}: {
  organizationId: number;
  setNotice: (message: string) => void;
}) {
  const [entities, setEntities] = useState<LegalEntity[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(blank);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const selected = useMemo(
    () => entities.find((entity) => entity.id === selectedId) ?? entities[0] ?? null,
    [entities, selectedId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/legal-entities?organizationId=${organizationId}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(payload.error ?? "Could not load legal employers.");
        return;
      }
      const nextEntities = Array.isArray(payload.legalEntities) ? payload.legalEntities as LegalEntity[] : [];
      setEntities(nextEntities);
      setEmployees(Array.isArray(payload.employees) ? payload.employees as EmployeeRow[] : []);
      setSelectedId((current) =>
        current && nextEntities.some((entity) => entity.id === current)
          ? current
          : nextEntities.find((entity) => entity.primaryEntity)?.id ?? nextEntities[0]?.id ?? null,
      );
    } catch {
      setNotice("Could not reach legal-employer management.");
    } finally {
      setLoading(false);
    }
  }, [organizationId, setNotice]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (creating) return;
    if (selected) setForm(fromEntity(selected));
  }, [selected, creating]);

  async function createEntity(event: React.FormEvent) {
    event.preventDefault();
    setSaving("create");
    try {
      const response = await fetch("/api/legal-entities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, ...form }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(payload.error ?? "Could not create legal employer.");
        return;
      }
      setCreating(false);
      setForm(blank);
      await load();
      setSelectedId(payload.legalEntity?.id ?? null);
      setNotice("Legal employer created.");
    } catch {
      setNotice("Could not reach legal-employer management.");
    } finally {
      setSaving(null);
    }
  }

  async function patch(payload: Record<string, unknown>, success: string) {
    setSaving(String(payload.action ?? "save"));
    try {
      const response = await fetch("/api/legal-entities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, ...payload }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(body.error ?? "The legal-employer change could not be saved.");
        return false;
      }
      await load();
      setNotice(success);
      return true;
    } catch {
      setNotice("Could not reach legal-employer management.");
      return false;
    } finally {
      setSaving(null);
    }
  }

  async function saveEntity(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    const saved = await patch({
      action: "update_entity",
      legalEntityId: selected.id,
      legalName: form.legalName,
      displayName: form.displayName,
      birTin: form.birTin,
      birBranchCode: form.birBranchCode,
      sssEmployerNo: form.sssEmployerNo,
      philHealthEmployerNo: form.philHealthEmployerNo,
      pagIbigEmployerNo: form.pagIbigEmployerNo,
      statutoryDeductionTiming: form.statutoryDeductionTiming,
      payrollCalendarMode: form.payrollCalendarMode,
      disbursementBankCode: form.disbursementBankCode,
      disbursementAccountName: form.disbursementAccountName,
      ...(form.disbursementAccount.trim() ? { disbursementAccount: form.disbursementAccount.trim() } : {}),
    }, "Legal employer settings updated.");
    if (saved) setForm((current) => ({ ...current, disbursementAccount: "" }));
  }

  async function assignEmployee(employeeId: number, legalEntityId: number) {
    await patch({
      action: "assign_employee",
      employeeId,
      legalEntityId,
    }, "Employee legal employer updated.");
  }

  return (
    <section style={{ marginBottom: 16 }}>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ENTERPRISE STRUCTURE</div>
          <h1>Legal employers</h1>
          <p>Separate Philippine employer registrations, payroll policy, bank configuration, employee populations, and payroll runs inside one parent workspace.</p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} /> Refresh</button>
          <button className="primary-button" onClick={() => { setCreating(true); setForm(blank); }}><Plus size={15} /> Legal employer</button>
        </div>
      </div>

      <div className="notice notice-slate" style={{ marginBottom: 16 }}>
        <ShieldCheck size={15} />
        <span><strong>Hard payroll boundary.</strong> A payroll run belongs to one legal employer and includes only employees assigned to that employer. Existing released payroll blocks ad-hoc employee reassignment.</span>
      </div>

      <section className="stats-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <article className="stat-card"><div className="stat-icon purple"><Building2 size={19} /></div><p>LEGAL EMPLOYERS</p><h3>{entities.length}</h3><span>{entities.filter((entity) => entity.active).length} active</span></article>
        <article className="stat-card"><div className="stat-icon blue"><UsersRound size={19} /></div><p>ASSIGNED PEOPLE</p><h3>{employees.filter((employee) => employee.legalEntityId).length}</h3><span>{employees.length} employees in workspace</span></article>
        <article className="stat-card"><div className="stat-icon mint"><ShieldCheck size={19} /></div><p>REGISTRATION READY</p><h3>{entities.filter((entity) => entity.birTin && entity.sssEmployerNo && entity.philHealthEmployerNo && entity.pagIbigEmployerNo).length}</h3><span>BIR + SSS + PhilHealth + Pag-IBIG</span></article>
        <article className="stat-card"><div className="stat-icon orange"><Landmark size={19} /></div><p>BANK READY</p><h3>{entities.filter((entity) => entity.disbursementBankCode && entity.disbursementAccount).length}</h3><span>entity payout configuration</span></article>
      </section>

      {creating && (
        <article className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div className="card-header"><div><div className="card-kicker">NEW LEGAL EMPLOYER</div><h2>Create an employer record</h2><p>The first existing employer remains primary. New entities are inactive only when explicitly disabled later.</p></div></div>
          <EntityForm form={form} setForm={setForm} includeCode onSubmit={createEntity} saving={saving === "create"} submitLabel="Create legal employer" onCancel={() => { setCreating(false); setForm(selected ? fromEntity(selected) : blank); }} />
        </article>
      )}

      <div className="module-grid two">
        <article className="card">
          <div className="card-header"><div><div className="card-kicker">EMPLOYER LEDGER</div><h2>Entities inside this workspace</h2></div></div>
          {entities.length === 0 && !loading && <div className="empty-state">No legal employers found.</div>}
          {entities.map((entity) => (
            <button
              key={entity.id}
              type="button"
              className="leave-request"
              style={{ width: "100%", border: 0, borderTop: "1px solid var(--line)", textAlign: "left", cursor: "pointer", background: selected?.id === entity.id ? "var(--green-light)" : "transparent" }}
              onClick={() => { setCreating(false); setSelectedId(entity.id); setForm(fromEntity(entity)); }}
            >
              <div className="inline-icon purple"><Building2 size={16} /></div>
              <div style={{ flex: 1 }}>
                <strong>{entity.displayName}</strong>
                <span>{entity.code} · {entity.legalName}</span>
                <small style={{ display: "block", color: "var(--muted)" }}>{entity.employeeCount} employee(s) · {entity.releasedPayrollRuns} released run(s)</small>
              </div>
              <span className={entity.active ? "status status-verified" : "status"}>{entity.primaryEntity ? "Primary" : entity.active ? "Active" : "Inactive"}</span>
            </button>
          ))}
        </article>

        <article className="card">
          <div className="card-header"><div><div className="card-kicker">LEGAL EMPLOYER SETTINGS</div><h2>{selected?.displayName ?? "Select an employer"}</h2><p>Government registration and payroll policy belong to the employer, not the parent workspace.</p></div></div>
          {selected && !creating && (
            <>
              <EntityForm form={form} setForm={setForm} onSubmit={saveEntity} saving={saving === "update_entity"} submitLabel="Save employer settings" />
              <div className="run-actions" style={{ padding: "0 16px 16px" }}>
                {!selected.primaryEntity && selected.active && <button className="secondary-button" onClick={() => void patch({ action: "set_primary", legalEntityId: selected.id }, "Primary legal employer updated.")}>Make primary</button>}
                {!selected.primaryEntity && <button className="secondary-button" onClick={() => void patch({ action: "set_active", legalEntityId: selected.id, active: !selected.active }, selected.active ? "Legal employer deactivated." : "Legal employer activated.")}>{selected.active ? "Deactivate" : "Activate"}</button>}
              </div>
            </>
          )}
        </article>
      </div>

      <article className="card" style={{ marginTop: 16 }}>
        <div className="card-header"><div><div className="card-kicker">EMPLOYEE EMPLOYER ASSIGNMENT</div><h2>Current legal employer</h2><p>Employees with released payroll cannot be moved here. That requires a future effective-dated employer-transfer workflow.</p></div></div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>EMPLOYEE</th><th>STATUS</th><th>LEGAL EMPLOYER</th></tr></thead>
            <tbody>
              {employees.map((employee) => (
                <tr key={employee.id}>
                  <td><strong>{employee.firstName} {employee.lastName}</strong><small style={{ display: "block", color: "var(--muted)" }}>{employee.employeeNo}</small></td>
                  <td>{employee.status}</td>
                  <td>
                    <select
                      value={employee.legalEntityId ?? ""}
                      disabled={saving !== null}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (Number.isInteger(next) && next > 0) void assignEmployee(employee.id, next);
                      }}
                    >
                      <option value="">Unassigned</option>
                      {entities.filter((entity) => entity.active).map((entity) => <option key={entity.id} value={entity.id}>{entity.code} · {entity.displayName}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
              {employees.length === 0 && <tr><td colSpan={3}><div className="empty-state">No employees in this workspace.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}

function EntityForm({
  form,
  setForm,
  includeCode = false,
  onSubmit,
  saving,
  submitLabel,
  onCancel,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  includeCode?: boolean;
  onSubmit: (event: React.FormEvent) => void;
  saving: boolean;
  submitLabel: string;
  onCancel?: () => void;
}) {
  return (
    <form onSubmit={onSubmit} style={{ padding: "0 16px 16px" }}>
      <div className="setting-form">
        {includeCode && <label>Entity code<input required maxLength={40} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="PH-MFG" /></label>}
        <label>Legal name<input required value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} /></label>
        <label>Display name<input required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></label>
        <label>BIR TIN<input inputMode="numeric" maxLength={16} value={form.birTin} onChange={(e) => setForm({ ...form, birTin: e.target.value })} placeholder="123456789" /></label>
        <label>BIR branch<input inputMode="numeric" maxLength={4} value={form.birBranchCode} onChange={(e) => setForm({ ...form, birBranchCode: e.target.value })} placeholder="0000" /></label>
        <label>SSS employer no.<input maxLength={24} value={form.sssEmployerNo} onChange={(e) => setForm({ ...form, sssEmployerNo: e.target.value })} /></label>
        <label>PhilHealth employer no.<input maxLength={24} value={form.philHealthEmployerNo} onChange={(e) => setForm({ ...form, philHealthEmployerNo: e.target.value })} /></label>
        <label>Pag-IBIG employer no.<input maxLength={24} value={form.pagIbigEmployerNo} onChange={(e) => setForm({ ...form, pagIbigEmployerNo: e.target.value })} /></label>
        <label>Payroll calendar<select value={form.payrollCalendarMode} onChange={(e) => setForm({ ...form, payrollCalendarMode: e.target.value })}><option value="flexible">Flexible</option><option value="ph_semi_monthly">PH semi-monthly</option></select></label>
        <label>Statutory deductions<select value={form.statutoryDeductionTiming} onChange={(e) => setForm({ ...form, statutoryDeductionTiming: e.target.value })}><option value="split">Split across cutoffs</option><option value="first_cutoff">First cutoff</option><option value="second_cutoff">Second cutoff</option></select></label>
        <label>Disbursement bank code<input maxLength={16} value={form.disbursementBankCode} onChange={(e) => setForm({ ...form, disbursementBankCode: e.target.value.toUpperCase() })} placeholder="BPI / BDO / bank code" /></label>
        <label>Account name<input maxLength={160} value={form.disbursementAccountName} onChange={(e) => setForm({ ...form, disbursementAccountName: e.target.value })} /></label>
        <label>{includeCode ? "Disbursement account" : "Replace disbursement account"}<input value={form.disbursementAccount} onChange={(e) => setForm({ ...form, disbursementAccount: e.target.value })} placeholder={includeCode ? "Optional" : "Leave blank to keep current encrypted account"} /></label>
      </div>
      <div className="run-actions">
        {onCancel && <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>}
        <button className="primary-button" disabled={saving}><Save size={14} /> {saving ? "Saving..." : submitLabel}</button>
      </div>
    </form>
  );
}
