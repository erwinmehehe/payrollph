"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BriefcaseBusiness, Building2, CheckCircle2, CircleDollarSign, Clock3, Plus, RefreshCw, Save, TrendingUp, UserCheck, UserPlus, UsersRound, XCircle } from "lucide-react";
import { WorkforcePlanAllocationPanel } from "@/components/workforce-plan-allocation-panel";

type JobFamily = { id: number; code: string; name: string; active: boolean };
type JobLevel = { id: number; code: string; name: string; sequence: number; active: boolean };
type JobGrade = { id: number; code: string; name: string; sequence: number; active: boolean };
type JobProfile = { id: number; title: string; familyId: number | null; levelId: number | null; gradeId: number | null; family: string; level: string; grade: string | null; active: boolean };
type WorkforcePlan = { id: number; name: string; startDate: string; endDate: string; budget: string; status: string };
type Position = { id: number; code: string; jobProfileId: number; orgUnitId: number | null; supervisoryOrgUnitId: number | null; legalEntityId: number | null; costCenterId: number | null; planId: number | null; managerEmployeeId: number | null; employmentType: string; status: string; plannedStartDate: string | null; annualBudget: string; activeRequisitionId: number | null; activeRequisitionStatus: string | null };
type Assignment = { id: number; positionId: number; employeeId: number; effectiveFrom: string; effectiveUntil: string | null };
type OrgUnit = { id: number; parentId: number | null; name: string; code: string; type: string; legalEntityId: number | null; costCenterId: number | null; managerEmployeeId: number | null; effectiveFrom: string | null; effectiveUntil: string | null; active: boolean };
type LegalEntity = { id: number; code: string; displayName: string; legalName: string; active: boolean };
type CostCenter = { id: number; code: string; name: string; active: boolean };
type Worksite = { id: number; orgUnitId: number | null; code: string; name: string; active: boolean };
type Shift = { id: number; code: string; name: string; startTime: string; endTime: string; active: boolean };
type Employee = { id: number; firstName: string; lastName: string; title: string; orgUnitId: number | null; status: string };
type WorkforceApprovalProcess = {
  instanceId: number;
  policyCode: string;
  policyVersion: number;
  status: string;
  amount: number | null;
  amountBasis: string | null;
  currentStepIndex: number;
  currentStep: { label: string; approver: string; status: string; approvalTaskId: number | null } | null;
  steps: Array<{ stepIndex: number; label: string; approver: string; status: string; approvalTaskId: number | null; decidedBy: string | null; decidedAt: string | null }>;
};

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
  approvalProcess?: WorkforceApprovalProcess | null;
};

type WorkforceApprovalConfiguration = {
  configured: boolean;
  conflict: boolean;
  policy: { id: number; code: string; name: string; version: number } | null;
};

type HeadcountPlanSummaryView = {
  requestedHeadcount: number;
  approvedHeadcount: number;
  filledHeadcount: number;
  vacantApprovedHeadcount: number;
  requestedFte: number;
  approvedFte: number;
  filledFte: number;
  annualPositionBudget: number | null;
};

type HeadcountPlanDimensionVarianceView = {
  key: number | null;
  code: string | null;
  name: string;
  baseline: {
    requestedHeadcount: number;
    approvedHeadcount: number;
    filledHeadcount: number;
    requestedFte: number;
    approvedFte: number;
    filledFte: number;
    annualPositionBudget: number | null;
  };
  actual: {
    requestedHeadcount: number;
    approvedHeadcount: number;
    filledHeadcount: number;
    requestedFte: number;
    approvedFte: number;
    filledFte: number;
    annualPositionBudget: number | null;
  };
  variance: {
    requestedHeadcount: number;
    approvedHeadcount: number;
    filledHeadcount: number;
    requestedFte: number;
    approvedFte: number;
    filledFte: number;
    annualPositionBudget: number | null;
  };
};

type WorkforcePlanBaseline = {
  id: number;
  planId: number;
  scenarioId: number;
  version: number;
  current: boolean;
  snapshotHash: string;
  publishedBy: string;
  publishedAt: string;
  snapshot: {
    plan?: { id?: number; name?: string; startDate?: string; endDate?: string; budget?: number | null };
    scenario?: { id?: number; name?: string; version?: number };
    headcount?: HeadcountPlanSummaryView;
  } | null;
  actual: HeadcountPlanSummaryView;
  variance: {
    requestedHeadcount: number;
    approvedHeadcount: number;
    filledHeadcount: number;
    vacantApprovedHeadcount: number;
    requestedFte: number;
    approvedFte: number;
    filledFte: number;
    annualPositionBudget: number | null;
  } | null;
  dimensionVariance: {
    orgUnits: HeadcountPlanDimensionVarianceView[];
    costCenters: HeadcountPlanDimensionVarianceView[];
  } | null;
};

type WorkforceForecast = {
  assumptions: {
    startDate: string;
    endDate: string;
    windowDays: number;
    demandGrowthPercent: number;
    vacancyFillPercent: number;
    employerLoadPercent: number;
    annualAttritionPercent: number;
    attritionBackfillPercent: number;
    windowAttritionPercent: number;
    attritionTimingModel: string;
  };
  summary: {
    activeHeadcount: number;
    costedHeadcount: number;
    expectedAttritionExits: number;
    plannedAttritionBackfills: number;
    endingActiveHeadcount: number;
    projectedHeadcountAfterVacancyFills: number;
    vacantPositions: number;
    expectedVacancyFills: number;
    annualizedBasePayroll: number | null;
    vacantAnnualBudget: number | null;
    annualRunRateLaborCost: number | null;
    currentPeriodBasePayroll: number | null;
    expectedAttritionPeriodBaseReduction: number | null;
    plannedBackfillPeriodBaseCost: number | null;
    expectedAttritionPeriodEmployerCostReduction: number | null;
    plannedBackfillPeriodEmployerCost: number | null;
    annualBackfillRunRateCost: number | null;
    netAttritionAnnualRunRateCostChange: number | null;
    expectedVacancyPeriodCost: number | null;
    currentPeriodStatutoryEmployerCost: number | null;
    currentPeriodBenefitEmployerCost: number | null;
    currentPeriodRecurringCompensationCost: number | null;
    expectedVacancyEmployerStatutoryCost: number | null;
    sourceGroundedEmployerCost: number | null;
    additionalScenarioLoadCost: number | null;
    employerLoadCost: number | null;
    forecastPeriodLaborCost: number | null;
    requiredHeadcountHours: number;
    forecastHeadcountHours: number;
    averageBaseHourlyRate: number | null;
    estimatedShiftDemandWageCost: number | null;
    currentPeriodCapacityHours: number;
    attritionCapacityLossHours: number;
    plannedBackfillCapacityHours: number;
    expectedVacancyCapacityHours: number;
    projectedCapacityHours: number;
    capacityGapBeforeFills: number;
    capacityGapAfterFills: number;
    capacityCoveragePercent: number;
  };
  roleDemand: Array<{
    jobProfileId: number | null;
    title: string;
    family: string;
    level: string;
    requiredHours: number;
    forecastHours: number;
    activeHeadcount: number;
    expectedAttritionExits: number;
    plannedAttritionBackfills: number;
    vacantPositions: number;
    expectedVacancyFills: number;
    currentCapacityHours: number;
    attritionCapacityLossHours: number;
    backfillCapacityHours: number;
    expectedVacancyCapacityHours: number;
    projectedCapacityHours: number;
    capacityGapHours: number;
    coveragePercent: number;
  }>;
  backfillPlan: Array<{
    jobProfileId: number | null;
    title: string;
    family: string;
    level: string;
    activeHeadcount: number;
    expectedAttritionExits: number;
    plannedBackfills: number;
    endingHeadcount: number;
    averageAnnualBaseCost: number | null;
    averageAnnualLoadedCost: number | null;
    expectedAttritionPeriodCostReduction: number | null;
    plannedBackfillPeriodCost: number | null;
    annualBackfillRunRateCost: number | null;
    netAnnualRunRateCostChange: number | null;
    attritionCapacityLossHours: number;
    backfillCapacityHours: number;
  }>;
  costCenters: Array<{ costCenterId: number; code: string; name: string; currentPeriodBaseCost: number; currentPeriodLoadedCost: number }>;
  unallocated: { currentPeriodBaseCost: number | null; plannedVacancyPeriodCost: number | null };
  quality: {
    missingPayProfileEmployeeIds: number[];
    invalidPayProfileEmployeeIds: number[];
    allocationIssueEmployeeIds: number[];
    staffingRequirements: number;
    requirementsMissingShift: number;
    roleEvidenceIssues: string[];
    recurringCompensationIssues: string[];
    employerCostRows: number;
    vacanciesWithoutBenefitCost: number;
  };
};

function addDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const peso = (value: number | string | null | undefined) =>
  value == null ? "Restricted" : `₱${Number(value).toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;

const signedNumber = (value: number, digits = 0) =>
  `${value > 0 ? "+" : ""}${value.toLocaleString("en-PH", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

const signedPeso = (value: number | null | undefined) =>
  value == null ? "Restricted" : `${Number(value) > 0 ? "+" : ""}${peso(value)}`;

export function WorkforcePlanningPanel({ organizationId, setNotice, onPage }: { organizationId: number; setNotice: (message: string) => void; onPage: (page: string) => void }) {
  const [profiles, setProfiles] = useState<JobProfile[]>([]);
  const [jobFamilies, setJobFamilies] = useState<JobFamily[]>([]);
  const [jobLevels, setJobLevels] = useState<JobLevel[]>([]);
  const [jobGrades, setJobGrades] = useState<JobGrade[]>([]);
  const [plans, setPlans] = useState<WorkforcePlan[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [legalEntities, setLegalEntities] = useState<LegalEntity[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [worksites, setWorksites] = useState<Worksite[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [scenarios, setScenarios] = useState<WorkforceScenario[]>([]);
  const [approvalConfiguration, setApprovalConfiguration] = useState<WorkforceApprovalConfiguration>({ configured: false, conflict: false, policy: null });
  const [baselines, setBaselines] = useState<WorkforcePlanBaseline[]>([]);
  const [baselinePublishing, setBaselinePublishing] = useState<number | null>(null);
  const [forecastPlanCreating, setForecastPlanCreating] = useState<number | null>(null);
  const [costVisible, setCostVisible] = useState(true);
  const [loading, setLoading] = useState(true);
  const [showArchitecture, setShowArchitecture] = useState(false);
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
  const [employerLoadPercent, setEmployerLoadPercent] = useState("0");
  const [annualAttritionPercent, setAnnualAttritionPercent] = useState("0");
  const [attritionBackfillPercent, setAttritionBackfillPercent] = useState("100");
  const [forecastOrgUnitId, setForecastOrgUnitId] = useState("");
  const [forecastWorksiteId, setForecastWorksiteId] = useState("");
  const [scenarioName, setScenarioName] = useState("");
  const [scenarioPlanId, setScenarioPlanId] = useState("");
  const [scenarioSaving, setScenarioSaving] = useState(false);
  const [handoffSaving, setHandoffSaving] = useState(false);
  const [handoffForm, setHandoffForm] = useState({
    planId: "",
    jobProfileId: "",
    worksiteId: "",
    shiftDefinitionId: "",
    startDate: initialForecastStart,
    endDate: addDays(initialForecastStart, 6),
    requiredHeadcount: "1",
  });

  const [familyForm, setFamilyForm] = useState({ code: "", name: "" });
  const [levelForm, setLevelForm] = useState({ code: "", name: "", sequence: "0" });
  const [gradeForm, setGradeForm] = useState({ code: "", name: "", sequence: "0" });
  const [orgUnitForm, setOrgUnitForm] = useState({ code: "", name: "", type: "department", parentId: "", legalEntityId: "", costCenterId: "", managerEmployeeId: "", effectiveFrom: "" });
  const [profileForm, setProfileForm] = useState({ title: "", familyId: "", levelId: "", gradeId: "" });
  const [planForm, setPlanForm] = useState({ name: "", startDate: "", endDate: "", budget: "" });
  const [positionForm, setPositionForm] = useState({ code: "", jobProfileId: "", orgUnitId: "", supervisoryOrgUnitId: "", legalEntityId: "", costCenterId: "", planId: "", managerEmployeeId: "", employmentType: "Regular", plannedStartDate: "", annualBudget: "" });
  const [assignmentForm, setAssignmentForm] = useState({ positionId: "", employeeId: "", effectiveFrom: new Date().toISOString().slice(0, 10) });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/workforce-planning?organizationId=${organizationId}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return setNotice(payload.error ?? "Could not load workforce planning.");
      setProfiles(payload.profiles ?? []);
      setJobFamilies(payload.jobFamilies ?? []);
      setJobLevels(payload.jobLevels ?? []);
      setJobGrades(payload.jobGrades ?? []);
      setPlans(payload.plans ?? []);
      setPositions(payload.positions ?? []);
      setAssignments(payload.assignments ?? []);
      setOrgUnits(payload.orgUnits ?? []);
      setLegalEntities(payload.legalEntities ?? []);
      setCostCenters(payload.costCenters ?? []);
      setWorksites(payload.worksites ?? []);
      setShifts(payload.shifts ?? []);
      setEmployees(payload.employees ?? []);
      const scenarioResponse = await fetch(`/api/workforce-planning/scenarios?organizationId=${organizationId}`, { cache: "no-store" });
      const scenarioPayload = await scenarioResponse.json().catch(() => ({}));
      if (scenarioResponse.ok) {
        setScenarios(scenarioPayload.scenarios ?? []);
        setApprovalConfiguration(scenarioPayload.approvalConfiguration ?? { configured: false, conflict: false, policy: null });
        setCostVisible(scenarioPayload.costVisible !== false);
      }
      const baselineResponse = await fetch(`/api/workforce-planning/baselines?organizationId=${organizationId}`, { cache: "no-store" });
      const baselinePayload = await baselineResponse.json().catch(() => ({}));
      if (baselineResponse.ok) {
        setBaselines(baselinePayload.baselines ?? []);
        setCostVisible(baselinePayload.costVisible !== false);
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
  const legalEntityById = useMemo(() => new Map(legalEntities.map((entity) => [entity.id, entity])), [legalEntities]);
  const costCenterById = useMemo(() => new Map(costCenters.map((center) => [center.id, center])), [costCenters]);
  const supervisoryUnits = useMemo(() => orgUnits.filter((unit) => unit.active && unit.type === "supervisory"), [orgUnits]);
  const plannedCost = positions.filter((position) => position.status !== "closed").reduce((sum, position) => sum + Number(position.annualBudget), 0);
  const approvedOpen = positions.filter((position) => ["approved", "open"].includes(position.status)).length;
  const filled = positions.filter((position) => activeAssignmentByPosition.has(position.id)).length;
  const selectedHandoffWorksite = worksites.find((site) => site.id === Number(handoffForm.worksiteId)) ?? null;
  const authorizedHandoffPositions = positions.filter((position) =>
    position.planId === Number(handoffForm.planId)
    && position.jobProfileId === Number(handoffForm.jobProfileId)
    && selectedHandoffWorksite?.orgUnitId != null
    && position.orgUnitId === selectedHandoffWorksite.orgUnitId
    && ["approved", "open", "filled"].includes(position.status)
  );
  const handoffAuthorizedHeadcount = authorizedHandoffPositions.length;
  const currentBaselineByPlan = useMemo(() => new Map(baselines.filter((row) => row.current).map((row) => [row.planId, row])), [baselines]);

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
        annualAttritionPercent: String(Number(annualAttritionPercent) || 0),
        attritionBackfillPercent: String(Number(attritionBackfillPercent) || 0),
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
          annualAttritionPercent: Number(annualAttritionPercent) || 0,
          attritionBackfillPercent: Number(attritionBackfillPercent) || 0,
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

  async function scenarioAction(scenarioId: number, action: "submit") {
    const response = await fetch("/api/workforce-planning/scenarios", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenarioId, action }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(payload.error ?? "Could not submit staffing scenario.");
      return;
    }
    await load();
    const currentStep = payload.approvalProcess?.currentStep;
    setNotice(currentStep
      ? `Staffing scenario submitted to ${currentStep.label} (${currentStep.approver}).`
      : "Staffing scenario submitted for approval.");
  }

  async function publishBaseline(scenarioId: number) {
    setBaselinePublishing(scenarioId);
    try {
      const response = await fetch("/api/workforce-planning/baselines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(payload.error ?? "Could not publish the headcount baseline.");
        return;
      }
      await load();
      setNotice(`Published workforce-plan baseline v${payload.baseline?.version ?? ""}. Live headcount is now reconciled against this locked version.`);
    } catch {
      setNotice("Could not reach published headcount plan management.");
    } finally {
      setBaselinePublishing(null);
    }
  }

  async function createForecastRevision(baseline: WorkforcePlanBaseline) {
    setForecastPlanCreating(baseline.id);
    try {
      const response = await fetch("/api/workforce-planning/forecast-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          planId: baseline.planId,
          startDate: forecastStart,
          endDate: forecastEnd,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(payload.error ?? "Could not create a forecast revision from the published baseline.");
        return;
      }
      await load();
      setScenarioPlanId(String(baseline.planId));
      setNotice(
        `Created ${payload.scenario?.name ?? "forecast revision"} v${payload.scenario?.version ?? ""} from published baseline v${payload.seed?.baselineVersion ?? baseline.version} plus live workforce actuals. Review the draft, then submit it through Approvals.`,
      );
    } catch {
      setNotice("Could not reach workforce forecast-plan creation.");
    } finally {
      setForecastPlanCreating(null);
    }
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

  async function createFamily(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({ entityType: "job_family", ...familyForm });
      setFamilyForm({ code: "", name: "" });
      await load();
      setNotice("Job family created.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not create job family."); }
  }

  async function createLevel(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({ entityType: "job_level", ...levelForm, sequence: Number(levelForm.sequence) });
      setLevelForm({ code: "", name: "", sequence: "0" });
      await load();
      setNotice("Job level created.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not create job level."); }
  }

  async function createGrade(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({ entityType: "job_grade", ...gradeForm, sequence: Number(gradeForm.sequence) });
      setGradeForm({ code: "", name: "", sequence: "0" });
      await load();
      setNotice("Job grade created.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not create job grade."); }
  }

  async function createOrgUnit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({
        entityType: "org_unit",
        ...orgUnitForm,
        parentId: orgUnitForm.parentId ? Number(orgUnitForm.parentId) : null,
        legalEntityId: orgUnitForm.legalEntityId ? Number(orgUnitForm.legalEntityId) : null,
        costCenterId: orgUnitForm.costCenterId ? Number(orgUnitForm.costCenterId) : null,
        managerEmployeeId: orgUnitForm.managerEmployeeId ? Number(orgUnitForm.managerEmployeeId) : null,
      });
      setOrgUnitForm({ code: "", name: "", type: "department", parentId: "", legalEntityId: "", costCenterId: "", managerEmployeeId: "", effectiveFrom: "" });
      await load();
      setNotice("Organization unit created.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not create organization unit."); }
  }

  async function createProfile(event: React.FormEvent) {
    event.preventDefault();
    try {
      await post({
        entityType: "profile",
        title: profileForm.title,
        familyId: Number(profileForm.familyId),
        levelId: Number(profileForm.levelId),
        gradeId: profileForm.gradeId ? Number(profileForm.gradeId) : null,
      });
      setShowProfile(false);
      setProfileForm({ title: "", familyId: "", levelId: "", gradeId: "" });
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
        supervisoryOrgUnitId: positionForm.supervisoryOrgUnitId ? Number(positionForm.supervisoryOrgUnitId) : null,
        legalEntityId: positionForm.legalEntityId ? Number(positionForm.legalEntityId) : null,
        costCenterId: positionForm.costCenterId ? Number(positionForm.costCenterId) : null,
        planId: positionForm.planId ? Number(positionForm.planId) : null,
        managerEmployeeId: positionForm.managerEmployeeId ? Number(positionForm.managerEmployeeId) : null,
        annualBudget: Number(positionForm.annualBudget),
      });
      setShowPosition(false);
      setPositionForm({ code: "", jobProfileId: "", orgUnitId: "", supervisoryOrgUnitId: "", legalEntityId: "", costCenterId: "", planId: "", managerEmployeeId: "", employmentType: "Regular", plannedStartDate: "", annualBudget: "" });
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

  async function handoffPlanDemand(event: React.FormEvent) {
    event.preventDefault();
    if (!handoffForm.planId || !handoffForm.jobProfileId || !handoffForm.worksiteId || !handoffForm.shiftDefinitionId) {
      setNotice("Choose a workforce plan, job profile, worksite, and shift.");
      return;
    }
    setHandoffSaving(true);
    try {
      const response = await fetch("/api/workforce-planning/demand-handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          planId: Number(handoffForm.planId),
          jobProfileId: Number(handoffForm.jobProfileId),
          worksiteId: Number(handoffForm.worksiteId),
          shiftDefinitionId: Number(handoffForm.shiftDefinitionId),
          requiredHeadcount: Number(handoffForm.requiredHeadcount),
          startDate: handoffForm.startDate,
          endDate: handoffForm.endDate,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(payload.error ?? "Could not hand approved headcount into WFM demand.");
        return;
      }
      setNotice(`${payload.requirements?.length ?? 0} WFM staffing requirement(s) now carry authoritative workforce-plan evidence.`);
      onPage("Coverage");
    } catch {
      setNotice("Could not reach the workforce-plan demand handoff service.");
    } finally {
      setHandoffSaving(false);
    }
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
          <div className="eyebrow">HCM STRUCTURE &amp; WORKFORCE PLANNING</div>
          <h1>Workforce planning</h1>
          <p>Keep one governed model for organization hierarchy, job architecture, positions, budgets, supervisory ownership, and effective-dated incumbents.</p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} /> Refresh</button>
          <button className="secondary-button" onClick={() => setShowArchitecture(!showArchitecture)}><Building2 size={15} /> Architecture</button>
          <button className="secondary-button" onClick={() => setShowProfile(!showProfile)} disabled={!jobFamilies.length || !jobLevels.length}><BriefcaseBusiness size={15} /> Job profile</button>
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
            <div className="card-kicker">HCM → WFM DEMAND HANDOFF</div>
            <h2>Turn approved headcount into operational staffing demand.</h2>
            <p>Positions authorize the role and headcount. You explicitly choose the worksite, shift, and dates; Linaw does not guess operational demand from HCM records.</p>
          </div>
        </div>
        <form className="setting-form" onSubmit={handoffPlanDemand}>
          <label>Workforce plan
            <select value={handoffForm.planId} onChange={(e) => setHandoffForm({ ...handoffForm, planId: e.target.value })} required>
              <option value="">Choose active plan…</option>
              {plans.filter((plan) => ["active", "approved", "published"].includes(plan.status)).map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {plan.startDate}–{plan.endDate}</option>)}
            </select>
          </label>
          <label>Job profile
            <select value={handoffForm.jobProfileId} onChange={(e) => setHandoffForm({ ...handoffForm, jobProfileId: e.target.value })} required>
              <option value="">Choose role…</option>
              {profiles.filter((profile) => profile.active).map((profile) => <option key={profile.id} value={profile.id}>{profile.title} · {profile.level}</option>)}
            </select>
          </label>
          <label>Worksite
            <select value={handoffForm.worksiteId} onChange={(e) => setHandoffForm({ ...handoffForm, worksiteId: e.target.value })} required>
              <option value="">Choose site…</option>
              {worksites.filter((site) => site.active && site.orgUnitId != null).map((site) => <option key={site.id} value={site.id}>{site.code} · {site.name}</option>)}
            </select>
          </label>
          <label>Shift
            <select value={handoffForm.shiftDefinitionId} onChange={(e) => setHandoffForm({ ...handoffForm, shiftDefinitionId: e.target.value })} required>
              <option value="">Choose shift…</option>
              {shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.code} · {shift.name} · {shift.startTime}–{shift.endTime}</option>)}
            </select>
          </label>
          <label>Demand start<input type="date" value={handoffForm.startDate} onChange={(e) => setHandoffForm({ ...handoffForm, startDate: e.target.value })} required /></label>
          <label>Demand end<input type="date" min={handoffForm.startDate} value={handoffForm.endDate} onChange={(e) => setHandoffForm({ ...handoffForm, endDate: e.target.value })} required /></label>
          <label>Required headcount
            <input type="number" min="1" max={handoffAuthorizedHeadcount || undefined} value={handoffForm.requiredHeadcount} onChange={(e) => setHandoffForm({ ...handoffForm, requiredHeadcount: e.target.value })} required />
          </label>
          <div style={{ display: "flex", alignItems: "end" }}>
            <button className="primary-button" type="submit" disabled={handoffSaving || handoffAuthorizedHeadcount < 1}>
              <UsersRound size={15} /> {handoffSaving ? "Handing off…" : "Create WFM demand"}
            </button>
          </div>
        </form>
        <div className={handoffForm.planId && handoffForm.jobProfileId && handoffForm.worksiteId && handoffAuthorizedHeadcount < 1 ? "notice notice-amber" : "notice notice-slate"} style={{ marginTop: 14 }}>
          <Building2 size={15} />
          <span>
            <strong>Authorized headcount: {handoffAuthorizedHeadcount}.</strong> Only approved, open, or filled positions in the selected plan, role, and worksite organization unit count toward this ceiling. The handoff is limited to 14 days at a time and preserves the source plan and position IDs on every WFM requirement.
          </span>
        </div>
      </article>

      <article className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">DEMAND & LABOR-COST FORECAST</div>
            <h2>Model workforce demand before adding headcount.</h2>
            <p>Combine current payroll run-rate, PayrollPH employer statutory costs, active employer-paid benefits, recurring compensation, approved vacancies, staffing requirements, attrition assumptions, governed backfill, and cost-center allocations. Assumptions never change employment, payroll, or position records.</p>
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
          <label>Additional scenario load %<input type="number" min="0" max="100" step="0.5" value={employerLoadPercent} onChange={(e) => setEmployerLoadPercent(e.target.value)} /></label>
          <label>Annual attrition %<input type="number" min="0" max="100" step="0.5" value={annualAttritionPercent} onChange={(e) => setAnnualAttritionPercent(e.target.value)} /></label>
          <label>Attrition backfill %<input type="number" min="0" max="100" step="1" value={attritionBackfillPercent} onChange={(e) => setAttritionBackfillPercent(e.target.value)} /></label>
          <label>Organization unit<select value={forecastOrgUnitId} onChange={(e) => { setForecastOrgUnitId(e.target.value); setForecastWorksiteId(""); }}><option value="">All visible units</option>{orgUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
          <label>Worksite<select value={forecastWorksiteId} onChange={(e) => setForecastWorksiteId(e.target.value)}><option value="">All visible worksites</option>{worksites.filter((site) => !forecastOrgUnitId || site.orgUnitId === Number(forecastOrgUnitId)).map((site) => <option key={site.id} value={site.id}>{site.code} · {site.name}</option>)}</select></label>
        </div>

        <div className="setting-form" style={{ marginBottom: 16 }}>
          <label>Scenario name<input value={scenarioName} onChange={(e) => setScenarioName(e.target.value)} placeholder="Q1 Peak staffing" /></label>
          <label>Link to workforce plan<select value={scenarioPlanId} onChange={(e) => setScenarioPlanId(e.target.value)}><option value="">No linked plan</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {plan.status}</option>)}</select></label>
          <div className={approvalConfiguration.configured ? "notice notice-slate" : "notice notice-amber"} style={{ margin: 0 }}>
            <span>
              {approvalConfiguration.configured && approvalConfiguration.policy
                ? `Approval: ${approvalConfiguration.policy.name} v${approvalConfiguration.policy.version}`
                : approvalConfiguration.conflict
                  ? "Approval routing conflict: keep exactly one Workforce planning policy active."
                  : "Approval routing not configured. Create a Workforce planning chain in Automation before submitting."}
            </span>
          </div>
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
              <article className="stat-card"><div className="stat-icon mint"><CircleDollarSign size={19} /></div><p>{costVisible ? "PERIOD LABOR COST" : "PROJECTED CAPACITY"}</p><h3>{costVisible ? peso(forecast.summary.forecastPeriodLaborCost) : `${forecast.summary.projectedCapacityHours.toLocaleString("en-PH", { maximumFractionDigits: 0 })} hrs`}</h3><span>{costVisible ? `${forecast.assumptions.windowDays} days · PayrollPH costs + ${forecast.assumptions.employerLoadPercent}% extra scenario load` : `${forecast.summary.capacityCoveragePercent.toFixed(1)}% demand coverage`}</span></article>
            </section>
            {costVisible && (
              <section className="stats-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 16 }}>
                <article className="stat-card"><p>STATUTORY EMPLOYER COST</p><h3>{peso(forecast.summary.currentPeriodStatutoryEmployerCost)}</h3><span>SSS/EC + PhilHealth + Pag-IBIG from payroll formulas</span></article>
                <article className="stat-card"><p>EMPLOYER-PAID BENEFITS</p><h3>{peso(forecast.summary.currentPeriodBenefitEmployerCost)}</h3><span>active benefit enrollment plan shares</span></article>
                <article className="stat-card"><p>RECURRING COMPENSATION</p><h3>{peso(forecast.summary.currentPeriodRecurringCompensationCost)}</h3><span>active monthly / per-cutoff components</span></article>
                <article className="stat-card"><p>EXTRA SCENARIO LOAD</p><h3>{peso(forecast.summary.additionalScenarioLoadCost)}</h3><span>{forecast.assumptions.employerLoadPercent}% optional planning overlay</span></article>
              </section>
            )}

            <section className="stats-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 16 }}>
              <article className="stat-card"><p>EXPECTED ATTRITION</p><h3>{forecast.summary.expectedAttritionExits}</h3><span>{forecast.assumptions.annualAttritionPercent}% annual assumption · {forecast.assumptions.windowAttritionPercent}% modeled in window</span></article>
              <article className="stat-card"><p>PLANNED BACKFILLS</p><h3>{forecast.summary.plannedAttritionBackfills}</h3><span>{forecast.assumptions.attritionBackfillPercent}% of expected exits</span></article>
              <article className="stat-card"><p>ENDING ACTIVE HC</p><h3>{forecast.summary.endingActiveHeadcount}</h3><span>{forecast.summary.projectedHeadcountAfterVacancyFills} including expected vacancy fills</span></article>
              <article className="stat-card"><p>{costVisible ? "BACKFILL RUN-RATE" : "BACKFILL CAPACITY"}</p><h3>{costVisible ? peso(forecast.summary.annualBackfillRunRateCost) : forecast.summary.plannedBackfillCapacityHours.toLocaleString("en-PH", { maximumFractionDigits: 0 }) + " hrs"}</h3><span>{costVisible ? "same-role annual loaded-cost planning estimate" : "modeled capacity recovered during the forecast window"}</span></article>
            </section>

            <div className="notice notice-slate" style={{ marginBottom: 16 }}>
              <UserPlus size={15} />
              <span><strong>Governed backfill boundary.</strong> Expected exits and backfills are scenario assumptions only. Saving freezes them into the scenario hash; submission routes them through the existing Workforce planning approval chain. They do not terminate employees, open positions, create requisitions, or change payroll.</span>
            </div>

            <div className="data-table-wrap" style={{ marginBottom: 16 }}>
              <table className="data-table">
                <thead><tr><th>BACKFILL ROLE</th><th>ACTIVE</th><th>EXPECTED EXITS</th><th>PLANNED BACKFILLS</th><th>ENDING HC</th><th className="right">{costVisible ? "ANNUAL BACKFILL RUN-RATE" : "COST"}</th></tr></thead>
                <tbody>
                  {forecast.backfillPlan.map((row) => (
                    <tr key={row.jobProfileId ?? "unresolved-backfill"}>
                      <td><strong>{row.title}</strong><small style={{ display: "block", color: "var(--muted)" }}>{row.family} · {row.level}</small></td>
                      <td>{row.activeHeadcount}</td>
                      <td>{row.expectedAttritionExits}</td>
                      <td>{row.plannedBackfills}</td>
                      <td>{row.endingHeadcount}</td>
                      <td className="right">{costVisible ? peso(row.annualBackfillRunRateCost) : "Restricted"}</td>
                    </tr>
                  ))}
                  {forecast.backfillPlan.length === 0 && <tr><td colSpan={6}><div className="empty-state">No active workforce in this scenario scope to model for attrition.</div></td></tr>}
                </tbody>
              </table>
            </div>
            <div className={forecast.summary.capacityGapAfterFills > 0 ? "notice notice-amber" : "notice notice-slate"} style={{ marginBottom: 16 }}>
              <UsersRound size={15} />
              <span><strong>{forecast.summary.capacityGapAfterFills > 0 ? "Capacity gap" : "Capacity covered"}:</strong> demand {forecast.summary.forecastHeadcountHours.toLocaleString("en-PH", { maximumFractionDigits: 0 })} hrs vs projected capacity {forecast.summary.projectedCapacityHours.toLocaleString("en-PH", { maximumFractionDigits: 0 })} hrs after expected fills. Gap after fills: {forecast.summary.capacityGapAfterFills.toLocaleString("en-PH", { maximumFractionDigits: 0 })} hrs.</span>
            </div>

            <div className="data-table-wrap" style={{ marginBottom: 16 }}>
              <table className="data-table">
                <thead><tr><th>JOB PROFILE</th><th>DEMAND</th><th>CURRENT CAPACITY</th><th>EXPECTED FILLS</th><th>PROJECTED CAPACITY</th><th>GAP</th></tr></thead>
                <tbody>
                  {forecast.roleDemand.map((role) => (
                    <tr key={role.jobProfileId ?? "any"}>
                      <td><strong>{role.title}</strong><small style={{ display: "block", color: "var(--muted)" }}>{role.family} · {role.level}</small></td>
                      <td><strong>{role.forecastHours.toLocaleString("en-PH", { maximumFractionDigits: 0 })} hrs</strong><small style={{ display: "block", color: "var(--muted)" }}>{role.requiredHours.toLocaleString("en-PH", { maximumFractionDigits: 0 })} baseline</small></td>
                      <td><strong>{role.currentCapacityHours.toLocaleString("en-PH", { maximumFractionDigits: 0 })} hrs</strong><small style={{ display: "block", color: "var(--muted)" }}>{role.activeHeadcount} active</small></td>
                      <td><strong>{role.expectedVacancyFills}</strong><small style={{ display: "block", color: "var(--muted)" }}>{role.vacantPositions} vacant positions</small></td>
                      <td><strong>{role.projectedCapacityHours.toLocaleString("en-PH", { maximumFractionDigits: 0 })} hrs</strong><small style={{ display: "block", color: "var(--muted)" }}>{role.coveragePercent.toFixed(1)}% coverage</small></td>
                      <td><span className={role.capacityGapHours > 0 ? "status status-pending" : "status status-verified"}>{role.capacityGapHours.toLocaleString("en-PH", { maximumFractionDigits: 0 })} hrs</span></td>
                    </tr>
                  ))}
                  {forecast.roleDemand.length === 0 && <tr><td colSpan={6}><div className="empty-state">No staffing demand rows in this scenario window.</div></td></tr>}
                </tbody>
              </table>
            </div>

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
                  <strong>{peso(forecast.summary.estimatedShiftDemandWageCost)} shift-demand estimate.</strong> This uses recorded staffing requirements, paid shift hours, average base hourly rate, source-grounded employer cost ratios, growth, and any optional scenario overlay. It is not added to the labor plan again.
                </span>
              </div>
            </div>

            {(forecast.quality.missingPayProfileEmployeeIds.length > 0 || forecast.quality.invalidPayProfileEmployeeIds.length > 0 || forecast.quality.allocationIssueEmployeeIds.length > 0 || forecast.quality.requirementsMissingShift > 0 || forecast.quality.roleEvidenceIssues.length > 0 || forecast.quality.recurringCompensationIssues.length > 0) && (
              <div className="notice notice-amber" style={{ marginTop: 16 }}>
                <CircleDollarSign size={15} />
                <span>
                  <strong>Forecast quality needs review.</strong> Missing pay profiles: {forecast.quality.missingPayProfileEmployeeIds.length}; invalid pay profiles: {forecast.quality.invalidPayProfileEmployeeIds.length}; allocation issues: {forecast.quality.allocationIssueEmployeeIds.length}; staffing rows missing a valid shift: {forecast.quality.requirementsMissingShift}; ambiguous role evidence: {forecast.quality.roleEvidenceIssues.length}; recurring compensation issues: {forecast.quality.recurringCompensationIssues.length}.
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
                <strong>Planning boundary.</strong> Existing-worker statutory employer cost uses the same SSS/EC, PhilHealth, and Pag-IBIG formulas as payroll, plus active employer-paid benefit shares and recurring compensation at the forecast start date. The additional load percentage is scenario-only. Vacancy statutory cost is estimated from the position salary budget; vacancy benefit cost remains unknown until coverage is assigned. Current unallocated base cost: {peso(forecast.unallocated.currentPeriodBaseCost)}.
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
            <p>Drafts enter the configured HCM business process. Approval steps are routed by incremental annual labor cost, use the shared Approvals inbox, and preserve maker-checker separation.</p>
          </div>
        </div>
        {!approvalConfiguration.configured && (
          <div className="notice notice-amber" style={{ marginBottom: 12 }}>
            <span>
              {approvalConfiguration.conflict
                ? "Multiple Workforce planning approval policies are active. Resolve the conflict in Automation before submitting a plan."
                : "No Workforce planning approval policy is active. Use the Workforce plan template in Automation > Approval routing."}
            </span>
            <button className="secondary-button" type="button" onClick={() => onPage("Automation")}>Configure routing</button>
          </div>
        )}
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
                    <td>
                      <span className={scenario.status === "approved" ? "status status-verified" : scenario.status === "rejected" ? "status status-rejected" : "status"}>{scenario.status}</span>
                      {scenario.status === "submitted" && scenario.approvalProcess?.currentStep && (
                        <small style={{ display: "block", color: "var(--muted)", marginTop: 4 }}>
                          {scenario.approvalProcess.currentStep.label} · {scenario.approvalProcess.currentStep.approver}
                          {scenario.approvalProcess.amount != null ? ` · ${peso(scenario.approvalProcess.amount)} incremental annual cost` : ""}
                        </small>
                      )}
                    </td>
                    <td className="right">
                      <div className="run-actions" style={{ justifyContent: "flex-end" }}>
                        {scenario.status === "draft" && (
                          <button
                            className="secondary-button"
                            disabled={!approvalConfiguration.configured || !scenario.planId}
                            onClick={() => void scenarioAction(scenario.id, "submit")}
                          >
                            Submit
                          </button>
                        )}
                        {scenario.status === "submitted" && <button className="secondary-button" onClick={() => onPage("Approvals")}><CheckCircle2 size={14} /> Open approvals</button>}
                        {scenario.status === "approved" && (() => {
                          const currentBaseline = scenario.planId ? currentBaselineByPlan.get(scenario.planId) : null;
                          if (currentBaseline?.scenarioId === scenario.id) {
                            return <span className="status status-verified"><CheckCircle2 size={13} /> Current baseline</span>;
                          }
                          if (!scenario.planId) {
                            return <span className="status">Link plan to publish</span>;
                          }
                          if (scenario.scopeOrgUnitId != null || scenario.worksiteId != null) {
                            return <span className="status">What-if only</span>;
                          }
                          return (
                            <button
                              className="primary-button"
                              disabled={baselinePublishing === scenario.id}
                              onClick={() => void publishBaseline(scenario.id)}
                            >
                              <CheckCircle2 size={14} /> {baselinePublishing === scenario.id ? "Publishing..." : currentBaseline ? "Publish new baseline" : "Publish baseline"}
                            </button>
                          );
                        })()}
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

      <article className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">PUBLISHED HEADCOUNT PLAN</div>
            <h2>Baseline vs live workforce</h2>
            <p>Approved company-wide scenarios become immutable planning baselines. Live positions and assignments remain operational records and are reconciled here without rewriting the approved evidence.</p>
          </div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>PLAN VERSION</th><th>APPROVED BASELINE</th><th>LIVE ACTUAL</th><th>VARIANCE</th><th className="right">POSITION BUDGET</th></tr></thead>
            <tbody>
              {baselines.map((baseline) => {
                const locked = baseline.snapshot?.headcount;
                const delta = baseline.variance;
                return (
                  <tr key={baseline.id}>
                    <td>
                      <strong>{baseline.snapshot?.plan?.name ?? `Plan #${baseline.planId}`} · v{baseline.version}</strong>
                      <small style={{ display: "block", color: "var(--muted)" }}>
                        Published by {baseline.publishedBy} · {new Date(baseline.publishedAt).toLocaleDateString("en-PH")} · {baseline.snapshotHash.slice(0, 10)}
                      </small>
                    </td>
                    <td>
                      {locked
                        ? <><strong>{locked.requestedHeadcount} requested · {locked.approvedHeadcount} approved · {locked.filledHeadcount} filled</strong><small style={{ display: "block", color: "var(--muted)" }}>{locked.filledFte.toFixed(2)} filled FTE</small></>
                        : "Baseline evidence unavailable"}
                    </td>
                    <td>
                      <strong>{baseline.actual.requestedHeadcount} requested · {baseline.actual.approvedHeadcount} approved · {baseline.actual.filledHeadcount} filled</strong>
                      <small style={{ display: "block", color: "var(--muted)" }}>{baseline.actual.filledFte.toFixed(2)} filled FTE · {baseline.actual.vacantApprovedHeadcount} authorized vacancy</small>
                    </td>
                    <td>
                      {delta
                        ? <><strong>{delta.filledHeadcount >= 0 ? "+" : ""}{delta.filledHeadcount} filled</strong><small style={{ display: "block", color: "var(--muted)" }}>{delta.requestedHeadcount >= 0 ? "+" : ""}{delta.requestedHeadcount} requested · {delta.approvedHeadcount >= 0 ? "+" : ""}{delta.approvedHeadcount} approved · {delta.filledFte >= 0 ? "+" : ""}{delta.filledFte.toFixed(2)} FTE</small></>
                        : "—"}
                    </td>
                    <td className="right">
                      <strong>{peso(baseline.actual.annualPositionBudget)}</strong>
                      <small style={{ display: "block", color: "var(--muted)", marginBottom: 8 }}>
                        {delta?.annualPositionBudget == null ? "cost restricted" : `${delta.annualPositionBudget >= 0 ? "+" : ""}${peso(delta.annualPositionBudget)} vs baseline`}
                      </small>
                      {baseline.current && (
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={forecastPlanCreating === baseline.id}
                          onClick={() => void createForecastRevision(baseline)}
                        >
                          <RefreshCw size={14} /> {forecastPlanCreating === baseline.id ? "Creating..." : "Start forecast revision"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {baselines.length === 0 && <tr><td colSpan={5}><div className="empty-state">No published headcount baseline yet. Approve a company-wide scenario linked to a workforce plan, then publish it here.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </article>

      <article className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">PLAN VS ACTUAL DRILLDOWN</div>
            <h2>Budget variance by org unit &amp; cost center</h2>
            <p>
              Reconcile the immutable published position budget against the live position ledger by operating dimension.
              Headcount and FTE remain visible within workforce scope; salary-sensitive budget values stay restricted to payroll-cost roles.
            </p>
          </div>
        </div>

        {!costVisible && baselines.length > 0 && (
          <div className="notice notice-slate" style={{ marginBottom: 16 }}>
            <CircleDollarSign size={15} />
            <span>Budget amounts are restricted for your role. Dimension-level headcount and FTE variance remains visible.</span>
          </div>
        )}

        {baselines.map((baseline) => {
          const dimensions = baseline.dimensionVariance;
          const planName = baseline.snapshot?.plan?.name ?? `Plan #${baseline.planId}`;
          const renderDimensionTable = (
            label: string,
            rows: HeadcountPlanDimensionVarianceView[],
          ) => (
            <div>
              <div className="card-kicker" style={{ marginBottom: 8 }}>{label}</div>
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>DIMENSION</th>
                      <th>BASELINE</th>
                      <th>LIVE</th>
                      <th>VARIANCE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={`${label}-${row.key ?? "unassigned"}`}>
                        <td>
                          <strong>{row.name}</strong>
                          <small style={{ display: "block", color: "var(--muted)" }}>{row.code ?? "Unassigned"}</small>
                        </td>
                        <td>
                          <strong>{row.baseline.requestedHeadcount} HC · {row.baseline.filledFte.toFixed(2)} filled FTE</strong>
                          <small style={{ display: "block", color: "var(--muted)" }}>
                            {costVisible ? `${peso(row.baseline.annualPositionBudget)} position budget` : "Budget restricted"}
                          </small>
                        </td>
                        <td>
                          <strong>{row.actual.requestedHeadcount} HC · {row.actual.filledFte.toFixed(2)} filled FTE</strong>
                          <small style={{ display: "block", color: "var(--muted)" }}>
                            {costVisible ? `${peso(row.actual.annualPositionBudget)} position budget` : "Budget restricted"}
                          </small>
                        </td>
                        <td>
                          <strong>{signedNumber(row.variance.requestedHeadcount)} HC · {signedNumber(row.variance.filledFte, 2)} filled FTE</strong>
                          <small style={{ display: "block", color: "var(--muted)" }}>
                            {costVisible ? `${signedPeso(row.variance.annualPositionBudget)} budget` : "Budget restricted"}
                          </small>
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr><td colSpan={4}><div className="empty-state">No dimensional position evidence for this published baseline.</div></td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          );

          return (
            <section key={`variance-${baseline.id}`} style={{ marginBottom: 18 }}>
              <div className="notice notice-slate" style={{ marginBottom: 12 }}>
                <span>
                  <strong>{planName} · v{baseline.version}</strong> · live reconciliation as of the current workforce ledger
                </span>
              </div>
              {dimensions ? (
                <div className="module-grid two">
                  {renderDimensionTable("ORGANIZATION UNIT", dimensions.orgUnits)}
                  {renderDimensionTable("COST CENTER", dimensions.costCenters)}
                </div>
              ) : (
                <div className="empty-state">Published baseline dimension evidence is unavailable.</div>
              )}
            </section>
          );
        })}

        {baselines.length === 0 && (
          <div className="empty-state">Publish a workforce-plan baseline to unlock dimension-level budget variance.</div>
        )}
      </article>

      <WorkforcePlanAllocationPanel
        organizationId={organizationId}
        plans={plans}
        orgUnits={orgUnits}
        setNotice={setNotice}
      />

      {showArchitecture && (
        <article className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div className="card-header">
            <div>
              <div className="card-kicker">HCM CORE 2.1</div>
              <h2>Organization &amp; job architecture</h2>
              <p>Define reusable dimensions first. Profiles and positions then reference governed records instead of inventing free-text structure.</p>
            </div>
          </div>

          <div className="module-grid two" style={{ marginBottom: 16 }}>
            <form onSubmit={createFamily} className="card" style={{ padding: 14, boxShadow: "none" }}>
              <div className="card-kicker">JOB FAMILY</div>
              <div className="setting-form">
                <label>Code<input required value={familyForm.code} onChange={(e) => setFamilyForm({ ...familyForm, code: e.target.value })} placeholder="FINOPS" /></label>
                <label>Name<input required value={familyForm.name} onChange={(e) => setFamilyForm({ ...familyForm, name: e.target.value })} placeholder="Finance Operations" /></label>
              </div>
              <div className="run-actions"><button className="primary-button"><Plus size={14} /> Add family</button></div>
            </form>

            <form onSubmit={createLevel} className="card" style={{ padding: 14, boxShadow: "none" }}>
              <div className="card-kicker">JOB LEVEL</div>
              <div className="setting-form">
                <label>Code<input required value={levelForm.code} onChange={(e) => setLevelForm({ ...levelForm, code: e.target.value })} placeholder="M2" /></label>
                <label>Name<input required value={levelForm.name} onChange={(e) => setLevelForm({ ...levelForm, name: e.target.value })} placeholder="Manager II" /></label>
                <label>Sequence<input required type="number" min="0" value={levelForm.sequence} onChange={(e) => setLevelForm({ ...levelForm, sequence: e.target.value })} /></label>
              </div>
              <div className="run-actions"><button className="primary-button"><Plus size={14} /> Add level</button></div>
            </form>

            <form onSubmit={createGrade} className="card" style={{ padding: 14, boxShadow: "none" }}>
              <div className="card-kicker">JOB GRADE</div>
              <div className="setting-form">
                <label>Code<input required value={gradeForm.code} onChange={(e) => setGradeForm({ ...gradeForm, code: e.target.value })} placeholder="G08" /></label>
                <label>Name<input required value={gradeForm.name} onChange={(e) => setGradeForm({ ...gradeForm, name: e.target.value })} placeholder="Grade 8" /></label>
                <label>Sequence<input required type="number" min="0" value={gradeForm.sequence} onChange={(e) => setGradeForm({ ...gradeForm, sequence: e.target.value })} /></label>
              </div>
              <div className="run-actions"><button className="primary-button"><Plus size={14} /> Add grade</button></div>
            </form>

            <form onSubmit={createOrgUnit} className="card" style={{ padding: 14, boxShadow: "none" }}>
              <div className="card-kicker">ORGANIZATION UNIT</div>
              <div className="setting-form">
                <label>Code<input required value={orgUnitForm.code} onChange={(e) => setOrgUnitForm({ ...orgUnitForm, code: e.target.value })} placeholder="MNL-SALES" /></label>
                <label>Name<input required value={orgUnitForm.name} onChange={(e) => setOrgUnitForm({ ...orgUnitForm, name: e.target.value })} placeholder="Manila Sales" /></label>
                <label>Type<select value={orgUnitForm.type} onChange={(e) => setOrgUnitForm({ ...orgUnitForm, type: e.target.value })}><option value="company">Company</option><option value="business_unit">Business unit</option><option value="division">Division</option><option value="department">Department</option><option value="team">Team</option><option value="supervisory">Supervisory organization</option></select></label>
                <label>Parent<select value={orgUnitForm.parentId} onChange={(e) => setOrgUnitForm({ ...orgUnitForm, parentId: e.target.value })}><option value="">Root / none</option>{orgUnits.filter((unit) => unit.active).map((unit) => <option key={unit.id} value={unit.id}>{unit.code} · {unit.name}</option>)}</select></label>
                <label>Legal employer<select value={orgUnitForm.legalEntityId} onChange={(e) => setOrgUnitForm({ ...orgUnitForm, legalEntityId: e.target.value })}><option value="">Inherit / unassigned</option>{legalEntities.filter((entity) => entity.active).map((entity) => <option key={entity.id} value={entity.id}>{entity.code} · {entity.displayName}</option>)}</select></label>
                <label>Cost center<select value={orgUnitForm.costCenterId} onChange={(e) => setOrgUnitForm({ ...orgUnitForm, costCenterId: e.target.value })}><option value="">Unassigned</option>{costCenters.filter((center) => center.active).map((center) => <option key={center.id} value={center.id}>{center.code} · {center.name}</option>)}</select></label>
                <label>Manager<select value={orgUnitForm.managerEmployeeId} onChange={(e) => setOrgUnitForm({ ...orgUnitForm, managerEmployeeId: e.target.value })}><option value="">No manager</option>{employees.filter((employee) => employee.status === "Active").map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</select></label>
                <label>Effective from<input type="date" value={orgUnitForm.effectiveFrom} onChange={(e) => setOrgUnitForm({ ...orgUnitForm, effectiveFrom: e.target.value })} /></label>
              </div>
              <div className="run-actions"><button className="primary-button"><Plus size={14} /> Add org unit</button></div>
            </form>
          </div>

          <div className="notice notice-slate">
            <Building2 size={15} />
            <span><strong>Modeling rule.</strong> Departments/divisions describe the organization hierarchy. Supervisory organizations represent manager-led reporting groups. Positions may reference both, plus one legal employer and cost center.</span>
          </div>
        </article>
      )}

      {showProfile && (
        <article className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div className="card-header"><div><div className="card-kicker">JOB ARCHITECTURE</div><h2>Create a reusable job profile</h2></div></div>
          <form onSubmit={createProfile}>
            <div className="setting-form">
              <label>Title<input required value={profileForm.title} onChange={(e) => setProfileForm({ ...profileForm, title: e.target.value })} placeholder="Payroll Operations Manager" /></label>
              <label>Family<select required value={profileForm.familyId} onChange={(e) => setProfileForm({ ...profileForm, familyId: e.target.value })}><option value="">Select family</option>{jobFamilies.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
              <label>Level<select required value={profileForm.levelId} onChange={(e) => setProfileForm({ ...profileForm, levelId: e.target.value })}><option value="">Select level</option>{jobLevels.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
              <label>Grade<select value={profileForm.gradeId} onChange={(e) => setProfileForm({ ...profileForm, gradeId: e.target.value })}><option value="">No grade</option>{jobGrades.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
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
              <label>Org unit<select value={positionForm.orgUnitId} onChange={(e) => setPositionForm({ ...positionForm, orgUnitId: e.target.value })}><option value="">Company-wide / unassigned</option>{orgUnits.filter((unit) => unit.active && unit.type !== "supervisory").map((unit) => <option key={unit.id} value={unit.id}>{unit.code} · {unit.name}</option>)}</select></label>
              <label>Supervisory org<select value={positionForm.supervisoryOrgUnitId} onChange={(e) => setPositionForm({ ...positionForm, supervisoryOrgUnitId: e.target.value })}><option value="">No supervisory org</option>{supervisoryUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.code} · {unit.name}</option>)}</select></label>
              <label>Legal employer<select value={positionForm.legalEntityId} onChange={(e) => setPositionForm({ ...positionForm, legalEntityId: e.target.value })}><option value="">Unassigned</option>{legalEntities.filter((entity) => entity.active).map((entity) => <option key={entity.id} value={entity.id}>{entity.code} · {entity.displayName}</option>)}</select></label>
              <label>Cost center<select value={positionForm.costCenterId} onChange={(e) => setPositionForm({ ...positionForm, costCenterId: e.target.value })}><option value="">Unassigned</option>{costCenters.filter((center) => center.active).map((center) => <option key={center.id} value={center.id}>{center.code} · {center.name}</option>)}</select></label>
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
                    : position.status === "reserved"
                      ? ["reserved"]
                      : position.status === "open"
                        ? ["open", "frozen", "closed"]
                        : ["planned", "approved", "frozen", "closed"];
                return (
                  <tr key={position.id}>
                    <td><strong>{position.code}</strong><small style={{ display: "block", color: "var(--muted)" }}>{position.employmentType}</small></td>
                    <td>
                      <strong>{profile?.title ?? "Job profile"}</strong>
                      <small style={{ display: "block", color: "var(--muted)" }}>
                        {position.orgUnitId ? unitById.get(position.orgUnitId)?.name ?? "Unit" : "Unassigned unit"}
                        {position.supervisoryOrgUnitId ? ` · Sup: ${unitById.get(position.supervisoryOrgUnitId)?.name ?? "Supervisory org"}` : ""}
                      </small>
                      <small style={{ display: "block", color: "var(--muted)" }}>
                        {position.legalEntityId ? legalEntityById.get(position.legalEntityId)?.displayName ?? "Legal employer" : "No legal employer"}
                        {" · "}
                        {position.costCenterId ? costCenterById.get(position.costCenterId)?.code ?? "Cost center" : "No cost center"}
                      </small>
                    </td>
                    <td>{incumbent ? <><strong>{incumbent.firstName} {incumbent.lastName}</strong><small style={{ display: "block", color: "var(--muted)" }}>{assignment?.effectiveFrom}</small></> : <span style={{ color: "var(--muted)" }}>Vacant</span>}</td>
                    <td>{position.plannedStartDate ?? "—"}</td>
                    <td className="right">{peso(position.annualBudget)}</td>
                    <td>
                      <select value={position.status} onChange={(e) => void updateStatus(position, e.target.value)} disabled={position.status === "filled" || position.status === "reserved"}>
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
                        <span style={{ color: "var(--muted)", fontSize: 11 }}>{position.status === "planned" ? "Approve first" : position.status === "reserved" ? "Reserved for scheduled HCM change" : "—"}</span>
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
          <div className="card-header"><div><div className="card-kicker">JOB ARCHITECTURE</div><h2>Families, levels, grades &amp; profiles</h2></div></div>
          <div className="notice notice-slate" style={{ margin: "0 0 10px" }}>
            <span><strong>{jobFamilies.length}</strong> families · <strong>{jobLevels.length}</strong> levels · <strong>{jobGrades.length}</strong> grades · <strong>{profiles.length}</strong> profiles</span>
          </div>
          {profiles.length === 0 && <div className="empty-state">No job profiles yet. Open Architecture to define dimensions first.</div>}
          {profiles.map((profile) => <div className="leave-request" key={profile.id}><div className="inline-icon purple"><BriefcaseBusiness size={16} /></div><div><strong>{profile.title}</strong><span>{profile.family} · {profile.level}{profile.grade ? ` · ${profile.grade}` : ""}</span></div></div>)}
        </article>
        <article className="card">
          <div className="card-header"><div><div className="card-kicker">PLANS</div><h2>Planning windows</h2></div></div>
          {plans.length === 0 && <div className="empty-state">No workforce plans yet.</div>}
          {plans.map((plan) => <div className="leave-request" key={plan.id}><div className="inline-icon mint"><Building2 size={16} /></div><div style={{ flex: 1 }}><strong>{plan.name}</strong><span>{plan.startDate} – {plan.endDate} · {plan.status}</span></div><strong>{peso(plan.budget)}</strong></div>)}
          <div className="card-kicker" style={{ marginTop: 16 }}>ORGANIZATION STRUCTURE</div>
          {orgUnits.filter((unit) => unit.active).slice(0, 8).map((unit) => (
            <div className="leave-request" key={`org-${unit.id}`}>
              <div className="inline-icon mint"><Building2 size={16} /></div>
              <div>
                <strong>{unit.code} · {unit.name}</strong>
                <span>{unit.type.replaceAll("_", " ")}{unit.parentId ? ` · parent ${unitById.get(unit.parentId)?.name ?? unit.parentId}` : ""}</span>
              </div>
            </div>
          ))}
        </article>
      </section>
    </div>
  );
}
