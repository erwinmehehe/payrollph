import { and, eq, isNotNull } from "drizzle-orm";
import { db, pool } from "../src/db";
import { employees } from "../src/db/schema";
import {
  encryptGovernmentId,
  governmentIdEncryptionConfigured,
  isEncryptedGovernmentId,
} from "../src/lib/government-id-crypto";

const apply = process.argv.includes("--apply");

async function main() {
  if (!governmentIdEncryptionConfigured()) {
    throw new Error("Configure PII_ENCRYPTION_KEY, BANK_DATA_ENCRYPTION_KEY, or TOTP_ENCRYPTION_KEY before running this migration.");
  }

  const rows = await db.select().from(employees).where(isNotNull(employees.id));
  let changed = 0;

  for (const row of rows) {
    const fields = {
      tin: row.tin,
      tinBranchCode: row.tinBranchCode,
      sssNo: row.sssNo,
      philHealthNo: row.philHealthNo,
      pagIbigNo: row.pagIbigNo,
    };
    const hasPlaintext = Object.values(fields).some((value) => value && !isEncryptedGovernmentId(value));
    if (!hasPlaintext) continue;
    changed += 1;
    if (!apply) continue;

    await db.update(employees).set({
      tin: encryptGovernmentId(row.tin, { required: true }),
      tinBranchCode: encryptGovernmentId(row.tinBranchCode, { required: true }),
      sssNo: encryptGovernmentId(row.sssNo, { required: true }),
      philHealthNo: encryptGovernmentId(row.philHealthNo, { required: true }),
      pagIbigNo: encryptGovernmentId(row.pagIbigNo, { required: true }),
    }).where(and(eq(employees.id, row.id), eq(employees.organizationId, row.organizationId)));
  }

  console.log(JSON.stringify({ apply, employeesWithPlaintextGovernmentIds: changed }, null, 2));
}

main().finally(async () => {
  await pool.end();
});
