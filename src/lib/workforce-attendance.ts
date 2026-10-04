import { deriveClockHours } from "@/lib/payroll-rules";
import {
  matchPunchesToWorkforceSegments,
} from "@/lib/workforce-payroll";
import type {
  ResolvedDailySchedule,
  ResolvedScheduleSegment,
} from "@/lib/workforce-scheduling";
import {
  resolveOvertimeAuthorizationDay,
  type OvertimeAuthorizationDay,
  type OvertimeRequestEvidence,
} from "@/lib/workforce-overtime";

export type AttendanceExceptionSeverity = "info" | "warning" | "blocker";

export type AttendanceExceptionKind =
  | "missing_punch"
  | "duplicate_punch"
  | "schedule_punch_mismatch"
  | "unscheduled_work"
  | "worked_rest_day"
  | "incomplete_punch"
  | "clock_integrity"
  | "early_clock_in"
  | "late_arrival"
  | "early_departure"
  | "late_clock_out"
  | "overtime_authorization";

export type AttendanceException = {
  kind: AttendanceExceptionKind;
  severity: AttendanceExceptionSeverity;
  message: string;
  punchId?: number;
  minutes?: number;
};

export type AttendancePunchInput = {
  id: number;
  timeIn: Date | string | null;
  timeOut: Date | string | null;
  breakStart?: Date | string | null;
  breakEnd?: Date | string | null;
  shiftStart?: string | null;
  shiftEnd?: string | null;
};

export type AttendanceDayAnalysis = {
  date: string;
  source: ResolvedDailySchedule["source"];
  isRestDay: boolean;
  scheduledSegments: number;
  punchCount: number;
  workedMinutes: number;
  overtimeMinutes: number;
  tardinessMinutes: number;
  undertimeMinutes: number;
  exceptions: AttendanceException[];
  reviewRequired: boolean;
  overtimeAuthorization: OvertimeAuthorizationDay;
};

function asDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function toPayrollLocalIso(value: Date | string | null | undefined) {
  const date = asDate(value);
  if (!date) return null;
  // PayrollPH is Philippine payroll. Convert the absolute timestamp to UTC+8
  // before passing it to deriveClockHours, whose parser intentionally treats
  // the date/time components as local wall-clock values.
  const local = new Date(date.getTime() + 8 * 60 * 60_000);
  return local.toISOString().slice(0, 19);
}

function scheduledStartInstant(workDate: string, segment: ResolvedScheduleSegment) {
  const seconds = segment.startTime.length === 5 ? ":00" : "";
  return new Date(`${workDate}T${segment.startTime}${seconds}+08:00`);
}

function duplicatePunchIds(punches: AttendancePunchInput[]) {
  const seen = new Map<string, number>();
  const duplicates = new Set<number>();
  for (const punch of punches) {
    const fingerprint = [
      asDate(punch.timeIn)?.toISOString() ?? "",
      asDate(punch.timeOut)?.toISOString() ?? "",
    ].join("|");
    if (fingerprint === "|") continue;
    const prior = seen.get(fingerprint);
    if (prior != null) {
      duplicates.add(prior);
      duplicates.add(punch.id);
    } else {
      seen.set(fingerprint, punch.id);
    }
  }
  return duplicates;
}

