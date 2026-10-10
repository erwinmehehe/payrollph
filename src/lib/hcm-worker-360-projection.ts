/**
 * Read-only Worker 360 projection helpers.
 * Source tables retain authority; do not infer historical org/job details
 * from mutable present-day position records or present-day employee status.
 */
export type Worker360Assignment = {
  id: number;
  positionId: number;
  assignmentType: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
};
export type Worker360Selection =
  | { status: "recorded"; assignment: Worker360Assignment }
  | { status: "not_recorded" | "ambiguous"; assignment: null };

export type Worker360Event = {
  id: number;
  effectiveDate: string;
  eventType: string;
  positionAssignmentId: number | null;
};

export function validWorker360Date(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1900 || year > 9999) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

/** Fail closed on duplicate historical primary assignments. */
export function selectWorker360Assignment(
  assignments: readonly Worker360Assignment[],
  asOfDate: string,
): Worker360Selection {
  if (!validWorker360Date(asOfDate)) throw new Error("Invalid as-of business date");
  const candidates = assignments.filter((assignment) =>
    Number.isSafeInteger(assignment.id) && assignment.id > 0 &&
    assignment.assignmentType === "primary" &&
    validWorker360Date(assignment.effectiveFrom) &&
    assignment.effectiveFrom <= asOfDate &&
    (assignment.effectiveUntil === null ||
      (validWorker360Date(assignment.effectiveUntil) && assignment.effectiveUntil >= asOfDate)));
  if (candidates.length > 1) return { status: "ambiguous", assignment: null };
  if (candidates.length === 0) return { status: "not_recorded", assignment: null };
  return { status: "recorded", assignment: candidates[0] };
}

export type Worker360EventPreview = {
  items: Worker360Event[];
  hasMore: boolean;
  partial: boolean;
};

/** Caller must first query only the requested authorized tenant and worker. */
export function projectWorker360Events(
  events: readonly Worker360Event[],
  asOfDate: string,
  limit = 25,
): Worker360EventPreview {
  if (!validWorker360Date(asOfDate)) throw new Error("Invalid as-of business date");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid preview limit");
  const eligible = events.filter((event) =>
    Number.isSafeInteger(event.id) && event.id > 0 &&
    validWorker360Date(event.effectiveDate) && event.effectiveDate <= asOfDate &&
    /^[a-zA-Z0-9_:-]{1,32}$/.test(event.eventType));
  const sorted = [...eligible].sort((a, b) =>
    b.effectiveDate.localeCompare(a.effectiveDate) || b.id - a.id);
  return {
    items: sorted.slice(0, limit).map(({ id, effectiveDate, eventType, positionAssignmentId }) =>
      ({ id, effectiveDate, eventType, positionAssignmentId })),
    hasMore: sorted.length > limit,
    partial: sorted.length > limit,
  };
}
