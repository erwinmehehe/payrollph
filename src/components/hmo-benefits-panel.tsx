"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { HeartPulse, Plus, RefreshCw, Send, ShieldCheck, Users } from "lucide-react";

type HmoPlan = {
  id: number;
  name: string;
  provider: string | null;
  planCode: string | null;
  employeeShare: string;
  employerShare: string;
  dependentShare: string;
  employerPaidDependents: number;
  waitingPeriodDays: number;
  annualBenefitLimit: string | null;
  contractEnd: string | null;
};

type HmoDependent = {
  id: number;
  name: string;
  relationship: string;
  birthDate: string;
  status: string;
  monthlyContribution: string;
};

type HmoEnrollment = {
  id: number;
  employeeId: number;
  planId: number;
  monthlyContribution: string;
  status: string;
  providerStatus: string;
  providerMemberId: string | null;
  startedOn: string;
  effectiveOn: string | null;
  dependents: HmoDependent[];
};

type HmoData = {
  dashboard: {
    activeMembers: number;
    activeDependents: number;
    pendingEnrollments: number;
    pendingProvider: number;
    monthlyEmployeeDeductions: number;
    monthlyEmployerCost: number;
  };
  plans: HmoPlan[];
  employees: Array<{ id: number; name: string }>;
  enrollments: HmoEnrollment[];
};

