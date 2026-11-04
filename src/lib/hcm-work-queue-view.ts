import type { HcmWorkQueueItem } from "./hcm-work-queue-summary";

export type WorkQueueViewSort = "due" | "newest" | "title";

/**
 * Local ordering of an already verified employer-scoped read. This helper
 * must not fetch other cases, infer missing SLA data, or modify source rows.
 */
export function deriveLoadedWorkQueueView(
  items: readonly HcmWorkQueueItem[],
  sort: WorkQueueViewSort,
  unassignedOnly: boolean,
): HcmWorkQueueItem[] {
  const rows = unassignedOnly
    ? items.filter((item) => item.ownerUserId === null)
    : [...items];

  return rows.sort((a, b) => {
    if (sort === "newest") return b.id - a.id;
    if (sort === "title") return a.title.localeCompare(b.title, "en-PH") || a.id - b.id;

    // Unknown/malformed due dates belong last, never treated as overdue.
    const left = a.dueAt === null ? NaN : Date.parse(a.dueAt);
    const right = b.dueAt === null ? NaN : Date.parse(b.dueAt);
    const leftKnown = Number.isFinite(left);
    const rightKnown = Number.isFinite(right);
    if (leftKnown && rightKnown) return left - right || a.id - b.id;
    if (leftKnown) return -1;
    if (rightKnown) return 1;
    return a.id - b.id;
  });
}
