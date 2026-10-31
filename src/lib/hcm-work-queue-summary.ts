/**
 * The HR work queue is a role-/employer-scoped read projection, not an
 * authoritative statement about all outstanding employer work.
 *
 * Failed, stale and pending reads must never be represented as zero items.
 */
export type WorkQueueSummaryItem = {
  overdue: boolean;
  ownerUserId: number | null;
};

export type VerifiedWorkQueueSummary = {
  total: number;
  overdue: number;
  unassigned: number;
};

export function summarizeVerifiedWorkQueue(
  items: readonly WorkQueueSummaryItem[],
  verified: boolean,
): VerifiedWorkQueueSummary | null {
  if (!verified) return null;

  return {
    total: items.length,
    overdue: items.filter((item) => item.overdue).length,
    unassigned: items.filter((item) => !item.ownerUserId).length,
  };
}
