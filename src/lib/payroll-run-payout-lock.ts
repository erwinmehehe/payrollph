import { pool } from "@/db";

/**
 * Serialize final bank-file generation and the first provider payout ledger
 * claim for one released payroll. This protects the cross-rail decision window
 * where each path could otherwise see "no prior payout" concurrently.
 *
 * The advisory lock is session-scoped because exporters use independent pool
 * queries and must finish recording their audit receipt before releasing it.
 * This never authorizes a payout; all existing role/treasury/MFA gates remain.
 */
export async function withPayrollRunPayoutLock<T>(
  organizationId: number,
  payrollRunId: number,
  work: () => Promise<T>,
): Promise<T> {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 ||
      !Number.isSafeInteger(payrollRunId) || payrollRunId <= 0) {
    throw new Error("PAYOUT_RUN_LOCK_INVALID_SCOPE");
  }
  const key = `payrollph:payout-claim:${organizationId}:${payrollRunId}`;
  const client = await pool.connect();
  let acquired = false;
  let reusable = false;
  try {
    const result = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired", [key],
    );
    if (result.rows[0]?.acquired === false) {
      reusable = true;
      throw new Error("PAYROLL_PAYOUT_CLAIM_ALREADY_IN_PROGRESS");
    }
    if (result.rows[0]?.acquired !== true) {
      // If PostgreSQL acknowledgement is ambiguous, discard the session:
      // it may still own the lock even when the response could not be parsed.
      throw new Error("PAYROLL_PAYOUT_CLAIM_LOCK_UNCERTAIN");
    }
    acquired = true;
    return await work();
  } finally {
    let releaseFailed = false;
    if (acquired) {
      try {
        const result = await client.query<{ released: boolean }>(
          "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS released", [key],
        );
        reusable = result.rows[0]?.released === true;
        releaseFailed = !reusable;
      } catch {
        releaseFailed = true;
      }
    }
    // A failed acquisition acknowledgement or failed unlock can leave a
    // session-level advisory lock; never put that client back in the pool.
    client.release(!reusable);
    if (releaseFailed) throw new Error("PAYROLL_PAYOUT_CLAIM_UNLOCK_UNCERTAIN");
  }
}
