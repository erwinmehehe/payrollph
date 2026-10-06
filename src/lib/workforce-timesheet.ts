import { createHash } from "node:crypto";
import type { ResolvedDailySchedule } from "@/lib/workforce-scheduling";

export type TimesheetPolicy = {
  active: boolean;
  enforcementMode: "advisory" | "block";
};

export type TimesheetGateRow = {
  employeeId: number;
  status: string;
  version: number;
};

export type TimesheetGateResult = {
  allowed: boolean;
  blocking: boolean;
  requiredEmployeeIds: number[];
  approvedEmployeeIds: number[];
  missingEmployeeIds: number[];
  nonApprovedEmployeeIds: number[];
};

function timeMinute(value: string) {
  const [hour, minute] = value.slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

export function scheduledMinutesForDay(day: ResolvedDailySchedule) {
  return day.segments.reduce((sum, segment) => {
    const start = timeMinute(segment.startTime);
    let end = timeMinute(segment.endTime);
    if (segment.spansMidnight || end <= start) end += 1440;
    return sum + Math.max(0, end - start - Math.max(0, segment.breakMinutes));
  }, 0);
}

export function datesBetween(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];
  const dates: string[] = [];
  for (let cursor = new Date(start); cursor <= end && dates.length <= 31; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

export function dateCoveredByApprovedLeave(
  date: string,
  leaves: Array<{ startDate: string; endDate: string; status: string }>,
) {
  return leaves.some((leave) =>
    leave.status.toLowerCase() === "approved"
    && leave.startDate <= date
    && leave.endDate >= date,
  );
}

export function hashTimesheetSnapshot(snapshot: unknown) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

export function evaluateTimesheetPayrollGate(input: {
  policy: TimesheetPolicy;
  employeeIds: number[];
  latestTimesheets: TimesheetGateRow[];
}): TimesheetGateResult {
  const requiredEmployeeIds = [...new Set(input.employeeIds)].sort((a, b) => a - b);
  const latestByEmployee = new Map(
    input.latestTimesheets.map((row) => [row.employeeId, row]),
  );
  const approvedEmployeeIds: number[] = [];
  const missingEmployeeIds: number[] = [];
  const nonApprovedEmployeeIds: number[] = [];

  for (const employeeId of requiredEmployeeIds) {
    const row = latestByEmployee.get(employeeId);
    if (!row) {
      missingEmployeeIds.push(employeeId);
      continue;
    }
    if (row.status === "approved") approvedEmployeeIds.push(employeeId);
    else nonApprovedEmployeeIds.push(employeeId);
  }

  const blocking =
    input.policy.active
    && input.policy.enforcementMode === "block"
    && (missingEmployeeIds.length > 0 || nonApprovedEmployeeIds.length > 0);

  return {
    allowed: !blocking,
    blocking,
    requiredEmployeeIds,
    approvedEmployeeIds,
    missingEmployeeIds,
    nonApprovedEmployeeIds,
  };
}
