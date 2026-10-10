import { and, asc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
  employeeScheduleAssignments, employees, leaveRequests,
  separationRecords, timePunches,
} from "@/db/schema";
import { runAutomationEventSafely } from "@/lib/automation";
import { resolveEmployeeScheduleWindow } from "@/lib/workforce-schedule-window";
import { clockInWatchSignals } from "@/lib/workforce-clock-in-watch";

const MAX_ELIGIBLE_ASSIGNMENTS = 200;

/**
 * Reconcile clock-in watch with authoritative WFM schedules, leave, and punches.
 * This is an opt-in, bounded manager nudge, not an attendance/absence decision.
 * A larger cohort is explicitly skipped, never silently partially scanned.
 */
export async function emitWorkforceClockInWatch(now: Date, graceMinutes: number) {
  if (!Number.isFinite(now.getTime())
    || !Number.isSafeInteger(graceMinutes) || graceMinutes < 5 || graceMinutes > 60) {
    return { skipped: true as const, reason: "invalid-clock-in-watch-config" };
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return { skipped: true as const, reason: "invalid-manila-business-date" };
  }
  const previous = new Date(today + "T00:00:00Z");
  previous.setUTCDate(previous.getUTCDate() - 1);
  const yesterday = previous.toISOString().slice(0, 10);

  const assignmentRows = await db.select({
    organizationId: employeeScheduleAssignments.organizationId,
    employeeId: employeeScheduleAssignments.employeeId,
  }).from(employeeScheduleAssignments).where(and(
    lte(employeeScheduleAssignments.effectiveFrom, today),
    or(isNull(employeeScheduleAssignments.effectiveUntil),
      gte(employeeScheduleAssignments.effectiveUntil, yesterday)),
  )).orderBy(
    asc(employeeScheduleAssignments.organizationId),
    asc(employeeScheduleAssignments.employeeId),
  ).limit(MAX_ELIGIBLE_ASSIGNMENTS + 1);
  if (assignmentRows.length > MAX_ELIGIBLE_ASSIGNMENTS) {
    return { skipped: true as const, reason: "cohort-too-large", limit: MAX_ELIGIBLE_ASSIGNMENTS };
  }
  const ids = [...new Set(assignmentRows.map(row => row.employeeId))];
  if (ids.length === 0) return { skipped: false as const, checked: 0, emitted: 0, exceptions: 0 };

  const [workerRows, punches, leaves, exits] = await Promise.all([
    db.select({
      id: employees.id, organizationId: employees.organizationId,
      status: employees.status, startDate: employees.startDate,
    }).from(employees).where(inArray(employees.id, ids)),
    db.select({
      organizationId: timePunches.organizationId, employeeId: timePunches.employeeId,
      workDate: timePunches.workDate, timeIn: timePunches.timeIn,
      timeOut: timePunches.timeOut,
    }).from(timePunches).where(and(
      inArray(timePunches.employeeId, ids),
      gte(timePunches.workDate, yesterday), lte(timePunches.workDate, today),
    )),
    db.select({
      organizationId: leaveRequests.organizationId, employeeId: leaveRequests.employeeId,
      startDate: leaveRequests.startDate, endDate: leaveRequests.endDate,
    }).from(leaveRequests).where(and(
      inArray(leaveRequests.employeeId, ids),
      eq(leaveRequests.status, "Approved"),
      lte(leaveRequests.startDate, today), gte(leaveRequests.endDate, yesterday),
    )),
    db.select({
      organizationId: separationRecords.organizationId, employeeId: separationRecords.employeeId,
      status: separationRecords.status, lastDay: separationRecords.lastDay,
    }).from(separationRecords).where(inArray(separationRecords.employeeId, ids)),
  ]);
  const eligibleOrgByEmployee = new Map(assignmentRows.map(row => [row.employeeId, row.organizationId]));
  let checked = 0;
  let exceptions = 0;
  const outcomes: Array<{ employeeId: number; workDate: string; eventKey: string }> = [];
  for (const employee of workerRows) {
    if (eligibleOrgByEmployee.get(employee.id) !== employee.organizationId
      || employee.status !== "Active" || String(employee.startDate) > today) continue;
    // A current exit with contradictory active HR status needs HR reconciliation,
    // not an automated allegation of lateness.
    const conflictingSeparation = exits.some(row =>
      row.employeeId === employee.id
      && row.organizationId === employee.organizationId
      && ["draft", "approved", "released"].includes(row.status)
      && String(row.lastDay) >= String(employee.startDate));
    if (conflictingSeparation) continue;

    let schedules;
    try {
      schedules = await resolveEmployeeScheduleWindow({
        organizationId: employee.organizationId,
        employeeId: employee.id,
        startDate: yesterday,
        endDate: today,
      });
    } catch {
      // A contradictory or unresolved schedule must be corrected separately.
      exceptions += 1;
      continue;
    }
    for (const schedule of schedules) {
      const workDate = schedule.date;
      const approvedLeaveOnDate = leaves.some(row =>
        row.organizationId === employee.organizationId
        && row.employeeId === employee.id
        && String(row.startDate) <= workDate
        && String(row.endDate) >= workDate);
      const dayPunches = punches.filter(row =>
        row.organizationId === employee.organizationId
        && row.employeeId === employee.id
        && String(row.workDate) === workDate);
      const signals = clockInWatchSignals({
        candidate: {
          organizationId: employee.organizationId,
          employeeId: employee.id,
          employeeStatus: employee.status,
          employmentStartDate: String(employee.startDate),
          schedule,
          punches: dayPunches.map(p => ({ timeIn: p.timeIn, timeOut: p.timeOut })),
          approvedLeaveOnDate,
          conflictingSeparation: false,
        },
        now, graceMinutes,
      });
      checked += 1;
      for (const signal of signals) {
        await runAutomationEventSafely({
          organizationId: signal.organizationId,
          employeeId: signal.employeeId,
          trigger: "attendance.clock_in_pending",
          eventKey: signal.eventKey,
          context: {
            workDate: signal.workDate,
            shiftDefinitionId: signal.shiftDefinitionId,
            shiftStartTime: signal.shiftStartTime,
            worksiteId: signal.worksiteId,
            minutesSinceShiftStart: signal.minutesSinceShiftStart,
            clockInWatchStatus: "unconfirmed",
            // Never send a model a person's private attendance history.
          },
        });
        outcomes.push({ employeeId: signal.employeeId, workDate, eventKey: signal.eventKey });
      }
    }
  }
  return { skipped: false as const, checked, emitted: outcomes.length, exceptions,
    // No employee identifiers or PII in the shared scheduler status output.
  };
}
