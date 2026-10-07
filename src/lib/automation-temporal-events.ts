import { eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  attendanceExceptionEvents,
  openShifts,
  payrollRuns,
  schedulerState,
  workforceTimesheets,
} from "@/db/schema";
import { runAutomationEventSafely } from "@/lib/automation";

const SCHEDULE_JOB = "automation-temporal-sla-events";
const SCHEDULE_INTERVAL_MS = 60 * 60 * 1000;

export type DeadlineBucket =
  | "within_7_days"
  | "within_3_days"
  | "within_1_day"
  | "due_today"
  | "overdue_1_2_days"
  | "overdue_3_6_days"
  | "overdue_7_plus_days";

export type AgeBucket =
  | "4h"
  | "8h"
  | "24h"
  | "48h"
  | "72h_plus";

export function phBusinessDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(now);
}

export function daysUntilDate(date: string, today: string) {
  const target = Date.parse(date + "T00:00:00Z");
  const base = Date.parse(today + "T00:00:00Z");
  return Math.round((target - base) / 86_400_000);
}

export function deadlineBucket(daysUntil: number): DeadlineBucket | null {
  if (!Number.isFinite(daysUntil) || daysUntil > 7) return null;
  if (daysUntil >= 4) return "within_7_days";
  if (daysUntil >= 2) return "within_3_days";
  if (daysUntil === 1) return "within_1_day";
  if (daysUntil === 0) return "due_today";
  if (daysUntil >= -2) return "overdue_1_2_days";
  if (daysUntil >= -6) return "overdue_3_6_days";
  return "overdue_7_plus_days";
}

export function ageBucket(ageHours: number): AgeBucket | null {
  if (!Number.isFinite(ageHours) || ageHours < 4) return null;
  if (ageHours < 8) return "4h";
  if (ageHours < 24) return "8h";
  if (ageHours < 48) return "24h";
  if (ageHours < 72) return "48h";
  return "72h_plus";
}

export function ageHoursSince(value: Date, now = new Date()) {
  return Math.max(0, Math.floor((now.getTime() - value.getTime()) / 3_600_000));
}

async function emitPayrollPayDateEvents(today: string) {
  const rows = await db.select().from(payrollRuns)
    .where(ne(payrollRuns.status, "Released"));
  const outcomes = [];

  for (const row of rows) {
    const daysUntilDeadline = daysUntilDate(String(row.payDate), today);
    const bucket = deadlineBucket(daysUntilDeadline);
    if (!bucket) continue;

    const automation = await runAutomationEventSafely({
      organizationId: row.organizationId,
      trigger: "payroll.pay_date_approaching",
      eventKey: `payroll-pay-date:${row.id}:${bucket}`,
      context: {
        deadlineType: "pay_date",
        deadlineBucket: bucket,
        daysUntilDeadline,
        payrollRunId: row.id,
        payrollRunStatus: row.status,
        payrollPeriodLabel: row.periodLabel,
        periodStart: String(row.periodStart),
        periodEnd: String(row.periodEnd),
        payDate: String(row.payDate),
        legalEntityId: row.legalEntityId,
        payrollAmount: Number(row.netPay),
        payrollExceptions: row.exceptions,
      },
    });

    outcomes.push({ payrollRunId: row.id, bucket, automation });
  }

  return outcomes;
}

async function emitTimesheetCutoffEvents(today: string) {
  const rows = await db.select().from(workforceTimesheets)
    .where(inArray(workforceTimesheets.status, ["submitted", "rejected", "stale"]));
  const outcomes = [];

  for (const row of rows) {
    const daysUntilDeadline = daysUntilDate(String(row.periodEnd), today);
    const bucket = deadlineBucket(daysUntilDeadline);
    if (!bucket) continue;

    const automation = await runAutomationEventSafely({
      organizationId: row.organizationId,
      employeeId: row.employeeId,
      trigger: "timesheet.cutoff_approaching",
      eventKey: `timesheet-cutoff:${row.id}:${row.version}:${bucket}`,
      context: {
        deadlineType: "timesheet_cutoff",
        deadlineBucket: bucket,
        daysUntilDeadline,
        timesheetId: row.id,
        timesheetVersion: row.version,
        timesheetStatus: row.status,
        periodStart: String(row.periodStart),
        periodEnd: String(row.periodEnd),
        timesheetBlockerCount: row.blockerCount,
        attendanceExceptionCount: row.exceptionCount,
        overtimeMinutes: row.overtimeMinutes,
      },
    });

    outcomes.push({ timesheetId: row.id, employeeId: row.employeeId, bucket, automation });
  }

  return outcomes;
}

