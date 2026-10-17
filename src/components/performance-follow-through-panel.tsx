"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BellRing, BookOpenCheck, CheckCircle2, LockKeyhole, Plus, RefreshCw, ShieldCheck } from "lucide-react";

type Employee = { id: number; firstName: string; lastName: string; title: string; orgUnitId: number | null };
type Skill = { id: number; code: string; name: string; category: string; active: boolean };
type Milestone = {
  id: number; planId: number; title: string; detail: string | null; dueDate: string;
  status: "open" | "in_progress" | "completed" | "cancelled";
};
type Progress = { id: number; planId: number; authorName: string; progressPercent: number | null; content: string; createdAt: string };
type Plan = {
  id: number; employeeId: number; skillId: number; title: string; objective: string;
  currentProficiency: string | null; targetProficiency: string; targetDate: string;
  status: "planned" | "in_progress" | "completed" | "cancelled";
  sourceSnapshot: Record<string, unknown>; employeeVisible: boolean;
  milestones: Milestone[]; progress: Progress[];
};
type ReminderPolicy = {
  version: number; enabled: boolean; reminderDaysBefore: number; escalationDaysOverdue: number;
  notifyManagerOnEmployeeItem: boolean; notifyPeopleAdminOnEscalation: boolean;
};
type EvidencePolicy = {
  version: number; retentionYears: number; autoSealCompletedCycles: boolean; allowPostSealAmendments: boolean;
};
type Cycle = { id: number; name: string; status: string; startDate: string; endDate: string };
type Seal = {
  id: number; cycleId: number; manifestHash: string; sealedAt: string; retentionUntil: string;
  legalHold: boolean; legalHoldReason: string | null; latestAmendmentNumber: number;
  lastVerifiedAt: string | null; lastVerificationStatus: "match" | "mismatch" | null;
  amendments: Array<{ id: number; amendmentNumber: number; reason: string; detail: string; actorName: string; createdAt: string }>;
};
type Governance = {
  reminderPolicy: ReminderPolicy;
  evidencePolicy: EvidencePolicy;
  cycles: Cycle[];
  seals: Seal[];
  reminderSummary: { open: number; overdue: number; escalated: number; resolved: number };
};

type PerformanceFollowThroughProps = {
  organizationId: number;
  canGovern: boolean;
  setNotice: (message: string) => void;
};

// Both tenant selection and lost governance access invalidate evidence-policy drafts.
export function PerformanceFollowThroughPanel(props: PerformanceFollowThroughProps) {
  return <PerformanceFollowThroughContent key={props.organizationId + ":" + String(props.canGovern)} {...props} />;
}

