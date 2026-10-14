import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { expenseCategoryPolicies, expenseClaimEvidence, expenseClaims } from "@/db/schema";
import { criticalReleaseFlagEnabled } from "./critical-release-flags";

export function spendPayrollEnabled(env: Readonly<Record<string, string | undefined>> = process.env) {
  return criticalReleaseFlagEnabled("spendPayroll", env) && !criticalReleaseFlagEnabled("multiEntity", env);
}
export type ReviewedExpenseClaim = typeof expenseClaims.$inferSelect &
  Partial<typeof expenseClaimEvidence.$inferSelect> & { policyMatched?: boolean };

/** Rollback cannot reinterpret a governed taxable/partially approved claim as legacy.
 * The schema probe is safe before A4 migration; absent evidence means legacy behavior.
 */
export async function assertSpendModeAvailable(database: Pick<typeof db, "select" | "execute">,
  claims: readonly (typeof expenseClaims.$inferSelect)[]) {
  if (spendPayrollEnabled() || !claims.length) return;
  const schema = await database.execute(sql`SELECT to_regclass('expense_claim_evidence') IS NOT NULL AS present`);
  if (schema.rows[0]?.present !== true) return;
  const [evidence] = await database.select({ claimId: expenseClaimEvidence.claimId }).from(expenseClaimEvidence)
    .where(inArray(expenseClaimEvidence.claimId, claims.map(claim => claim.id))).limit(1);
  if (evidence) throw new Error("Reviewed reimbursements are paused. Restore the reviewed Spend mode or reconcile before calculating or deciding these claims.");
}

/** No additive table reads or new response fields when the feature is off. */
export async function loadSpendClaimEvidence(database: Pick<typeof db, "select">,
  claims: readonly (typeof expenseClaims.$inferSelect)[]): Promise<ReviewedExpenseClaim[]> {
  if (!spendPayrollEnabled() || !claims.length) return [...claims];
  const rows = await database.select({ evidence: expenseClaimEvidence, policy: expenseCategoryPolicies })
    .from(expenseClaimEvidence).innerJoin(expenseCategoryPolicies, and(
      eq(expenseClaimEvidence.organizationId, expenseCategoryPolicies.organizationId),
      eq(expenseClaimEvidence.categoryPolicyId, expenseCategoryPolicies.id),
    )).where(inArray(expenseClaimEvidence.claimId, claims.map(claim => claim.id)));
  return claims.map(claim => {
    const row = rows.find(item => item.evidence.claimId === claim.id &&
      item.evidence.organizationId === claim.organizationId && item.evidence.employeeId === claim.employeeId);
    return row ? { ...claim, ...row.evidence, policyMatched: row.policy.category === claim.category &&
      row.policy.taxable === row.evidence.taxable && row.policy.reviewedByUserId > 0 &&
      row.policy.reviewReference.trim().length >= 8 } : claim;
  });
}
