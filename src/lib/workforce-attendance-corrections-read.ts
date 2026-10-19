/** Verified, employer-bound read contract for attendance correction approvals.
 * This browser check does not replace role, org-unit, MFA, cutoff or DB guards.
 * A malformed successful response cannot turn into an empty approval queue.
 */
export type AttendanceSnapshotRead = {
  workDate: string;
  timeIn: string | null;
  timeOut: string | null;
  breakStart: string | null;
  breakEnd: string | null;
  status: string;
};
export type VerifiedAttendanceCorrection = {
  id: number;
  organizationId: number;
  employeeId: number;
  punchId: number;
  workDate: string;
  originalPunchSnapshot: AttendanceSnapshotRead;
  proposedPunchSnapshot: AttendanceSnapshotRead;
  reason: string;
  status: "pending" | "approved" | "rejected";
  requestedBy: string;
  requestedByUserId: number | null;
  decidedBy?: string | null;
  decisionNote?: string | null;
  appliedAt?: string | null;
  invalidatedPayrollRunIds: number[];
};
export type VerifiedCorrectionQueue = {
  organizationId: number;
  requests: VerifiedAttendanceCorrection[];
};
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const positiveId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const day = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const millis = Date.parse(value + "T00:00:00.000Z");
  return Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 10) === value;
};
const instant = (value: unknown): value is string => {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value;
};
function verifiedSnapshot(raw: unknown, workDate: string): raw is AttendanceSnapshotRead {
  if (!object(raw) || raw.workDate !== workDate ||
      typeof raw.status !== "string" || raw.status.trim().length === 0) return false;
  for (const field of ["timeIn","timeOut","breakStart","breakEnd"]) {
    if (!(field in raw) || (raw[field] !== null && !instant(raw[field]))) return false;
  }
  return true;
}
function verifiedCorrection(raw: unknown, organizationId: number): raw is VerifiedAttendanceCorrection {
  if (!object(raw) || !positiveId(raw.id) || raw.organizationId !== organizationId ||
      !positiveId(raw.employeeId) || !positiveId(raw.punchId) ||
      !day(raw.workDate) || !verifiedSnapshot(raw.originalPunchSnapshot, raw.workDate) ||
      !verifiedSnapshot(raw.proposedPunchSnapshot, raw.workDate) ||
      typeof raw.reason !== "string" || raw.reason.trim().length === 0 ||
      typeof raw.requestedBy !== "string" || raw.requestedBy.trim().length === 0 ||
      (raw.status !== "pending" && raw.status !== "approved" && raw.status !== "rejected") ||
      !(raw.requestedByUserId === null || positiveId(raw.requestedByUserId)) ||
      !Array.isArray(raw.invalidatedPayrollRunIds) ||
      raw.invalidatedPayrollRunIds.some((value: unknown) => !positiveId(value)) ||
      new Set(raw.invalidatedPayrollRunIds).size !== raw.invalidatedPayrollRunIds.length) return false;
  if (raw.decidedBy !== null && raw.decidedBy !== undefined && typeof raw.decidedBy !== "string") return false;
  if (raw.decisionNote !== null && raw.decisionNote !== undefined && typeof raw.decisionNote !== "string") return false;
  if (raw.appliedAt !== null && raw.appliedAt !== undefined && !instant(raw.appliedAt)) return false;
  // An approved response must carry a committed approval timestamp.
  if (raw.status === "approved" && !instant(raw.appliedAt)) return false;
  return true;
}
export function isVerifiedAttendanceCorrectionQueue(
  payload: unknown, organizationId: number,
): payload is VerifiedCorrectionQueue {
  if (!positiveId(organizationId) || !object(payload) || payload.organizationId !== organizationId ||
      !Array.isArray(payload.requests) || payload.requests.length > 5000) return false;
  const ids = new Set<number>();
  for (const item of payload.requests) {
    if (!verifiedCorrection(item, organizationId) || ids.has(item.id)) return false;
    ids.add(item.id);
  }
  return true;
}
export async function readVerifiedAttendanceCorrections(
  organizationId: number, fetcher: typeof fetch = fetch, signal?: AbortSignal,
): Promise<VerifiedCorrectionQueue> {
  if (!positiveId(organizationId)) throw Error("Select a valid employer before loading corrections.");
  const response = await fetcher(
    "/api/workforce/attendance-corrections?organizationId=" + organizationId,
    { cache: "no-store", signal },
  );
  if (!response.ok) throw Error("Attendance corrections unavailable. Retry to verify approvals.");
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw Error("Attendance corrections returned unreadable data. Retry."); }
  if (!isVerifiedAttendanceCorrectionQueue(payload, organizationId)) {
    throw Error("Attendance correction records are incomplete or from another employer. Retry.");
  }
  return payload;
}
/** POST 2xx is not enough to confirm a changed attendance or correction request. */
export function verifiedCorrectionReceipt(
  payload: unknown, organizationId: number, action: "create_request" | "decide_request",
  identity: { punchId?: number; requestId?: number; decision?: "approved" | "rejected" },
): boolean {
  if (!positiveId(organizationId) || !object(payload) || !object(payload.correction)) return false;
  const correction = payload.correction;
  if (!positiveId(correction.id) || correction.organizationId !== organizationId ||
      !positiveId(correction.employeeId) || !positiveId(correction.punchId)) return false;
  if (action === "create_request") {
    return positiveId(identity.punchId) && correction.punchId === identity.punchId &&
      correction.status === "pending" && positiveId(correction.requestedByUserId);
  }
  return positiveId(identity.requestId) && correction.id === identity.requestId &&
    correction.status === identity.decision && (
      identity.decision !== "approved" || instant(correction.appliedAt)
    );
}
