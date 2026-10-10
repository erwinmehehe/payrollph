/**
 * Proposal-only bulk roster checks on a single authorized team-roster page.
 * These are not availability, HCM qualification, labor law or payroll checks.
 * No schedule is persisted and there is no "ready to publish" state.
 */
import {
  rosterWeekDates,
  type TeamRosterRow,
  type TeamRosterDay,
} from "./workforce-team-roster";

export type BulkPreviewShift = {
  id: number;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  spansMidnight: boolean;
};

export type BulkPreviewRow = {
  employeeId: number;
  employeeNo: string;
  employeeName: string;
  workDate: string;
  existing: string;
  proposed: string;
  status: "blocked" | "review" | "unchanged";
  reasons: string[];
};

function clockMinutes(value: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new Error("Invalid shift clock evidence.");
  }
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

function ordinal(date: string): number {
  const ms = Date.parse(date + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(ms)
    || new Date(ms).toISOString().slice(0, 10) !== date) {
    throw new Error("Invalid Philippine work date.");
  }
  return Math.trunc(ms / 86_400_000);
}

function windowFor(date: string, start: string, end: string, spansMidnight: boolean): { start: number; end: number } {
  const begin = ordinal(date) * 1440 + clockMinutes(start);
  let finish = ordinal(date) * 1440 + clockMinutes(end);
  if (spansMidnight) finish += 1440;
  if (finish <= begin || finish - begin > 1440) {
    throw new Error("Invalid shift duration evidence.");
  }
  return { start: begin, end: finish };
}

function describe(day: TeamRosterDay): string {
  if (day.source === "unassigned") return "Unassigned";
  if (day.isRestDay) return "Recorded rest day";
  if (!day.segments.length) return "No shift evidence";
  return day.segments.map(s => s.shiftCode + " " + s.startTime + "-" + s.endTime).join(" / ");
}

function currentIntervals(row: TeamRosterRow, workDate: string) {
  return row.days.filter(day => day.date !== workDate && !day.isRestDay).flatMap(day =>
    day.segments.map(segment => windowFor(day.date, segment.startTime, segment.endTime, segment.spansMidnight)));
}

export function previewBulkRosterDay(input: {
  weekDates: readonly string[];
  rows: readonly TeamRosterRow[];
  selectedEmployeeIds: readonly number[];
  workDate: string;
  today: string;
  shift: BulkPreviewShift;
}): BulkPreviewRow[] {
  if (input.weekDates.length !== 7 ||
    rosterWeekDates(input.weekDates[0]).some((date, i) => date !== input.weekDates[i])) {
    throw new Error("A complete consecutive seven-day roster is required.");
  }
  ordinal(input.today);
  if (!input.weekDates.includes(input.workDate) || input.workDate <= input.today) {
    throw new Error("The proposed shift must be on a future date within this roster week.");
  }
  if (!Number.isSafeInteger(input.shift.id) || input.shift.id <= 0 || !input.shift.code.trim()) {
    throw new Error("Select an active shift returned by the authorized roster source.");
  }
  const proposed = windowFor(input.workDate, input.shift.startTime, input.shift.endTime, input.shift.spansMidnight);
  if (input.selectedEmployeeIds.length > 20 || new Set(input.selectedEmployeeIds).size !== input.selectedEmployeeIds.length) {
    throw new Error("A proposal contains at most 20 distinct workers from the current page.");
  }
  const byId = new Map(input.rows.map(row => [row.employee.id, row]));
  if (byId.size !== input.rows.length || input.selectedEmployeeIds.some(id =>
    !Number.isSafeInteger(id) || !byId.has(id))) {
    throw new Error("The selection must contain only workers from the authorized current roster page.");
  }

  return input.selectedEmployeeIds.map(employeeId => {
    const row = byId.get(employeeId)!;
    const days = row.days.filter(d => d.date === input.workDate);
    const day = days.length === 1 ? days[0] : null;
    const reasons: string[] = [];
    const base = {
      employeeId, employeeNo: row.employee.employeeNo,
      employeeName: row.employee.name, workDate: input.workDate,
      existing: day ? describe(day) : "Unresolved",
      proposed: input.shift.code + " " + input.shift.startTime + "-" + input.shift.endTime,
    };

    if (row.error || !day) reasons.push("Source roster evidence is missing or ambiguous.");
    if (row.employee.status.trim().toLowerCase() !== "active") reasons.push("Employment status requires HR review.");
    if (day?.source === "override") reasons.push("An existing approved override needs individual source review.");
    if (day && day.segments.length > 1) reasons.push("Split-shift schedule requires the advanced individual editor.");
    const unchanged = Boolean(day && !day.isRestDay && day.segments.length === 1 &&
      day.segments[0].shiftDefinitionId === input.shift.id);
    if (unchanged && reasons.length === 0) {
      return { ...base, status: "unchanged" as const, reasons: ["The existing shift already matches this proposal."] };
    }
    if (reasons.length > 0) return { ...base, status: "blocked" as const, reasons };

    if (day!.isRestDay) reasons.push("Explicit rest-day changes need human approval.");
    if (day!.source === "unassigned") reasons.push("No assigned rotation; confirm shift and worksite.");
    if (day!.worksiteId == null) reasons.push("Worksite scope has not been verified.");
    if (input.workDate === input.weekDates[0] || input.workDate === input.weekDates[6]) {
      reasons.push("Adjacent-week schedule is outside this page; check overnight boundaries.");
    }
    try {
      const otherIntervals = currentIntervals(row, input.workDate);
      if (otherIntervals.some(other => proposed.start < other.end && other.start < proposed.end)) {
        return {
          ...base, status: "blocked" as const,
          reasons: [...reasons, "Proposed shift overlaps another recorded shift in this roster week."],
        };
      }
    } catch {
      return { ...base, status: "blocked" as const,
        reasons: [...reasons, "Existing shift clock is malformed or inconsistent."] };
    }
    return {
      ...base,
      status: "review" as const,
      reasons: [...reasons,
        "Confirm approved leave, eligibility, rest policies, live source changes and payroll effects in the native workflow."],
    };
  });
}

/** CSV contains only the selected authorized page workers and neutralizes spreadsheet formulas. */
export function bulkRosterPreviewCsv(rows: readonly BulkPreviewRow[]): string {
  const cell = (value: string): string => {
    const safe = /^[\s\u0000-\u001f]*[=+\-@]/u.test(value) ? "'" + value : value;
    return '"' + safe.replace(/"/g, '""') + '"';
  };
  const records = [
    ["Employee number", "Employee", "Work date", "Existing schedule",
      "Proposed shift", "Preview status", "Review notes"],
    ...rows.map(row => [row.employeeNo, row.employeeName, row.workDate,
      row.existing, row.proposed, row.status, row.reasons.join("; ")]),
  ];
  return records.map(row => row.map(value => cell(value)).join(",")).join("\r\n") + "\r\n";
}
