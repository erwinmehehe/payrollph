/**
 * Pure read/receipt contracts for independent review of enhanced WFM punches.
 * Server-side authorization, same-tenant DB selection, MFA, maker/checker,
 * period locks and approval transaction stay authoritative.
 */
export type VerifiedPunchReviewRow = {
  id: number;
  organizationId: number;
  employeeId: number;
  requestedByUserId: number;
  clientPunchId: string;
  name: string;
  actionType: "clock_in" | "break_start" | "break_end" | "clock_out";
  workDate: string;
  deviceOccurredAt: string;
  serverReceivedAt: string;
  receivedSource: "online" | "offline";
  status: "pending";
  flags: string[];
  photoEvidenceId: string | null;
};

export type VerifiedPunchReviewQueue = {
  organizationId: number;
  submissions: VerifiedPunchReviewRow[];
};

export type VerifiedPunchDecisionReceipt = {
  ok: true;
  organizationId: number;
  submission: {
    id: number; employeeId: number; organizationId: number; status: "approved" | "rejected";
  };
  approvedWorkDate: string | null;
  warning?: string;
};

const ACTIONS = new Set(["clock_in", "break_start", "break_end", "clock_out"]);
const FLAGS = new Set([
  "offline-synced", "clock-skew", "shared-device", "impossible-travel",
  "photo-missing", "consent-declined", "geofence-unverified", "geofence-verified",
  "photo-policy-changed", "time-invalid",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function id(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function utcTimestamp(value: unknown): value is string {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value;
}
function workDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const millis = Date.parse(value + "T00:00:00.000Z");
  return Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 10) === value;
}
function reviewRow(value: unknown, organizationId: number): value is VerifiedPunchReviewRow {
  if (!record(value)) return false;
  return id(value.id) && value.organizationId === organizationId &&
    id(value.employeeId) && id(value.requestedByUserId) &&
    typeof value.clientPunchId === "string" && UUID.test(value.clientPunchId) &&
    typeof value.name === "string" && value.name.trim().length > 0 &&
    ACTIONS.has(String(value.actionType)) && workDate(value.workDate) &&
    utcTimestamp(value.deviceOccurredAt) && utcTimestamp(value.serverReceivedAt) &&
    (value.receivedSource === "online" || value.receivedSource === "offline") &&
    value.status === "pending" &&
    Array.isArray(value.flags) && value.flags.length <= 16 &&
    value.flags.every((flag: unknown) => typeof flag === "string" && FLAGS.has(flag)) &&
    (value.photoEvidenceId === null ||
      (typeof value.photoEvidenceId === "string" && UUID.test(value.photoEvidenceId)));
}

export function isVerifiedPunchReviewQueue(
  value: unknown, organizationId: number,
): value is VerifiedPunchReviewQueue {
  if (!id(organizationId) || !record(value) || value.organizationId !== organizationId ||
      !Array.isArray(value.submissions) || value.submissions.length > 100) return false;
  const seen = new Set<number>();
  for (const candidate of value.submissions) {
    if (!reviewRow(candidate, organizationId) || seen.has(candidate.id)) return false;
    seen.add(candidate.id);
  }
  return true;
}

export async function readVerifiedPunchReviewQueue(
  organizationId: number, fetcher: typeof fetch = fetch, signal?: AbortSignal,
): Promise<VerifiedPunchReviewQueue> {
  if (!id(organizationId)) throw Error("Select a valid employer before reviewing punch evidence.");
  const response = await fetcher("/api/web-bundy/review?organizationId=" + organizationId, {
    cache: "no-store", signal,
  });
  // A disabled pilot / unauthorized 404 is unavailable, NOT an empty queue.
  if (!response.ok) throw Error("Enhanced punch review is unavailable or unauthorized. Retry after checking access.");
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw Error("Enhanced punch review returned unreadable data. Retry before deciding."); }
  if (!isVerifiedPunchReviewQueue(payload, organizationId)) {
    throw Error("Enhanced punch evidence was incomplete or from another employer. Retry before deciding.");
  }
  return payload;
}

/** A successful HTTP code alone is not proof that a punch entered the ledger. */
export function isVerifiedPunchDecisionReceipt(
  value: unknown, organizationId: number, row: VerifiedPunchReviewRow,
  decision: "approved" | "rejected",
): value is VerifiedPunchDecisionReceipt {
  if (!id(organizationId) || !record(value) || !record(value.submission) ||
      !id(row.id) || !id(row.employeeId) || row.organizationId !== organizationId) return false;
  if (value.ok !== true || value.organizationId !== organizationId ||
      value.submission.id !== row.id || value.submission.organizationId !== organizationId ||
      value.submission.employeeId !== row.employeeId ||
      value.submission.status !== decision) return false;
  if (decision === "approved" ? !workDate(value.approvedWorkDate) : value.approvedWorkDate !== null) return false;
  return value.warning === undefined ||
    (typeof value.warning === "string" && value.warning.trim().length > 0 && value.warning.length <= 500);
}
