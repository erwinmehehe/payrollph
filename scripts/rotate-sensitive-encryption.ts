import "dotenv/config";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, pool } from "../src/db";
import { contractors, employees, payrollEntries } from "../src/db/schema";
import {
  bankEncryptionConfigured,
  bankEncryptionPreviousKeyConfigured,
  decryptBankAccount,
  rotateBankAccountEncryption,
} from "../src/lib/bank-account-crypto";
import {
  decryptGovernmentId,
  governmentIdEncryptionConfigured,
  governmentIdPreviousKeyConfigured,
  rotateGovernmentIdEncryption,
} from "../src/lib/government-id-crypto";

const apply = process.argv.includes("--apply");

function currentOnlyEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.BANK_DATA_ENCRYPTION_KEY_PREVIOUS;
  delete env.PII_ENCRYPTION_KEY_PREVIOUS;
  delete env.TOTP_ENCRYPTION_KEY_PREVIOUS;
  return env;
}

function verifyBank(value: string | null) {
  if (!value) return;
  decryptBankAccount(value, currentOnlyEnv());
}

function verifyGov(value: string | null) {
  if (!value) return;
  decryptGovernmentId(value, currentOnlyEnv());
}

async function main() {
  const rotateBank = bankEncryptionConfigured() && bankEncryptionPreviousKeyConfigured();
  const rotateGov = governmentIdEncryptionConfigured() && governmentIdPreviousKeyConfigured();
  if (!rotateBank && !rotateGov) {
    throw new Error(
      "Configure a current and previous encryption key for BANK_DATA_ENCRYPTION_KEY/PII_ENCRYPTION_KEY " +
      "(or the supported TOTP fallbacks) before rotating sensitive data.",
    );
  }

  const employeeRows = await db.select().from(employees).where(isNotNull(employees.id));
  const contractorRows = rotateGov
    ? await db.select().from(contractors).where(isNotNull(contractors.id))
    : [];
  const entryRows = rotateBank
    ? await db.select({ id: payrollEntries.id, trace: payrollEntries.trace }).from(payrollEntries)
    : [];

  let bankRows = 0;
  let governmentRows = 0;
  let contractorRowsChanged = 0;
  let snapshotRows = 0;

  for (const employee of employeeRows) {
    const patch: Partial<typeof employees.$inferInsert> = {};

    if (rotateBank && employee.bankAccount?.trim()) {
      const next = rotateBankAccountEncryption(employee.bankAccount);
      verifyBank(next);
      patch.bankAccount = next;
      bankRows += 1;
    }

    if (rotateGov) {
      for (const [field, value] of Object.entries({
        tin: employee.tin,
        tinBranchCode: employee.tinBranchCode,
        sssNo: employee.sssNo,
        philHealthNo: employee.philHealthNo,
        pagIbigNo: employee.pagIbigNo,
      })) {
        if (!value?.trim()) continue;
        const next = rotateGovernmentIdEncryption(value, { required: true });
        verifyGov(next);
        patch[field] = next;
        governmentRows += 1;
      }
    }

    if (apply && Object.keys(patch).length > 0) {
      await db.update(employees).set(patch).where(and(
        eq(employees.id, employee.id),
        eq(employees.organizationId, employee.organizationId),
      ));
    }
  }

  if (rotateGov) {
    for (const contractor of contractorRows) {
      if (!contractor.tin?.trim()) continue;
      const next = rotateGovernmentIdEncryption(contractor.tin, { required: true });
      verifyGov(next);
      contractorRowsChanged += 1;
      if (apply) {
        await db.update(contractors).set({ tin: next }).where(and(
          eq(contractors.id, contractor.id),
          eq(contractors.organizationId, contractor.organizationId),
        ));
      }
    }
  }

  if (rotateBank) {
    for (const row of entryRows) {
      const trace = row.trace as { payment?: { bankAccount?: string | null } } & Record<string, unknown>;
      const stored = trace.payment?.bankAccount?.trim();
      if (!stored) continue;
      const next = rotateBankAccountEncryption(stored);
      verifyBank(next);
      snapshotRows += 1;
      if (apply) {
        await db.update(payrollEntries).set({
          trace: {
            ...trace,
            payment: { ...trace.payment, bankAccount: next },
          },
        }).where(eq(payrollEntries.id, row.id));
      }
    }
  }

  console.log(JSON.stringify({
    apply,
    bankEmployeeValuesRewrapped: bankRows,
    governmentIdentifierValuesRewrapped: governmentRows,
    contractorTinValuesRewrapped: contractorRowsChanged,
    payrollPaymentSnapshotsRewrapped: snapshotRows,
    nextStep: apply
      ? "Run the script once more without previous-key environment variables. If all reads succeed, remove the previous keys permanently."
      : "Dry run only. Re-run with --apply after reviewing the counts.",
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
