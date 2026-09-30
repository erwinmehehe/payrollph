import { pool } from "@/db";

let coreSchemaReady = false;
let coreSchemaInFlight: Promise<void> | null = null;

/**
 * Production on Vercel does not run drizzle db:push automatically.
 * Keep additive schema changes required by the current workspace idempotent so
 * older production databases can upgrade before Drizzle selects the new fields.
 */
export async function ensureCoreCompatibilitySchema() {
  if (coreSchemaReady) return;
  if (coreSchemaInFlight) return coreSchemaInFlight;

  coreSchemaInFlight = (async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('linaw_core_schema_compat_v2'))");

      await client.query(`
        ALTER TABLE organizations
          ADD COLUMN IF NOT EXISTS bir_tin varchar(16),
          ADD COLUMN IF NOT EXISTS bir_branch_code varchar(4),
          ADD COLUMN IF NOT EXISTS sss_employer_no varchar(24),
          ADD COLUMN IF NOT EXISTS philhealth_employer_no varchar(24),
          ADD COLUMN IF NOT EXISTS pagibig_employer_no varchar(24)
      `);

      await client.query(`
        ALTER TABLE employees
          ADD COLUMN IF NOT EXISTS middle_name varchar(80),
          ADD COLUMN IF NOT EXISTS tin_branch_code varchar(4),
          ADD COLUMN IF NOT EXISTS nationality varchar(60) NOT NULL DEFAULT 'Filipino'
      `);

      await client.query(`
        ALTER TABLE payroll_runs
          ADD COLUMN IF NOT EXISTS period_start date,
          ADD COLUMN IF NOT EXISTS period_end date,
          ADD COLUMN IF NOT EXISTS scope_org_unit_id integer
      `);

      // Older runs pre-date explicit period boundaries. Use pay date as a safe
      // compatibility fallback so current UI/API reads never receive null.
      await client.query(`
        UPDATE payroll_runs
        SET period_start = COALESCE(period_start, pay_date),
            period_end = COALESCE(period_end, pay_date)
        WHERE period_start IS NULL OR period_end IS NULL
      `);

      await client.query("ALTER TABLE payroll_runs ALTER COLUMN period_start SET NOT NULL");
      await client.query("ALTER TABLE payroll_runs ALTER COLUMN period_end SET NOT NULL");

      await client.query(`
        ALTER TABLE import_batches
          ADD COLUMN IF NOT EXISTS source_system varchar(64) NOT NULL DEFAULT 'generic',
          ADD COLUMN IF NOT EXISTS import_kind varchar(40) NOT NULL DEFAULT 'employees'
      `);

      await client.query(`
        ALTER TABLE outbox
          ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          ADD COLUMN IF NOT EXISTS provider_message_id varchar(200),
          ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 5,
          ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
          ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS outbox_org_created_idx
        ON outbox(organization_id, created_at)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS outbox_retry_idx
        ON outbox(status, next_attempt_at)
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
          net_pay numeric(14,2) NOT NULL,
          tax_withheld numeric(14,2) NOT NULL DEFAULT 0,
          sss_employee numeric(14,2) NOT NULL DEFAULT 0,
          philhealth_employee numeric(14,2) NOT NULL DEFAULT 0,
          pagibig_employee numeric(14,2) NOT NULL DEFAULT 0,
          thirteenth_month numeric(14,2) NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS historical_payroll_source_unique
        ON historical_payroll_entries(
          organization_id,
          employee_id,
          source_system,
          source_reference
        )
      `);

      await client.query("COMMIT");
      coreSchemaReady = true;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* no-op */ }
      throw error;
    } finally {
      client.release();
      coreSchemaInFlight = null;
    }
  })();

  return coreSchemaInFlight;
}
