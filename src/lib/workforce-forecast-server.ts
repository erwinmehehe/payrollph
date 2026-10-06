import { and, asc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
  costCenters,
  employeeLaborAllocations,
  employeePayProfiles,
  employees,
  employeeWorksiteAssignments,
  jobProfiles,
  positionAssignments,
  positions,
  shiftDefinitions,
  staffingRequirements,
  worksites,
} from "@/db/schema";
import {
  getAccess,
  PEOPLE_PAYROLL_ROLES,
  WORKFORCE_MANAGER_ROLES,
} from "@/lib/access";
import { buildWorkforceDemandForecast } from "@/lib/workforce-forecast";
import { assertUnambiguousRoleDemand, resolveEmployeeJobProfileAtDate } from "@/lib/workforce-role-demand";

export type WorkforceForecastScope = {
  orgUnitId: number | null;
  worksiteId: number | null;
};

export type WorkforceForecastRequest = WorkforceForecastScope & {
  organizationId: number;
  userId: number;
  startDate: string;
  endDate: string;
  demandGrowthPercent: number;
  vacancyFillPercent: number;
  employerLoadPercent: number;
};

function roleAllowed(role: string, roles: readonly string[]) {
  return roles.includes(role);
}

export async function loadScopedWorkforceForecast(input: WorkforceForecastRequest) {
  const access = await getAccess(input.userId, input.organizationId);
  if (!access || !roleAllowed(access.role, WORKFORCE_MANAGER_ROLES as readonly string[])) {
    throw new Error("Workforce-manager access is required to forecast staffing.");
  }

  if (
    input.orgUnitId != null
    && (!Number.isInteger(input.orgUnitId) || input.orgUnitId <= 0)
  ) {
    throw new Error("Invalid organization-unit scope.");
  }
  if (
    input.worksiteId != null
    && (!Number.isInteger(input.worksiteId) || input.worksiteId <= 0)
  ) {
    throw new Error("Invalid worksite scope.");
  }
  if (!access.companyWide && input.orgUnitId != null && input.orgUnitId !== access.orgUnitId) {
    throw new Error("The requested scenario is outside your assigned organization unit.");
  }

  const effectiveOrgUnitId = access.companyWide
    ? input.orgUnitId
    : access.orgUnitId;

  const [
    employeeRows,
    payProfileRows,
    positionRows,
    worksiteRows,
    requirementRows,
    shiftRows,
    allocationRows,
    centerRows,
    worksiteAssignmentRows,
    jobProfileRows,
    positionAssignmentRows,
  ] = await Promise.all([
    db.select().from(employees)
      .where(eq(employees.organizationId, input.organizationId))
      .orderBy(asc(employees.id)),
    db.select().from(employeePayProfiles)
      .where(eq(employeePayProfiles.organizationId, input.organizationId))
      .orderBy(asc(employeePayProfiles.employeeId)),
    db.select().from(positions)
      .where(eq(positions.organizationId, input.organizationId))
      .orderBy(asc(positions.id)),
    db.select().from(worksites)
      .where(eq(worksites.organizationId, input.organizationId))
      .orderBy(asc(worksites.id)),
    db.select().from(staffingRequirements)
      .where(and(
        eq(staffingRequirements.organizationId, input.organizationId),
        gte(staffingRequirements.workDate, input.startDate),
        lte(staffingRequirements.workDate, input.endDate),
      ))
      .orderBy(asc(staffingRequirements.workDate), asc(staffingRequirements.id)),
    db.select().from(shiftDefinitions)
      .where(eq(shiftDefinitions.organizationId, input.organizationId))
      .orderBy(asc(shiftDefinitions.id)),
    db.select().from(employeeLaborAllocations)
      .where(eq(employeeLaborAllocations.organizationId, input.organizationId))
      .orderBy(
        asc(employeeLaborAllocations.employeeId),
        asc(employeeLaborAllocations.effectiveFrom),
        asc(employeeLaborAllocations.id),
      ),
    db.select().from(costCenters)
      .where(eq(costCenters.organizationId, input.organizationId))
      .orderBy(asc(costCenters.code)),
    db.select().from(employeeWorksiteAssignments)
      .where(and(
        eq(employeeWorksiteAssignments.organizationId, input.organizationId),
        lte(employeeWorksiteAssignments.effectiveFrom, input.startDate),
        or(
          isNull(employeeWorksiteAssignments.effectiveUntil),
          gte(employeeWorksiteAssignments.effectiveUntil, input.startDate),
        ),
      ))
      .orderBy(
        asc(employeeWorksiteAssignments.employeeId),
        asc(employeeWorksiteAssignments.effectiveFrom),
        asc(employeeWorksiteAssignments.id),
      ),
    db.select().from(jobProfiles)
      .where(and(
        eq(jobProfiles.organizationId, input.organizationId),
        eq(jobProfiles.active, true),
      ))
      .orderBy(asc(jobProfiles.family), asc(jobProfiles.title), asc(jobProfiles.level)),
    db.select().from(positionAssignments)
      .where(and(
        eq(positionAssignments.organizationId, input.organizationId),
        lte(positionAssignments.effectiveFrom, input.startDate),
        or(
          isNull(positionAssignments.effectiveUntil),
          gte(positionAssignments.effectiveUntil, input.startDate),
        ),
      ))
      .orderBy(
        asc(positionAssignments.employeeId),
        asc(positionAssignments.effectiveFrom),
        asc(positionAssignments.id),
      ),
  ]);

  const requestedWorksite = input.worksiteId == null
    ? null
    : worksiteRows.find((worksite) => worksite.id === input.worksiteId) ?? null;
  if (input.worksiteId != null && !requestedWorksite) {
    throw new Error("Worksite not found in this organization.");
  }
  if (
    requestedWorksite
    && !access.companyWide
    && requestedWorksite.orgUnitId !== access.orgUnitId
  ) {
    throw new Error("The requested worksite is outside your assigned organization unit.");
  }
  if (
    requestedWorksite?.orgUnitId
    && effectiveOrgUnitId != null
    && requestedWorksite.orgUnitId !== effectiveOrgUnitId
  ) {
    throw new Error("The requested worksite does not belong to the selected organization unit.");
  }

  const employeeWorksiteAtStart = new Map<number, number>();
  for (const assignment of worksiteAssignmentRows) {
    employeeWorksiteAtStart.set(assignment.employeeId, assignment.worksiteId);
  }

  const visibleEmployees = employeeRows.filter((employee) => {
    if (effectiveOrgUnitId != null && employee.orgUnitId !== effectiveOrgUnitId) return false;
    if (input.worksiteId != null && employeeWorksiteAtStart.get(employee.id) !== input.worksiteId) return false;
    return true;
  });
  const visibleEmployeeIds = new Set(visibleEmployees.map((employee) => employee.id));
  const roleAssignments = positionAssignmentRows.map((row) => ({
    employeeId: row.employeeId,
    positionId: row.positionId,
    effectiveFrom: String(row.effectiveFrom),
    effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
  }));
  const rolePositions = positionRows.map((position) => ({
    id: position.id,
    jobProfileId: position.jobProfileId,
  }));
  const roleByEmployee = new Map<number, number | null>();
  const roleEvidenceIssues: string[] = [];
  for (const employee of visibleEmployees) {
    const role = resolveEmployeeJobProfileAtDate({
      employeeId: employee.id,
      date: input.startDate,
      assignments: roleAssignments,
      positions: rolePositions,
    });
    roleByEmployee.set(employee.id, role.jobProfileId);
    if (role.ambiguous) {
      roleEvidenceIssues.push(
        `Employee #${employee.id} has multiple active job profiles on ${input.startDate}; role capacity is not attributed until position evidence is resolved.`,
      );
    }
  }

  const positionOrgUnitId = requestedWorksite?.orgUnitId ?? effectiveOrgUnitId;
  const visiblePositions = requestedWorksite
    ? requestedWorksite.orgUnitId == null
      ? []
      : positionRows.filter((position) => position.orgUnitId === requestedWorksite.orgUnitId)
    : positionRows.filter((position) =>
        positionOrgUnitId == null || position.orgUnitId === positionOrgUnitId
      );
  const vacancyScopeMode = requestedWorksite
    ? requestedWorksite.orgUnitId == null
      ? "worksite-no-position-allocation"
      : "worksite-org-unit-proxy"
    : effectiveOrgUnitId == null
      ? "company"
      : "org-unit";

  const visibleWorksites = worksiteRows.filter((worksite) => {
    if (input.worksiteId != null) return worksite.id === input.worksiteId;
    if (effectiveOrgUnitId != null) return worksite.orgUnitId === effectiveOrgUnitId;
    return true;
  });
  const visibleWorksiteIds = new Set(visibleWorksites.map((worksite) => worksite.id));
  const visibleRequirementRows = requirementRows.filter((row) => visibleWorksiteIds.has(row.worksiteId));
  assertUnambiguousRoleDemand(visibleRequirementRows.map((row) => ({
    worksiteId: row.worksiteId,
    workDate: String(row.workDate),
    shiftDefinitionId: row.shiftDefinitionId,
    jobProfileId: row.jobProfileId,
  })));

  const forecast = buildWorkforceDemandForecast({
    assumptions: {
      startDate: input.startDate,
      endDate: input.endDate,
      demandGrowthPercent: input.demandGrowthPercent,
      vacancyFillPercent: input.vacancyFillPercent,
      employerLoadPercent: input.employerLoadPercent,
    },
    employees: visibleEmployees.map((employee) => ({
      id: employee.id,
      status: employee.status,
      jobProfileId: roleByEmployee.get(employee.id) ?? null,
    })),
    payProfiles: payProfileRows
      .filter((profile) => visibleEmployeeIds.has(profile.employeeId))
      .map((profile) => ({
        employeeId: profile.employeeId,
        payBasis: profile.payBasis,
        rateAmount: profile.rateAmount,
        standardWorkDaysPerMonth: profile.standardWorkDaysPerMonth,
        standardHoursPerDay: profile.standardHoursPerDay,
      })),
    positions: visiblePositions.map((position) => ({
      id: position.id,
      status: position.status,
      jobProfileId: position.jobProfileId,
      annualBudget: position.annualBudget,
      plannedStartDate: position.plannedStartDate ? String(position.plannedStartDate) : null,
    })),
    staffingRequirements: visibleRequirementRows
      .map((row) => ({
        workDate: String(row.workDate),
        shiftDefinitionId: row.shiftDefinitionId,
        jobProfileId: row.jobProfileId,
        requiredHeadcount: row.requiredHeadcount,
      })),
    shifts: shiftRows.map((shift) => ({
      id: shift.id,
      startTime: shift.startTime,
      endTime: shift.endTime,
      breakMinutes: shift.breakMinutes,
      spansMidnight: shift.spansMidnight,
    })),
    laborAllocations: allocationRows
      .filter((row) => visibleEmployeeIds.has(row.employeeId))
      .map((row) => ({
        id: row.id,
        employeeId: row.employeeId,
        costCenterId: row.costCenterId,
        effectiveFrom: String(row.effectiveFrom),
        effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
        allocationPercent: row.allocationPercent,
        allocationBasis: row.allocationBasis,
        projectCode: row.projectCode,
        clientCode: row.clientCode,
        jobCode: row.jobCode,
      })),
    costCenters: centerRows.map((center) => ({
      id: center.id,
      code: center.code,
      name: center.name,
    })),
    jobProfiles: jobProfileRows.map((profile) => ({
      id: profile.id,
      title: profile.title,
      family: profile.family,
      level: profile.level,
    })),
  });
  const forecastWithRoleEvidence = {
    ...forecast,
    quality: {
      ...forecast.quality,
      roleEvidenceIssues,
    },
  };

  return {
    forecast: forecastWithRoleEvidence,
    scope: {
      companyWide: access.companyWide,
      membershipOrgUnitId: access.orgUnitId,
      orgUnitId: effectiveOrgUnitId,
      worksiteId: input.worksiteId,
      worksiteName: requestedWorksite?.name ?? null,
      vacancyScopeMode,
      visibleEmployees: visibleEmployees.length,
      visiblePositions: visiblePositions.length,
      visibleWorksites: visibleWorksiteIds.size,
    },
    canViewCost: roleAllowed(access.role, PEOPLE_PAYROLL_ROLES as readonly string[]),
    role: access.role,
  };
}

export function redactWorkforceForecastCosts<T extends {
  summary: Record<string, unknown>;
  costCenters: unknown[];
  unallocated: Record<string, unknown>;
}>(forecast: T) {
  return {
    ...forecast,
    summary: {
      ...forecast.summary,
      annualizedBasePayroll: null,
      vacantAnnualBudget: null,
      annualRunRateLaborCost: null,
      currentPeriodBasePayroll: null,
      expectedVacancyPeriodCost: null,
      employerLoadCost: null,
      forecastPeriodLaborCost: null,
      averageBaseHourlyRate: null,
      estimatedShiftDemandWageCost: null,
    },
    costCenters: [],
    unallocated: {
      currentPeriodBaseCost: null,
      plannedVacancyPeriodCost: null,
    },
  };
}
