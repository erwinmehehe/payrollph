import { coreSchemaCompatibilityMode } from "@/lib/core-schema-readonly";
import { outboxDeliverySchemaSpec, verifyRequestSchemaReadOnlyFromPool } from "@/lib/request-schema-readonly";
import { pool } from "@/db";

let outboxSchemaReady = false;
let outboxSchemaInFlight: Promise<void> | null = null;

/**
 * Vercel does not run db:push automatically. Keep additive outbox delivery
 * fields available before current code inserts or reads them on an older
 * production database.
 */
export async function ensureOutboxDeliverySchema() {
  const mode = coreSchemaCompatibilityMode(process.env.CORE_SCHEMA_COMPATIBILITY_MODE);
  if (mode === "read-only") {
    if (outboxSchemaInFlight) throw new Error("OUTBOX_LEGACY_SCHEMA_WRITE_IN_PROGRESS");
    await verifyRequestSchemaReadOnlyFromPool(pool, outboxDeliverySchemaSpec);
    return;
  }
  if (outboxSchemaReady) return;
  if (outboxSchemaInFlight) return outboxSchemaInFlight;

  outboxSchemaInFlight = (async () => {
    const client = await pool.connect();
    let transactionOpen = false;
    let safeToReuse = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      await client.query("SELECT pg_advisory_xact_lock(hashtext('linaw_outbox_delivery_v2'))");
      await client.query(`
        ALTER TABLE outbox
          ADD COLUMN IF NOT EXISTS dedupe_key varchar(200),
          ADD COLUMN IF NOT EXISTS provider_message_id varchar(200),
          ADD COLUMN IF NOT EXISTS delivery_status varchar(32),
          ADD COLUMN IF NOT EXISTS delivery_detail text,
          ADD COLUMN IF NOT EXISTS delivery_updated_at timestamptz,
          ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 4,
          ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
          ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS outbox_dedupe_key_unique
        ON outbox(dedupe_key)
        WHERE dedupe_key IS NOT NULL
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS outbox_org_created_idx
        ON outbox(organization_id, created_at)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS outbox_retry_idx
        ON outbox(status, next_attempt_at)
      `);
      await client.query("COMMIT");
      transactionOpen = false;
      safeToReuse = true;
      outboxSchemaReady = true;
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
      outboxSchemaInFlight = null;
    }
  })();

  return outboxSchemaInFlight;
}
