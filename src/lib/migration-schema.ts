import { pool } from "@/db";

let ready = false;
let inFlight: Promise<void> | null = null;

/**
 * Migration Center adds a small amount of schema that older deployments do not
 * have. CI runs db:push against a disposable database, but Vercel previews do
 * not mutate the connected database during build. This guard makes the feature
 * self-initializing and idempotent at the request boundary instead of failing
 * with "column/table does not exist" at runtime.
 */
export async function ensureMigrationSchema() {
  if (ready) return;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('linaw_migration_schema_v1'))");

      await client.query(`
        ALTER TABLE import_batches
          ADD COLUMN IF NOT EXISTS source_system varchar(64) NOT NULL DEFAULT 'generic',
          ADD COLUMN IF NOT EXISTS import_kind varchar(40) NOT NULL DEFAULT 'employees'
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS historical_payroll_entries (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          import_batch_id integer REFERENCES import_batches(id) ON DELETE SET NULL,
          source_system varchar(64) NOT NULL DEFAULT 'generic',
          source_reference varchar(180) NOT NULL,
          period_label varchar(120) NOT NULL,
          pay_date date NOT NULL,
          gross_pay numeric(14,2) NOT NULL,
          basic_salary_earned numeric(14,2) NOT NULL DEFAULT 0,
          other_non_taxable numeric(14,2) NOT NULL DEFAULT 0,
          net_pay numeric(14,2) NOT NULL,
          tax_withheld numeric(14,2) NOT NULL DEFAULT 0,
          sss_employee numeric(14,2) NOT NULL DEFAULT 0,
          philhealth_employee numeric(14,2) NOT NULL DEFAULT 0,
          pagibig_employee numeric(14,2) NOT NULL DEFAULT 0,
          thirteenth_month numeric(14,2) NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);

      await client.query(`
        ALTER TABLE historical_payroll_entries
          ADD COLUMN IF NOT EXISTS basic_salary_earned numeric(14,2) NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS other_non_taxable numeric(14,2) NOT NULL DEFAULT 0
      `);

      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS historical_payroll_source_unique
        ON historical_payroll_entries (
          organization_id,
          employee_id,
          source_system,
          source_reference
        )
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
