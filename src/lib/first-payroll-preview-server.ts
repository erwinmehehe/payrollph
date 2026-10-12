import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { employees, firstPayrollJourneyProgress, legalEntities, workforceAttendancePeriodLocks } from "@/db/schema";
import { previewPayrollWithReader } from "./payroll-engine";
import { validJourneySchedule } from "./first-payroll-journey";
import { firstPayrollPreviewResult } from "./first-payroll-preview";

/** PostgreSQL rejects writes even if a future loader accidentally introduces one.
 * Never call schema repair, audit, queue, or run creation from this transaction. */
export async function loadFirstPayrollPreview(organizationId: number, database = db) {
  return database.transaction(async (tx) => {
    const [state] = await tx.select().from(firstPayrollJourneyProgress).where(and(eq(firstPayrollJourneyProgress.organizationId, organizationId), eq(firstPayrollJourneyProgress.step, "company"))).limit(1);
    const schedule = (state?.data as { schedule?: unknown } | undefined)?.schedule;
    if (!validJourneySchedule(schedule)) return firstPayrollPreviewResult([], schedule, false);
    const [entity] = await tx.select().from(legalEntities).where(and(eq(legalEntities.organizationId, organizationId), eq(legalEntities.active, true), eq(legalEntities.primaryEntity, true))).limit(1);
    const [lock] = await tx.select().from(workforceAttendancePeriodLocks).where(and(eq(workforceAttendancePeriodLocks.organizationId, organizationId), eq(workforceAttendancePeriodLocks.status, "locked"), eq(workforceAttendancePeriodLocks.lockType, "payroll_cutoff"), lte(workforceAttendancePeriodLocks.periodStart, schedule.periodStart), gte(workforceAttendancePeriodLocks.periodEnd, schedule.periodEnd))).limit(1);
    const roster = await tx.select({ id: employees.id }).from(employees).where(and(eq(employees.organizationId, organizationId), eq(employees.status, "Active"), lte(employees.startDate, schedule.periodEnd), entity ? eq(employees.legalEntityId, entity.id) : undefined));
    const rows = await previewPayrollWithReader(tx as unknown as typeof db, organizationId, {
      id: 0, legalEntityId: entity?.id ?? null, scopeOrgUnitId: null,
      ...schedule, periodLabel: `${schedule.periodStart}–${schedule.periodEnd}`, employeeCount: roster.length,
    });
    return firstPayrollPreviewResult(rows, schedule, Boolean(lock?.lockedByUserId));
  }, { accessMode: "read only", isolationLevel: "repeatable read" });
}
