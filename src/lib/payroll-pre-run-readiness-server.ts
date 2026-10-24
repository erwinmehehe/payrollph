import { and, eq, gte, inArray, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
  attendanceCorrectionRequests, employeePayProfiles, employeeRestDayRevisions,
  employeeScheduleAssignments, employees, legalEntities, payrollRuns,
  scheduleOverrides, scheduleSwapRequests, timePunches, workforceTimesheets,
} from "@/db/schema";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { findPayrollPeriodConflict } from "@/lib/payroll-period-integrity";
import { buildStatutoryRuleWatch } from "@/lib/statutory-rule-watch";
import { evaluatePayrollPreRunReadiness } from "@/lib/payroll-pre-run-readiness";
import { payrollEmploymentStatus } from "@/lib/approved-exit-payroll";

export type PayrollPreRunIdentity = Pick<typeof payrollRuns.$inferSelect,
  "id" | "organizationId" | "legalEntityId" | "scopeOrgUnitId" | "periodStart" | "periodEnd" | "payDate">;

/**
 * Read-only equivalent of the selected cohort in the /process route. The
 * addition of employees with NULL employer attribution is deliberate: with
 * multi-entity mode on, the worker's normal cohort filter excludes them, so
 * an invisible unassigned worker would otherwise escape pre-run checking.
 */
