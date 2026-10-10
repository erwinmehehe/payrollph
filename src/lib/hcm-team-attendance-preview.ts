/** Advisory source evidence only: not a verified absence, payroll record or shift-coverage certification. */
export type TeamAttendanceDay = {
  employeeId: number;
  name: string;
  workDate: string;
  scheduledSegments: number;
  overnightSegments: number;
  punchRecords: number;
  incompletePunchRecords: number;
  state: "scheduled" | "rest_day" | "unassigned" | "review";
};
export type TeamAttendanceResponse = {
  organizationId: number;
  workDate: string;
  observedAt: string;
  scope: { kind: "company"; orgUnitId: null } | { kind: "unit"; orgUnitId: number };
  rows: TeamAttendanceDay[];
  summary: ReturnType<typeof summarizeTeamAttendance>;
  page: { size: 10; hasMore: boolean; nextCursor: number | null };
  warning: string;
};

/** Input is a resolved, current, employer-scoped WFM day, never a guessed shift. */
export function classifyTeamAttendance(input: {
  employeeId: number;
  name: string;
  workDate: string;
  schedule: { source: "pattern" | "override" | "unassigned"; isRestDay: boolean; segments: { spansMidnight: boolean }[] };
  punches: { timeIn: Date | null; timeOut: Date | null }[];
}): TeamAttendanceDay {
  const { schedule, punches } = input;
  // Both timestamps missing is also incomplete source evidence, not a valid recorded shift.
  const incomplete = punches.filter(p => p.timeIn === null || p.timeOut === null).length;
  const state: TeamAttendanceDay["state"] = schedule.source === "unassigned" ? "unassigned"
    : incomplete > 0 || (schedule.isRestDay && punches.length > 0)
      || (!schedule.isRestDay && schedule.segments.length === 0) ? "review"
    : schedule.isRestDay ? "rest_day" : "scheduled";
  return {
    employeeId: input.employeeId, name: input.name, workDate: input.workDate,
    scheduledSegments: schedule.segments.length,
    overnightSegments: schedule.segments.filter(s => s.spansMidnight).length,
    punchRecords: punches.length, incompletePunchRecords: incomplete, state,
  };
}

/** All totals are bounded to the page already authorized, not an employer or site census. */
export function summarizeTeamAttendance(rows: readonly TeamAttendanceDay[]) {
  return {
    employeeDaysOnPage: rows.length,
    scheduledSegmentsOnPage: rows.reduce((n, row) => n + row.scheduledSegments, 0),
    recordedPunchesOnPage: rows.reduce((n, row) => n + row.punchRecords, 0),
    reviewRowsOnPage: rows.filter(row => row.state === "review" || row.state === "unassigned").length,
  };
}
