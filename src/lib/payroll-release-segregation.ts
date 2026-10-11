import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents } from "@/db/schema";

/**
 * Release segregation is independent of optional organization policy flags.
 * The checker identity is the authenticated ID written into the approval audit
 * in the SAME DB transaction that approved the exact payroll task.
 * Display names, client-supplied IDs and task.approver are not identity proof.
 */
export const PAYROLL_APPROVAL_ACTIONS = [
  "Approval approved",
  "Approval approved by delegate",
] as const;

export type PayrollReleaseDutyEvent = {
  action: string;
  metadata: unknown;
};

export type PayrollReleaseDutyInput = {
  organizationId: number;
  payrollRunId: number;
  approvalTaskId: number;
  releaserUserId: number;
  managedClientApproverUserId: number | null;
};

export type PayrollReleaseDutyVerdict =
  | { allowed: true; makerUserId: number; checkerUserId: number; assignedCheckerUserId: number }
  | { allowed: false; status: 403 | 409; code: string; error: string };

const EVIDENCE_UNAVAILABLE: PayrollReleaseDutyVerdict = {
  allowed: false,
  status: 409,
  code: "PAYROLL_RELEASE_SOD_EVIDENCE_MISSING",
  error: "Authenticated maker and checker evidence is missing or ambiguous. Resubmit the payroll for independent checker approval.",
};
const PERSON_CONFLICT: PayrollReleaseDutyVerdict = {
  allowed: false,
  status: 403,
  code: "PAYROLL_RELEASE_SOD_CONFLICT",
  error: "Separation of duties: a payroll checker or client approver cannot release the same payroll run. Ask another authorized owner or administrator to release it.",
};

function positiveUserId(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}
function objectMetadata(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Pure fail-closed evaluator; useful for testing legacy/ambiguous evidence. */
export function evaluatePayrollReleaseDuties(
  input: PayrollReleaseDutyInput,
  events: readonly PayrollReleaseDutyEvent[],
): PayrollReleaseDutyVerdict {
  if (![input.organizationId, input.payrollRunId, input.approvalTaskId, input.releaserUserId]
    .every((id) => positiveUserId(id) !== null)) return EVIDENCE_UNAVAILABLE;

  const submissions = events.filter((event) => {
    const m = objectMetadata(event.metadata);
    return event.action === "Payroll submitted for review" &&
      m?.taskId === input.approvalTaskId && m.runId === input.payrollRunId;
  });
  const approvals = events.filter((event) => {
    const m = objectMetadata(event.metadata);
    return PAYROLL_APPROVAL_ACTIONS.some((action) => action === event.action) &&
      m?.taskId === input.approvalTaskId && m.payrollRunId === input.payrollRunId;
  });
  if (submissions.length !== 1 || approvals.length !== 1 || events.length !== 2) {
    return EVIDENCE_UNAVAILABLE;
  }

  const submit = objectMetadata(submissions[0].metadata)!;
  const decided = objectMetadata(approvals[0].metadata)!;
  const maker = positiveUserId(submit.makerUserId);
  const assignedChecker = positiveUserId(submit.approverUserId);
  const actualChecker = positiveUserId(decided.deciderUserId);
  const auditedMaker = positiveUserId(decided.makerUserId);
  const auditedAssignedChecker = positiveUserId(decided.approverUserId);
  if (
    maker === null || assignedChecker === null || actualChecker === null ||
    auditedMaker !== maker || auditedAssignedChecker !== assignedChecker ||
    maker === actualChecker
  ) {
    return EVIDENCE_UNAVAILABLE;
  }

  const managedApprover = input.managedClientApproverUserId;
  if (managedApprover !== null && positiveUserId(managedApprover) === null) {
    return EVIDENCE_UNAVAILABLE;
  }

  // Both the person assigned to review and an actual delegate who decided
  // are excluded from releasing; release never inherits a maker-checker opt-in.
  if (
    input.releaserUserId === actualChecker ||
    input.releaserUserId === assignedChecker ||
    managedApprover === input.releaserUserId ||
    (managedApprover !== null && (managedApprover === actualChecker || managedApprover === assignedChecker))
  ) return PERSON_CONFLICT;

  return {
    allowed: true,
    makerUserId: maker,
    checkerUserId: actualChecker,
    assignedCheckerUserId: assignedChecker,
  };
}

/**
 * Source the linked evidence only for this employer/task from the trusted audit
 * ledger. A fixed cap ensures a duplicated/conflicting audit never looks valid.
 */
export async function checkPayrollReleaseSegregation(
  input: PayrollReleaseDutyInput,
): Promise<PayrollReleaseDutyVerdict> {
  const rows = await db.select({
    action: auditEvents.action,
    metadata: auditEvents.metadata,
  }).from(auditEvents).where(and(
    eq(auditEvents.organizationId, input.organizationId),
    inArray(auditEvents.action, [
      "Payroll submitted for review",
      ...PAYROLL_APPROVAL_ACTIONS,
    ]),
    sql`(${auditEvents.metadata} ->> 'taskId') = ${String(input.approvalTaskId)}`
  )).limit(5);
  return evaluatePayrollReleaseDuties(input, rows);
}
