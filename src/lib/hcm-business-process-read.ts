/**
 * Browser-safe, complete employer-bound business-process queue contract.
 * A successful HTTP response is NOT evidence of a complete approval queue.
 */
export type HcmBusinessProcessWorkItem = {
  id: number; stepIndex: number; stepType: "approval" | "review" | "to_do";
  label: string; assignee: string; dueAt: string | null;
  approvalTaskId: number | null; instanceId: number;
  processType: string; processName: string; effectiveDate: string | null;
  initiatedByName: string; makerBlocked: boolean;
  employee: null | { id: number; employeeNo: string; name: string; title: string };
};
export type HcmBusinessProcessHistory = {
  id: number; processType: string; processName: string; status: string;
  effectiveDate: string | null; initiatedByName: string;
  initiatedAt: string | null; completedAt: string | null;
  employeeId: number | null;
};
export type HcmBusinessProcessInboxRead = {
  organizationId: number;
  myWork: HcmBusinessProcessWorkItem[];
  submitted: HcmBusinessProcessHistory[];
  recent: HcmBusinessProcessHistory[];
  meta: {
    myWorkPartial: boolean; submittedPartial: boolean; recentPartial: boolean;
    companyHistoryAvailable: boolean;
  };
};
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const positive = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const count = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const text = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;
const nullableDate = (v: unknown) => {
  if (v === null) return true;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  // Date.parse normalizes impossible dates (e.g. Feb 30) into the next month.
  // Effective dates must remain the exact recorded calendar day.
  const date = new Date(v + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === v;
};
const nullableTimestamp = (v: unknown) => {
  if (v === null) return true;
  if (typeof v !== "string") return false;
  // Require an explicit offset; Date.parse otherwise accepts ambiguous local times
  // and silently normalizes impossible dates (for example, February 30).
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.exec(v);
  if (!match || Number(match[2]) > 23 || Number(match[3]) > 59 ||
      Number(match[4]) > 59) return false;
  const calendar = new Date(match[1] + "T00:00:00.000Z");
  return Number.isFinite(calendar.getTime()) &&
    calendar.toISOString().slice(0, 10) === match[1] &&
    Number.isFinite(Date.parse(v));
};
const nullableId = (v: unknown) => v === null || positive(v);

function workItem(v: unknown): v is HcmBusinessProcessWorkItem {
  if (!record(v) || !positive(v.id) || !count(v.stepIndex) ||
      !["approval", "review", "to_do"].includes(String(v.stepType)) ||
      !text(v.label) || !text(v.assignee) || !nullableTimestamp(v.dueAt) ||
      !nullableId(v.approvalTaskId) || !positive(v.instanceId) ||
      !text(v.processType) || !text(v.processName) || !nullableDate(v.effectiveDate) ||
      !text(v.initiatedByName) || typeof v.makerBlocked !== "boolean") return false;
  return v.employee === null ||
    (record(v.employee) && positive(v.employee.id) &&
      typeof v.employee.employeeNo === "string" &&
      text(v.employee.name) && typeof v.employee.title === "string");
}
function history(v: unknown): v is HcmBusinessProcessHistory {
  return record(v) && positive(v.id) &&
    text(v.processType) && text(v.processName) && text(v.status) &&
    nullableDate(v.effectiveDate) && text(v.initiatedByName) &&
    nullableTimestamp(v.initiatedAt) && nullableTimestamp(v.completedAt) &&
    nullableId(v.employeeId);
}
function uniqueIds<T extends { id: number }>(items: T[]): boolean {
  return new Set(items.map(item => item.id)).size === items.length;
}
export function isVerifiedHcmBusinessProcessInbox(
  v: unknown, organizationId: number,
): v is HcmBusinessProcessInboxRead {
  if (!positive(organizationId) || !record(v) || v.organizationId !== organizationId ||
      !Array.isArray(v.myWork) || v.myWork.length > 1000 ||
      !Array.isArray(v.submitted) || v.submitted.length > 500 ||
      !Array.isArray(v.recent) || v.recent.length > 500 ||
      !v.myWork.every(workItem) || !v.submitted.every(history) ||
      !v.recent.every(history) || !record(v.meta)) return false;
  const m = v.meta;
  if (["myWorkPartial", "submittedPartial", "recentPartial", "companyHistoryAvailable"]
    .some(key => typeof m[key] !== "boolean")) return false;
  return uniqueIds(v.myWork) && uniqueIds(v.submitted) && uniqueIds(v.recent);
}
/** Pure HTTP + JSON gate: null is unavailable, never a verified-empty queue. */
export function readVerifiedHcmBusinessProcessResponse(
  ok: boolean, payload: unknown, organizationId: number,
): HcmBusinessProcessInboxRead | null {
  return ok && isVerifiedHcmBusinessProcessInbox(payload, organizationId) ? payload : null;
}

export async function readVerifiedHcmBusinessProcessInbox(
  organizationId: number, fetcher: typeof fetch = fetch, signal?: AbortSignal,
): Promise<HcmBusinessProcessInboxRead> {
  if (!positive(organizationId)) throw Error("Select a valid employer.");
  const response = await fetcher(
    "/api/hcm/business-processes/inbox?organizationId=" + organizationId,
    { cache: "no-store", signal },
  );
  if (!response.ok) throw Error("HCM business-process inbox is unavailable. Retry.");
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw Error("HCM work queue returned unreadable data."); }
  const verified = readVerifiedHcmBusinessProcessResponse(response.ok, payload, organizationId);
  if (!verified) {
    throw Error("HCM work queue is incomplete or belongs to another employer. Retry.");
  }
  return verified;
}
