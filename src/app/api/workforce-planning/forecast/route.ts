import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  costCenters,
  employeeLaborAllocations,
  employeePayProfiles,
  employees,
  positions,
  shiftDefinitions,
  staffingRequirements,
  worksites,
} from "@/db/schema";
import {
  assertOrganizationRole,
  getAccess,
  PEOPLE_PAYROLL_ROLES,
} from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { buildWorkforceDemandForecast } from "@/lib/workforce-forecast";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function finiteNumber(value: string | null, fallback: number) {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const startDate = String(url.searchParams.get("startDate") ?? "");
  const endDate = String(url.searchParams.get("endDate") ?? "");
  const demandGrowthPercent = finiteNumber(url.searchParams.get("demandGrowthPercent"), 0);
  const vacancyFillPercent = finiteNumber(url.searchParams.get("vacancyFillPercent"), 100);
  const employerLoadPercent = finiteNumber(url.searchParams.get("employerLoadPercent"), 0);

  if (
    !Number.isInteger(organizationId)
    || !ISO_DATE.test(startDate)
    || !ISO_DATE.test(endDate)
    || !Number.isFinite(demandGrowthPercent)
    || !Number.isFinite(vacancyFillPercent)
    || !Number.isFinite(employerLoadPercent)
  ) {
    return Response.json({
      error: "organizationId, startDate/endDate, and numeric forecast assumptions are required.",
    }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Payroll or People finance access is required to view workforce cost forecasts.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) {
    return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  }

  try {
    const [
      employeeRows,
      payProfileRows,
      positionRows,
      worksiteRows,
      requirementRows,
      shiftRows,
      allocationRows,
      centerRows,
    ] = await Promise.all([
      db.select().from(employees)
        .where(eq(employees.organizationId, organizationId))
        .orderBy(asc(employees.id)),
      db.select().from(employeePayProfiles)
        .where(eq(employeePayProfiles.organizationId, organizationId))
        .orderBy(asc(employeePayProfiles.employeeId)),
      db.select().from(positions)
        .where(eq(positions.organizationId, organizationId))
        .orderBy(asc(positions.id)),
      db.select().from(worksites)
        .where(eq(worksites.organizationId, organizationId))
        .orderBy(asc(worksites.id)),
      db.select().from(staffingRequirements)
        .where(and(
          eq(staffingRequirements.organizationId, organizationId),
          gte(staffingRequirements.workDate, startDate),
          lte(staffingRequirements.workDate, endDate),
        ))
        .orderBy(asc(staffingRequirements.workDate), asc(staffingRequirements.id)),
      db.select().from(shiftDefinitions)
        .where(eq(shiftDefinitions.organizationId, organizationId))
        .orderBy(asc(shiftDefinitions.id)),
      db.select().from(employeeLaborAllocations)
        .where(eq(employeeLaborAllocations.organizationId, organizationId))
        .orderBy(asc(employeeLaborAllocations.employeeId), asc(employeeLaborAllocations.effectiveFrom), asc(employeeLaborAllocations.id)),
      db.select().from(costCenters)
        .where(eq(costCenters.organizationId, organizationId))
        .orderBy(asc(costCenters.code)),
    ]);

    const visibleEmployees = access.companyWide
      ? employeeRows
      : employeeRows.filter((employee) => employee.orgUnitId === access.orgUnitId);
    const visibleEmployeeIds = new Set(visibleEmployees.map((employee) => employee.id));

    const visiblePositions = access.companyWide
      ? positionRows
      : positionRows.filter((position) => position.orgUnitId === access.orgUnitId);

    const visibleWorksiteIds = new Set(
      worksiteRows
        .filter((worksite) => access.companyWide || worksite.orgUnitId == null || worksite.orgUnitId === access.orgUnitId)
        .map((worksite) => worksite.id),
    );

    const forecast = buildWorkforceDemandForecast({
      assumptions: {
        startDate,
        endDate,
        demandGrowthPercent,
        vacancyFillPercent,
        employerLoadPercent,
      },
      employees: visibleEmployees.map((employee) => ({
        id: employee.id,
        status: employee.status,
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
        annualBudget: position.annualBudget,
        plannedStartDate: position.plannedStartDate ? String(position.plannedStartDate) : null,
      })),
      staffingRequirements: requirementRows
        .filter((row) => visibleWorksiteIds.has(row.worksiteId))
        .map((row) => ({
          workDate: String(row.workDate),
          shiftDefinitionId: row.shiftDefinitionId,
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
    });

    return Response.json({
      forecast,
      scope: {
        companyWide: access.companyWide,
        orgUnitId: access.orgUnitId,
        visibleEmployees: visibleEmployees.length,
        visiblePositions: visiblePositions.length,
        visibleWorksites: visibleWorksiteIds.size,
      },
      boundary: "Planning estimate only. Forecast employer load and staffing demand are scenario assumptions, not payroll calculations or statutory liabilities.",
    });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Workforce forecast could not be calculated.",
    }, { status: 422 });
  }
}
