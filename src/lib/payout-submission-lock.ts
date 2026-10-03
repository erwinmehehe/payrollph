import type { PoolClient } from "pg";
import { pool } from "@/db";

const LOCK_PREFIX = "linaw:paymongo-wallet:";

async function unlock(client: PoolClient, key: string) {
  try {
    await client.query(
      "select pg_advisory_unlock(hashtextextended($1, 0))",
      [key],
    );
  } finally {
    client.release();
  }
}

/**
 * Serialize live PayMongo submissions by wallet across payroll runs.
 *
 * Idempotency protects repeated submission of the SAME run. This advisory lock
 * closes the separate race where two different runs both read the same wallet
 * balance before either debit reaches the provider.
 */
export async function withPayrollPayoutSubmissionLock<T>(
  work: () => Promise<T>,
): Promise<T> {
  const walletId = process.env.PAYMONGO_WALLET_ID?.trim();
  if (!walletId) {
    throw new Error("PAYMONGO_WALLET_ID is required before a live payout can acquire the wallet submission lock.");
  }

  const key = `${LOCK_PREFIX}${walletId}`;
  const client = await pool.connect();
  const result = await client.query<{ acquired: boolean }>(
    "select pg_try_advisory_lock(hashtextextended($1, 0)) as acquired",
    [key],
  );
  if (!result.rows[0]?.acquired) {
    client.release();
    throw new Error(
      "Another payroll payout is already being submitted from this PayMongo wallet. Wait for it to finish and reconcile before retrying.",
    );
  }

  try {
    return await work();
  } finally {
    await unlock(client, key);
  }
}
