import "dotenv/config";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db, pool } from "../src/db";
import { replaceEmployeeBankAccount, replacePayrollSnapshotBankAccount } from "./lib/bank-backfill-writes";
import { employeePayoutChangeRequests, employees, legalEntities, payrollEntries } from "../src/db/schema";
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
 * It also encrypts payroll payment snapshots, legacy proposed payout-destination
 * accounts, and legal-entity disbursement accounts. Otherwise an operator
 * could see "zero plaintext" on employees while those other tables still
 * retain copies. The release guard compares by decrypted value.
 *
 * Already-encrypted rows are skipped. Each newly sealed value must pass a
 * decrypt/compare check BEFORE writing. Each write also compares the original
 * account to reject stale scan results. Snapshot updates patch only the bank
 * account field, preserving concurrent changes to unrelated payroll evidence.
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
  const legalLegacy = await db.select({
    id: legalEntities.id, bankAccount: legalEntities.disbursementAccount,
  }).from(legalEntities).where(sql`${legalEntities.disbursementAccount} is not null
    and ${legalEntities.disbursementAccount} <> ''
    and ${legalEntities.disbursementAccount} not like 'enc:v1:%'`);

  const proposedLegacy = await db.select({
    id: employeePayoutChangeRequests.id, bankAccount: employeePayoutChangeRequests.proposedBankAccount,
  }).from(employeePayoutChangeRequests).where(sql`${employeePayoutChangeRequests.proposedBankAccount} is not null
    and ${employeePayoutChangeRequests.proposedBankAccount} <> ''
    and ${employeePayoutChangeRequests.proposedBankAccount} not like 'enc:v1:%'`);

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
    console.log(`${legalLegacy.length} legal entity disbursement account(s) hold plaintext.`);
    console.log(`${proposedLegacy.length} payout change request(s) hold plaintext.`);
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
    await replaceEmployeeBankAccount(pool, {
      id: row.id, original: row.bankAccount!, encrypted: sealed,
    });
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
    await replacePayrollSnapshotBankAccount(pool, {
      id: row.id, original: trace.payment!.bankAccount!, encrypted: sealed,
    });
    sealedSnapshots += 1;
  }
  console.log(`Encrypted ${sealedSnapshots} payroll payment snapshot(s).`);
  // The other two recorded account fields may still contain legacy plaintext.
  // Compare-and-swap prevents overwriting edits made during the operator run.
  let legalSealed = 0;
  for (const row of legalLegacy) {
    const plain = row.bankAccount?.trim();
    if (!plain) continue;
    const sealed = encryptBankAccount(plain);
    if (!sealed || decryptBankAccount(sealed) !== plain) {
      throw new Error("Legal-entity account round-trip failed. Stop before continuing.");
    }
    const updated = await db.update(legalEntities).set({ disbursementAccount: sealed })
      .where(and(eq(legalEntities.id, row.id), eq(legalEntities.disbursementAccount, row.bankAccount!)))
      .returning({ id: legalEntities.id });
    if (updated.length !== 1) throw new Error("Legal-entity account changed during backfill; repeat dry-run.");
    legalSealed += 1;
  }
  console.log(`Encrypted ${legalSealed} legal entity disbursement account(s).`);

  let proposedSealed = 0;
  for (const row of proposedLegacy) {
    const plain = row.bankAccount?.trim();
    if (!plain) continue;
    const sealed = encryptBankAccount(plain);
    if (!sealed || decryptBankAccount(sealed) !== plain) {
      throw new Error("Payout-change account round-trip failed. Stop before continuing.");
    }
    const updated = await db.update(employeePayoutChangeRequests).set({ proposedBankAccount: sealed })
      .where(and(eq(employeePayoutChangeRequests.id, row.id),
        eq(employeePayoutChangeRequests.proposedBankAccount, row.bankAccount!)))
      .returning({ id: employeePayoutChangeRequests.id });
    if (updated.length !== 1) throw new Error("Payout-change account changed during backfill; repeat dry-run.");
    proposedSealed += 1;
  }
  console.log(`Encrypted ${proposedSealed} payout change request account(s).`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