function PerformanceFollowThroughContent({
  organizationId,
  canGovern,
  setNotice,
}: PerformanceFollowThroughProps) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [governance, setGovernance] = useState<Governance | null>(null);
  const [showPlan, setShowPlan] = useState(false);
  const [planForm, setPlanForm] = useState({
    employeeId: "", skillId: "", title: "", objective: "", targetProficiency: "3", targetDate: "",
  });
  const [milestoneDrafts, setMilestoneDrafts] = useState<Record<number, { title: string; dueDate: string }>>({});
  const [planNotes, setPlanNotes] = useState<Record<number, string>>({});
  const [reminderForm, setReminderForm] = useState({
    enabled: true, reminderDaysBefore: "3", escalationDaysOverdue: "3",
    notifyManagerOnEmployeeItem: true, notifyPeopleAdminOnEscalation: true,
  });
  const [evidenceForm, setEvidenceForm] = useState({
    retentionYears: "7", autoSealCompletedCycles: true, allowPostSealAmendments: true,
  });
  const [sealNotes, setSealNotes] = useState<Record<number, string>>({});
  const [amendmentDetail, setAmendmentDetail] = useState<Record<number, string>>({});

  const mountedRef = useRef(false);
  const requestRevisionRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);
  const announce = useCallback((message: string) => {
    if (mountedRef.current) setNotice(message);
  }, [setNotice]);

  const load = useCallback(async () => {
    if (!mountedRef.current) return;
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const revision = ++requestRevisionRef.current;
    const isCurrent = () =>
      mountedRef.current && !controller.signal.aborted && revision === requestRevisionRef.current;
    try {
      const [developmentResponse, governanceResponse] = await Promise.all([
        fetch("/api/performance/development-plans?organizationId=" + organizationId, {
          cache: "no-store", signal: controller.signal,
        }),
        canGovern
          ? fetch("/api/performance/follow-through-governance?organizationId=" + organizationId, {
              cache: "no-store", signal: controller.signal,
            })
          : Promise.resolve(null),
      ]);
      const [development, governancePayload] = await Promise.all([
        developmentResponse.json().catch(() => ({})),
        governanceResponse ? governanceResponse.json().catch(() => ({})) : Promise.resolve(null),
      ]);
      if (!isCurrent()) return;
      if (!developmentResponse.ok) {
        announce(development.error ?? "Could not load skill development plans.");
        return;
      }
      if (governanceResponse && !governanceResponse.ok) {
        announce(governancePayload?.error ?? "Could not load performance follow-through governance.");
        return;
      }
      // Treat both scoped endpoints as one response generation; never mix an old
      // employee's plans with the next organization's governance or evidence.
      setEmployees(development.employees ?? []);
      setSkills(development.skills ?? []);
      setPlans(development.plans ?? []);
      if (governancePayload) {
        setGovernance(governancePayload);
        const reminder = governancePayload.reminderPolicy as ReminderPolicy;
        setReminderForm({
          enabled: reminder.enabled,
          reminderDaysBefore: String(reminder.reminderDaysBefore),
          escalationDaysOverdue: String(reminder.escalationDaysOverdue),
          notifyManagerOnEmployeeItem: reminder.notifyManagerOnEmployeeItem,
          notifyPeopleAdminOnEscalation: reminder.notifyPeopleAdminOnEscalation,
        });
        const evidence = governancePayload.evidencePolicy as EvidencePolicy;
        setEvidenceForm({
          retentionYears: String(evidence.retentionYears),
          autoSealCompletedCycles: evidence.autoSealCompletedCycles,
          allowPostSealAmendments: evidence.allowPostSealAmendments,
        });
      }
    } catch (error) {
      if (isCurrent()) announce(error instanceof Error ? error.message : "Could not load performance follow-through governance.");
    }
  }, [organizationId, canGovern, announce]);

  useEffect(() => {
    mountedRef.current = true;
    let retired = false;
    // Defer the initial stateful fetch and ignore retired Strict Mode setups.
    queueMicrotask(() => { if (!retired) void load(); });
    return () => {
      retired = true;
      mountedRef.current = false;
      requestRevisionRef.current += 1;
      requestControllerRef.current?.abort();
    };
  }, [load]);

  const employeeById = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);
  const skillById = useMemo(() => new Map(skills.map((skill) => [skill.id, skill])), [skills]);
  const cycleById = useMemo(() => new Map((governance?.cycles ?? []).map((cycle) => [cycle.id, cycle])), [governance]);

  async function createPlan(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/performance/development-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId,
        entityType: "plan",
        employeeId: Number(planForm.employeeId),
        skillId: Number(planForm.skillId),
        title: planForm.title,
        objective: planForm.objective,
        targetProficiency: Number(planForm.targetProficiency),
        targetDate: planForm.targetDate,
        employeeVisible: true,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!mountedRef.current) return;
    if (!response.ok) {
      announce(payload.error ?? "Could not create development plan.");
      return;
    }
    setPlanForm({ employeeId: "", skillId: "", title: "", objective: "", targetProficiency: "3", targetDate: "" });
    setShowPlan(false);
    await load();
    announce("Skill development plan created from verified persistent-gap evidence.");
  }

  async function addMilestone(plan: Plan) {
    const draft = milestoneDrafts[plan.id] ?? { title: "", dueDate: "" };
    const response = await fetch("/api/performance/development-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, entityType: "milestone", planId: plan.id, ...draft }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!mountedRef.current) return;
    if (!response.ok) {
      announce(payload.error ?? "Could not add development milestone.");
      return;
    }
    setMilestoneDrafts((current) => ({ ...current, [plan.id]: { title: "", dueDate: "" } }));
    await load();
    announce("Development milestone added.");
  }

  async function updatePlan(plan: Plan, status: Plan["status"]) {
    const response = await fetch("/api/performance/development-plans", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId, entityType: "plan", id: plan.id, status, note: planNotes[plan.id] ?? "",
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!mountedRef.current) return;
    if (!response.ok) {
      announce(payload.error ?? "Could not update development plan.");
      return;
    }
    await load();
    announce("Development plan status updated.");
  }

  async function updateMilestone(milestone: Milestone, status: Milestone["status"]) {
    const response = await fetch("/api/performance/development-plans", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, entityType: "milestone", id: milestone.id, status }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!mountedRef.current) return;
    if (!response.ok) {
      announce(payload.error ?? "Could not update development milestone.");
      return;
    }
    await load();
    announce("Development milestone updated.");
  }

  async function saveReminderPolicy(event: React.FormEvent) {
    event.preventDefault();
    if (!governance) return;
    const response = await fetch("/api/performance/follow-through-governance", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId, action: "action_reminder_policy", expectedVersion: governance.reminderPolicy.version,
        enabled: reminderForm.enabled,
        reminderDaysBefore: Number(reminderForm.reminderDaysBefore),
        escalationDaysOverdue: Number(reminderForm.escalationDaysOverdue),
        notifyManagerOnEmployeeItem: reminderForm.notifyManagerOnEmployeeItem,
        notifyPeopleAdminOnEscalation: reminderForm.notifyPeopleAdminOnEscalation,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!mountedRef.current) return;
    if (!response.ok) return announce(payload.error ?? "Could not save action reminder policy.");
    await load();
    announce("1:1 action reminder policy version updated.");
  }

  async function saveEvidencePolicy(event: React.FormEvent) {
    event.preventDefault();
    if (!governance) return;
    const response = await fetch("/api/performance/follow-through-governance", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId, action: "evidence_policy", expectedVersion: governance.evidencePolicy.version,
        retentionYears: Number(evidenceForm.retentionYears),
        autoSealCompletedCycles: evidenceForm.autoSealCompletedCycles,
        allowPostSealAmendments: evidenceForm.allowPostSealAmendments,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!mountedRef.current) return;
    if (!response.ok) return announce(payload.error ?? "Could not save evidence policy.");
    await load();
    announce("Performance evidence retention policy version updated.");
  }

  async function evidenceAction(cycleId: number, action: "seal_cycle" | "verify_cycle" | "legal_hold" | "amend_seal", extra: Record<string, unknown> = {}) {
    const response = await fetch("/api/performance/follow-through-governance", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, cycleId, action, ...extra }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!mountedRef.current) return;
    if (!response.ok) return announce(payload.error ?? "Could not complete performance evidence action.");
    await load();
    announce(
      action === "verify_cycle" ? "Performance evidence seal verified."
        : action === "seal_cycle" ? "Performance cycle evidence sealed."
          : action === "amend_seal" ? "Tamper-evident amendment appended to the seal."
            : extra.legalHold ? "Legal hold applied." : "Legal hold released.",
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <article className="card" style={{ padding: 20 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">SKILL DEVELOPMENT</div>
            <h2>Turn persistent competency gaps into governed development plans</h2>
            <p>Plans can only be created when stored performance evidence shows the skill below its frozen role expectation for at least two consecutive completed cycles.</p>
          </div>
          <div className="page-actions">
            <button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw size={14} /> Refresh</button>
            <button className="primary-button" type="button" onClick={() => setShowPlan((value) => !value)}><Plus size={14} /> Development plan</button>
          </div>
        </div>

        {showPlan && (
          <form onSubmit={createPlan} style={{ marginBottom: 16 }}>
            <div className="setting-form">
              <label>Employee<select required value={planForm.employeeId} onChange={(event) => setPlanForm({ ...planForm, employeeId: event.target.value })}><option value="">Select employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName} · {employee.title}</option>)}</select></label>
              <label>Skill<select required value={planForm.skillId} onChange={(event) => setPlanForm({ ...planForm, skillId: event.target.value })}><option value="">Select governed skill</option>{skills.filter((skill) => skill.active).map((skill) => <option key={skill.id} value={skill.id}>{skill.code} · {skill.name}</option>)}</select></label>
              <label>Target proficiency<input type="number" min="1" max="5" step="0.1" value={planForm.targetProficiency} onChange={(event) => setPlanForm({ ...planForm, targetProficiency: event.target.value })} /></label>
              <label>Target date<input type="date" required value={planForm.targetDate} onChange={(event) => setPlanForm({ ...planForm, targetDate: event.target.value })} /></label>
              <label style={{ gridColumn: "1 / -1" }}>Title<input required value={planForm.title} onChange={(event) => setPlanForm({ ...planForm, title: event.target.value })} placeholder="Close the persistent capability gap" /></label>
              <label style={{ gridColumn: "1 / -1" }}>Objective<textarea required rows={3} value={planForm.objective} onChange={(event) => setPlanForm({ ...planForm, objective: event.target.value })} /></label>
            </div>
            <div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowPlan(false)}>Cancel</button><button className="primary-button">Create from evidence</button></div>
          </form>
        )}

        {plans.length === 0 && <div className="empty-state">No skill development plans in your current scope.</div>}
        {plans.map((plan) => {
          const employee = employeeById.get(plan.employeeId);
          const skill = skillById.get(plan.skillId);
          const overdue = !["completed", "cancelled"].includes(plan.status)
            && plan.targetDate < new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
          const draft = milestoneDrafts[plan.id] ?? { title: "", dueDate: "" };
          return (
            <div className="employee-edit-card" key={plan.id} style={{ marginBottom: 12 }}>
              <div className="employee-list-card-head">
                <div>
                  <strong>{plan.title}</strong>
                  <span>{employee?.firstName} {employee?.lastName} · {skill?.name ?? "Skill"} · {plan.currentProficiency ?? "—"} → {plan.targetProficiency}/5 · target {plan.targetDate}{overdue ? " · overdue" : ""}</span>
                  <p>{plan.objective}</p>
                </div>
                <span className={"employee-status-pill " + (plan.status === "completed" ? "good" : overdue ? "bad" : "warn")}>{plan.status.replaceAll("_", " ")}</span>
              </div>

              {plan.milestones.map((milestone) => (
                <div className="leave-request" key={milestone.id}>
                  <BookOpenCheck size={15} />
                  <div style={{ flex: 1 }}><strong>{milestone.title}</strong><span>Due {milestone.dueDate}</span></div>
                  <span className={"employee-status-pill " + (milestone.status === "completed" ? "good" : "neutral")}>{milestone.status.replaceAll("_", " ")}</span>
                  {!["completed", "cancelled"].includes(milestone.status) && (
                    <div className="run-actions">
                      {milestone.status === "open" && <button type="button" className="secondary-button" onClick={() => void updateMilestone(milestone, "in_progress")}>Start</button>}
                      <button type="button" className="secondary-button" onClick={() => void updateMilestone(milestone, "completed")}>Complete</button>
                      <button type="button" className="secondary-button" onClick={() => void updateMilestone(milestone, "cancelled")}>Cancel</button>
                    </div>
                  )}
                </div>
              ))}

              {!["completed", "cancelled"].includes(plan.status) && (
                <>
                  <div className="setting-form" style={{ marginTop: 10 }}>
                    <label>Milestone<input value={draft.title} onChange={(event) => setMilestoneDrafts((current) => ({ ...current, [plan.id]: { ...draft, title: event.target.value } }))} /></label>
                    <label>Due date<input type="date" value={draft.dueDate} onChange={(event) => setMilestoneDrafts((current) => ({ ...current, [plan.id]: { ...draft, dueDate: event.target.value } }))} /></label>
                    <button type="button" className="secondary-button" onClick={() => void addMilestone(plan)}><Plus size={14} /> Add milestone</button>
                  </div>
                  <div className="run-actions">
                    {plan.status === "planned" && <button type="button" className="secondary-button" onClick={() => void updatePlan(plan, "in_progress")}>Start plan</button>}
                    <button type="button" className="primary-button" onClick={() => void updatePlan(plan, "completed")}><CheckCircle2 size={14} /> Complete plan</button>
                  </div>
                  <div className="setting-form" style={{ marginTop: 8 }}>
                    <label style={{ gridColumn: "1 / -1" }}>Cancellation rationale<input value={planNotes[plan.id] ?? ""} onChange={(event) => setPlanNotes((current) => ({ ...current, [plan.id]: event.target.value }))} /></label>
                    <button type="button" className="secondary-button" onClick={() => void updatePlan(plan, "cancelled")}>Cancel plan</button>
                  </div>
                </>
              )}

              {plan.progress.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div className="card-kicker">PROGRESS EVIDENCE</div>
                  {plan.progress.map((item) => <p key={item.id}><strong>{item.authorName}</strong>{item.progressPercent == null ? "" : " · " + item.progressPercent + "%"}: {item.content}</p>)}
                </div>
              )}
            </div>
          );
        })}
      </article>

      {canGovern && governance && (
        <>
          <article className="card" style={{ padding: 20 }}>
            <div className="card-header">
              <div><div className="card-kicker">ACTION REMINDER POLICY · v{governance.reminderPolicy.version}</div><h2>1:1 commitment reminders and escalation</h2><p>{governance.reminderSummary.open} open reminder(s) · {governance.reminderSummary.overdue} overdue · {governance.reminderSummary.escalated} escalated</p></div>
              <BellRing size={18} />
            </div>
            <form onSubmit={saveReminderPolicy}>
              <div className="setting-form">
                <label><input type="checkbox" checked={reminderForm.enabled} onChange={(event) => setReminderForm({ ...reminderForm, enabled: event.target.checked })} /> Enable reminders</label>
                <label>Upcoming days<input type="number" min="0" max="30" value={reminderForm.reminderDaysBefore} onChange={(event) => setReminderForm({ ...reminderForm, reminderDaysBefore: event.target.value })} /></label>
                <label>Escalate after overdue days<input type="number" min="1" max="90" value={reminderForm.escalationDaysOverdue} onChange={(event) => setReminderForm({ ...reminderForm, escalationDaysOverdue: event.target.value })} /></label>
                <label><input type="checkbox" checked={reminderForm.notifyManagerOnEmployeeItem} onChange={(event) => setReminderForm({ ...reminderForm, notifyManagerOnEmployeeItem: event.target.checked })} /> Notify manager on employee-owned items</label>
                <label><input type="checkbox" checked={reminderForm.notifyPeopleAdminOnEscalation} onChange={(event) => setReminderForm({ ...reminderForm, notifyPeopleAdminOnEscalation: event.target.checked })} /> Escalate to company People admin</label>
              </div>
              <div className="run-actions"><button className="primary-button">Save reminder policy</button></div>
            </form>
          </article>

          <article className="card" style={{ padding: 20 }}>
            <div className="card-header">
              <div><div className="card-kicker">EVIDENCE RETENTION · v{governance.evidencePolicy.version}</div><h2>Seal completed performance cycles</h2><p>Seals freeze a privacy-scoped evidence manifest. Corrections are appended as tamper-evident amendments rather than rewriting the original seal.</p></div>
              <LockKeyhole size={18} />
            </div>
            <form onSubmit={saveEvidencePolicy}>
              <div className="setting-form">
                <label>Retention years<input type="number" min="1" max="20" value={evidenceForm.retentionYears} onChange={(event) => setEvidenceForm({ ...evidenceForm, retentionYears: event.target.value })} /></label>
                <label><input type="checkbox" checked={evidenceForm.autoSealCompletedCycles} onChange={(event) => setEvidenceForm({ ...evidenceForm, autoSealCompletedCycles: event.target.checked })} /> Auto-seal completed cycles</label>
                <label><input type="checkbox" checked={evidenceForm.allowPostSealAmendments} onChange={(event) => setEvidenceForm({ ...evidenceForm, allowPostSealAmendments: event.target.checked })} /> Allow governed post-seal amendments</label>
              </div>
              <div className="run-actions"><button className="primary-button"><ShieldCheck size={14} /> Save retention policy</button></div>
            </form>

            <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
              {governance.cycles.filter((cycle) => cycle.status === "completed").map((cycle) => {
                const seal = governance.seals.find((item) => item.cycleId === cycle.id);
                return (
                  <div className="employee-edit-card" key={cycle.id}>
                    <div className="employee-list-card-head">
                      <div><strong>{cycle.name}</strong><span>{cycle.startDate} → {cycle.endDate}{seal ? " · retain until " + seal.retentionUntil : " · not sealed"}</span>{seal && <span>Hash {seal.manifestHash.slice(0, 16)}… · amendments {seal.latestAmendmentNumber}</span>}</div>
                      <span className={"employee-status-pill " + (seal?.lastVerificationStatus === "mismatch" ? "bad" : seal ? "good" : "warn")}>{seal?.legalHold ? "legal hold" : seal?.lastVerificationStatus ?? (seal ? "sealed" : "unsealed")}</span>
                    </div>
                    <div className="run-actions">
                      {!seal && <button type="button" className="primary-button" onClick={() => void evidenceAction(cycle.id, "seal_cycle")}>Seal cycle</button>}
                      {seal && <button type="button" className="secondary-button" onClick={() => void evidenceAction(cycle.id, "verify_cycle")}>Verify seal</button>}
                    </div>
                    {seal && (
                      <div className="setting-form" style={{ marginTop: 8 }}>
                        <label style={{ gridColumn: "1 / -1" }}>Hold / amendment reason<input value={sealNotes[cycle.id] ?? ""} onChange={(event) => setSealNotes((current) => ({ ...current, [cycle.id]: event.target.value }))} placeholder="Required for legal hold changes or amendments." /></label>
                        <label style={{ gridColumn: "1 / -1" }}>Amendment detail<textarea rows={2} value={amendmentDetail[cycle.id] ?? ""} onChange={(event) => setAmendmentDetail((current) => ({ ...current, [cycle.id]: event.target.value }))} /></label>
                        <div className="run-actions" style={{ gridColumn: "1 / -1" }}>
                          <button type="button" className="secondary-button" onClick={() => void evidenceAction(cycle.id, "legal_hold", { legalHold: !seal.legalHold, reason: sealNotes[cycle.id] ?? "" })}>{seal.legalHold ? "Release legal hold" : "Apply legal hold"}</button>
                          <button type="button" className="secondary-button" disabled={!evidenceForm.allowPostSealAmendments} onClick={() => void evidenceAction(cycle.id, "amend_seal", { reason: sealNotes[cycle.id] ?? "", detail: amendmentDetail[cycle.id] ?? "" })}>Append amendment</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </article>
        </>
      )}
    </div>
  );
}
