import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  employees, leaveRequests, orgUnits, overtimeRequests,
  payrollEntries, payrollRuns, separationRecords,
} from "@/db/schema";
import type { ReportDataset } from "@/lib/hcm-report-builder";

export type AuthorizedReportRow = Record<string, string | number | null>;
const MAX_SOURCE_ROWS = 50_000;

export function overtimeCostFromPayLines(lines: unknown): number {
  if (!Array.isArray(lines)) return 0;
  let centavos = 0;
  for (const entry of lines) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const line = entry as Record<string, unknown>;
    const code = typeof line.code === "string" ? line.code : "";
    if (code !== "OT" && !code.startsWith("OTPREM-")) continue;
    const amount = Number(line.amount);
    if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(Math.round(amount * 100))) {
      throw new Error("Stored overtime earning has an invalid amount.");
    }
    centavos += Math.round(amount * 100);
  }
  return centavos / 100;
}

function checkedRows<T>(rows: T[]): T[] {
  if (rows.length > MAX_SOURCE_ROWS) throw new Error("Report source exceeds 50,000 records; shorten the date window.");
  return rows;
}

export async function loadAuthorizedReportRows(input: {
  organizationId: number;
  dataset: ReportDataset;
  startDate: string;
  endDate: string;
  requireDepartmentAttribution?: boolean;
}): Promise<AuthorizedReportRow[]> {
  const { organizationId, dataset, startDate, endDate } = input;
  // This function is server-only; the route must authenticate the tenant and
  // block multi-entity workspaces until entity grants have been approved.
  const units = await db.select({ id: orgUnits.id, name: orgUnits.name }).from(orgUnits)
    .where(eq(orgUnits.organizationId, organizationId)).limit(MAX_SOURCE_ROWS + 1);
  checkedRows(units);
  const departments = new Map(units.map(unit => [unit.id, unit.name]));
  const departmentOf = (unitId: number | null) =>
    unitId == null ? "Unassigned" : departments.get(unitId) ?? "Unknown department";

  if (dataset === "people") {
    const [people, departures] = await Promise.all([
      db.select({ id: employees.id, status: employees.status, orgUnitId: employees.orgUnitId })
        .from(employees).where(eq(employees.organizationId, organizationId))
        .limit(MAX_SOURCE_ROWS + 1),
      db.select({ id: separationRecords.id }).from(separationRecords).where(and(
        eq(separationRecords.organizationId, organizationId),
        eq(separationRecords.status, "released"),
        gte(separationRecords.lastDay, startDate),
        lte(separationRecords.lastDay, endDate),
      )).limit(MAX_SOURCE_ROWS + 1),
    ]);
    checkedRows(people);
    checkedRows(departures);
    return [
      ...people.map(person => ({
        department: departmentOf(person.orgUnitId),
        status: person.status,
        headcount: ["Active", "On Leave", "Separating"].includes(person.status) ? 1 : 0,
        turnover: 0,
      })),
      // Historical org-unit assignment has not yet been migrated. Refuse to
      // misattribute released separations to a worker's CURRENT department.
      ...departures.map(() => ({
        department: "Historical department not attributed",
        status: "Released separation",
        headcount: 0,
        turnover: 1,
      })),
    ];
  }

  if (dataset === "time") {
    const [people, leaves, overtime] = await Promise.all([
      db.select({ id: employees.id, orgUnitId: employees.orgUnitId })
        .from(employees).where(eq(employees.organizationId, organizationId))
        .limit(MAX_SOURCE_ROWS + 1),
      db.select({ employeeId: leaveRequests.employeeId, days: leaveRequests.days }).from(leaveRequests)
        .where(and(
          eq(leaveRequests.organizationId, organizationId),
          eq(leaveRequests.status, "Approved"),
          gte(leaveRequests.startDate, startDate),
          lte(leaveRequests.endDate, endDate),
        )).limit(MAX_SOURCE_ROWS + 1),
      db.select({ employeeId: overtimeRequests.employeeId, minutes: overtimeRequests.requestedMinutes })
        .from(overtimeRequests).where(and(
          eq(overtimeRequests.organizationId, organizationId),
          eq(overtimeRequests.status, "approved"),
          gte(overtimeRequests.workDate, startDate),
          lte(overtimeRequests.workDate, endDate),
        )).limit(MAX_SOURCE_ROWS + 1),
    ]);
    checkedRows(people);
    checkedRows(leaves);
    checkedRows(overtime);
    const scoped = new Map(people.map(person => [person.id, person.orgUnitId]));
    return [
      ...leaves.map(leave => {
        if (!scoped.has(leave.employeeId)) throw new Error("Orphaned approved leave detected.");
        return { department: departmentOf(scoped.get(leave.employeeId) ?? null), absenceDays: Number(leave.days), overtimeHours: 0 };
      }),
      ...overtime.map(request => {
        if (!scoped.has(request.employeeId)) throw new Error("Orphaned approved overtime detected.");
        return { department: departmentOf(scoped.get(request.employeeId) ?? null), absenceDays: 0, overtimeHours: Math.round(request.minutes / 60 * 100) / 100 };
      }),
    ];
  }

  const [runs, unitsInTenant] = await Promise.all([
    db.select({
      id: payrollRuns.id,
      scopeOrgUnitId: payrollRuns.scopeOrgUnitId,
    }).from(payrollRuns).where(and(
      eq(payrollRuns.organizationId, organizationId),
      eq(payrollRuns.status, "Released"),
      gte(payrollRuns.payDate, startDate),
      lte(payrollRuns.payDate, endDate),
    )).limit(MAX_SOURCE_ROWS + 1),
    db.select({ id: orgUnits.id }).from(orgUnits).where(eq(orgUnits.organizationId, organizationId)),
  ]);
  checkedRows(runs);
  const validUnits = new Set(unitsInTenant.map(row => row.id));
  if (input.requireDepartmentAttribution !== false && runs.some(run => run.scopeOrgUnitId == null || !validUnits.has(run.scopeOrgUnitId))) {
    // Payroll entries have no immutable historical department snapshot.
    // A company-wide run cannot be apportioned using current employee units.
    throw new Error("Released company-wide payroll lacks historical department attribution. Department-cost reporting is blocked until attribution is reviewed.");
  }
  if (!runs.length) return [];
  const runDepartment = new Map(runs.map(run => [run.id,
    run.scopeOrgUnitId == null ? "Unattributed" : departmentOf(run.scopeOrgUnitId),
  ]));
  const entries = await db.select({
    payrollRunId: payrollEntries.payrollRunId,
    grossPay: payrollEntries.grossPay,
    lineItems: payrollEntries.lineItems,
    employeeOrganizationId: employees.organizationId,
    employeeLegalEntityId: employees.legalEntityId,
    runLegalEntityId: payrollRuns.legalEntityId,
  }).from(payrollEntries)
    .innerJoin(payrollRuns, and(
      eq(payrollEntries.payrollRunId, payrollRuns.id),
      eq(payrollRuns.organizationId, organizationId),
      eq(payrollRuns.status, "Released"),
    ))
    // The entry has no organization_id of its own. A payroll run belonging to
    // employer A must never pull employee B's salary into A's analytics.
    // LEFT JOIN preserves missing/corrupt employee links for explicit rejection.
    .leftJoin(employees, eq(payrollEntries.employeeId, employees.id))
    .where(inArray(payrollEntries.payrollRunId, runs.map(run => run.id)))
    .limit(MAX_SOURCE_ROWS + 1);
  checkedRows(entries);
  if (entries.some(entry =>
    entry.employeeOrganizationId !== organizationId
    || (entry.runLegalEntityId != null
      && entry.employeeLegalEntityId !== entry.runLegalEntityId)
  )) {
    // No foreign worker identifier, amounts, or employer name in the error.
    throw new Error("Released payroll source attribution is inconsistent with its employee employer.");
  }
  return entries.map(entry => ({
    department: runDepartment.get(entry.payrollRunId) ?? "Unattributed",
    grossPay: Number(entry.grossPay),
    overtimeCost: overtimeCostFromPayLines(entry.lineItems),
  }));
}
