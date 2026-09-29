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
