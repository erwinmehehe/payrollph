import { pool } from "@/db";

const LOCK_PREFIX = "linaw:paymongo-wallet:";

/**
 * Serialize live PayMongo submissions by wallet, including different payroll
 * runs that might otherwise spend the same wallet balance concurrently.
 *
 * A transaction-scoped advisory lock remains attached to one pinned backend
 * for the duration of a PostgreSQL transaction, including when PgBouncer is
 * in transaction-pooling mode. It is always released by ROLLBACK (or by a
 * disconnected backend), never by a session advisory-unlock query.
 *
 * An incoming request may not silently retry when lock ownership or release
 * is ambiguous; an earlier provider HTTP request might have moved funds.
 */
export async function withPayrollPayoutSubmissionLock<T>(
  work: () => Promise<T>,
): Promise<T> {
  const walletId = process.env.PAYMONGO_WALLET_ID?.trim();
  if (!walletId) {
    throw new Error("PAYMONGO_WALLET_ID is required before a live payout can acquire the wallet submission lock.");
  }
  if ((pool.options.max ?? 10) < 2) {
    throw new Error("PAYMONGO_WALLET_LOCK_REQUIRES_MULTIPLE_POOL_CONNECTIONS");
  }

  const key = `${LOCK_PREFIX}${walletId}`;
  const client = await pool.connect();
  let began = false;
  let rolledBack = false;
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED, READ ONLY");
    began = true;
    await client.query("SET LOCAL statement_timeout = '7000ms'");
    const result = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired",
      [key],
    );
    if (result.rows[0]?.acquired === false) {
      throw new Error(
        "Another payroll payout is already being submitted from this PayMongo wallet. Reconcile it before retrying.",
      );
    }
    if (result.rows[0]?.acquired !== true) {
      throw new Error("PAYMONGO_WALLET_LOCK_UNCERTAIN");
    }
    return await work();
  } finally {
    if (began) {
      try {
        await client.query("ROLLBACK");
        rolledBack = true;
      } catch {
        // An uncertain open transaction must be discarded from the pool.
      }
    }
    client.release(!rolledBack);
    if (began && !rolledBack) {
      throw new Error("PAYMONGO_WALLET_LOCK_ROLLBACK_UNCERTAIN");
    }
  }
}
