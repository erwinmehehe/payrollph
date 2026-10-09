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
