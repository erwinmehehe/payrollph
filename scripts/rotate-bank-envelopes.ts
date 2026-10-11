import "dotenv/config";
import { and, asc, eq, gt } from "drizzle-orm";
import { db, pool } from "../src/db";
import { employeePayoutChangeRequests, employees, legalEntities, payrollEntries } from "../src/db/schema";
import { bankEncryptionKeySource, bankEncryptionPreviousKeyConfigured } from "../src/lib/bank-account-crypto";
import { replaceEmployeeBankAccount, replacePayrollSnapshotBankAccount } from "./lib/bank-backfill-writes";
import { bankRotationPlan } from "./lib/bank-rotation-policy";

/**
 * Controlled current-key rotation for ALL FOUR bank destination stores.
 * Dry-run never changes records. Apply requires an approval reference, an
 * explicit operator confirmation and a DBA-verified database name.
 * Does not rotate government IDs, alter schema or release any payroll.
 */
const PAGE_SIZE = 500;
const apply = process.argv.includes("--apply");
type BankRow = { id: number; value: unknown };
type Write = (id: number, original: string, replacement: string) => Promise<void>;
type Read = (cursor: number) => Promise<BankRow[]>;

function paymentBankAccount(trace: unknown): unknown {
  if (trace == null) return null;
  if (typeof trace !== "object" || Array.isArray(trace)) throw new Error("Invalid stored payroll snapshot.");
  const payment = (trace as Record<string, unknown>).payment;
  if (payment == null) return null;
  if (typeof payment !== "object" || Array.isArray(payment)) throw new Error("Invalid payroll payment evidence.");
  return (payment as Record<string, unknown>).bankAccount;
}

async function scanStore(label: string, read: Read, write: Write, mutate: boolean) {
  let cursor = 0;
  let empty = 0;
  let alreadyCurrent = 0;
  let rewrap = 0;
  for (;;) {
    const rows = await read(cursor);
    if (rows.length > PAGE_SIZE) throw new Error("Bank rotation page exceeded the allowed size.");
    for (const row of rows) {
      if (!Number.isSafeInteger(row.id) || row.id <= cursor) {
        throw new Error("Bank rotation page is out of order.");
      }
      cursor = row.id;
      const decision = bankRotationPlan(row.value);
      if (decision.status === "empty") empty += 1;
      if (decision.status === "already-current") alreadyCurrent += 1;
      if (decision.status === "rewrap") {
        rewrap += 1;
        if (mutate) await write(row.id, row.value as string, decision.replacement);
      }
    }
    if (rows.length < PAGE_SIZE) break;
  }
  console.log(label + ": current=" + alreadyCurrent + ", previous-key=" + rewrap +
    ", empty=" + empty + (mutate ? " (rotation applied)" : " (dry-run)"));
  return { previousKey: rewrap };
}

async function scanAll(mutate: boolean) {
  const summaries = [
    await scanStore("Employee accounts",
      async (cursor) => db.select({ id: employees.id, value: employees.bankAccount })
        .from(employees).where(gt(employees.id, cursor)).orderBy(asc(employees.id)).limit(PAGE_SIZE),
      async (id, original, replacement) => replaceEmployeeBankAccount(pool, {
        id, original, encrypted: replacement,
      }), mutate),
    await scanStore("Payroll payment snapshots",
      async (cursor) => {
        const rows = await db.select({ id: payrollEntries.id, trace: payrollEntries.trace })
          .from(payrollEntries).where(gt(payrollEntries.id, cursor))
          .orderBy(asc(payrollEntries.id)).limit(PAGE_SIZE);
        return rows.map(row => ({ id: row.id, value: paymentBankAccount(row.trace) }));
      },
      async (id, original, replacement) => replacePayrollSnapshotBankAccount(pool, {
        id, original, encrypted: replacement,
      }), mutate),
    await scanStore("Legal-entity disbursement accounts",
      async (cursor) => db.select({ id: legalEntities.id, value: legalEntities.disbursementAccount })
        .from(legalEntities).where(gt(legalEntities.id, cursor))
        .orderBy(asc(legalEntities.id)).limit(PAGE_SIZE),
      async (id, original, replacement) => {
        const changed = await db.update(legalEntities).set({ disbursementAccount: replacement })
          .where(and(eq(legalEntities.id, id), eq(legalEntities.disbursementAccount, original)))
          .returning({ id: legalEntities.id });
        if (changed.length !== 1) throw new Error("Legal-entity account changed during rotation.");
      }, mutate),
    await scanStore("Payout-change proposals",
      async (cursor) => db.select({
        id: employeePayoutChangeRequests.id,
        value: employeePayoutChangeRequests.proposedBankAccount,
      }).from(employeePayoutChangeRequests).where(gt(employeePayoutChangeRequests.id, cursor))
        .orderBy(asc(employeePayoutChangeRequests.id)).limit(PAGE_SIZE),
      async (id, original, replacement) => {
        const changed = await db.update(employeePayoutChangeRequests).set({ proposedBankAccount: replacement })
          .where(and(eq(employeePayoutChangeRequests.id, id),
            eq(employeePayoutChangeRequests.proposedBankAccount, original)))
          .returning({ id: employeePayoutChangeRequests.id });
        if (changed.length !== 1) throw new Error("Payout-change account changed during rotation.");
      }, mutate),
  ];
  return summaries.reduce((sum, item) => sum + item.previousKey, 0);
}

async function main() {
  if (bankEncryptionKeySource() !== "dedicated" || !bankEncryptionPreviousKeyConfigured()) {
    throw new Error("Bank rotation requires separate valid current dedicated and previous decryption keys.");
  }
  const expectedDb = process.env.EXPECTED_PRODUCTION_DATABASE_NAME;
  if (!expectedDb || !/^[A-Za-z0-9_]{1,63}$/.test(expectedDb)) {
    throw new Error("Bank rotation requires a DBA-verified database name.");
  }
  if (apply) {
    const approval = process.env.BANK_ROTATION_APPROVAL_REF;
    if (process.env.BANK_ROTATION_CONFIRMATION !== "APPLY_APPROVED_BANK_ROTATION" ||
      !approval || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{7,120}$/.test(approval)) {
      throw new Error("Bank rotation apply requires an approved change reference and explicit confirmation.");
    }
  }

  const identity = await pool.query<{ matches: boolean }>(
    "SELECT current_database() = $1::text AS matches", [expectedDb],
  );
  if (identity.rows.length !== 1 || identity.rows[0].matches !== true) {
    throw new Error("Database target does not match the reviewed bank-rotation target.");
  }
  // First pass validates every stored envelope before writing ANY replacement.
  const pending = await scanAll(false);
  if (!apply) {
    console.log("Rotation dry-run complete. No bank values were changed.");
    return;
  }
  const written = await scanAll(true);
  if (written > pending) {
    throw new Error("More old-key values appeared during rotation; stop and reconcile concurrent writes.");
  }
  console.log("Rotation writes completed. Run four-store current-key verification before retiring the previous key.");
}

void main()
  .catch(() => {
    // Suppress raw pg/SQL error details and all bank account numbers.
    console.error("Bank rotation stopped. Reconcile the four stores under DBA/security supervision.");
    process.exitCode = 1;
  })
  .finally(() => pool.end());
