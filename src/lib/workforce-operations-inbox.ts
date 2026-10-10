/**
 * Privacy-minimized read-only projections for the WFM manager operations view.
 * Source APIs remain the authority for scope and decisions. Nothing here
 * changes a punch, schedule, timesheet, approval or payroll run.
 */

export type AttendanceOpsCounts = {
  open: number;
  overdue: number;
  unassigned: number;
  resolved: number;
};

export type TimesheetOpsCounts = {
  pendingReview: number;
  stale: number;
  rejected: number;
  blockers: number;
  missingExpected: number;
  approved: number;
  otherStatuses: number;
  enforcement: "block" | "advisory";
};

export type WfmOpsSignal = {
  id: string;
  priority: "urgent" | "review";
  label: string;
  count: number;
  destination: "attendance" | "timesheets";
};

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Unexpected WFM source response.");
  }
  return value as Record<string, unknown>;
}

function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("Invalid WFM count evidence.");
  }
  return value as number;
}

function positiveId(value: unknown): number {
  const result = count(value);
  if (result === 0) throw new Error("Invalid WFM source identifier.");
  return result;
}

/** Drop worker records and messages before a source response enters React state. */
export function projectAttendanceOps(payload: unknown): AttendanceOpsCounts {
  const summary = object(object(payload).summary);
  const projected = {
    open: count(summary.open),
    overdue: count(summary.overdue),
    unassigned: count(summary.unassigned),
    resolved: count(summary.resolved),
  };
  if (projected.overdue > projected.open || projected.unassigned > projected.open) {
    throw new Error("Inconsistent WFM attendance summary.");
  }
  return projected;
}

/**
 * Report only the selected exact timesheet period. A generic month or
 * fortnight is NOT assumed to be the employer's authorized payroll cycle.
 */
export function projectTimesheetOps(payload: unknown): TimesheetOpsCounts {
  const data = object(payload);
  if (data.manager !== true || !Array.isArray(data.latest) || !Array.isArray(data.expectations)) {
    throw new Error("The manager timesheet summary is unavailable.");
  }
  const policy = object(data.policy);
  if (typeof policy.active !== "boolean" || !["advisory", "block"].includes(String(policy.enforcementMode))) {
    throw new Error("Unknown timesheet enforcement policy.");
  }
  const enforcement = policy.active && policy.enforcementMode === "block" ? "block" : "advisory";
  const latest = new Map<number, { status: string; blockerCount: number }>();
  for (const item of data.latest) {
    const row = object(item);
    const employeeId = positiveId(row.employeeId);
    if (typeof row.status !== "string" || latest.has(employeeId)) {
      throw new Error("Invalid or duplicate latest timesheet evidence.");
    }
    latest.set(employeeId, {
      status: row.status,
      blockerCount: count(row.blockerCount),
    });
  }

  const awaiting = new Set<number>();
  for (const item of data.expectations) {
    const row = object(item);
    const employeeId = positiveId(row.employeeId);
    if (typeof row.status !== "string") throw new Error("Invalid timesheet expectation.");
    if (row.status === "expected" && !latest.has(employeeId)) {
      awaiting.add(employeeId);
    }
  }
  const values = [...latest.values()];
  return {
    pendingReview: values.filter((row) => row.status === "submitted").length,
    stale: values.filter((row) => row.status === "stale").length,
    rejected: values.filter((row) => row.status === "rejected").length,
    blockers: values.filter((row) => row.blockerCount > 0).length,
    missingExpected: awaiting.size,
    approved: values.filter((row) => row.status === "approved").length,
    otherStatuses: values.filter((row) =>
      !["submitted", "stale", "rejected", "approved"].includes(row.status)).length,
    enforcement,
  };
}

export function buildWfmOpsSignals(
  attendance: AttendanceOpsCounts | null,
  timesheets: TimesheetOpsCounts | null,
): WfmOpsSignal[] {
  const signals: WfmOpsSignal[] = [];
  const add = (id: string, priority: "urgent" | "review", label: string, value: number, destination: WfmOpsSignal["destination"]) => {
    if (value > 0) signals.push({ id, priority, label, count: value, destination });
  };
  if (attendance) {
    add("attendance-overdue", "urgent", "Overdue attendance cases", attendance.overdue, "attendance");
    add("attendance-unassigned", "review", "Attendance cases without an owner", attendance.unassigned, "attendance");
    add("attendance-open", "review", "Open attendance cases", attendance.open, "attendance");
  }
  if (timesheets) {
    const blocking = timesheets.enforcement === "block" ? "urgent" : "review";
    add("timesheet-blocker", blocking, "Timecards containing source blockers", timesheets.blockers, "timesheets");
    add("timesheet-missing", blocking, "Expected timesheets without a submitted version", timesheets.missingExpected, "timesheets");
    add("timesheet-stale", "review", "Stale timecards requiring resubmission", timesheets.stale, "timesheets");
    add("timesheet-rejected", "review", "Returned timecards requiring correction", timesheets.rejected, "timesheets");
    add("timesheet-submitted", "review", "Submitted timecards awaiting checker review", timesheets.pendingReview, "timesheets");
    add("timesheet-unknown", "review", "Timecards with unfamiliar statuses", timesheets.otherStatuses, "timesheets");
  }
  return signals.sort((a, b) => Number(a.priority !== "urgent") - Number(b.priority !== "urgent") || a.id.localeCompare(b.id));
}

function calendarDate(text: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("A valid ISO work date is required.");
  const date = new Date(text + "T00:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new Error("A valid ISO work date is required.");
  }
  return date;
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function recentAttendanceWindow(phToday: string): { startDate: string; endDate: string } {
  const today = calendarDate(phToday);
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 13);
  return { startDate: iso(start), endDate: phToday };
}

/** Suggested *completed* half-month only; employers may use other cutoffs. */
export function suggestCompletedHalfMonth(phToday: string): { periodStart: string; periodEnd: string } {
  const today = calendarDate(phToday);
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  if (today.getUTCDate() >= 16) {
    return {
      periodStart: iso(new Date(Date.UTC(y, m, 1))),
      periodEnd: iso(new Date(Date.UTC(y, m, 15))),
    };
  }
  return {
    periodStart: iso(new Date(Date.UTC(y, m - 1, 16))),
    periodEnd: iso(new Date(Date.UTC(y, m, 0))),
  };
}
