import "dotenv/config";
import { eq, isNotNull, sql } from "drizzle-orm";
import { db, pool } from "../src/db";
import { employees, payrollEntries } from "../src/db/schema";
import {
  bankEncryptionConfigured,
  decryptBankAccount,
  encryptBankAccount,
  isEncryptedBankAccount,
} from "../src/lib/bank-account-crypto";

/**
 * One-off backfill: encrypts employee bank account numbers that were stored
 * before BANK_DATA_ENCRYPTION_KEY existed.
 *
 * Needs DATABASE_URL, like the other operator scripts, and is not an HTTP
 * endpoint. Anyone who can run it already has full database access.
 *
 * Order of operations for an existing deployment:
 *   1. Apply drizzle/0004_bank_account_envelope.sql (widens the column).
 *   2. Set BANK_DATA_ENCRYPTION_KEY (32 bytes: `openssl rand -hex 32`).
 *      Store that key somewhere other than the database. Losing it makes every
 *      encrypted account number unrecoverable.
 *   3. Run this once without flags. It only reports what it would change.
 *   4. Run it again with --apply.
 *
 * It also encrypts the copy of the account number that every payroll entry
 * keeps in its payment snapshot (payroll_entries.trace.payment). Without that,
 * old runs would still hold the plaintext number even after the employee row
 * was protected. The release guard compares by decrypted value, so re-sealing
 * a snapshot does not make it look "changed".
 *
 * Safe to re-run: already-encrypted rows are skipped, and every row is
 * decrypted again after writing and compared to the original before the script
 * moves on, so a bad key cannot silently destroy an account number.
 *
 * Usage:
 *   npx tsx scripts/encrypt-bank-accounts.ts            # dry run
 *   npx tsx scripts/encrypt-bank-accounts.ts --apply
 */

const apply = process.argv.includes("--apply");

async function columnWidth(): Promise<number | null> {
  const result = await pool.query(
    `select character_maximum_length as width
       from information_schema.columns
      where table_name = 'employees' and column_name = 'bank_account'`,
  );
  const width = result.rows[0]?.width;
  return typeof width === "number" ? width : null;
}

async function main() {
  if (!bankEncryptionConfigured()) {
    throw new Error("BANK_DATA_ENCRYPTION_KEY is not set (or is not 32 bytes). Nothing was changed.");
  }

  const width = await columnWidth();
  if (width !== null && width < 160) {
    throw new Error(
      `employees.bank_account is varchar(${width}), too narrow for an encrypted value. ` +
        "Apply drizzle/0004_bank_account_envelope.sql first. Nothing was changed.",
    );
  }

  const rows = await db
    .select({ id: employees.id, employeeNo: employees.employeeNo, bankAccount: employees.bankAccount })
    .from(employees)
    .where(isNotNull(employees.bankAccount));

  const pending = rows.filter((row) => row.bankAccount?.trim() && !isEncryptedBankAccount(row.bankAccount));
  const alreadyEncrypted = rows.filter((row) => isEncryptedBankAccount(row.bankAccount)).length;

  console.log(
    `${rows.length} employee(s) have a bank account. ${alreadyEncrypted} already encrypted, ${pending.length} to encrypt.`,
  );

  if (!apply) {
    const [{ snapshotCount }] = await db
      .select({ snapshotCount: sql<number>`count(*)::int` })
      .from(payrollEntries)
      .where(sql`${payrollEntries.trace} #>> '{payment,bankAccount}' is not null
                 and ${payrollEntries.trace} #>> '{payment,bankAccount}' <> ''
                 and ${payrollEntries.trace} #>> '{payment,bankAccount}' not like 'enc:v1:%'`);
    console.log(`${snapshotCount} payroll payment snapshot(s) also hold a plaintext account number.`);
    console.log("Dry run, nothing written. Re-run with --apply to encrypt.");
    return;
  }

  let done = 0;
  for (const row of pending) {
    const plain = row.bankAccount!.trim();
    const sealed = encryptBankAccount(plain);
    if (!sealed || !isEncryptedBankAccount(sealed)) {
      throw new Error(`Encryption produced no envelope for employee ${row.employeeNo}. Stopped after ${done} row(s).`);
    }
    // Prove the round trip before replacing the only copy of the number.
    if (decryptBankAccount(sealed) !== plain) {
      throw new Error(`Round-trip check failed for employee ${row.employeeNo}. Stopped after ${done} row(s).`);
    }
    await db.update(employees).set({ bankAccount: sealed }).where(eq(employees.id, row.id));
    done += 1;
  }

  const [{ remaining }] = await db
    .select({ remaining: sql<number>`count(*)::int` })
    .from(employees)
    .where(sql`${employees.bankAccount} is not null and ${employees.bankAccount} not like 'enc:v1:%'`);

  console.log(`Encrypted ${done} account number(s) on employees. ${remaining} plaintext value(s) remain.`);

  const snapshots = await db
    .select({ id: payrollEntries.id, trace: payrollEntries.trace })
    .from(payrollEntries)
    .where(sql`${payrollEntries.trace} #>> '{payment,bankAccount}' is not null
               and ${payrollEntries.trace} #>> '{payment,bankAccount}' <> ''
               and ${payrollEntries.trace} #>> '{payment,bankAccount}' not like 'enc:v1:%'`);

  let sealedSnapshots = 0;
  for (const row of snapshots) {
    const trace = row.trace as { payment?: { bankAccount?: string } } & Record<string, unknown>;
    const plain = trace.payment?.bankAccount?.trim();
    if (!plain) continue;
    const sealed = encryptBankAccount(plain);
    if (!sealed || decryptBankAccount(sealed) !== plain) {
      throw new Error(`Snapshot round-trip failed for payroll entry ${row.id}. Stopped after ${sealedSnapshots} snapshot(s).`);
    }
    await db
      .update(payrollEntries)
      .set({ trace: { ...trace, payment: { ...trace.payment, bankAccount: sealed } } })
      .where(eq(payrollEntries.id, row.id));
    sealedSnapshots += 1;
  }
  console.log(`Encrypted ${sealedSnapshots} payroll payment snapshot(s).`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
