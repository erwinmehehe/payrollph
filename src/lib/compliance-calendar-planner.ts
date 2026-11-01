import type { CalendarItem, CalendarStatus } from "./compliance-calendar-read";

/**
 * Read-only presentation of source-verified compliance obligations.
 * Never infer a missing statutory date, verified filing, or payment outcome.
 */
export type ComplianceAgencyFilter = "all" | CalendarItem["agency"];
export type ComplianceDateSort = "earliest" | "latest" | "source";
const attentionStatuses = new Set<CalendarStatus>([
  "overdue", "exception", "verification-required", "configuration-required",
  "posting-pending", "due-soon",
]);

export function needsComplianceAttention(status: CalendarStatus): boolean {
  return attentionStatuses.has(status);
}

export function countComplianceAgencies(items: readonly CalendarItem[]) {
  return {
    all: items.length,
    BIR: items.filter(item => item.agency === "BIR").length,
    SSS: items.filter(item => item.agency === "SSS").length,
    PhilHealth: items.filter(item => item.agency === "PhilHealth").length,
    "Pag-IBIG": items.filter(item => item.agency === "Pag-IBIG").length,
    unresolved: items.filter(item => item.dueDate === null).length,
  };
}

export function selectComplianceCalendarItems(
  items: readonly CalendarItem[],
  attentionOnly: boolean,
  agency: ComplianceAgencyFilter,
  sort: ComplianceDateSort,
): CalendarItem[] {
  const filtered = items.map((item, index) => ({ item, index }))
    .filter(({ item }) => (!attentionOnly || needsComplianceAttention(item.status))
      && (agency === "all" || item.agency === agency));
  if (sort === "source") return filtered.map(({ item }) => item);
  return filtered.sort((a, b) => {
    // Missing deadlines are not made up and always appear last.
    if (a.item.dueDate === null) return b.item.dueDate === null ? a.index - b.index : 1;
    if (b.item.dueDate === null) return -1;
    const delta = a.item.dueDate.localeCompare(b.item.dueDate);
    return (sort === "earliest" ? delta : -delta) || a.index - b.index;
  }).map(({ item }) => item);
}
