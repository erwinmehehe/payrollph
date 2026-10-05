import { ensureStatutoryRemittanceCorrectionSchema } from "@/lib/statutory-remittance-correction-schema";
import { pool } from "@/db";

let ready = false;
let inFlight: Promise<void> | null = null;

export async function ensureStatutoryRemittanceMonthCloseSchema() {
  if (ready) return;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    await ensureStatutoryRemittanceCorrectionSchema();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('payrollph_statutory_remittance_month_close_v2'))",
      );
      await client.query(`
        CREATE TABLE IF NOT EXISTS statutory_remittance_month_closures (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          applicable_month varchar(7) NOT NULL,
          status varchar(24) NOT NULL DEFAULT 'certified',
          snapshot_hash varchar(64) NOT NULL,
          certified_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
          certified_by_name varchar(120) NOT NULL,
          certified_at timestamptz NOT NULL DEFAULT NOW(),
          invalidated_at timestamptz,
          invalidation_reason varchar(280),
          created_at timestamptz NOT NULL DEFAULT NOW(),
          updated_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS statutory_remittance_month_closure_snapshot_unique
        ON statutory_remittance_month_closures(organization_id, applicable_month, snapshot_hash)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS statutory_remittance_month_closure_status_idx
        ON statutory_remittance_month_closures(organization_id, status)
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
