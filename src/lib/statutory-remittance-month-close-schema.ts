import { coreSchemaCompatibilityMode } from "@/lib/core-schema-readonly";
import { statutoryMonthCloseSchemaSpec, verifyRequestSchemaReadOnlyFromPool } from "@/lib/request-schema-readonly";
import { ensureStatutoryRemittanceCorrectionSchema } from "@/lib/statutory-remittance-correction-schema";
import { pool } from "@/db";

let ready = false;
let inFlight: Promise<void> | null = null;

export async function ensureStatutoryRemittanceMonthCloseSchema() {
  const mode = coreSchemaCompatibilityMode(process.env.CORE_SCHEMA_COMPATIBILITY_MODE);
  if (mode === "read-only") {
    if (inFlight) throw new Error("REMITTANCE_MONTH_CLOSE_LEGACY_SCHEMA_WRITE_IN_PROGRESS");
    await ensureStatutoryRemittanceCorrectionSchema();
    await verifyRequestSchemaReadOnlyFromPool(pool, statutoryMonthCloseSchemaSpec);
    return;
  }
  if (ready) return;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    await ensureStatutoryRemittanceCorrectionSchema();
    const client = await pool.connect();
    let transactionOpen = false;
    let safeToReuse = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('payrollph_statutory_remittance_month_close_v3'))",
      );
      await client.query(`
        CREATE TABLE IF NOT EXISTS statutory_remittance_month_closures (
          id serial PRIMARY KEY,
          organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT,
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
        ALTER TABLE statutory_remittance_month_closures
          ADD COLUMN IF NOT EXISTS legal_entity_id integer REFERENCES legal_entities(id) ON DELETE RESTRICT;
        UPDATE statutory_remittance_month_closures c
        SET legal_entity_id = le.id
        FROM legal_entities le
        WHERE c.legal_entity_id IS NULL
          AND le.organization_id = c.organization_id
          AND le.primary_entity = true;
        ALTER TABLE statutory_remittance_month_closures
          ALTER COLUMN legal_entity_id SET NOT NULL;
        DROP INDEX IF EXISTS statutory_remittance_month_closure_snapshot_unique;
        CREATE UNIQUE INDEX statutory_remittance_month_closure_snapshot_unique
          ON statutory_remittance_month_closures(organization_id, legal_entity_id, applicable_month, snapshot_hash);
        DROP INDEX IF EXISTS statutory_remittance_month_closure_status_idx;
        CREATE INDEX statutory_remittance_month_closure_status_idx
          ON statutory_remittance_month_closures(organization_id, legal_entity_id, status);
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
