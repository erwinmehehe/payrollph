import { pool } from "@/db";

let ready = false;
let inFlight: Promise<void> | null = null;

/**
 * Vercel deployments do not run drizzle db:push against the connected
 * production database. Keep the leave-payroll schema change idempotent at the
 * request/worker boundary so older databases upgrade before Drizzle selects the
 * new columns.
 */
export async function ensureLeavePayrollSchema() {
  if (ready) return;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('linaw_leave_payroll_schema_v1'))");
      await client.query(`
        ALTER TABLE leave_policies
          ADD COLUMN IF NOT EXISTS pay_treatment varchar(24) NOT NULL DEFAULT 'unconfigured',
          ADD COLUMN IF NOT EXISTS paid_percentage numeric(5,2) NOT NULL DEFAULT 100
      `);
      await client.query("ALTER TABLE leave_requests ALTER COLUMN days TYPE numeric(8,4)");
      await client.query(`
        CREATE TABLE IF NOT EXISTS hcm_leave_time_windows (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE cascade,
          leave_request_id integer NOT NULL REFERENCES leave_requests(id) ON DELETE cascade UNIQUE,
          employee_id integer NOT NULL REFERENCES employees(id) ON DELETE cascade,
          work_date date NOT NULL,
          start_time varchar(5) NOT NULL,
          end_time varchar(5) NOT NULL,
          minutes integer NOT NULL CHECK (minutes BETWEEN 1 AND 1439),
          standard_day_minutes integer NOT NULL CHECK (standard_day_minutes BETWEEN 60 AND 1440),
          exact_day_equivalent numeric(8,4) NOT NULL CHECK (exact_day_equivalent > 0),
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS hcm_leave_windows_org_date_idx
          ON hcm_leave_time_windows (organization_id, employee_id, work_date)
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
