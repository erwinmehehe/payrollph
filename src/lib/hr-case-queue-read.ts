import { isHrCaseType, type HrCaseStatus, type HrCaseType } from "./hr-case-policy";

/** Staff-case response contract; never turn missing or foreign cases into an empty inbox. */
export type VerifiedStaffHrCase = {
  id: number;
  organizationId: number;
  employeeId: number;
  employeeName?: string | null;
  employeeTitle?: string | null;
  employeeStartDate?: string | null;
  caseType: HrCaseType;
  assignedRole: string;
  subject: string;
  description: string;
  status: HrCaseStatus;
  sla: { hoursRemaining: number; overdue: boolean };
  coeDocumentId: number | null;
  messages: Array<{
    id: number;
    actorUserId: number;
    visibility: "employee" | "internal";
    body: string;
    createdAt: string;
  }>;
};

const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const status = (v: unknown): v is HrCaseStatus =>
  typeof v === "string" && ["open", "in_progress", "waiting_employee", "resolved", "closed"].includes(v);
const optionalText = (v: unknown) => v == null || typeof v === "string";

function validMessage(v: unknown): boolean {
  return record(v) && id(v.id) && id(v.actorUserId) &&
    (v.visibility === "employee" || v.visibility === "internal") &&
    typeof v.body === "string" && typeof v.createdAt === "string";
}

function validCase(v: unknown, organizationId: number): v is VerifiedStaffHrCase {
  return record(v) && id(v.id) && v.organizationId === organizationId &&
    id(v.employeeId) && isHrCaseType(v.caseType) &&
    (v.assignedRole === "hr" || v.assignedRole === "payroll") &&
    typeof v.subject === "string" && v.subject.length > 0 &&
    typeof v.description === "string" && status(v.status) &&
    optionalText(v.employeeName) && optionalText(v.employeeTitle) &&
    optionalText(v.employeeStartDate) &&
    (v.coeDocumentId === null || id(v.coeDocumentId)) &&
    record(v.sla) && typeof v.sla.hoursRemaining === "number" &&
    Number.isFinite(v.sla.hoursRemaining) && typeof v.sla.overdue === "boolean" &&
    Array.isArray(v.messages) && v.messages.every(validMessage);
}
export function isVerifiedHrCaseQueue(
  value: unknown, organizationId: number,
): value is { organizationId: number; cases: VerifiedStaffHrCase[] } {
  if (!id(organizationId) || !record(value) || value.organizationId !== organizationId ||
      !Array.isArray(value.cases) || !value.cases.every((row) => validCase(row, organizationId))) {
    return false;
  }
  const caseIds = value.cases.map((row: VerifiedStaffHrCase) => row.id);
  return new Set(caseIds).size === caseIds.length;
}
export async function readVerifiedHrCaseQueue(
  organizationId: number, fetcher: typeof fetch = fetch, signal?: AbortSignal,
): Promise<VerifiedStaffHrCase[]> {
  const response = await fetcher(
    "/api/hr-cases?organizationId=" + organizationId, { cache: "no-store", signal },
  );
  if (!response.ok) throw new Error("HR case inbox read failed.");
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error("HR case inbox returned malformed JSON."); }
  if (!isVerifiedHrCaseQueue(body, organizationId)) {
    throw new Error("HR case inbox could not be verified for the selected employer.");
  }
  return body.cases;
}
