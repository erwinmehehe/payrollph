import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  workforceTimesheetExpectations,
  workforceTimesheets,
} from "@/db/schema";

export type TimesheetExpectationLifecycle = "expected" | "submitted" | "approved" | "cancelled";

function expectationStatusForTimesheet(status: string): TimesheetExpectationLifecycle {
  return status === "approved" ? "approved" : "submitted";
}

/**
 * Freezes the exact employee population of a newly created payroll run.
 * Existing runs are intentionally never reconstructed from current employee
 * state because transfers/separations after the fact would make that inference
 * non-authoritative.
 */
export async function createTimesheetExpectationsForPayrollRun(input: {
  organizationId: number;
  payrollRunId: number;
  periodStart: string;
  periodEnd: string;
  enforcementMode: "advisory" | "block";
  employees: Array<{ id: number; orgUnitId: number | null }>;
}, executor: any = db) {
  if (input.employees.length === 0) return [];

  const employeeIds = input.employees.map((employee) => employee.id);
  const priorTimesheets = await executor.select().from(workforceTimesheets).where(and(
    eq(workforceTimesheets.organizationId, input.organizationId),
    inArray(workforceTimesheets.employeeId, employeeIds),
    eq(workforceTimesheets.periodStart, input.periodStart),
    eq(workforceTimesheets.periodEnd, input.periodEnd),
  )).orderBy(asc(workforceTimesheets.employeeId), desc(workforceTimesheets.version));

  const latestByEmployee = new Map<number, typeof workforceTimesheets.$inferSelect>();
  for (const row of priorTimesheets as Array<typeof workforceTimesheets.$inferSelect>) {
    if (!latestByEmployee.has(row.employeeId)) latestByEmployee.set(row.employeeId, row);
  }

  const values = input.employees.map((employee) => {
    const latest = latestByEmployee.get(employee.id);
    return {
      organizationId: input.organizationId,
      payrollRunId: input.payrollRunId,
      employeeId: employee.id,
      orgUnitId: employee.orgUnitId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      expectedBy: input.periodEnd,
      enforcementMode: input.enforcementMode,
      status: latest ? expectationStatusForTimesheet(latest.status) : "expected",
      version: 1,
      latestTimesheetId: latest?.id ?? null,
      latestTimesheetVersion: latest?.version ?? null,
      firstSubmittedAt: latest?.submittedAt ?? null,
    } satisfies typeof workforceTimesheetExpectations.$inferInsert;
  });

  return executor.insert(workforceTimesheetExpectations)
    .values(values)
    .onConflictDoNothing()
    .returning();
}

/**
 * Links every matching frozen payroll-run expectation to the first/most recent
 * real timesheet version. Rejected/stale versions remain "submitted" because
 * they are no longer "never submitted"; the existing cutoff workflow handles
 * their correction lifecycle.
 */
export async function linkTimesheetExpectationsToTimesheet(input: {
  organizationId: number;
  employeeId: number;
  periodStart: string;
  periodEnd: string;
  timesheetId: number;
  timesheetVersion: number;
  timesheetStatus: string;
  submittedAt: Date | null;
}, executor: any = db) {
  return executor.update(workforceTimesheetExpectations).set({
    status: expectationStatusForTimesheet(input.timesheetStatus),
    version: sql`${workforceTimesheetExpectations.version} + 1`,
    latestTimesheetId: input.timesheetId,
    latestTimesheetVersion: input.timesheetVersion,
    firstSubmittedAt: sql`coalesce(${workforceTimesheetExpectations.firstSubmittedAt}, ${input.submittedAt})`,
    updatedAt: new Date(),
  }).where(and(
    eq(workforceTimesheetExpectations.organizationId, input.organizationId),
    eq(workforceTimesheetExpectations.employeeId, input.employeeId),
    eq(workforceTimesheetExpectations.periodStart, input.periodStart),
    eq(workforceTimesheetExpectations.periodEnd, input.periodEnd),
  )).returning();
}

export async function listTimesheetExpectationsForPeriod(input: {
  organizationId: number;
  employeeIds: number[];
  periodStart: string;
  periodEnd: string;
}) {
  if (input.employeeIds.length === 0) return [];
  return db.select().from(workforceTimesheetExpectations).where(and(
    eq(workforceTimesheetExpectations.organizationId, input.organizationId),
    inArray(workforceTimesheetExpectations.employeeId, input.employeeIds),
    eq(workforceTimesheetExpectations.periodStart, input.periodStart),
    eq(workforceTimesheetExpectations.periodEnd, input.periodEnd),
  )).orderBy(asc(workforceTimesheetExpectations.employeeId), desc(workforceTimesheetExpectations.id));
}
