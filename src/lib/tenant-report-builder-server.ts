import { and, eq, gte, lte, asc } from "drizzle-orm";
import { db } from "@/db";
import { employees, leaveRequests, orgUnits, payrollEntries, payrollRuns, separationRecords } from "@/db/schema";
import { runBiExport, validateBiExportFilters } from "@/lib/bi-exports";
import { leaveRangeFullyWithinReport, reportMoneyCentavos, formatReportCentavos, type BuilderDataset, type BuilderFact } from "@/lib/tenant-report-builder";

export async function getBuilderFacts(input: {
  organizationId: number; dataset: BuilderDataset;
  startDate: string; endDate: string;
}): Promise<BuilderFact[]> {
  const { organizationId, dataset, startDate, endDate } = input;
  const invalid = validateBiExportFilters({ startDate, endDate });
  if (invalid) throw new Error(invalid);

  if (dataset === "people") {
    const rows = await db.select({
      id: employees.id, status: employees.status,
      employmentType: employees.employmentType, department: orgUnits.code,
    }).from(employees).leftJoin(orgUnits, and(
      eq(employees.orgUnitId, orgUnits.id), eq(orgUnits.organizationId, organizationId),
    )).where(eq(employees.organizationId, organizationId))
      .orderBy(asc(employees.id)).limit(5_001);
    if (rows.length > 5_000) throw new Error("Headcount scope exceeds 5,000 employees.");
    // Turnover count is based on a recorded departure date and an actual
    // Separated employee state, not a draft separation/final-pay amount.
    // Multiple historical correction records for one employee count once.
    const departures = await db.select({employeeId:separationRecords.employeeId})
      .from(separationRecords)
      .innerJoin(employees, and(
        eq(separationRecords.employeeId,employees.id),
        eq(employees.organizationId,organizationId),
      ))
      .where(and(
        eq(separationRecords.organizationId,organizationId),
        eq(employees.status,"Separated"),
        gte(separationRecords.lastDay,startDate),
        lte(separationRecords.lastDay,endDate),
      )).limit(5_001);
    if(departures.length>5_000)
      throw new Error("Recorded departures exceed 5,000; narrow the date range.");
    const departedEmployeeIds=new Set(departures.map(item=>item.employeeId));
    return rows.map(row => ({
      department: row.department ?? "Unallocated", status: row.status,
      employmentType: row.employmentType,
      headcount: row.status === "Active" ? 1 : 0,
      // Snapshot count, not a date-window turnover rate.
      separatedCount: row.status === "Separated" ? 1 : 0,
      turnoverCount: departedEmployeeIds.has(row.id) ? 1 : 0,
    }));
  }

  if (dataset === "time") {
    const timesheets = await runBiExport({
      key: "workforce_timesheets", organizationId,
      filters: { startDate, endDate },
    });
    const leaves = await db.select({
      days: leaveRequests.days, department: orgUnits.code,
      leaveStart: leaveRequests.startDate, leaveEnd: leaveRequests.endDate,
    }).from(leaveRequests).innerJoin(employees, and(
      eq(leaveRequests.employeeId, employees.id),
      eq(employees.organizationId, organizationId),
    )).leftJoin(orgUnits, and(
      eq(employees.orgUnitId, orgUnits.id),
      eq(orgUnits.organizationId, organizationId),
    )).where(and(
      eq(leaveRequests.organizationId, organizationId),
      eq(leaveRequests.status, "Approved"),
      lte(leaveRequests.startDate, endDate),
      gte(leaveRequests.endDate, startDate),
    )).limit(5_001);
    if (leaves.length > 5_000) throw new Error("Approved leave scope exceeds 5,000 requests.");
    if (leaves.some(row => !leaveRangeFullyWithinReport(
      String(row.leaveStart), String(row.leaveEnd), startDate, endDate,
    ))) {
      throw new Error("An approved leave request crosses the report boundary; choose a window containing the full leave interval, or use a date-allocated absence report. No partial days were guessed.");
    }
    return [
      ...timesheets.rows.map(row => ({
        department: String(row.currentOrgUnitCode ?? "Unallocated"),
        status: String(row.status ?? ""),
        scheduledMinutes: Number(row.scheduledMinutes ?? 0),
        workedMinutes: Number(row.workedMinutes ?? 0),
        overtimeMinutes: Number(row.overtimeMinutes ?? 0), absenceDays: 0,
      })),
      ...leaves.map(row => ({
        department: row.department ?? "Unallocated",
        status: "Approved leave", scheduledMinutes: 0, workedMinutes: 0,
        overtimeMinutes: 0, absenceDays: Number(row.days ?? 0),
      })),
    ];
  }

  // Historical payroll costs use the run's frozen department scope, never
  // an employee's potentially transferred current department.
  const rows = await db.select({
    orgUnit: orgUnits.code, runStatus: payrollRuns.status,
    grossPay: payrollEntries.grossPay, lineItems: payrollEntries.lineItems,
    employeeOrganizationId: employees.organizationId,
    employeeLegalEntityId: employees.legalEntityId,
    runLegalEntityId: payrollRuns.legalEntityId,
  }).from(payrollEntries)
    .innerJoin(payrollRuns, and(
      eq(payrollEntries.payrollRunId, payrollRuns.id),
      eq(payrollRuns.organizationId, organizationId),
    ))
    // Payroll entry records have no independent organization_id. Never use
    // a tenant-scoped run as evidence that its referenced employee is owned.
    // A LEFT JOIN keeps missing or inconsistent links visible for rejection.
    .leftJoin(employees, eq(payrollEntries.employeeId, employees.id))
    .leftJoin(orgUnits, and(
      eq(payrollRuns.scopeOrgUnitId, orgUnits.id),
      eq(orgUnits.organizationId, organizationId),
    )).where(and(
      eq(payrollRuns.organizationId, organizationId),
      eq(payrollRuns.status, "Released"),
      gte(payrollRuns.payDate, startDate),
      lte(payrollRuns.payDate, endDate),
    )).limit(5_001);
  if (rows.length > 5_000) throw new Error("Payroll scope exceeds 5,000 entries.");
  if (rows.some(row => row.employeeOrganizationId !== organizationId
    || (row.runLegalEntityId != null && row.employeeLegalEntityId !== row.runLegalEntityId))) {
    // No worker identifiers, tenant names or wage amounts in report errors.
    throw new Error("Payroll source attribution is inconsistent with its legal employer.");
  }
  return rows.map(row => {
    const items = Array.isArray(row.lineItems) ? row.lineItems : [];
    const otLineCost = items.reduce((amount, item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return amount;
      const line = item as { code?: unknown; amount?: unknown };
      if (line.code !== "OT") return amount;
      const value = reportMoneyCentavos(String(line.amount));
      if (value < BigInt(0)) throw new Error("Stored OT line item needs review.");
      return amount + value;
    }, BigInt(0));
    return { department: row.orgUnit ?? "Unallocated", status: row.runStatus,
      payrollCost: formatReportCentavos(reportMoneyCentavos(String(row.grossPay))),
      otLineCost: formatReportCentavos(otLineCost) };
  });
}
