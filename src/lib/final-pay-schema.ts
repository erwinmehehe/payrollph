import { pool } from "@/db";
import { ensureMigrationSchema } from "@/lib/migration-schema";
import { ensureEmployeePayProfileSchema, ensureEmployeePayProfiles } from "@/lib/pay-basis-schema";

let ready = false;
let inFlight: Promise<void> | null = null;

export async function ensureFinalPaySchema(organizationId?: number) {
  await ensureEmployeePayProfileSchema();
  if (organizationId != null) await ensureEmployeePayProfiles(organizationId);
  await ensureMigrationSchema();
  if (ready) return;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('linaw_final_pay_schema_v1'))");

      await client.query(`
        ALTER TABLE separation_records
          ADD COLUMN IF NOT EXISTS final_pay_due_date date,
          ADD COLUMN IF NOT EXISTS final_pay_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
          ADD COLUMN IF NOT EXISTS released_at timestamptz,
          ADD COLUMN IF NOT EXISTS released_by varchar(120)
      `);

      await client.query(`
        ALTER TABLE employee_pay_retro_adjustments
          ADD COLUMN IF NOT EXISTS settled_separation_id integer
      `);

      await client.query(`
        ALTER TABLE historical_payroll_entries
          ADD COLUMN IF NOT EXISTS basic_salary_earned numeric(14,2) NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS other_non_taxable numeric(14,2) NOT NULL DEFAULT 0
      `);

      await client.query("COMMIT");
      ready = true;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* no-op */ }
      throw error;
    } finally {
      client.release();
      inFlight = null;
    }
  })();

  return inFlight;
}