const peso = (value: string | number) =>
  `₱${Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function HmoBenefitsPanel({
  organizationId,
  setNotice,
}: {
  organizationId: number;
  setNotice: (message: string) => void;
}) {
  const [data, setData] = useState<HmoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [employeeId, setEmployeeId] = useState(0);
  const [planId, setPlanId] = useState(0);
  const [startedOn, setStartedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [dependentEnrollmentId, setDependentEnrollmentId] = useState(0);
  const [dependentName, setDependentName] = useState("");
  const [relationship, setRelationship] = useState("child");
  const [birthDate, setBirthDate] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/benefits/hmo?organizationId=${organizationId}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not load HMO administration.");
      setData(payload as HmoData);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load HMO administration.");
    } finally {
      setLoading(false);
    }
  }, [organizationId, setNotice]);

  useEffect(() => { void load(); }, [load]);

  const employeeById = useMemo(
    () => new Map((data?.employees ?? []).map((employee) => [employee.id, employee.name])),
    [data],
  );
  const planById = useMemo(
    () => new Map((data?.plans ?? []).map((plan) => [plan.id, plan])),
    [data],
  );

  async function createPlan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/benefits/hmo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create_plan",
        organizationId,
        name: form.get("name"),
        provider: form.get("provider"),
        planCode: form.get("planCode"),
        annualBenefitLimit: form.get("annualBenefitLimit"),
        employeeShare: form.get("employeeShare"),
        employerShare: form.get("employerShare"),
        dependentShare: form.get("dependentShare"),
        employerPaidDependents: form.get("employerPaidDependents"),
        waitingPeriodDays: form.get("waitingPeriodDays"),
        contractStart: form.get("contractStart"),
        contractEnd: form.get("contractEnd"),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setNotice(payload.error ?? "Could not create HMO plan.");
    setNotice("HMO plan created.");
    setShowPlanForm(false);
    event.currentTarget.reset();
    await load();
  }

  async function enroll(event: React.FormEvent) {
    event.preventDefault();
    if (!employeeId || !planId) return;
    const plan = planById.get(planId);
    const response = await fetch("/api/benefits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId,
        employeeId,
        planId,
        monthlyContribution: Number(plan?.employeeShare ?? 0),
        startedOn,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setNotice(payload.error ?? "Could not enroll employee.");
    setNotice("HMO enrollment created. Payroll deduction and automation event are ready.");
    setEmployeeId(0);
    setPlanId(0);
    await load();
  }

  async function addDependent(event: React.FormEvent) {
    event.preventDefault();
    if (!dependentEnrollmentId) return;
    const response = await fetch("/api/benefits/hmo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add_dependent",
        organizationId,
        enrollmentId: dependentEnrollmentId,
        name: dependentName,
        relationship,
        birthDate,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setNotice(payload.error ?? "Could not add dependent.");
    setNotice("Dependent added. Any employee-paid premium was calculated from the plan rules.");
    setDependentName("");
    setBirthDate("");
    await load();
  }

  async function updateEnrollment(
    enrollmentId: number,
    patch: { status?: string; providerStatus?: string; effectiveOn?: string },
  ) {
    const response = await fetch("/api/benefits/hmo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_enrollment", organizationId, enrollmentId, ...patch }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setNotice(payload.error ?? "Could not update HMO enrollment.");
    setNotice("HMO enrollment updated.");
    await load();
  }

  if (loading && !data) return <div className="empty-state">Loading HMO administration…</div>;

  return (
    <section style={{ marginBottom: 22 }}>
      <div className="card-header" style={{ marginBottom: 12 }}>
        <div>
          <div className="card-kicker">HMO OPERATIONS</div>
          <h2>Health coverage administration</h2>
          <p className="muted">Manage plans, employee coverage, dependents, provider handoff and payroll-linked contributions.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="secondary-button" onClick={() => void load()}><RefreshCw size={15} /> Refresh</button>
          <button className="primary-button" onClick={() => setShowPlanForm((value) => !value)}><Plus size={15} /> HMO plan</button>
        </div>
      </div>

      <section className="stats-grid">
        <article className="stat-card"><div className="stat-icon mint"><HeartPulse size={19} /></div><p>ACTIVE MEMBERS</p><h3>{data?.dashboard.activeMembers ?? 0}</h3><span>{data?.dashboard.activeDependents ?? 0} active dependents</span></article>
        <article className="stat-card"><div className="stat-icon purple"><Users size={19} /></div><p>PENDING</p><h3>{data?.dashboard.pendingEnrollments ?? 0}</h3><span>{data?.dashboard.pendingProvider ?? 0} waiting on provider</span></article>
        <article className="stat-card"><div className="stat-icon blue"><ShieldCheck size={19} /></div><p>EMPLOYER COST / MO</p><h3>{peso(data?.dashboard.monthlyEmployerCost ?? 0)}</h3><span>active employee coverage</span></article>
        <article className="stat-card"><div className="stat-icon pink"><HeartPulse size={19} /></div><p>EMPLOYEE DEDUCTIONS / MO</p><h3>{peso(data?.dashboard.monthlyEmployeeDeductions ?? 0)}</h3><span>employee + dependent shares</span></article>
      </section>

      {showPlanForm && (
        <article className="card" style={{ marginTop: 16 }}>
          <div className="card-header"><div><div className="card-kicker">PLAN SETUP</div><h2>Create company HMO plan</h2></div></div>
          <form className="setting-form" onSubmit={createPlan}>
            <label>Plan name<input name="name" required placeholder="Maxicare Gold" /></label>
            <label>Provider<input name="provider" required placeholder="Maxicare" /></label>
            <label>Plan code<input name="planCode" placeholder="GOLD-150" /></label>
            <label>Annual benefit limit<input name="annualBenefitLimit" inputMode="decimal" placeholder="150000" /></label>
            <label>Employee share / month<input name="employeeShare" inputMode="decimal" defaultValue="0" /></label>
            <label>Employer share / month<input name="employerShare" inputMode="decimal" defaultValue="0" /></label>
            <label>Dependent share / month<input name="dependentShare" inputMode="decimal" defaultValue="0" /></label>
            <label>Employer-paid dependents<input name="employerPaidDependents" type="number" min="0" defaultValue="0" /></label>
            <label>Waiting period (days)<input name="waitingPeriodDays" type="number" min="0" defaultValue="0" /></label>
            <label>Contract starts<input name="contractStart" type="date" /></label>
            <label>Contract ends<input name="contractEnd" type="date" /></label>
            <div style={{ gridColumn: "1 / -1" }}><button className="primary-button">Create HMO plan</button></div>
          </form>
        </article>
      )}

      {(data?.plans.length ?? 0) > 0 && (
        <article className="card" style={{ marginTop: 16 }}>
          <div className="card-header"><div><div className="card-kicker">ENROLLMENT</div><h2>Enroll an employee</h2></div></div>
          <form className="setting-form" onSubmit={enroll}>
            <label>Employee
              <select value={employeeId} onChange={(event) => setEmployeeId(Number(event.target.value))} required>
                <option value="">Choose…</option>
                {data?.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
              </select>
            </label>
            <label>HMO plan
              <select value={planId} onChange={(event) => setPlanId(Number(event.target.value))} required>
                <option value="">Choose…</option>
                {data?.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.provider} · {plan.name}</option>)}
              </select>
            </label>
            <label>Coverage start<input type="date" value={startedOn} onChange={(event) => setStartedOn(event.target.value)} /></label>
            <div style={{ gridColumn: "1 / -1" }}><button className="primary-button">Create enrollment</button></div>
          </form>
        </article>
      )}

      {(data?.enrollments.length ?? 0) > 0 && (
        <article className="card" style={{ marginTop: 16 }}>
          <div className="card-header"><div><div className="card-kicker">CARRIER HANDOFF</div><h2>HMO enrollments</h2></div></div>
          <div className="worksheet-list">
            {data?.enrollments.map((enrollment) => {
              const plan = planById.get(enrollment.planId);
              return (
                <div key={enrollment.id} style={{ alignItems: "flex-start" }}>
                  <span className="attention-icon"><HeartPulse size={17} /></span>
                  <span style={{ flex: 1 }}>
                    <strong>{employeeById.get(enrollment.employeeId) ?? `Employee #${enrollment.employeeId}`}</strong>
                    <small>{plan?.provider} · {plan?.name} · {enrollment.status} · provider: {enrollment.providerStatus}</small>
                    {enrollment.dependents.length > 0 && (
                      <small>{enrollment.dependents.map((dependent) => `${dependent.name} (${dependent.relationship}, ${dependent.status}, ${peso(dependent.monthlyContribution)}/mo)`).join(" · ")}</small>
                    )}
                  </span>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {enrollment.providerStatus === "not_sent" && <button className="secondary-button" onClick={() => void updateEnrollment(enrollment.id, { providerStatus: "pending_provider" })}><Send size={14} /> Mark sent</button>}
                    {enrollment.status !== "active" && <button className="secondary-button" onClick={() => void updateEnrollment(enrollment.id, { status: "active", providerStatus: "confirmed", effectiveOn: enrollment.effectiveOn ?? enrollment.startedOn })}>Activate</button>}
                    {enrollment.status !== "ended" && <button className="row-more" onClick={() => void updateEnrollment(enrollment.id, { status: "ended" })}>End</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      )}

      {(data?.enrollments.length ?? 0) > 0 && (
        <article className="card" style={{ marginTop: 16 }}>
          <div className="card-header"><div><div className="card-kicker">DEPENDENTS</div><h2>Add a dependent</h2></div></div>
          <form className="setting-form" onSubmit={addDependent}>
            <label>Enrollment
              <select value={dependentEnrollmentId} onChange={(event) => setDependentEnrollmentId(Number(event.target.value))} required>
                <option value="">Choose…</option>
                {data?.enrollments.filter((row) => row.status !== "ended").map((row) => (
                  <option key={row.id} value={row.id}>
                    {employeeById.get(row.employeeId)} · {planById.get(row.planId)?.name}
                  </option>
                ))}
              </select>
            </label>
            <label>Dependent name<input value={dependentName} onChange={(event) => setDependentName(event.target.value)} required /></label>
            <label>Relationship
              <select value={relationship} onChange={(event) => setRelationship(event.target.value)}>
                <option value="spouse">Spouse</option>
                <option value="child">Child</option>
                <option value="parent">Parent</option>
                <option value="other">Other eligible dependent</option>
              </select>
            </label>
            <label>Birth date<input type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} required /></label>
            <div style={{ gridColumn: "1 / -1" }}><button className="primary-button">Add dependent</button></div>
          </form>
        </article>
      )}

      {(data?.plans.length ?? 0) === 0 && (
        <div className="empty-state" style={{ marginTop: 16 }}>
          <HeartPulse size={20} />
          <span>No company HMO plan yet. Create one to start governed enrollment and payroll-linked coverage.</span>
        </div>
      )}
    </section>
  );
}
