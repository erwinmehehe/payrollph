/**
 * The HR work queue is a role-/employer-scoped read projection, not an
 * authoritative statement about all outstanding employer work.
 *
 * Failed, stale and pending reads must never be represented as zero items.
 */
export type WorkQueueSummaryItem = {
  overdue: boolean | null;
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


/**
 * Server responses are not trusted as empty just because they contain arrays.
 * An employer-mixed, partial or malformed response must not reveal data or
 * authorize editing from a guessed / stale workspace selector.
 */
export type HcmWorkQueueItem = WorkQueueSummaryItem & {
  id: number;
  organizationId: number;
  title: string;
  detail: string;
  caseType: string;
  status: string;
  ownerTeam: string;
  ownerName: string | null;
  dueAt: string | null;
  escalateAt: string | null;
  escalationLevel: number;
};

export type HcmWorkQueueOwner = { id: number; name: string };

export function isVerifiedHcmWorkQueueResponse(
  value: unknown,
  organizationId: number,
): value is { items: HcmWorkQueueItem[]; owners: HcmWorkQueueOwner[] } {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 ||
      !value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  if (!Array.isArray(response.items) || !Array.isArray(response.owners)) return false;

  const itemIds = new Set<number>();
  for (const raw of response.items) {
    if (!raw || typeof raw !== "object") return false;
    const item = raw as Record<string, unknown>;
    if (!Number.isSafeInteger(item.id) || Number(item.id) <= 0 ||
        itemIds.has(Number(item.id)) ||
        item.organizationId !== organizationId ||
        typeof item.title !== "string" ||
        typeof item.detail !== "string" ||
        typeof item.caseType !== "string" ||
        !["open", "acknowledged", "resolved"].includes(String(item.status)) ||
        typeof item.ownerTeam !== "string" ||
        !(item.ownerUserId === null ||
          (Number.isSafeInteger(item.ownerUserId) && Number(item.ownerUserId) > 0)) ||
        !(item.ownerName === null || typeof item.ownerName === "string") ||
        !(item.dueAt === null || typeof item.dueAt === "string") ||
        !(item.escalateAt === null || typeof item.escalateAt === "string") ||
        !Number.isSafeInteger(item.escalationLevel) || Number(item.escalationLevel) < 0 ||
        !(item.overdue === null || typeof item.overdue === "boolean")) return false;
    itemIds.add(Number(item.id));
  }

  const ownerIds = new Set<number>();
  for (const raw of response.owners) {
    if (!raw || typeof raw !== "object") return false;
    const owner = raw as Record<string, unknown>;
    if (!Number.isSafeInteger(owner.id) || Number(owner.id) <= 0 ||
        ownerIds.has(Number(owner.id)) ||
        typeof owner.name !== "string") return false;
    ownerIds.add(Number(owner.id));
  }
  return true;
}
