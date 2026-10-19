/**
 * Read-only and browser-safe validation for the scoped HR offline claim queue.
 * It is not an authorization check: server roles, org-unit visibility and
 * maker/checker controls remain authoritative on the GET/PATCH routes.
 * A missing or malformed 200 response is unavailable, NEVER an empty queue.
 */
export type OfflinePunchReviewRow = {
  id: number;
  organizationId: number;
  employeeId: number;
  employeeName: string;
  claimedAt: string;
  createdAt: string;
  actionType: "clock_in" | "clock_out";
  status: "pending_review" | "flagged" | "dismissed";
  reviewNote: string | null;
};

export type VerifiedOfflinePunchQueue = {
  organizationId: number;
  claims: OfflinePunchReviewRow[];
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function positiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** JSON.stringify(Date) in the authorized route emits canonical UTC ISO. */
function verifiedTimestamp(value: unknown): value is string {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value;
}

function verifiedRow(value: unknown, organizationId: number): value is OfflinePunchReviewRow {
  if (!record(value)) return false;
  return positiveId(value.id) && value.organizationId === organizationId &&
    positiveId(value.employeeId) &&
    typeof value.employeeName === "string" && value.employeeName.trim().length > 0 &&
    (value.actionType === "clock_in" || value.actionType === "clock_out") &&
    (value.status === "pending_review" || value.status === "flagged" || value.status === "dismissed") &&
    verifiedTimestamp(value.claimedAt) && verifiedTimestamp(value.createdAt) &&
    (value.reviewNote === null || typeof value.reviewNote === "string");
}

export function isVerifiedOfflinePunchQueue(
  value: unknown, organizationId: number,
): value is VerifiedOfflinePunchQueue {
  if (!positiveId(organizationId) || !record(value) ||
      value.organizationId !== organizationId || !Array.isArray(value.claims) ||
      value.claims.length > 100) return false;
  const ids = new Set<number>();
  for (const candidate of value.claims) {
    if (!verifiedRow(candidate, organizationId) || ids.has(candidate.id)) return false;
    ids.add(candidate.id);
  }
  return true;
}

export async function readVerifiedOfflinePunchClaims(
  organizationId: number, fetcher: typeof fetch = fetch, signal?: AbortSignal,
): Promise<VerifiedOfflinePunchQueue> {
  if (!positiveId(organizationId)) throw Error("Select a valid employer to review offline claims.");
  const response = await fetcher("/api/attendance/offline-claims?organizationId=" + organizationId, {
    cache: "no-store", signal,
  });
  if (!response.ok) throw Error("Offline claim queue unavailable. Retry to verify current records.");
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw Error("Offline claim queue returned unreadable data. Retry before reviewing."); }
  if (!isVerifiedOfflinePunchQueue(payload, organizationId)) {
    throw Error("Offline claim queue was incomplete or for another employer. Retry before reviewing.");
  }
  return payload;
}

/** A 2xx PATCH is not by itself proof that an offline review was recorded. */
export function isVerifiedOfflinePunchReviewReceipt(
  value: unknown, organizationId: number,
  claim: Pick<OfflinePunchReviewRow, "id" | "employeeId">, action: "flag" | "dismiss",
): boolean {
  if (!positiveId(organizationId) || !positiveId(claim.id) ||
      !positiveId(claim.employeeId) || !record(value) || !record(value.claim)) return false;
  return value.verified === false &&
    value.claim.id === claim.id &&
    value.claim.organizationId === organizationId &&
    value.claim.employeeId === claim.employeeId &&
    value.claim.status === (action === "flag" ? "flagged" : "dismissed");
}
