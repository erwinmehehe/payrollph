/**
 * Pure, Philippine-calendar roster helpers. The API and client share these
 * contracts so we do not infer dates or working time from browser timezone.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function rosterDateOffset(date: string, offset: number): string {
  if (!ISO_DATE.test(date) || !Number.isInteger(offset)) {
    throw new Error("Roster date must be YYYY-MM-DD with an integer offset.");
  }
  const start = new Date(date + "T00:00:00Z");
  if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== date) {
    throw new Error("Roster date is not a valid calendar day.");
  }
  start.setUTCDate(start.getUTCDate() + offset);
  return start.toISOString().slice(0, 10);
}

export function rosterWeekDates(startDate: string): string[] {
  return Array.from({ length: 7 }, (_, index) => rosterDateOffset(startDate, index));
}

export type TeamRosterDay = {
  date: string;
  source: "pattern" | "override" | "unassigned";
  isRestDay: boolean;
  worksiteId: number | null;
  segments: Array<{
    shiftDefinitionId: number;
    shiftCode: string;
    startTime: string;
    endTime: string;
    breakMinutes: number;
    spansMidnight: boolean;
  }>;
};

export type TeamRosterEmployee = {
  id: number;
  employeeNo: string;
  name: string;
  status: string;
  orgUnitId: number | null;
};

export type TeamRosterRow = {
  employee: TeamRosterEmployee;
  days: TeamRosterDay[];
  error: string | null;
};

export type TeamRosterSummary = {
  employees: number;
  scheduledDays: number;
  restDays: number;
  unassignedDays: number;
  overnightShifts: number;
  rowsNeedingReview: number;
};

export function summarizeTeamRoster(rows: TeamRosterRow[]): TeamRosterSummary {
  const summary: TeamRosterSummary = {
    employees: rows.length,
    scheduledDays: 0,
    restDays: 0,
    unassignedDays: 0,
    overnightShifts: 0,
    rowsNeedingReview: 0,
  };
  for (const row of rows) {
    if (row.error) summary.rowsNeedingReview += 1;
    for (const day of row.days) {
      if (day.source === "unassigned") summary.unassignedDays += 1;
      if (day.isRestDay) summary.restDays += 1;
      if (!day.isRestDay && day.segments.length > 0) summary.scheduledDays += 1;
      summary.overnightShifts += day.segments.filter((segment) => segment.spansMidnight).length;
    }
  }
  return summary;
}

/** A page-local operations view; not the organization's staffing requirement. */
export type TeamRosterFocus = "all" | "attention" | "overnight";

export type TeamRosterDayDigest = {
  date: string;
  scheduledEmployees: number;
  restEmployees: number;
  unassignedEmployees: number;
  overnightSegments: number;
  needsReviewEmployees: number;
};

function assertWeekDates(dates: readonly string[]): void {
  if (dates.length !== 7) throw new Error("A seven-day roster window is required.");
  const expected = rosterWeekDates(dates[0]);
  if (expected.some((date, index) => date !== dates[index])) {
    throw new Error("Roster dates must be consecutive and use YYYY-MM-DD.");
  }
}

function uniqueDay(row: TeamRosterRow, date: string): TeamRosterDay | null {
  const matching = row.days.filter((day) => day.date === date);
  return matching.length === 1 ? matching[0] : null;
}

/**
 * Never infer that an employee with missing, duplicated or unassigned
 * scheduling evidence is on an approved rest day.
 */
export function rosterRowNeedsAttention(
  row: TeamRosterRow,
  dates: readonly string[],
): boolean {
  assertWeekDates(dates);
  if (row.error) return true;
  return dates.some((date) => {
    const day = uniqueDay(row, date);
    return day === null || day.source === "unassigned"
      || (!day.isRestDay && day.segments.length === 0);
  });
}

export function filterTeamRosterRows(
  rows: readonly TeamRosterRow[],
  dates: readonly string[],
  focus: TeamRosterFocus,
): TeamRosterRow[] {
  assertWeekDates(dates);
  if (focus === "all") return [...rows];
  if (focus === "attention") return rows.filter((row) => rosterRowNeedsAttention(row, dates));
  if (focus === "overnight") {
    return rows.filter((row) => !row.error && row.days.some((day) =>
      dates.includes(day.date) && day.segments.some((segment) => segment.spansMidnight)
    ));
  }
  throw new Error("Unsupported roster focus.");
}

export function summarizeTeamRosterByDate(
  rows: readonly TeamRosterRow[],
  dates: readonly string[],
): TeamRosterDayDigest[] {
  assertWeekDates(dates);
  return dates.map((date) => {
    const digest: TeamRosterDayDigest = {
      date,
      scheduledEmployees: 0,
      restEmployees: 0,
      unassignedEmployees: 0,
      overnightSegments: 0,
      needsReviewEmployees: 0,
    };
    for (const row of rows) {
      const day = row.error ? null : uniqueDay(row, date);
      if (!day) {
        digest.needsReviewEmployees += 1;
      } else if (day.source === "unassigned") {
        digest.unassignedEmployees += 1;
        digest.needsReviewEmployees += 1;
      } else if (day.isRestDay) {
        digest.restEmployees += 1;
      } else if (day.segments.length === 0) {
        digest.needsReviewEmployees += 1;
      } else {
        digest.scheduledEmployees += 1;
        digest.overnightSegments += day.segments.filter((segment) => segment.spansMidnight).length;
      }
    }
    return digest;
  });
}

/**
 * Export exactly one already-authorized API page. Escapes CSV delimiters and
 * neutralizes spreadsheet formula prefixes in employee or shift text.
 * Never adds payroll amounts, unrequested employees or a hidden extra page.
 */
export function buildTeamRosterPageCsv(
  rows: readonly TeamRosterRow[],
  dates: readonly string[],
): string {
  assertWeekDates(dates);
  const escapeCell = (value: string | number | null | undefined): string => {
    const raw = String(value ?? "");
    const neutralized = /^[\s\u0000-\u001f]*[=+\-@]/u.test(raw) ? "'" + raw : raw;
    return '"' + neutralized.replace(/"/g, '""') + '"';
  };
  const record = (cells: Array<string | number | null | undefined>) =>
    cells.map(escapeCell).join(",");
  const lines = [record([
    "Employee number", "Employee", "Employment status", "Work date",
    "Roster evidence", "Schedule", "Worksite ID", "Overnight", "Needs review",
  ])];
  for (const row of rows) {
    for (const date of dates) {
      const day = row.error ? null : uniqueDay(row, date);
      const missingEvidence = row.error !== null || day === null;
      const needsReview = missingEvidence || day?.source === "unassigned"
        || (day !== null && !day.isRestDay && day.segments.length === 0);
      const evidence = missingEvidence
        ? "Needs review"
        : day!.source === "unassigned" ? "Unassigned" : day!.source;
      const schedule = missingEvidence ? "Evidence unavailable"
        : day!.source === "unassigned" ? "No assigned rotation"
        : day!.isRestDay ? "Rest day"
        : day!.segments.length ? day!.segments.map((segment) =>
          segment.shiftCode + " " + segment.startTime + "-" + segment.endTime
        ).join(" / ") : "No shift (review)";
      lines.push(record([
        row.employee.employeeNo, row.employee.name, row.employee.status,
        date, evidence, schedule, missingEvidence ? null : day!.worksiteId,
        !missingEvidence && day!.segments.some((segment) => segment.spansMidnight)
          ? "Yes" : "No",
        needsReview ? "Yes" : "No",
      ]));
    }
  }
  return lines.join("\r\n") + "\r\n";
}
