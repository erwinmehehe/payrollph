import type { OperationalException } from "./attendance-exception-read";

/** Presentation-only triage for the verified employer/date-window cases. */
export type AttendanceTriageFilter = "all" | "overdue" | "unassigned" | "blocking" | "warning";
export type AttendanceTriageSort = "priority" | "sla" | "recent";

function isOpen(item: OperationalException) {
  return item.status === "open";
}

function matches(item: OperationalException, filter: AttendanceTriageFilter): boolean {
  if (filter === "all") return true;
  if (!isOpen(item)) return false;
  if (filter === "overdue") return item.slaStatus === "overdue";
  if (filter === "unassigned") return item.ownerUserId === null;
  return item.severity === (filter === "blocking" ? "blocker" : "warning");
}

export function countAttendanceTriageCases(items: readonly OperationalException[]) {
  return {
    all: items.length,
    overdue: items.filter((item) => matches(item, "overdue")).length,
    unassigned: items.filter((item) => matches(item, "unassigned")).length,
    blocking: items.filter((item) => matches(item, "blocking")).length,
    warning: items.filter((item) => matches(item, "warning")).length,
  };
}

function dueTime(item: OperationalException): number {
  if (!item.slaDueAt) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(item.slaDueAt);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function priority(item: OperationalException): number {
  if (!isOpen(item)) return 7;
  const severity = item.severity === "blocker" ? 0 : item.severity === "warning" ? 1 : 2;
  return item.slaStatus === "overdue" ? severity : severity + 3;
}

export function selectAttendanceTriageCases(
  items: readonly OperationalException[],
  filter: AttendanceTriageFilter,
  sort: AttendanceTriageSort,
): OperationalException[] {
  return items.map((item, index) => ({ item, index }))
    .filter(({ item }) => matches(item, filter))
    .sort((a, b) => {
      if (sort === "recent") {
        return b.item.workDate.localeCompare(a.item.workDate)
          || b.item.id - a.item.id || a.index - b.index;
      }
      if (sort === "sla") {
        // Open cases first, then earliest known due dates. Unknown dates last.
        return Number(!isOpen(a.item)) - Number(!isOpen(b.item))
          || dueTime(a.item) - dueTime(b.item)
          || a.index - b.index;
      }
      // Overdue blockers, overdue warnings, other open cases, then resolved.
      return priority(a.item) - priority(b.item)
        || Number(a.item.ownerUserId !== null) - Number(b.item.ownerUserId !== null)
        || dueTime(a.item) - dueTime(b.item)
        || a.index - b.index;
    })
    .map(({ item }) => item);
}
