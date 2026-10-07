import { pool } from "@/db";

let ready = false;
let inFlight: Promise<void> | null = null;

export async function ensurePayrollMonthCloseSchema() {
  if (ready) return;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('payrollph_payroll_month_close_v2'))",
      );
      await client.query(`
        CREATE TABLE IF NOT EXISTS payroll_month_closures (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT,
          applicable_month varchar(7) NOT NULL,
          status varchar(24) NOT NULL DEFAULT 'certified',
          snapshot_hash varchar(64) NOT NULL,
          evidence_snapshot jsonb NOT NULL,
          certified_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
          certified_by_name varchar(120) NOT NULL,
          certified_at timestamptz NOT NULL DEFAULT NOW(),
          created_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        ALTER TABLE payroll_month_closures
          ADD COLUMN IF NOT EXISTS legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT;
        UPDATE payroll_month_closures c
        SET legal_entity_id = le.id
        FROM legal_entities le
        WHERE c.legal_entity_id IS NULL
          AND le.organization_id = c.organization_id
          AND le.primary_entity = true;
        ALTER TABLE payroll_month_closures
          ALTER COLUMN legal_entity_id SET NOT NULL;
        DROP INDEX IF EXISTS payroll_month_closure_snapshot_unique;
        CREATE UNIQUE INDEX payroll_month_closure_snapshot_unique
          ON payroll_month_closures(organization_id, legal_entity_id, applicable_month, snapshot_hash);
        DROP INDEX IF EXISTS payroll_month_closure_status_idx;
        CREATE INDEX payroll_month_closure_status_idx
          ON payroll_month_closures(organization_id, legal_entity_id, applicable_month, status);
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
