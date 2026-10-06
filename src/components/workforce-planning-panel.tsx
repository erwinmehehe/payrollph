"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BriefcaseBusiness, Building2, CircleDollarSign, Plus, RefreshCw, UserCheck, UserPlus, UsersRound } from "lucide-react";

type JobProfile = { id: number; title: string; family: string; level: string; grade: string | null; active: boolean };
type WorkforcePlan = { id: number; name: string; startDate: string; endDate: string; budget: string; status: string };
type Position = { id: number; code: string; jobProfileId: number; orgUnitId: number | null; planId: number | null; managerEmployeeId: number | null; employmentType: string; status: string; plannedStartDate: string | null; annualBudget: string; activeRequisitionId: number | null; activeRequisitionStatus: string | null };
type Assignment = { id: number; positionId: number; employeeId: number; effectiveFrom: string; effectiveUntil: string | null };
type OrgUnit = { id: number; name: string; type: string };
type Employee = { id: number; firstName: string; lastName: string; title: string; orgUnitId: number | null; status: string };

const peso = (value: number | string) => `₱${Number(value).toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;

export function WorkforcePlanningPanel({ organizationId, setNotice, onPage }: { organizationId: number; setNotice: (message: string) => void; onPage: (page: string) => void }) {
  const [profiles, setProfiles] = useState<JobProfile[]>([]);
  const [plans, setPlans] = useState<WorkforcePlan[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showProfile, setShowProfile] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const [showPosition, setShowPosition] = useState(false);
  const [showAssignment, setShowAssignment] = useState(false);

  const [profileForm, setProfileForm] = useState({ title: "", family: "", level: "", grade: "" });
  const [planForm, setPlanForm] = useState({ name: "", startDate: "", endDate: "", budget: "" });
  const [positionForm, setPositionForm] = useState({ code: "", jobProfileId: "", orgUnitId: "", planId: "", managerEmployeeId: "", employmentType: "Regular", plannedStartDate: "", annualBudget: "" });
  const [assignmentForm, setAssignmentForm] = useState({ positionId: "", employeeId: "", effectiveFrom: new Date().toISOString().slice(0, 10) });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/workforce-planning?organizationId=${organizationId}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return setNotice(payload.error ?? "Could not load workforce planning.");
      setProfiles(payload.profiles ?? []);
      setPlans(payload.plans ?? []);
      setPositions(payload.positions ?? []);
      setAssignments(payload.assignments ?? []);
      setOrgUnits(payload.orgUnits ?? []);
      setEmployees(payload.employees ?? []);
    } finally {
      setLoading(false);
    }
  }, [organizationId, setNotice]);

  useEffect(() => { void load(); }, [load]);

  const activeAssignments = assignments.filter((assignment) => !assignment.effectiveUntil);
  const activeAssignmentByPosition = useMemo(() => new Map(activeAssignments.map((assignment) => [assignment.positionId, assignment])), [activeAssignments]);
  const employeeById = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);
  const profileById = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles]);
  const unitById = useMemo(() => new Map(orgUnits.map((unit) => [unit.id, unit])), [orgUnits]);
  const plannedCost = positions.filter((position) => position.status !== "closed").reduce((sum, position) => sum + Number(position.annualBudget), 0);
  const approvedOpen = positions.filter((position) => ["approved", "open"].includes(position.status)).length;
  const filled = positions.filter((position) => activeAssignmentByPosition.has(position.id)).length;

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/workforce-planning", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, ...body }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "Could not save workforce planning data.");
    return payload;
  }

  async function createProfile(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({ entityType: "profile", ...profileForm });
      setShowProfile(false);
      setProfileForm({ title: "", family: "", level: "", grade: "" });
      await load();
      setNotice("Job profile created.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not create job profile."); }
  }

  async function createPlan(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({ entityType: "plan", ...planForm, budget: Number(planForm.budget) });
      setShowPlan(false);
      setPlanForm({ name: "", startDate: "", endDate: "", budget: "" });
      await load();
      setNotice("Workforce plan created.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not create workforce plan."); }
  }

  async function createPosition(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({
        entityType: "position",
        ...positionForm,
        jobProfileId: Number(positionForm.jobProfileId),
        orgUnitId: positionForm.orgUnitId ? Number(positionForm.orgUnitId) : null,
        planId: positionForm.planId ? Number(positionForm.planId) : null,
        managerEmployeeId: positionForm.managerEmployeeId ? Number(positionForm.managerEmployeeId) : null,
        annualBudget: Number(positionForm.annualBudget),
      });
      setShowPosition(false);
      setPositionForm({ code: "", jobProfileId: "", orgUnitId: "", planId: "", managerEmployeeId: "", employmentType: "Regular", plannedStartDate: "", annualBudget: "" });
      await load();
      setNotice("Position added to the headcount plan.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not create position."); }
  }

  async function assignPosition(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({
        entityType: "assignment",
        positionId: Number(assignmentForm.positionId),
        employeeId: Number(assignmentForm.employeeId),
        effectiveFrom: assignmentForm.effectiveFrom,
      });
      setShowAssignment(false);
      setAssignmentForm({ positionId: "", employeeId: "", effectiveFrom: new Date().toISOString().slice(0, 10) });
      await load();
      setNotice("Employee assigned to position.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not assign position."); }
  }

  async function updateStatus(position: Position, status: string) {
    const response = await fetch("/api/workforce-planning", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: position.id, status }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setNotice(payload.error ?? "Could not update position.");
    await load();
    setNotice(`Position ${position.code} moved to ${status}.`);
  }

  async function openRecruitment(position: Position) {
    const response = await fetch("/api/recruitment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entityType: "requisition",
        organizationId,
        positionId: position.id,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(payload.error ?? "Could not open this position for recruitment.");
      return;
    }
    await load();
    setNotice(`Requisition #${payload.id} opened from position ${position.code}.`);
    onPage("Recruitment");
  }

  return (
    <div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">WORKFORCE PLANNING</div>
          <h1>Plan positions before opening requisitions.</h1>
          <p>Keep an authoritative headcount ledger with job architecture, approved positions, budgets, ownership, and effective-dated incumbents.</p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} /> Refresh</button>
          <button className="secondary-button" onClick={() => setShowProfile(!showProfile)}><BriefcaseBusiness size={15} /> Job profile</button>
          <button className="secondary-button" onClick={() => setShowPlan(!showPlan)}><CircleDollarSign size={15} /> Plan</button>
          <button className="primary-button" onClick={() => setShowPosition(!showPosition)}><Plus size={15} /> Position</button>
        </div>
      </div>

      <section className="stats-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <article className="stat-card"><div className="stat-icon purple"><BriefcaseBusiness size={19} /></div><p>POSITIONS</p><h3>{positions.length}</h3><span>{profiles.length} job profiles</span></article>
        <article className="stat-card"><div className="stat-icon blue"><UsersRound size={19} /></div><p>APPROVED / OPEN</p><h3>{approvedOpen}</h3><span>Ready for recruiting</span></article>
        <article className="stat-card"><div className="stat-icon mint"><UserCheck size={19} /></div><p>FILLED</p><h3>{filled}</h3><span>{positions.length ? Math.round((filled / positions.length) * 100) : 0}% fill rate</span></article>
        <article className="stat-card"><div className="stat-icon orange"><CircleDollarSign size={19} /></div><p>PLANNED ANNUAL COST</p><h3>{peso(plannedCost)}</h3><span>Position salary budgets</span></article>
      </section>

      {showProfile && (
        <article className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div className="card-header"><div><div className="card-kicker">JOB ARCHITECTURE</div><h2>Create a reusable job profile</h2></div></div>
          <form onSubmit={createProfile}>
            <div className="setting-form">
              <label>Title<input required value={profileForm.title} onChange={(e) => setProfileForm({ ...profileForm, title: e.target.value })} placeholder="Payroll Operations Manager" /></label>
              <label>Family<input required value={profileForm.family} onChange={(e) => setProfileForm({ ...profileForm, family: e.target.value })} placeholder="Finance Operations" /></label>
              <label>Level<input required value={profileForm.level} onChange={(e) => setProfileForm({ ...profileForm, level: e.target.value })} placeholder="Manager" /></label>
              <label>Grade<input value={profileForm.grade} onChange={(e) => setProfileForm({ ...profileForm, grade: e.target.value })} placeholder="M2" /></label>
            </div>
            <div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowProfile(false)}>Cancel</button><button className="primary-button">Create profile</button></div>
          </form>
        </article>
      )}

      {showPlan && (
        <article className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div className="card-header"><div><div className="card-kicker">HEADCOUNT PLAN</div><h2>Set a governed planning window and budget</h2></div></div>
          <form onSubmit={createPlan}>
            <div className="setting-form">
              <label>Name<input required value={planForm.name} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} placeholder="2027 Operating Plan" /></label>
              <label>Start<input required type="date" value={planForm.startDate} onChange={(e) => setPlanForm({ ...planForm, startDate: e.target.value })} /></label>
              <label>End<input required type="date" value={planForm.endDate} onChange={(e) => setPlanForm({ ...planForm, endDate: e.target.value })} /></label>
              <label>Annual budget<input required type="number" min="0" value={planForm.budget} onChange={(e) => setPlanForm({ ...planForm, budget: e.target.value })} /></label>
            </div>
            <div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowPlan(false)}>Cancel</button><button className="primary-button">Create plan</button></div>
          </form>
        </article>
      )}

      {showPosition && (
        <article className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div className="card-header"><div><div className="card-kicker">POSITION CONTROL</div><h2>Add one position to the ledger</h2></div></div>
          <form onSubmit={createPosition}>
            <div className="setting-form">
              <label>Position code<input required value={positionForm.code} onChange={(e) => setPositionForm({ ...positionForm, code: e.target.value })} placeholder="FIN-PAY-004" /></label>
              <label>Job profile<select required value={positionForm.jobProfileId} onChange={(e) => setPositionForm({ ...positionForm, jobProfileId: e.target.value })}><option value="">Select profile</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.title} · {profile.level}</option>)}</select></label>
              <label>Org unit<select value={positionForm.orgUnitId} onChange={(e) => setPositionForm({ ...positionForm, orgUnitId: e.target.value })}><option value="">Company-wide / unassigned</option>{orgUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
              <label>Workforce plan<select value={positionForm.planId} onChange={(e) => setPositionForm({ ...positionForm, planId: e.target.value })}><option value="">No plan</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>
              <label>Manager<select value={positionForm.managerEmployeeId} onChange={(e) => setPositionForm({ ...positionForm, managerEmployeeId: e.target.value })}><option value="">No manager</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</select></label>
              <label>Employment type<select value={positionForm.employmentType} onChange={(e) => setPositionForm({ ...positionForm, employmentType: e.target.value })}><option>Regular</option><option>Probationary</option><option>Part-time</option><option>Contractual</option></select></label>
              <label>Planned start<input type="date" value={positionForm.plannedStartDate} onChange={(e) => setPositionForm({ ...positionForm, plannedStartDate: e.target.value })} /></label>
              <label>Annual salary budget<input required type="number" min="0" value={positionForm.annualBudget} onChange={(e) => setPositionForm({ ...positionForm, annualBudget: e.target.value })} /></label>
            </div>
            <div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowPosition(false)}>Cancel</button><button className="primary-button">Add position</button></div>
          </form>
        </article>
      )}

      {showAssignment && (
        <article className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div className="card-header"><div><div className="card-kicker">POSITION ASSIGNMENT</div><h2>Place an employee into an approved position</h2></div></div>
          <form onSubmit={assignPosition}>
            <div className="setting-form">
              <label>Position<select required value={assignmentForm.positionId} onChange={(e) => setAssignmentForm({ ...assignmentForm, positionId: e.target.value })}><option value="">Select position</option>{positions.filter((position) => !activeAssignmentByPosition.has(position.id) && ["approved", "open"].includes(position.status)).map((position) => <option key={position.id} value={position.id}>{position.code} · {profileById.get(position.jobProfileId)?.title}</option>)}</select></label>
              <label>Employee<select required value={assignmentForm.employeeId} onChange={(e) => setAssignmentForm({ ...assignmentForm, employeeId: e.target.value })}><option value="">Select employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName} · {employee.title}</option>)}</select></label>
              <label>Effective from<input required type="date" value={assignmentForm.effectiveFrom} onChange={(e) => setAssignmentForm({ ...assignmentForm, effectiveFrom: e.target.value })} /></label>
            </div>
            <div className="run-actions"><button type="button" className="secondary-button" onClick={() => setShowAssignment(false)}>Cancel</button><button className="primary-button">Assign employee</button></div>
          </form>
        </article>
      )}

      <article className="card">
        <div className="card-header">
          <div><div className="card-kicker">POSITION LEDGER</div><h2>Approved structure, vacancies, and incumbents</h2><p>Approve headcount here, open the approved position in Recruitment, then let the hire flow create the employee and fill the position atomically.</p></div>
          <button className="secondary-button" onClick={() => setShowAssignment(!showAssignment)} disabled={!positions.length || !employees.length}><UserCheck size={15} /> Assign existing employee</button>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>POSITION</th><th>JOB / UNIT</th><th>INCUMBENT</th><th>START</th><th className="right">BUDGET</th><th>STATUS</th><th>ACTION</th></tr></thead>
            <tbody>
              {positions.length === 0 && <tr><td colSpan={7}><div className="empty-state">No positions yet. Create job architecture, then add planned positions.</div></td></tr>}
              {positions.map((position) => {
                const assignment = activeAssignmentByPosition.get(position.id);
                const incumbent = assignment ? employeeById.get(assignment.employeeId) : null;
                const profile = profileById.get(position.jobProfileId);
                const statusOptions =
                  position.status === "filled"
                    ? ["filled"]
                    : position.status === "open"
                      ? ["open", "frozen", "closed"]
                      : ["planned", "approved", "frozen", "closed"];
                return (
                  <tr key={position.id}>
                    <td><strong>{position.code}</strong><small style={{ display: "block", color: "var(--muted)" }}>{position.employmentType}</small></td>
                    <td><strong>{profile?.title ?? "Job profile"}</strong><small style={{ display: "block", color: "var(--muted)" }}>{position.orgUnitId ? unitById.get(position.orgUnitId)?.name ?? "Unit" : "Unassigned unit"}</small></td>
                    <td>{incumbent ? <><strong>{incumbent.firstName} {incumbent.lastName}</strong><small style={{ display: "block", color: "var(--muted)" }}>{assignment?.effectiveFrom}</small></> : <span style={{ color: "var(--muted)" }}>Vacant</span>}</td>
                    <td>{position.plannedStartDate ?? "—"}</td>
                    <td className="right">{peso(position.annualBudget)}</td>
                    <td>
                      <select value={position.status} onChange={(e) => void updateStatus(position, e.target.value)} disabled={position.status === "filled"}>
                        {statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
                      </select>
                      {position.activeRequisitionId && <small style={{ display: "block", color: "var(--muted)", marginTop: 4 }}>Req #{position.activeRequisitionId} · {position.activeRequisitionStatus}</small>}
                    </td>
                    <td>
                      {position.status === "approved" && !position.activeRequisitionId ? (
                        <button className="secondary-button" onClick={() => void openRecruitment(position)}><UserPlus size={14} /> Open requisition</button>
                      ) : position.activeRequisitionId ? (
                        <button className="secondary-button" onClick={() => onPage("Recruitment")}>View ATS</button>
                      ) : (
                        <span style={{ color: "var(--muted)", fontSize: 11 }}>{position.status === "planned" ? "Approve first" : "—"}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>

      <section className="module-grid two" style={{ marginTop: 16 }}>
        <article className="card">
          <div className="card-header"><div><div className="card-kicker">JOB ARCHITECTURE</div><h2>Profiles and levels</h2></div></div>
          {profiles.length === 0 && <div className="empty-state">No job profiles yet.</div>}
          {profiles.map((profile) => <div className="leave-request" key={profile.id}><div className="inline-icon purple"><BriefcaseBusiness size={16} /></div><div><strong>{profile.title}</strong><span>{profile.family} · {profile.level}{profile.grade ? ` · ${profile.grade}` : ""}</span></div></div>)}
        </article>
        <article className="card">
          <div className="card-header"><div><div className="card-kicker">PLANS</div><h2>Planning windows</h2></div></div>
          {plans.length === 0 && <div className="empty-state">No workforce plans yet.</div>}
          {plans.map((plan) => <div className="leave-request" key={plan.id}><div className="inline-icon mint"><Building2 size={16} /></div><div style={{ flex: 1 }}><strong>{plan.name}</strong><span>{plan.startDate} – {plan.endDate} · {plan.status}</span></div><strong>{peso(plan.budget)}</strong></div>)}
        </article>
      </section>
    </div>
  );
}
