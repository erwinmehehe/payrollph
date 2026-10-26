/**
 * Employee HR requests are a read-only, session-scoped snapshot before any
 * submit/reply controls are shown. A failed or malformed GET is NOT an empty
 * inbox, and a 404 only means feature-off with the explicit server sentinel.
 */
export type EmployeeHrCaseRow = {
  id: number;
  organizationId: number;
  employeeId: number;
  caseType: string;
  subject: string;
  description: string;
  status: string;
  sla: { hoursRemaining: number; overdue: boolean };
  coeDocumentId: number | null;
  messages: Array<{
    id: number;
    visibility: "employee";
    body: string;
    createdAt: string;
  }>;
};

export type EmployeeHrCasesRead =
  | { status: "ready"; cases: EmployeeHrCaseRow[] }
  | { status: "disabled"; cases: null };

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const positiveId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const CASE_TYPES = new Set(["coe", "payslip_correction", "bir_2316", "dispute", "general"]);
const CASE_STATUSES = new Set(["open", "in_progress", "waiting_employee", "resolved", "closed"]);

function validEmployeeMessage(value: unknown): boolean {
  return record(value) && positiveId(value.id) &&
    value.visibility === "employee" && typeof value.body === "string" &&
    typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt));
}

function validEmployeeCase(value: unknown, organizationId: number): value is EmployeeHrCaseRow {
  return record(value) && positiveId(value.id) && value.organizationId === organizationId &&
    positiveId(value.employeeId) && typeof value.caseType === "string" &&
    CASE_TYPES.has(value.caseType) && typeof value.subject === "string" &&
    value.subject.length > 0 && typeof value.description === "string" &&
    typeof value.status === "string" && CASE_STATUSES.has(value.status) &&
    (value.coeDocumentId === null || positiveId(value.coeDocumentId)) &&
    record(value.sla) && typeof value.sla.hoursRemaining === "number" &&
    Number.isFinite(value.sla.hoursRemaining) && typeof value.sla.overdue === "boolean" &&
    Array.isArray(value.messages) && value.messages.every(validEmployeeMessage);
}

export function isVerifiedEmployeeHrCases(
  value: unknown,
): value is { organizationId: number; cases: EmployeeHrCaseRow[] } {
  if (!record(value) || !positiveId(value.organizationId) ||
      !Array.isArray(value.cases) || value.cases.length > 100) return false;

  const caseIds = new Set<number>();
  let totalMessages = 0;
  for (const item of value.cases) {
    if (!validEmployeeCase(item, value.organizationId) || caseIds.has(item.id)) return false;
    caseIds.add(item.id);
    totalMessages += item.messages.length;
    // GET caps messages at 500 across the entire response.
    if (totalMessages > 500) return false;
  }
  return true;
}

/** Never return a verified empty list for errors, partial JSON or foreign rows. */
export async function readEmployeeHrCases(
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<EmployeeHrCasesRead> {
  const response = await fetcher("/api/hr-cases", { cache: "no-store", signal });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("HR requests returned an unreadable response. Retry.");
  }
  if (response.status === 404 && record(payload) &&
      payload.error === "HR cases are not enabled for this release.") {
    return { status: "disabled", cases: null };
  }
  if (!response.ok) {
    throw new Error("Could not load HR requests. Check your session or connection and retry.");
  }
  if (!isVerifiedEmployeeHrCases(payload)) {
    throw new Error("HR requests returned an incomplete or invalid response. Retry.");
  }
  return { status: "ready", cases: payload.cases };
}
