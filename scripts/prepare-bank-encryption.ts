import "dotenv/config";
import { pool } from "../src/db";

/**
 * Idempotent schema preparation for bank-account encryption.
 *
 * This deliberately does only the non-destructive varchar widening. It does
 * not encrypt data and is safe to run before the production application key is
 * configured. Data encryption remains a separate, fingerprint-guarded step.
 */
async function main() {
  await pool.query("begin");
  try {
    await pool.query("ALTER TABLE employees ALTER COLUMN bank_account TYPE varchar(160)");
    const result = await pool.query(
      `select character_maximum_length as width
         from information_schema.columns
        where table_name = 'employees' and column_name = 'bank_account'`,
    );
    const width = result.rows[0]?.width;
    if (typeof width === "number" && width < 160) {
      throw new Error(`employees.bank_account is still varchar(${width}); expected at least varchar(160).`);
    }
    await pool.query("commit");
    console.log(`Bank-account schema ready (width=${width ?? "unbounded"}).`);
  } catch (error) {
    await pool.query("rollback");
    throw error;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
