import { and, asc, eq, gt, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
  employeeScheduleAssignments, employees, leaveRequests,
  separationRecords, timePunches,
} from "@/db/schema";
import { runAutomationEventSafely } from "@/lib/automation";
import { resolveEmployeeScheduleWindow } from "@/lib/workforce-schedule-window";
import { loadClockInWatchScheduleBatch } from "@/lib/workforce-clock-in-watch-batch";
import { clockInWatchSignals, type ClockInWatchSignal } from "@/lib/workforce-clock-in-watch";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { scanActiveRosterAssignments, ROSTER_SCAN_PAGE_SIZE } from "@/lib/workforce-roster-scale";
import { clockWatchLeaseFence } from "@/lib/workforce-clock-watch-lease";

const MAX_LEGACY_ASSIGNMENTS = 200;
const WORKER_BATCH_SIZE = 100;

/**
 * Under the opt-in roster-scale gate, load all eligible assignments in
 * deterministic keyset pages and stage signals only after a complete scan.
 * No notification is emitted for a partial/failed scan. The caller's central
 * scheduler still owns the fenced lease for the whole tick.
 */
export async function emitWorkforceClockInWatch(now: Date, graceMinutes: number, assertLeaseOwnership: () => Promise<void>) {
  if (!Number.isFinite(now.getTime())
    || !Number.isSafeInteger(graceMinutes) || graceMinutes < 5 || graceMinutes > 60) {
    return { skipped: true as const, reason: "invalid-clock-in-watch-config" };
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(now);
  if (!/^\d{4}-\d\d-\d\d$/.test(today)) {
    return { skipped: true as const, reason: "invalid-manila-business-date" };
  }
  const previous = new Date(today + "T00:00:00Z");
  previous.setUTCDate(previous.getUTCDate() - 1);
  const yesterday = previous.toISOString().slice(0, 10);
  const enhanced = criticalReleaseFlagEnabled("wfmRosterScaleRules");
  const assertActiveLease = clockWatchLeaseFence(assertLeaseOwnership);

  const rowsForPage = async (afterId: number, limit: number) => {
    await assertActiveLease();
    return db.select({
      id: employeeScheduleAssignments.id,
      organizationId: employeeScheduleAssignments.organizationId,
      employeeId: employeeScheduleAssignments.employeeId,
    }).from(employeeScheduleAssignments).where(and(
      gt(employeeScheduleAssignments.id, afterId),
      lte(employeeScheduleAssignments.effectiveFrom, today),
      or(isNull(employeeScheduleAssignments.effectiveUntil),
        gte(employeeScheduleAssignments.effectiveUntil, yesterday)),
    )).orderBy(asc(employeeScheduleAssignments.id)).limit(limit);
  };

  const cohort = await scanActiveRosterAssignments({
    fetchPage: rowsForPage,
    pageSize: ROSTER_SCAN_PAGE_SIZE,
    maxAssignments: enhanced ? 20_000 : MAX_LEGACY_ASSIGNMENTS,
  });
  if (!cohort.complete) {
    return { skipped: true as const, reason: "cohort-too-large",
      limit: enhanced ? 20_000 : MAX_LEGACY_ASSIGNMENTS };
  }
  if (cohort.workers.length === 0) {
    return { skipped: false as const, checked: 0, emitted: 0,
      exceptions: 0, assignmentsScanned: cohort.assignmentsScanned, pages: cohort.pages };
  }

  // Keep each worker/punch/leave/exit read within the same tenant and a
  // bounded employee-ID page. A duplicate historical assignment never
  // generates duplicate events, even across page boundaries.
  const byOrganization = new Map<number, number[]>();
  for (const worker of cohort.workers) {
    const ids = byOrganization.get(worker.organizationId) ?? [];
    ids.push(worker.employeeId);
    byOrganization.set(worker.organizationId, ids);
  }
  let checked = 0;
  let exceptions = 0;
  const pendingSignals: ClockInWatchSignal[] = [];
  for (const [organizationId, employeeIds] of byOrganization) {
    for (let index = 0; index < employeeIds.length; index += WORKER_BATCH_SIZE) {
      await assertActiveLease();
      const ids = employeeIds.slice(index, index + WORKER_BATCH_SIZE);
      const [workerRows, punches, leaves, exits] = await Promise.all([
        db.select({
          id: employees.id, organizationId: employees.organizationId,
          status: employees.status, startDate: employees.startDate,
        }).from(employees).where(and(
          eq(employees.organizationId, organizationId), inArray(employees.id, ids),
        )),
        db.select({
          organizationId: timePunches.organizationId, employeeId: timePunches.employeeId,
          workDate: timePunches.workDate, timeIn: timePunches.timeIn, timeOut: timePunches.timeOut,
        }).from(timePunches).where(and(
          eq(timePunches.organizationId, organizationId),
          inArray(timePunches.employeeId, ids),
          gte(timePunches.workDate, yesterday), lte(timePunches.workDate, today),
        )),
        db.select({
          organizationId: leaveRequests.organizationId, employeeId: leaveRequests.employeeId,
          startDate: leaveRequests.startDate, endDate: leaveRequests.endDate,
        }).from(leaveRequests).where(and(
          eq(leaveRequests.organizationId, organizationId),
          inArray(leaveRequests.employeeId, ids),
          eq(leaveRequests.status, "Approved"),
          lte(leaveRequests.startDate, today), gte(leaveRequests.endDate, yesterday),
        )),
        db.select({
          organizationId: separationRecords.organizationId, employeeId: separationRecords.employeeId,
          status: separationRecords.status, lastDay: separationRecords.lastDay,
        }).from(separationRecords).where(and(
          eq(separationRecords.organizationId, organizationId),
          inArray(separationRecords.employeeId, ids),
        )),
      ]);
      const schedulesByWorker = enhanced ? await loadClockInWatchScheduleBatch({
        organizationId, employeeIds: ids, startDate: yesterday, endDate: today,
      }) : null;
      const punchesByWorker = new Map<number, typeof punches>();
      for (const punch of punches) {
        const list = punchesByWorker.get(punch.employeeId) ?? [];
        list.push(punch);
        punchesByWorker.set(punch.employeeId, list);
      }
      for (const employee of workerRows) {
        if (employee.organizationId !== organizationId
          || employee.status !== "Active" || String(employee.startDate) > today) continue;
        const conflictingSeparation = exits.some(row =>
          row.employeeId === employee.id
          && ["draft", "approved", "released"].includes(row.status)
          && String(row.lastDay) >= String(employee.startDate));
        if (conflictingSeparation) continue;
        let schedules;
        try {
          if (schedulesByWorker) {
            const stored = schedulesByWorker.get(employee.id);
            if (!stored || stored.length !== 2) throw Error("Unresolved batched schedule.");
            schedules = stored;
          } else {
            schedules = await resolveEmployeeScheduleWindow({
              organizationId, employeeId: employee.id, startDate: yesterday, endDate: today,
            });
          }
        } catch {
          exceptions += 1;
          continue;
        }
        for (const schedule of schedules) {
          const date = schedule.date;
          const approvedLeaveOnDate = leaves.some(row =>
            row.employeeId === employee.id
            && String(row.startDate) <= date && String(row.endDate) >= date);
          const dayPunches = (punchesByWorker.get(employee.id) ?? [])
            .filter(row => String(row.workDate) === date);
          const signals = clockInWatchSignals({
            candidate: {
              organizationId, employeeId: employee.id,
              employeeStatus: employee.status,
              employmentStartDate: String(employee.startDate),
              schedule,
              punches: dayPunches.map(row => ({ timeIn: row.timeIn, timeOut: row.timeOut })),
              approvedLeaveOnDate,
              conflictingSeparation: false,
            },
            now, graceMinutes,
          });
          checked += 1;
          pendingSignals.push(...signals);
        }
      }
    }
  }

  // No side effect occurred before this point: a truncated scan or any failed
  // page read cannot silently create a partial set of manager alerts.
  let emitted = 0;
  for (const signal of pendingSignals) {
    await assertActiveLease();
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
      },
    });
    emitted += 1;
  }
  return { skipped: false as const, checked, emitted, exceptions,
    assignmentsScanned: cohort.assignmentsScanned, pages: cohort.pages };
}
