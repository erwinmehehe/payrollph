import {
  activeLeaveRequestSpans, teamLeaveMonthCells,
  type TeamLeaveCase,
} from "./hcm-team-leave-calendar-contract";

/** Presentation-only view of already authorized source request spans. */
export type TeamLeaveViewFilter = "all" | "approved" | "pending";

export function selectTeamLeaveCases(
  cases: readonly TeamLeaveCase[], filter: TeamLeaveViewFilter,
): TeamLeaveCase[] {
  if (filter === "all") return [...cases];
  const status = filter === "approved" ? "Approved" : "Pending";
  return cases.filter((entry) => entry.status === status);
}

/**
 * A day with two or more request records is NOT a staffing conflict or two
 * full-day absences. These are source spans, with no durations or leave reasons.
 */
export function summarizeVisibleTeamLeaveMonth(month: string, cases: readonly TeamLeaveCase[]) {
  const dates = teamLeaveMonthCells(month).filter((day): day is string => day !== null);
  let datesWithAnySpans = 0;
  let datesWithMultipleSpans = 0;
  for (const date of dates) {
    const count = activeLeaveRequestSpans(date, cases).length;
    if (count >= 1) datesWithAnySpans++;
    if (count >= 2) datesWithMultipleSpans++;
  }
  return {
    visibleRequestRecords: cases.length,
    datesWithAnySpans,
    datesWithMultipleSpans,
  };
}