export async function loadPayrollPreRunReadiness(
  run: PayrollPreRunIdentity,
  reader: Pick<typeof db, "select"> = db,
) {
  const organizationId = run.organizationId;
  const periodStart = String(run.periodStart);
  const periodEnd = String(run.periodEnd);
  const payDate = String(run.payDate);
  const [candidateEmployees, legal, conflict] = await Promise.all([
    reader.select({
      id: employees.id,
      employeeNo: employees.employeeNo,
      legalEntityId: employees.legalEntityId,
      orgUnitId: employees.orgUnitId,
    }).from(employees).where(and(
      eq(employees.organizationId, organizationId),
      payrollEmploymentStatus(periodStart),
      lte(employees.startDate, periodEnd),
      run.scopeOrgUnitId == null ? undefined : eq(employees.orgUnitId, run.scopeOrgUnitId),
    )),
    run.legalEntityId == null ? Promise.resolve([]) : reader.select({
      id: legalEntities.id, payrollCalendarMode: legalEntities.payrollCalendarMode,
      active: legalEntities.active,
    }).from(legalEntities).where(and(
      eq(legalEntities.organizationId, organizationId),
      eq(legalEntities.id, run.legalEntityId),
    )).limit(1),
    findPayrollPeriodConflict({
      organizationId,
      legalEntityId: run.legalEntityId,
      scopeOrgUnitId: run.scopeOrgUnitId,
      periodStart, periodEnd, excludeRunId: run.id,
      executor: reader,
    }),
  ]);

  const multiEntityScoped = criticalReleaseFlagEnabled("multiEntity") && run.legalEntityId != null;
  const cohort = candidateEmployees.filter(employee =>
    !multiEntityScoped || employee.legalEntityId === run.legalEntityId
      || employee.legalEntityId == null);
  const ids = cohort.map(employee => employee.id);
  // An empty cohort must not issue an unscoped IN query.
  const [
    profiles, timesheets, punches, corrections, restDays, schedules, overrides, swaps,
  ] = ids.length ? await Promise.all([
    reader.select({ employeeId: employeePayProfiles.employeeId })
      .from(employeePayProfiles).where(and(
        eq(employeePayProfiles.organizationId, organizationId),
        inArray(employeePayProfiles.employeeId, ids),
      )),
    reader.select({
      employeeId: workforceTimesheets.employeeId,
      periodStart: workforceTimesheets.periodStart,
      periodEnd: workforceTimesheets.periodEnd,
      version: workforceTimesheets.version,
      status: workforceTimesheets.status,
      decidedAt: workforceTimesheets.decidedAt,
    }).from(workforceTimesheets).where(and(
      eq(workforceTimesheets.organizationId, organizationId),
      inArray(workforceTimesheets.employeeId, ids),
      eq(workforceTimesheets.periodStart, periodStart),
      eq(workforceTimesheets.periodEnd, periodEnd),
    )),
    reader.select({ employeeId: timePunches.employeeId })
      .from(timePunches).where(and(
        eq(timePunches.organizationId, organizationId),
        inArray(timePunches.employeeId, ids),
        gte(timePunches.workDate, periodStart),
        lte(timePunches.workDate, periodEnd),
      )).groupBy(timePunches.employeeId),
    reader.select({
      employeeId: attendanceCorrectionRequests.employeeId,
      workDate: attendanceCorrectionRequests.workDate,
      status: attendanceCorrectionRequests.status,
    }).from(attendanceCorrectionRequests).where(and(
      eq(attendanceCorrectionRequests.organizationId, organizationId),
      inArray(attendanceCorrectionRequests.employeeId, ids),
      eq(attendanceCorrectionRequests.status, "pending"),
      gte(attendanceCorrectionRequests.workDate, periodStart),
      lte(attendanceCorrectionRequests.workDate, periodEnd),
    )),
    reader.select({
      employeeId: employeeRestDayRevisions.employeeId,
      effectiveDate: employeeRestDayRevisions.effectiveDate,
      createdAt: employeeRestDayRevisions.createdAt,
    }).from(employeeRestDayRevisions).where(and(
      eq(employeeRestDayRevisions.organizationId, organizationId),
      inArray(employeeRestDayRevisions.employeeId, ids),
      gte(employeeRestDayRevisions.effectiveDate, periodStart),
      lte(employeeRestDayRevisions.effectiveDate, periodEnd),
    )),
    reader.select({
      employeeId: employeeScheduleAssignments.employeeId,
      effectiveFrom: employeeScheduleAssignments.effectiveFrom,
      createdAt: employeeScheduleAssignments.createdAt,
    }).from(employeeScheduleAssignments).where(and(
      eq(employeeScheduleAssignments.organizationId, organizationId),
      inArray(employeeScheduleAssignments.employeeId, ids),
      gte(employeeScheduleAssignments.effectiveFrom, periodStart),
      lte(employeeScheduleAssignments.effectiveFrom, periodEnd),
    )),
    reader.select({
      employeeId: scheduleOverrides.employeeId,
      workDate: scheduleOverrides.workDate,
      status: scheduleOverrides.status,
    }).from(scheduleOverrides).where(and(
      eq(scheduleOverrides.organizationId, organizationId),
      inArray(scheduleOverrides.employeeId, ids),
      eq(scheduleOverrides.status, "pending"),
      gte(scheduleOverrides.workDate, periodStart),
      lte(scheduleOverrides.workDate, periodEnd),
    )),
    reader.select({
      requesterEmployeeId: scheduleSwapRequests.requesterEmployeeId,
      counterpartyEmployeeId: scheduleSwapRequests.counterpartyEmployeeId,
      requesterWorkDate: scheduleSwapRequests.requesterWorkDate,
      counterpartyWorkDate: scheduleSwapRequests.counterpartyWorkDate,
      status: scheduleSwapRequests.status,
    }).from(scheduleSwapRequests).where(and(
      eq(scheduleSwapRequests.organizationId, organizationId),
      eq(scheduleSwapRequests.status, "pending"),
      or(
        and(gte(scheduleSwapRequests.requesterWorkDate, periodStart),
          lte(scheduleSwapRequests.requesterWorkDate, periodEnd),
          inArray(scheduleSwapRequests.requesterEmployeeId, ids)),
        and(gte(scheduleSwapRequests.counterpartyWorkDate, periodStart),
          lte(scheduleSwapRequests.counterpartyWorkDate, periodEnd),
          inArray(scheduleSwapRequests.counterpartyEmployeeId, ids)),
      ),
    )),
  ]) : [[], [], [], [], [], [], [], []];

  const scopedSwaps = swaps.filter(row =>
    (ids.includes(row.requesterEmployeeId)
      && row.requesterWorkDate >= periodStart && row.requesterWorkDate <= periodEnd)
    || (ids.includes(row.counterpartyEmployeeId)
      && row.counterpartyWorkDate >= periodStart && row.counterpartyWorkDate <= periodEnd));

  const today = new Date().toISOString().slice(0, 10);
  return evaluatePayrollPreRunReadiness({
    run: {
      id: run.id, organizationId, legalEntityId: run.legalEntityId,
      periodStart, periodEnd, payDate,
    },
    employer: legal[0] ?? null,
    employees: cohort,
    profiles,
    timesheets,
    punchEmployees: punches,
    attendanceCorrections: corrections,
    restDayRevisions: restDays,
    scheduleAssignments: schedules,
    scheduleOverrides: overrides,
    scheduleSwaps: scopedSwaps,
    periodConflict: conflict
      ? { id: conflict.id, periodLabel: conflict.periodLabel, status: conflict.status }
      : null,
    ruleWatch: buildStatutoryRuleWatch(payDate > today ? payDate : today),
  });
}
