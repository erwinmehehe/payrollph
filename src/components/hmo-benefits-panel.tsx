"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HeartPulse, Plus, RefreshCw, Send, ShieldCheck, Users } from "lucide-react";
import { useWorkflowUi } from "@/components/workspace/workflow-ui-context";
import { benefitEnrollmentReviewConfirmed, benefitEnrollmentReviewKey } from "@/lib/benefit-enrollment-review";
import { manilaCalendarDate } from "@/lib/payroll-period-ui";

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

type HmoBenefitsProps = {
  organizationId: number;
  setNotice: (message: string) => void;
};

// Enrollment confirmations and deductions must not outlive employer selection.
export function HmoBenefitsPanel(props: HmoBenefitsProps) {
  return <ScopedHmoBenefitsPanel key={props.organizationId} {...props} />;
}

function ScopedHmoBenefitsPanel({
  organizationId,
  setNotice,
}: HmoBenefitsProps) {
  const enhancedEnrollment = useWorkflowUi().benefitsLoans;
  const [reviewedKey, setReviewedKey] = useState<string | null>(null);
  const [data, setData] = useState<HmoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [employeeId, setEmployeeId] = useState(0);
  const [planId, setPlanId] = useState(0);
  const [startedOn, setStartedOn] = useState(() => enhancedEnrollment ? manilaCalendarDate() : new Date().toISOString().slice(0, 10));
  const [dependentEnrollmentId, setDependentEnrollmentId] = useState(0);
  const [dependentName, setDependentName] = useState("");
  const [relationship, setRelationship] = useState("child");
  const [birthDate, setBirthDate] = useState("");

  const mountedRef = useRef(false);
  const loadRevisionRef = useRef(0);
  const loadControllerRef = useRef<AbortController | null>(null);
  const announce = useCallback((message: string) => {
    if (mountedRef.current) setNotice(message);
  }, [setNotice]);

  const load = useCallback(async () => {
    if (!mountedRef.current) return;
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    const revision = ++loadRevisionRef.current;
    const isCurrent = () =>
      mountedRef.current && !controller.signal.aborted && revision === loadRevisionRef.current;
    setLoading(true);
    // A refresh might revoke HMO access: hide old coverage costs and revoke the review checkbox.
    setData(null);
    setReviewedKey(null);
    try {
      const response = await fetch(`/api/benefits/hmo?organizationId=${organizationId}`, {
        cache: "no-store", signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!isCurrent()) return;
      if (!response.ok) throw new Error(payload.error ?? "Could not load HMO administration.");
      setData(payload as HmoData);
    } catch (error) {
      if (isCurrent()) announce(error instanceof Error ? error.message : "Could not load HMO administration.");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [organizationId, announce]);

  useEffect(() => {
    mountedRef.current = true;
    let retired = false;
    queueMicrotask(() => { if (!retired) void load(); });
    return () => {
      retired = true;
      mountedRef.current = false;
      loadRevisionRef.current += 1;
      loadControllerRef.current?.abort();
    };
  }, [load]);

  const employeeById = useMemo(
    () => new Map((data?.employees ?? []).map((employee) => [employee.id, employee.name])),
    [data],
  );
  const planById = useMemo(
    () => new Map((data?.plans ?? []).map((plan) => [plan.id, plan])),
    [data],
  );

  const selectedPlan = planById.get(planId);
  const selectedEmployee = employeeById.get(employeeId);
  const reviewKey = selectedPlan && selectedEmployee
    ? benefitEnrollmentReviewKey({
      organizationId, employeeId, planId,
      monthlyContribution: selectedPlan.employeeShare,
      startedOn,
    })
    : null;
  const reviewConfirmed = benefitEnrollmentReviewConfirmed(reviewedKey, reviewKey);

  async function createPlan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
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
    if (!mountedRef.current) return;
    if (!response.ok) return announce(payload.error ?? "Could not create HMO plan.");
    announce("HMO plan created.");
    setShowPlanForm(false);
    formElement.reset();
    await load();
  }

  async function enroll(event: React.FormEvent) {
    event.preventDefault();
    if (!employeeId || !planId) return;
    if (enhancedEnrollment && !reviewConfirmed) {
      announce("Review the employee, HMO plan and effective date before enrolling.");
      return;
    }
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
    if (!mountedRef.current) return;
    if (!response.ok) return announce(payload.error ?? "Could not enroll employee.");
    announce("HMO enrollment created. Payroll deduction and automation event are ready.");
    setEmployeeId(0);
    setPlanId(0);
    setReviewedKey(null);
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
    if (!mountedRef.current) return;
    if (!response.ok) return announce(payload.error ?? "Could not add dependent.");
    announce("Dependent added. Any employee-paid premium was calculated from the plan rules.");
    setDependentName("");
    setBirthDate("");
    await load();
  }

  async function updateDependent(dependentId: number, status: "active" | "rejected" | "ended") {
    const response = await fetch("/api/benefits/hmo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_dependent", organizationId, dependentId, status }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!mountedRef.current) return;
    if (!response.ok) return announce(payload.error ?? "Could not update HMO dependent.");
    announce(status === "active"
      ? "Dependent activated. Any employee-paid premium will flow into payroll."
      : "Dependent status updated.");
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
    if (!mountedRef.current) return;
    if (!response.ok) return announce(payload.error ?? "Could not update HMO enrollment.");
    announce("HMO enrollment updated.");
    await load();
  }

  if (!data) return (
    <div className="empty-state">
      {loading ? "Loading HMO administration…" : (
        <>
          <span>HMO administration unavailable.</span>
          <button className="secondary-button" type="button" onClick={() => void load()}>Retry</button>
        </>
      )}
    </div>
  );

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
              <select value={employeeId} onChange={(event) => { setEmployeeId(Number(event.target.value)); setReviewedKey(null); }} required>
                <option value="">Choose…</option>
                {data?.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
              </select>
            </label>
            <label>HMO plan
              <select value={planId} onChange={(event) => { setPlanId(Number(event.target.value)); setReviewedKey(null); }} required>
                <option value="">Choose…</option>
                {data?.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.provider} · {plan.name}</option>)}
              </select>
            </label>
            <label>Coverage start<input type="date" value={startedOn} onChange={(event) => { setStartedOn(event.target.value); setReviewedKey(null); }} required={enhancedEnrollment} /></label>
            {enhancedEnrollment && <div className="notice notice-blue" style={{ gridColumn: "1 / -1" }}>
              <strong>Review HMO enrollment</strong>
              <p>Employee: {selectedEmployee ?? "Choose employee"} ·
                Plan: {selectedPlan?.name ?? "Choose plan"} ·
                Coverage starts: {startedOn || "Choose date"} ·
                Monthly employee share: {selectedPlan ? peso(selectedPlan.employeeShare) : "Choose plan"}.</p>
              <p>This administrator review does not record employee consent. Confirm the separate employee authorization evidence before enrolling.</p>
              <label><input type="checkbox" checked={reviewConfirmed} disabled={!reviewKey}
                onChange={(event) => setReviewedKey(event.target.checked ? reviewKey : null)} />
                I reviewed this employee, HMO plan, amount and effective date.</label>
            </div>}
            <div style={{ gridColumn: "1 / -1" }}><button className="primary-button"
              disabled={enhancedEnrollment && !reviewConfirmed}>Create enrollment</button></div>
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
                      <span style={{ display: "grid", gap: 4, marginTop: 6 }}>
                        {enrollment.dependents.map((dependent) => (
                          <small key={dependent.id} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                            <span>{dependent.name} ({dependent.relationship}, {dependent.status}, {peso(dependent.monthlyContribution)}/mo)</span>
                            {dependent.status === "pending" && (
                              <>
                                <button type="button" className="row-more" onClick={() => void updateDependent(dependent.id, "active")}>Activate</button>
                                <button type="button" className="row-more" onClick={() => void updateDependent(dependent.id, "rejected")}>Reject</button>
                              </>
                            )}
                            {dependent.status === "active" && (
                              <button type="button" className="row-more" onClick={() => void updateDependent(dependent.id, "ended")}>End</button>
                            )}
                          </small>
                        ))}
                      </span>
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
