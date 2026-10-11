import { pool } from "@/db";
import type { PoolClient } from "pg";
import { coreSchemaCompatibilityMode } from "@/lib/core-schema-readonly";
import { separationSchemaSpec, verifyRequestSchemaReadOnly } from "@/lib/request-schema-readonly";

let separationSchemaPromise: Promise<void> | null = null;
let separationReadOnlyReady = false;
let separationReadOnlyInFlight: Promise<void> | null = null;

export function ensureSeparationSchema() {
  // Use independent readiness caches: even an earlier legacy DDL call
  // cannot bypass the opt-in read-only catalog check for final-pay records.
  const mode = coreSchemaCompatibilityMode(process.env.CORE_SCHEMA_COMPATIBILITY_MODE);
  if (mode === "read-only") {
    if (separationReadOnlyReady) return Promise.resolve();
    if (separationReadOnlyInFlight) return separationReadOnlyInFlight;
    separationReadOnlyInFlight = (async () => {
      let client: PoolClient | null = null;
      let verified = false;
      try {
        client = await pool.connect();
        const connected = client;
        await verifyRequestSchemaReadOnly(
          (sql, parameters) => connected.query(sql, parameters),
          separationSchemaSpec,
        );
        verified = true;
        separationReadOnlyReady = true;
      } finally {
        // Catalog failure or failed ROLLBACK makes the connection unsafe.
        client?.release(!verified);
        separationReadOnlyInFlight = null;
      }
    })();
    return separationReadOnlyInFlight;
  }

  separationSchemaPromise ??= (async () => {
    let client: PoolClient | null = null;
    let transactionOpen = false;
    let safeToReuse = false;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      transactionOpen = true;
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS thirteenth_entitlement numeric(12,2) NOT NULL DEFAULT 0');
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS thirteenth_paid_ytd numeric(12,2) NOT NULL DEFAULT 0');
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS basic_salary_earned_ytd numeric(14,2) NOT NULL DEFAULT 0');
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS historical_basic_salary_earned numeric(14,2) NOT NULL DEFAULT 0');
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS unpaid_basic_salary numeric(12,2) NOT NULL DEFAULT 0');
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS separation_pay numeric(12,2) NOT NULL DEFAULT 0');
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS retirement_pay numeric(12,2) NOT NULL DEFAULT 0');
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS other_benefits numeric(12,2) NOT NULL DEFAULT 0');
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS final_statutory_deductions numeric(12,2) NOT NULL DEFAULT 0');
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS gross_final_pay numeric(12,2) NOT NULL DEFAULT 0');
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS final_pay_due_date date');
      await client.query("ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS computation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb");
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS approved_at timestamptz');
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS released_at timestamptz');
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS release_reference varchar(160)');
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS prepared_by_user_id integer REFERENCES users(id) ON DELETE SET NULL');
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS approved_by_user_id integer REFERENCES users(id) ON DELETE SET NULL');
      await client.query('ALTER TABLE separation_records ADD COLUMN IF NOT EXISTS released_by_user_id integer REFERENCES users(id) ON DELETE SET NULL');
      await client.query("COMMIT");
      transactionOpen = false;
      safeToReuse = true;
    } catch (error) {
      if (transactionOpen && client) {
        try {
          await client.query("ROLLBACK");
          transactionOpen = false;
          safeToReuse = true;
        } catch {
          // Failed rollback requires discarding the possibly open transaction.
        }
      }
      separationSchemaPromise = null;
      throw error;
    } finally {
      client?.release(!safeToReuse);
    }
  })();
  return separationSchemaPromise;
}