async function emitAttendanceAgingEvents(now: Date) {
  const rows = await db.select().from(attendanceExceptionEvents)
    .where(eq(attendanceExceptionEvents.status, "open"));
  const outcomes = [];

  for (const row of rows) {
    const ageHours = ageHoursSince(row.firstDetectedAt, now);
    const bucket = ageBucket(ageHours);
    if (!bucket) continue;

    const automation = await runAutomationEventSafely({
      organizationId: row.organizationId,
      employeeId: row.employeeId,
      trigger: "attendance.exception_aging",
      eventKey: `attendance-exception-aging:${row.id}:${bucket}`,
      context: {
        attendanceExceptionId: row.id,
        attendanceExceptionKind: row.exceptionKind,
        attendanceExceptionSeverity: row.severity,
        attendanceExceptionStatus: row.status,
        workDate: String(row.workDate),
        minutes: row.minutes,
        ageHours,
        ageBucket: bucket,
        firstDetectedAt: row.firstDetectedAt.toISOString(),
        lastDetectedAt: row.lastDetectedAt.toISOString(),
      },
    });

    outcomes.push({ attendanceExceptionId: row.id, employeeId: row.employeeId, bucket, automation });
  }

  return outcomes;
}

async function emitCoverageDeadlineEvents(today: string) {
  const rows = await db.select().from(openShifts)
    .where(eq(openShifts.status, "open"));
  const outcomes = [];

  for (const row of rows) {
    const daysUntilDeadline = daysUntilDate(String(row.workDate), today);
    const bucket = deadlineBucket(daysUntilDeadline);
    if (!bucket) continue;

    const automation = await runAutomationEventSafely({
      organizationId: row.organizationId,
      trigger: "coverage.gap_approaching",
      eventKey: `coverage-gap:${row.id}:${bucket}`,
      context: {
        deadlineType: "coverage_gap",
        deadlineBucket: bucket,
        daysUntilDeadline,
        openShiftId: row.id,
        sourceRequirementId: row.sourceRequirementId,
        worksiteId: row.worksiteId,
        workDate: String(row.workDate),
        shiftDefinitionId: row.shiftDefinitionId,
        jobProfileId: row.jobProfileId,
        coverageSlots: row.slots,
        coverageStatus: row.status,
        reason: row.reason,
      },
    });

    outcomes.push({ openShiftId: row.id, bucket, automation });
  }

  return outcomes;
}

export async function runScheduledAutomationTemporalEvents(options: {
  now?: Date;
  force?: boolean;
} = {}) {
  const now = options.now ?? new Date();
  const force = options.force === true;

  const [state] = await db.select().from(schedulerState)
    .where(eq(schedulerState.jobName, SCHEDULE_JOB))
    .limit(1);

  if (!force && state?.lastRunAt && now.getTime() - state.lastRunAt.getTime() < SCHEDULE_INTERVAL_MS) {
    return { skipped: true as const, reason: "scheduler-interval" as const, lastRunAt: state.lastRunAt };
  }

  const today = phBusinessDate(now);
  const [payroll, timesheets, attendance, coverage] = await Promise.all([
    emitPayrollPayDateEvents(today),
    emitTimesheetCutoffEvents(today),
    emitAttendanceAgingEvents(now),
    emitCoverageDeadlineEvents(today),
  ]);

  const payload = {
    at: now.toISOString(),
    today,
    payrollEvents: payroll.length,
    timesheetEvents: timesheets.length,
    attendanceEvents: attendance.length,
    coverageEvents: coverage.length,
    results: {
      payroll: payroll.slice(0, 50),
      timesheets: timesheets.slice(0, 50),
      attendance: attendance.slice(0, 50),
      coverage: coverage.slice(0, 50),
    },
  };

  await db.insert(schedulerState).values({
    jobName: SCHEDULE_JOB,
    lastRunAt: now,
    lastResult: payload,
  }).onConflictDoUpdate({
    target: schedulerState.jobName,
    set: {
      lastRunAt: now,
      lastResult: payload,
    },
  });

  return { skipped: false as const, ...payload };
}
