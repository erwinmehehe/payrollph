import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents } from "@/db/schema";

/** One authoritative, transactionally recorded approval action per task/run. */
export type PayrollCheckerAudit = { metadata: unknown };

/** Fail closed for missing, duplicate, or non-stable checker identity evidence. */
export function independentPayrollReleaseViolation(input: {
  approvalEvents: readonly PayrollCheckerAudit[];
  releasingUserId: number;
}): { code: string; error: string; status: number } | null {
  const { approvalEvents, releasingUserId } = input;
  if (approvalEvents.length !== 1) {
    return {
      code: "PAYROLL_CHECKER_IDENTITY_UNVERIFIED",
      error: "Payroll checker identity cannot be verified from a unique authenticated decision. Re-submit the payroll for a new independent approval before release.",
      status: 409,
    };
  }
  const metadata = approvalEvents[0].metadata;
  const identity = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>).deciderUserId : null;
  // Audit provenance requires a positive integer session identity, not a
  // display name or an optional organization-level treasury policy setting.
  if (typeof identity !== "number" || !Number.isSafeInteger(identity) || identity < 1) {
    return {
      code: "PAYROLL_CHECKER_IDENTITY_UNVERIFIED",
      error: "The approval has no authenticated checker ID. Re-submit payroll for current independent review.",
      status: 409,
    };
  }
  if (identity === releasingUserId) {
    return {
      code: "PAYROLL_CHECKER_CANNOT_RELEASE",
      error: "Maker-checker-release control: the user who approved this payroll cannot also release it. Assign an independent authorized releaser.",
      status: 403,
    };
  }
  return null;
}

/**
 * Reads stable identity from the approval audit written in the SAME
 * transaction as the Approved task and the Ready-for-release transition.
 * Two results indicate ambiguous evidence and block release; missing legacy
 * actor IDs fail closed. No schema change or treasury-policy opt-in.
 */
export async function checkIndependentPayrollReleaser(input: {
  organizationId: number;
  payrollRunId: number;
  approvalTaskId: number;
  releasingUserId: number;
}): Promise<Response | null> {
  const events = await db.select({ metadata: auditEvents.metadata })
    .from(auditEvents)
    .where(and(
      eq(auditEvents.organizationId, input.organizationId),
      inArray(auditEvents.action, ["Approval approved", "Approval approved by delegate"]),
      sql`${auditEvents.metadata} ->> 'taskId' = ${String(input.approvalTaskId)}`,
      sql`${auditEvents.metadata} ->> 'payrollRunId' = ${String(input.payrollRunId)}`,
    ))
    .limit(2);
  const violation = independentPayrollReleaseViolation({
    approvalEvents: events,
    releasingUserId: input.releasingUserId,
  });
  return violation
    ? Response.json({ code: violation.code, error: violation.error }, { status: violation.status })
    : null;
}
