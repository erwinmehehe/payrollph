import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { payrollEntries, payrollRuns } from "@/db/schema";

/**
 * A legacy employee-profile editor must never rewrite bank/mobile payout
 * coordinates after this worker has appeared in any calculated payroll register.
 * A company with configured treasury separation already has the approved,
 * independent payout-destination change workflow.
 *
 * Check per worker, not per company: a newly hired worker without an existing
 * payroll entry may still complete initial payout setup before calculation.
 */
export async function employeeHasPayrollRegisterEntry(
  organizationId: number,
  employeeId: number,
): Promise<boolean> {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0
    || !Number.isSafeInteger(employeeId) || employeeId <= 0) {
    throw new Error("Valid organization and employee are required for payout history check.");
  }
  const [entry] = await db.select({ id: payrollEntries.id })
    .from(payrollEntries)
    .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
    .where(and(
      eq(payrollRuns.organizationId, organizationId),
      eq(payrollEntries.employeeId, employeeId),
    )).limit(1);
  return Boolean(entry);
}

/** Use inside the employee mutation transaction to prevent a stale preflight. */
export function payoutHistoryUnderLockQuery(organizationId: number, employeeId: number) {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0
    || !Number.isSafeInteger(employeeId) || employeeId <= 0) {
    throw new Error("Valid organization and employee are required for payout history check.");
  }
  return sql`
    SELECT pr.status
    FROM payroll_entries pe
    JOIN payroll_runs pr ON pr.id = pe.payroll_run_id
    WHERE pr.organization_id = ${organizationId}
      AND pe.employee_id = ${employeeId}
    ORDER BY pr.id
    FOR SHARE OF pr
  `;
}

export function legacyPayoutChangeBlockReason(input: {
  treasuryEnabled: boolean;
  hasPayrollRegisterEntry: boolean;
  companyWide: boolean;
  role: string;
}): "review_required" | "role_required" | null {
  if (input.treasuryEnabled) return null; // Existing dual-control flow is authoritative.
  if (input.hasPayrollRegisterEntry) return "review_required";
  if (!input.companyWide || !["owner", "admin"].includes(input.role)) return "role_required";
  return null;
}

export const REVIEWED_PAYOUT_DESTINATION_REQUIRED = {
  code: "PAYOUT_DESTINATION_REVIEW_REQUIRED",
  error: "This employee already appears in a payroll register (even if not released). Direct bank account, bank code or payout mobile changes require Treasury Controls and independent payout-destination approval. Do not alter a calculated register, create a replacement employee or bypass the approved workflow.",
} as const;
