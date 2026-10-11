import { pool } from "@/db";

/**
 * Serialize the first provider payout claim, final bank-file generation, and
 * its durable audit receipt per payroll run. This is a PostgreSQL transaction-
 * scoped advisory lock, not a session lock: transaction poolers such as
 * PgBouncer must keep the reserved backend only until ROLLBACK.
 *
 * The work callback performs its own separately authorized DB operations.
 * This lock never grants treasury, payroll, provider or bank permissions.
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
  // Xendit claims need a separate work connection, while PayMongo also holds
  // a separate wallet lock. A 1-2 connection pool would deadlock instead of
  // offering safe payout serialization; reject that configuration up front.
  if ((pool.options.max ?? 10) < 3) {
    throw new Error("PAYOUT_RUN_LOCK_REQUIRES_THREE_POOL_CONNECTIONS");
  }

  const key = `payrollph:payout-claim:${organizationId}:${payrollRunId}`;
  const client = await pool.connect();
  let began = false;
  let rolledBack = false;
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED, READ ONLY");
    began = true;
    await client.query("SET LOCAL statement_timeout = '7000ms'");
    const response = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired",
      [key],
    );
    if (response.rows[0]?.acquired === false) {
      throw new Error("PAYROLL_PAYOUT_CLAIM_ALREADY_IN_PROGRESS");
    }
    if (response.rows[0]?.acquired !== true) {
      throw new Error("PAYROLL_PAYOUT_CLAIM_LOCK_UNCERTAIN");
    }
    return await work();
  } finally {
    if (began) {
      try {
        // Also releases advisory ownership on crash and ensures a backend
        // cannot retain a lock across PgBouncer transaction-pool reuse.
        await client.query("ROLLBACK");
        rolledBack = true;
      } catch {
        // A possibly open transaction must be discarded from the pool.
      }
    }
    client.release(!rolledBack);
    if (began && !rolledBack) {
      throw new Error("PAYOUT_RUN_CLAIM_ROLLBACK_UNCERTAIN");
    }
  }
}
