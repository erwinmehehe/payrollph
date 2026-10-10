import "dotenv/config";
import { asc, gt } from "drizzle-orm";
import { db, pool } from "../src/db";
import {
  employeePayoutChangeRequests,
  employees,
  legalEntities,
  payrollEntries,
} from "../src/db/schema";
import { bankEncryptionConfigured } from "../src/lib/bank-account-crypto";
import { classifyStoredBankEnvelope, currentBankKeyOnly } from "./lib/bank-envelope-inspection";

/**
 * Read-only post-backfill proof, to be run from an approved operator context.
 * Verify every nonblank stored account across all four stores using the
 * CURRENT key alone; an enc:v1: prefix or an old rotation key is insufficient.
 * No account values, ciphertext, names or key material are logged.
 *
 * Usage: npx tsx scripts/verify-bank-account-envelopes.ts
 */
const PAGE_SIZE = 500;
const currentOnlyEnv = currentBankKeyOnly();
type EnvelopeRow = { id: number; value: unknown };

function paymentBankAccount(trace: unknown): unknown {
  if (trace == null) return null;
  if (typeof trace !== "object" || Array.isArray(trace)) return { invalid: true };
  const payment = (trace as Record<string, unknown>).payment;
  if (payment == null) return null;
  if (typeof payment !== "object" || Array.isArray(payment)) return { invalid: true };
  return (payment as Record<string, unknown>).bankAccount;
}

async function scan(
  label: string,
  readBatch: (afterId: number) => Promise<EnvelopeRow[]>,
): Promise<{ plaintext: number; unreadable: number }> {
  let afterId = 0;
  let authenticated = 0;
  let plaintext = 0;
  let unreadable = 0;
  for (;;) {
    const rows = await readBatch(afterId);
    if (rows.length > PAGE_SIZE) throw new Error("Bank audit source exceeded page size.");
    for (const row of rows) {
      if (!Number.isSafeInteger(row.id) || row.id <= afterId) {
        throw new Error("Bank audit source returned out-of-order or invalid IDs.");
      }
      afterId = row.id;
      const state = classifyStoredBankEnvelope(row.value, currentOnlyEnv);
      if (state === "authenticated") authenticated += 1;
      if (state === "plaintext") plaintext += 1;
      if (state === "unreadable") unreadable += 1;
    }
    if (rows.length < PAGE_SIZE) break;
  }
  console.log(label + ": authenticated=" + authenticated +
    ", plaintext=" + plaintext + ", unreadable=" + unreadable);
  return { plaintext, unreadable };
}

async function main() {
  if (!bankEncryptionConfigured(currentOnlyEnv)) {
    throw new Error("A valid current bank encryption key is required for verification.");
  }
  const results = await Promise.all([
    scan("Employee bank accounts", async (cursor) => {
      const rows = await db.select({ id: employees.id, value: employees.bankAccount })
        .from(employees).where(gt(employees.id, cursor))
        .orderBy(asc(employees.id)).limit(PAGE_SIZE);
      return rows;
    }),
    scan("Payroll payment snapshots", async (cursor) => {
      const rows = await db.select({ id: payrollEntries.id, trace: payrollEntries.trace })
        .from(payrollEntries).where(gt(payrollEntries.id, cursor))
        .orderBy(asc(payrollEntries.id)).limit(PAGE_SIZE);
      return rows.map((row) => ({ id: row.id, value: paymentBankAccount(row.trace) }));
    }),
    scan("Legal entity disbursement accounts", async (cursor) => {
      const rows = await db.select({ id: legalEntities.id, value: legalEntities.disbursementAccount })
        .from(legalEntities).where(gt(legalEntities.id, cursor))
        .orderBy(asc(legalEntities.id)).limit(PAGE_SIZE);
      return rows;
    }),
    scan("Payout change proposals", async (cursor) => {
      const rows = await db.select({
        id: employeePayoutChangeRequests.id,
        value: employeePayoutChangeRequests.proposedBankAccount,
      }).from(employeePayoutChangeRequests)
        .where(gt(employeePayoutChangeRequests.id, cursor))
        .orderBy(asc(employeePayoutChangeRequests.id)).limit(PAGE_SIZE);
      return rows;
    }),
  ]);
  if (results.some((result) => result.plaintext !== 0 || result.unreadable !== 0)) {
    throw new Error("Bank envelope verification failed. No rollout approval is implied.");
  }
  console.log("Current-key authenticated bank envelopes verified across four stores.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Bank verification failed.");
    process.exitCode = 1;
  })
  .finally(() => pool.end());
