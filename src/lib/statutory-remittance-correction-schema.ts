import { pool } from "@/db";

let ready = false;
let inFlight: Promise<void> | null = null;

export async function ensureStatutoryRemittanceCorrectionSchema() {
  if (ready) return;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('payrollph_statutory_remittance_corrections_v1'))",
      );
      await client.query(`
        CREATE TABLE IF NOT EXISTS statutory_remittance_correction_requests (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          target_type varchar(32) NOT NULL,
          batch_id integer NOT NULL REFERENCES statutory_remittance_batches(id) ON DELETE CASCADE,
          member_id integer REFERENCES statutory_remittance_members(id) ON DELETE CASCADE,
          original_snapshot jsonb NOT NULL,
          proposed_snapshot jsonb NOT NULL,
          reason varchar(360) NOT NULL,
          status varchar(24) NOT NULL DEFAULT 'pending',
          requested_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
          requested_by_name varchar(120) NOT NULL,
          decided_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
          decided_by_name varchar(120),
          decision_note varchar(360),
          decided_at timestamptz,
          applied_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT NOW(),
          updated_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS statutory_remittance_corrections_status_idx
        ON statutory_remittance_correction_requests(organization_id, status, created_at)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS statutory_remittance_corrections_batch_idx
        ON statutory_remittance_correction_requests(organization_id, batch_id)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS statutory_remittance_corrections_member_idx
        ON statutory_remittance_correction_requests(organization_id, member_id)
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
