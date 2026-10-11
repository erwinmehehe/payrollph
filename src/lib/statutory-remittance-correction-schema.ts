import { coreSchemaCompatibilityMode } from "@/lib/core-schema-readonly";
import { statutoryCorrectionSchemaSpec, verifyRequestSchemaReadOnlyFromPool } from "@/lib/request-schema-readonly";
import { pool } from "@/db";

let ready = false;
let inFlight: Promise<void> | null = null;

export async function ensureStatutoryRemittanceCorrectionSchema() {
  const mode = coreSchemaCompatibilityMode(process.env.CORE_SCHEMA_COMPATIBILITY_MODE);
  if (mode === "read-only") {
    if (inFlight) throw new Error("REMITTANCE_CORRECTION_LEGACY_SCHEMA_WRITE_IN_PROGRESS");
    await verifyRequestSchemaReadOnlyFromPool(pool, statutoryCorrectionSchemaSpec);
    return;
  }
  if (ready) return;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const client = await pool.connect();
    let transactionOpen = false;
    let safeToReuse = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
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
      transactionOpen = false;
      safeToReuse = true;
      ready = true;
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query("ROLLBACK");
          transactionOpen = false;
          safeToReuse = true;
        } catch {
          // Never reuse a client with an uncertain open transaction.
        }
      }
      throw error;
    } finally {
      client.release(!safeToReuse);
      inFlight = null;
    }
  })();

  return inFlight;
}
