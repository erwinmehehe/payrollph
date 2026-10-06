"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BriefcaseBusiness, Building2, CheckCircle2, CircleDollarSign, Clock3, Plus, RefreshCw, Save, TrendingUp, UserCheck, UserPlus, UsersRound, XCircle } from "lucide-react";

type JobProfile = { id: number; title: string; family: string; level: string; grade: string | null; active: boolean };
type WorkforcePlan = { id: number; name: string; startDate: string; endDate: string; budget: string; status: string };
type Position = { id: number; code: string; jobProfileId: number; orgUnitId: number | null; planId: number | null; managerEmployeeId: number | null; employmentType: string; status: string; plannedStartDate: string | null; annualBudget: string; activeRequisitionId: number | null; activeRequisitionStatus: string | null };
type Assignment = { id: number; positionId: number; employeeId: number; effectiveFrom: string; effectiveUntil: string | null };
type OrgUnit = { id: number; name: string; type: string };
type Worksite = { id: number; orgUnitId: number | null; code: string; name: string; active: boolean };
type Employee = { id: number; firstName: string; lastName: string; title: string; orgUnitId: number | null; status: string };
type WorkforceScenario = {
  id: number;
  planId: number | null;
  name: string;
  version: number;
  scopeOrgUnitId: number | null;
  worksiteId: number | null;
  startDate: string;
  endDate: string;
  status: string;
  snapshotHash: string;
  submittedByUserId: number | null;
  submittedAt: string | null;
  decidedByUserId: number | null;
  decidedAt: string | null;
  decisionNote: string | null;
  snapshot: { forecast?: WorkforceForecast; scope?: { worksiteName?: string | null } } | null;
};

type WorkforceForecast = {
  assumptions: { startDate: string; endDate: string; windowDays: number; demandGrowthPercent: number; vacancyFillPercent: number; employerLoadPercent: number };
  summary: {
    activeHeadcount: number;
    costedHeadcount: number;
    vacantPositions: number;
    expectedVacancyFills: number;
    annualizedBasePayroll: number | null;
    vacantAnnualBudget: number | null;
    annualRunRateLaborCost: number | null;
    currentPeriodBasePayroll: number | null;
    expectedVacancyPeriodCost: number | null;
    employerLoadCost: number | null;
    forecastPeriodLaborCost: number | null;
    requiredHeadcountHours: number;
    forecastHeadcountHours: number;
    averageBaseHourlyRate: number | null;
    estimatedShiftDemandWageCost: number | null;
    currentPeriodCapacityHours: number;
    expectedVacancyCapacityHours: number;
    projectedCapacityHours: number;
    capacityGapBeforeFills: number;
    capacityGapAfterFills: number;
    capacityCoveragePercent: number;
  };
  roleDemand: Array<{ jobProfileId: number | null; title: string; family: string | null; level: string | null; requiredHours: number; forecastHours: number; currentCapacityHours: number; expectedVacancyCapacityHours: number; projectedCapacityHours: number; capacityGapHours: number; coveragePercent: number }>;
  costCenters: Array<{ costCenterId: number; code: string; name: string; currentPeriodBaseCost: number; currentPeriodLoadedCost: number }>;
  unallocated: { currentPeriodBaseCost: number | null; plannedVacancyPeriodCost: number | null };
  quality: {
    missingPayProfileEmployeeIds: number[];
    invalidPayProfileEmployeeIds: number[];
    allocationIssueEmployeeIds: number[];
    staffingRequirements: number;
    requirementsMissingShift: number;
  };
};

function addDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const peso = (value: number | string | null | undefined) =>
  value == null ? "Restricted" : `₱${Number(value).toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;

export function WorkforcePlanningPanel({ organizationId, setNotice, onPage }: { organizationId: number; setNotice: (message: string) => void; onPage: (page: string) => void }) {
  const [profiles, setProfiles] = useState<JobProfile[]>([]);
  const [plans, setPlans] = useState<WorkforcePlan[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [worksites, setWorksites] = useState<Worksite[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [scenarios, setScenarios] = useState<WorkforceScenario[]>([]);
  const [costVisible, setCostVisible] = useState(true);
  const [loading, setLoading] = useState(true);
  const [showProfile, setShowProfile] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const [showPosition, setShowPosition] = useState(false);
  const [showAssignment, setShowAssignment] = useState(false);

  const initialForecastStart = new Date().toISOString().slice(0, 10);
  const [forecast, setForecast] = useState<WorkforceForecast | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastStart, setForecastStart] = useState(initialForecastStart);
  const [forecastEnd, setForecastEnd] = useState(addDays(initialForecastStart, 89));
  const [demandGrowthPercent, setDemandGrowthPercent] = useState("0");
  const [vacancyFillPercent, setVacancyFillPercent] = useState("100");
  const [employerLoadPercent, setEmployerLoadPercent] = useState("15");
  const [forecastOrgUnitId, setForecastOrgUnitId] = useState("");
  const [forecastWorksiteId, setForecastWorksiteId] = useState("");
  const [scenarioName, setScenarioName] = useState("");
  const [scenarioPlanId, setScenarioPlanId] = useState("");
  const [scenarioSaving, setScenarioSaving] = useState(false);
  const [scenarioDecisionNote, setScenarioDecisionNote] = useState("");

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
      setWorksites(payload.worksites ?? []);
      setEmployees(payload.employees ?? []);
      const scenarioResponse = await fetch(`/api/workforce-planning/scenarios?organizationId=${organizationId}`, { cache: "no-store" });
      const scenarioPayload = await scenarioResponse.json().catch(() => ({}));
      if (scenarioResponse.ok) {
        setScenarios(scenarioPayload.scenarios ?? []);
        setCostVisible(scenarioPayload.costVisible !== false);
      }
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

  async function runForecast() {
    if (!forecastStart || !forecastEnd || forecastEnd < forecastStart) {
      setNotice("Forecast end date must be on or after the start date.");
      return;
    }
    setForecastLoading(true);
    try {
      const params = new URLSearchParams({
        organizationId: String(organizationId),
        startDate: forecastStart,
        endDate: forecastEnd,
        demandGrowthPercent: String(Number(demandGrowthPercent) || 0),
        vacancyFillPercent: String(Number(vacancyFillPercent) || 0),
        employerLoadPercent: String(Number(employerLoadPercent) || 0),
        ...(forecastOrgUnitId ? { orgUnitId: forecastOrgUnitId } : {}),
        ...(forecastWorksiteId ? { worksiteId: forecastWorksiteId } : {}),
      });
      const response = await fetch(`/api/workforce-planning/forecast?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(payload.error ?? "Could not calculate workforce forecast.");
        return;
      }
      setForecast(payload.forecast ?? null);
      setCostVisible(payload.costVisible !== false);
    } catch {
      setNotice("Could not reach the workforce forecast service.");
    } finally {
      setForecastLoading(false);
    }
  }

  async function saveScenario() {
    if (!scenarioName.trim()) {
      setNotice("Give the staffing scenario a name before saving.");
      return;
    }
    setScenarioSaving(true);
    try {
      const response = await fetch("/api/workforce-planning/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          name: scenarioName.trim(),
          planId: scenarioPlanId ? Number(scenarioPlanId) : null,
          scopeOrgUnitId: forecastOrgUnitId ? Number(forecastOrgUnitId) : null,
          worksiteId: forecastWorksiteId ? Number(forecastWorksiteId) : null,
          startDate: forecastStart,
          endDate: forecastEnd,
          demandGrowthPercent: Number(demandGrowthPercent) || 0,
          vacancyFillPercent: Number(vacancyFillPercent) || 0,
          employerLoadPercent: Number(employerLoadPercent) || 0,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(payload.error ?? "Could not save staffing scenario.");
        return;
      }
      setScenarioName("");
      await load();
      setNotice(`Staffing scenario ${payload.scenario?.name ?? ""} v${payload.scenario?.version ?? ""} saved as draft.`);
    } catch {
      setNotice("Could not reach staffing scenario management.");
    } finally {
      setScenarioSaving(false);
    }
  }

  async function scenarioAction(scenarioId: number, action: "submit" | "approve" | "reject") {
    const response = await fetch("/api/workforce-planning/scenarios", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenarioId,
        action,
        decisionNote: scenarioDecisionNote,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(payload.error ?? "Could not update staffing scenario.");
      return;
    }
    setScenarioDecisionNote("");
    await load();
    setNotice(`Staffing scenario ${action === "submit" ? "submitted" : action === "approve" ? "approved" : "rejected"}.`);
  }

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

      <article className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">DEMAND & LABOR-COST FORECAST</div>
            <h2>Model workforce demand before adding headcount.</h2>
            <p>Combine current payroll run-rate, approved vacancies, staffing requirements, and cost-center allocations. Assumptions never change payroll or position records.</p>
          </div>
          <button className="primary-button" type="button" onClick={() => void runForecast()} disabled={forecastLoading}>
            <TrendingUp size={15} /> {forecastLoading ? "Calculating..." : "Run forecast"}
          </button>
        </div>

        <div className="setting-form" style={{ marginBottom: 16 }}>
          <label>Forecast start<input type="date" value={forecastStart} onChange={(e) => setForecastStart(e.target.value)} /></label>
          <label>Forecast end<input type="date" min={forecastStart} value={forecastEnd} onChange={(e) => setForecastEnd(e.target.value)} /></label>
          <label>Demand growth %<input type="number" min="-50" max="200" step="1" value={demandGrowthPercent} onChange={(e) => setDemandGrowthPercent(e.target.value)} /></label>
          <label>Vacancy fill %<input type="number" min="0" max="100" step="1" value={vacancyFillPercent} onChange={(e) => setVacancyFillPercent(e.target.value)} /></label>
          <label>Employer load %<input type="number" min="0" max="100" step="0.5" value={employerLoadPercent} onChange={(e) => setEmployerLoadPercent(e.target.value)} /></label>
          <label>Organization unit<select value={forecastOrgUnitId} onChange={(e) => { setForecastOrgUnitId(e.target.value); setForecastWorksiteId(""); }}><option value="">All visible units</option>{orgUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
          <label>Worksite<select value={forecastWorksiteId} onChange={(e) => setForecastWorksiteId(e.target.value)}><option value="">All visible worksites</option>{worksites.filter((site) => !forecastOrgUnitId || site.orgUnitId === Number(forecastOrgUnitId)).map((site) => <option key={site.id} value={site.id}>{site.code} · {site.name}</option>)}</select></label>
        </div>

        <div className="setting-form" style={{ marginBottom: 16 }}>
          <label>Scenario name<input value={scenarioName} onChange={(e) => setScenarioName(e.target.value)} placeholder="Q1 Peak staffing" /></label>
          <label>Link to workforce plan<select value={scenarioPlanId} onChange={(e) => setScenarioPlanId(e.target.value)}><option value="">No linked plan</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {plan.status}</option>)}</select></label>
          <label>Approval note<input value={scenarioDecisionNote} onChange={(e) => setScenarioDecisionNote(e.target.value)} placeholder="Used when approving or rejecting" /></label>
          <button className="secondary-button" type="button" onClick={() => void saveScenario()} disabled={scenarioSaving || !forecast}><Save size={15} /> {scenarioSaving ? "Saving..." : "Save scenario"}</button>
        </div>

        {!forecast && (
          <div className="empty-state">Run a scenario to compare current payroll cost, vacancy budget, staffing demand, and finance allocation.</div>
        )}

        {forecast && (
          <>
            <section className="stats-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 16 }}>
              <article className="stat-card"><div className="stat-icon purple"><UsersRound size={19} /></div><p>ACTIVE HEADCOUNT</p><h3>{forecast.summary.activeHeadcount}</h3><span>{forecast.summary.costedHeadcount} with valid pay profiles</span></article>
              <article className="stat-card"><div className="stat-icon blue"><Clock3 size={19} /></div><p>FORECAST DEMAND</p><h3>{forecast.summary.forecastHeadcountHours.toLocaleString("en-PH", { maximumFractionDigits: 0 })} hrs</h3><span>{forecast.summary.requiredHeadcountHours.toLocaleString("en-PH", { maximumFractionDigits: 0 })} baseline hours</span></article>
              <article className="stat-card"><div className="stat-icon orange"><UserPlus size={19} /></div><p>EXPECTED FILLS</p><h3>{forecast.summary.expectedVacancyFills}</h3><span>{forecast.summary.vacantPositions} vacant planned / approved / open positions</span></article>
              <article className="stat-card"><div className="stat-icon mint"><CircleDollarSign size={19} /></div><p>{costVisible ? "PERIOD LABOR COST" : "PROJECTED CAPACITY"}</p><h3>{costVisible ? peso(forecast.summary.forecastPeriodLaborCost) : `${forecast.summary.projectedCapacityHours.toLocaleString("en-PH", { maximumFractionDigits: 0 })} hrs`}</h3><span>{costVisible ? `${forecast.assumptions.windowDays} days · includes ${forecast.assumptions.employerLoadPercent}% scenario load` : `${forecast.summary.capacityCoveragePercent.toFixed(1)}% demand coverage`}</span></article>
            </section>
            <div className={forecast.summary.capacityGapAfterFills > 0 ? "notice notice-amber" : "notice notice-slate"} style={{ marginBottom: 16 }}>
              <UsersRound size={15} />
              <span><strong>{forecast.summary.capacityGapAfterFills > 0 ? "Capacity gap" : "Capacity covered"}:</strong> demand {forecast.summary.forecastHeadcountHours.toLocaleString("en-PH", { maximumFractionDigits: 0 })} hrs vs projected capacity {forecast.summary.projectedCapacityHours.toLocaleString("en-PH", { maximumFractionDigits: 0 })} hrs after expected fills. Gap after fills: {forecast.summary.capacityGapAfterFills.toLocaleString("en-PH", { maximumFractionDigits: 0 })} hrs.</span>
            </div>

            {forecast.roleDemand.length > 0 && (
              <div className="data-table-wrap" style={{ marginBottom: 16 }}>
                <table className="data-table" data-wfm-role-demand>
                  <thead><tr><th>JOB PROFILE</th><th className="right">FORECAST DEMAND</th><th className="right">CURRENT CAPACITY</th><th className="right">AFTER FILLS</th><th className="right">GAP</th></tr></thead>
                  <tbody>
                    {forecast.roleDemand.map((row) => (
                      <tr key={row.jobProfileId ?? "any"}>
                        <td><strong>{row.title}</strong><small style={{ display: "block", color: "var(--muted)" }}>{[row.family, row.level].filter(Boolean).join(" · ") || "General staffing requirement"}</small></td>
                        <td className="right">{row.forecastHours.toLocaleString("en-PH", { maximumFractionDigits: 0 })} hrs</td>
                        <td className="right">{row.currentCapacityHours.toLocaleString("en-PH", { maximumFractionDigits: 0 })} hrs</td>
                        <td className="right">{row.projectedCapacityHours.toLocaleString("en-PH", { maximumFractionDigits: 0 })} hrs</td>
                        <td className="right"><strong>{row.capacityGapHours.toLocaleString("en-PH", { maximumFractionDigits: 0 })} hrs</strong><small style={{ display: "block", color: "var(--muted)" }}>{row.coveragePercent.toFixed(1)}% coverage</small></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="module-grid two">
              <div className="notice notice-slate" style={{ margin: 0 }}>
                <TrendingUp size={15} />
                <span>
                  <strong>{peso(forecast.summary.annualRunRateLaborCost)} annual run-rate.</strong> Current annualized base payroll is {peso(forecast.summary.annualizedBasePayroll)} and vacant position budget is {peso(forecast.summary.vacantAnnualBudget)}.
                </span>
              </div>
              <div className="notice notice-slate" style={{ margin: 0 }}>
                <Clock3 size={15} />
                <span>
                  <strong>{peso(forecast.summary.estimatedShiftDemandWageCost)} shift-demand estimate.</strong> This uses recorded staffing requirements, paid shift hours, average base hourly rate, growth, and the scenario load. It is not added to the labor plan again.
                </span>
              </div>
            </div>

            {(forecast.quality.missingPayProfileEmployeeIds.length > 0 || forecast.quality.invalidPayProfileEmployeeIds.length > 0 || forecast.quality.allocationIssueEmployeeIds.length > 0 || forecast.quality.requirementsMissingShift > 0) && (
              <div className="notice notice-amber" style={{ marginTop: 16 }}>
                <CircleDollarSign size={15} />
                <span>
                  <strong>Forecast quality needs review.</strong> Missing pay profiles: {forecast.quality.missingPayProfileEmployeeIds.length}; invalid pay profiles: {forecast.quality.invalidPayProfileEmployeeIds.length}; allocation issues: {forecast.quality.allocationIssueEmployeeIds.length}; staffing rows missing a valid shift: {forecast.quality.requirementsMissingShift}.
                </span>
              </div>
            )}

            <div className="data-table-wrap" style={{ marginTop: 16 }}>
              <table className="data-table">
                <thead><tr><th>COST CENTER</th><th className="right">CURRENT BASE COST</th><th className="right">LOADED COST</th></tr></thead>
                <tbody>
                  {forecast.costCenters.map((center) => (
                    <tr key={center.costCenterId}>
                      <td><strong>{center.code}</strong><small style={{ display: "block", color: "var(--muted)" }}>{center.name}</small></td>
                      <td className="right">{peso(center.currentPeriodBaseCost)}</td>
                      <td className="right">{peso(center.currentPeriodLoadedCost)}</td>
                    </tr>
                  ))}
                  {forecast.costCenters.length === 0 && <tr><td colSpan={3}><div className="empty-state">No current employee labor allocations resolve at the scenario start date.</div></td></tr>}
                </tbody>
              </table>
            </div>

            <div className="notice notice-slate" style={{ marginTop: 16 }}>
              <Building2 size={15} />
              <span>
                <strong>Planning boundary.</strong> Employer load is an explicit scenario assumption, not a statutory contribution calculation. Planned vacancy cost remains unallocated until a worker has an effective labor-cost allocation. Current unallocated base cost: {peso(forecast.unallocated.currentPeriodBaseCost)}.
              </span>
            </div>
          </>
        )}
      </article>

      <article className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">STAFFING PLAN APPROVAL</div>
            <h2>Saved scenario evidence</h2>
            <p>Drafts can be submitted for independent manager review. The submitter cannot approve or reject their own scenario.</p>
          </div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>SCENARIO</th><th>SCOPE</th><th>CAPACITY</th><th>STATUS</th><th className="right">ACTION</th></tr></thead>
            <tbody>
              {scenarios.map((scenario) => {
                const scenarioForecast = scenario.snapshot?.forecast;
                const gap = scenarioForecast?.summary.capacityGapAfterFills ?? null;
                return (
                  <tr key={scenario.id}>
                    <td><strong>{scenario.name} v{scenario.version}</strong><small style={{ display: "block", color: "var(--muted)" }}>{scenario.startDate} → {scenario.endDate} · {scenario.snapshotHash.slice(0, 10)}</small></td>
                    <td>{scenario.snapshot?.scope?.worksiteName ?? (scenario.scopeOrgUnitId ? unitById.get(scenario.scopeOrgUnitId)?.name ?? "Scoped unit" : "Company")}</td>
                    <td>{scenarioForecast ? <><strong>{scenarioForecast.summary.capacityCoveragePercent.toFixed(1)}%</strong><small style={{ display: "block", color: "var(--muted)" }}>{gap == null ? "" : `${gap.toLocaleString("en-PH", { maximumFractionDigits: 0 })} hr gap`}</small></> : "Snapshot unavailable"}</td>
                    <td><span className={scenario.status === "approved" ? "status status-verified" : scenario.status === "rejected" ? "status status-rejected" : "status"}>{scenario.status}</span></td>
                    <td className="right">
                      <div className="run-actions" style={{ justifyContent: "flex-end" }}>
                        {scenario.status === "draft" && <button className="secondary-button" onClick={() => void scenarioAction(scenario.id, "submit")}>Submit</button>}
                        {scenario.status === "submitted" && <>
                          <button className="secondary-button" onClick={() => void scenarioAction(scenario.id, "reject")}><XCircle size={14} /> Reject</button>
                          <button className="primary-button" onClick={() => void scenarioAction(scenario.id, "approve")}><CheckCircle2 size={14} /> Approve</button>
                        </>}
                        {scenario.status === "approved" && <span className="status status-verified"><CheckCircle2 size={13} /> Locked evidence</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {scenarios.length === 0 && <tr><td colSpan={5}><div className="empty-state">No saved staffing scenarios yet. Run a forecast, name it, and save the snapshot.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </article>

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