export function analyzeAttendanceDay(input: {
  date: string;
  schedule: ResolvedDailySchedule;
  punches: AttendancePunchInput[];
  overtimeRequests?: OvertimeRequestEvidence[];
  earlyClockInThresholdMinutes?: number;
}): AttendanceDayAnalysis {
  const exceptions: AttendanceException[] = [];
  const punches = [...input.punches].sort((a, b) => {
    const aTime = asDate(a.timeIn)?.getTime() ?? Number.POSITIVE_INFINITY;
    const bTime = asDate(b.timeIn)?.getTime() ?? Number.POSITIVE_INFINITY;
    return aTime - bTime || a.id - b.id;
  });
  const duplicateIds = duplicatePunchIds(punches);
  for (const punchId of duplicateIds) {
    exceptions.push({
      kind: "duplicate_punch",
      severity: "blocker",
      punchId,
      message: `${input.date}: duplicate attendance record detected for punch #${punchId}.`,
    });
  }

  const advancedWorkingDay =
    input.schedule.source !== "unassigned"
    && !input.schedule.isRestDay
    && input.schedule.segments.length > 0;

  if (advancedWorkingDay && punches.length === 0) {
    exceptions.push({
      kind: "missing_punch",
      severity: "blocker",
      message: `${input.date}: scheduled work has no attendance punch.`,
    });
  }

  if (input.schedule.source === "unassigned" && punches.length > 0) {
    exceptions.push({
      kind: "unscheduled_work",
      severity: "warning",
      message: `${input.date}: attendance exists but no advanced workforce schedule is assigned.`,
    });
  }

  if (input.schedule.isRestDay && punches.length > 0) {
    exceptions.push({
      kind: "worked_rest_day",
      severity: "info",
      message: `${input.date}: attendance was recorded on the employee's resolved rest day.`,
    });
  }

  const match = matchPunchesToWorkforceSegments({
    date: input.date,
    schedule: input.schedule,
    punches: punches.map((punch) => ({ id: punch.id, timeIn: punch.timeIn })),
  });
  if (match.exception && punches.length > 0) {
    exceptions.push({
      kind: "schedule_punch_mismatch",
      severity: "blocker",
      message: match.exception,
    });
  }

  let workedMinutes = 0;
  let overtimeMinutes = 0;
  let tardinessMinutes = 0;
  let undertimeMinutes = 0;
  const earlyThreshold = Math.max(0, input.earlyClockInThresholdMinutes ?? 15);

  for (const punch of punches) {
    if (!punch.timeIn || !punch.timeOut) {
      exceptions.push({
        kind: "incomplete_punch",
        severity: "blocker",
        punchId: punch.id,
        message: `${input.date}: punch #${punch.id} is missing an IN or OUT timestamp.`,
      });
      continue;
    }

    const segment = match.segmentByPunchId.get(punch.id);
    const shiftStart = segment?.startTime ?? punch.shiftStart ?? "09:00";
    const shiftEnd = segment?.endTime ?? punch.shiftEnd ?? "18:00";
    const derived = deriveClockHours({
      timeIn: toPayrollLocalIso(punch.timeIn),
      timeOut: toPayrollLocalIso(punch.timeOut),
      breakStart: toPayrollLocalIso(punch.breakStart),
      breakEnd: toPayrollLocalIso(punch.breakEnd),
    }, {
      start: shiftStart,
      end: shiftEnd,
      breakMinutes: segment?.breakMinutes ?? 60,
      graceMinutes: 5,
    });

    workedMinutes += derived.workedMinutes;
    overtimeMinutes += derived.overtimeMinutes;
    tardinessMinutes += derived.tardinessMinutes;
    undertimeMinutes += derived.undertimeMinutes;

    for (const flag of derived.flags) {
      exceptions.push({
        kind: "clock_integrity",
        severity: "blocker",
        punchId: punch.id,
        message: `${input.date}: punch #${punch.id}: ${flag}`,
      });
    }

    if (segment) {
      const actualIn = asDate(punch.timeIn);
      const scheduledStart = scheduledStartInstant(input.date, segment);
      if (actualIn && Number.isFinite(scheduledStart.getTime())) {
        const earlyMinutes = Math.max(
          0,
          Math.round((scheduledStart.getTime() - actualIn.getTime()) / 60_000),
        );
        if (earlyMinutes > earlyThreshold) {
          exceptions.push({
            kind: "early_clock_in",
            severity: "info",
            punchId: punch.id,
            minutes: earlyMinutes,
            message: `${input.date}: punch #${punch.id} clocked in ${earlyMinutes} minute(s) before the scheduled shift.`,
          });
        }
      }
    }

    if (derived.tardinessMinutes > 0) {
      exceptions.push({
        kind: "late_arrival",
        severity: "warning",
        punchId: punch.id,
        minutes: derived.tardinessMinutes,
        message: `${input.date}: punch #${punch.id} is ${derived.tardinessMinutes} minute(s) late beyond grace.`,
      });
    }
    if (derived.undertimeMinutes > 0) {
      exceptions.push({
        kind: "early_departure",
        severity: "warning",
        punchId: punch.id,
        minutes: derived.undertimeMinutes,
        message: `${input.date}: punch #${punch.id} ends ${derived.undertimeMinutes} minute(s) before the scheduled shift end.`,
      });
    }
    if (derived.overtimeMinutes > 0) {
      exceptions.push({
        kind: "late_clock_out",
        severity: "info",
        punchId: punch.id,
        minutes: derived.overtimeMinutes,
        message: `${input.date}: punch #${punch.id} includes ${derived.overtimeMinutes} minute(s) beyond the scheduled shift end.`,
      });
    }
  }

  const overtimeAuthorization = resolveOvertimeAuthorizationDay({
    actualOvertimeMinutes: overtimeMinutes,
    requests: input.overtimeRequests ?? [],
  });
  if (overtimeAuthorization.reviewRequired) {
    exceptions.push({
      kind: "overtime_authorization",
      severity: "blocker",
      minutes: overtimeMinutes,
      message:
        overtimeAuthorization.reviewReason === "multiple_requests"
          ? `${input.date}: multiple overtime authorization requests conflict with ${overtimeMinutes} worked OT minute(s).`
          : overtimeAuthorization.reviewReason === "missing_request"
            ? `${input.date}: ${overtimeMinutes} worked OT minute(s) have no authorization request.`
            : overtimeAuthorization.reviewReason === "not_approved"
              ? `${input.date}: ${overtimeMinutes} worked OT minute(s) are attached to a request that is not approved.`
              : `${input.date}: worked OT exceeds the approved minutes and requires manager review.`,
    });
  }

  return {
    date: input.date,
    source: input.schedule.source,
    isRestDay: input.schedule.isRestDay,
    scheduledSegments: input.schedule.segments.length,
    punchCount: punches.length,
    workedMinutes,
    overtimeMinutes,
    tardinessMinutes,
    undertimeMinutes,
    exceptions,
    reviewRequired: exceptions.some((exception) => exception.severity === "blocker"),
    overtimeAuthorization,
  };
}
