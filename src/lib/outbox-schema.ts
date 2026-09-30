import { pool } from "@/db";

let outboxSchemaReady = false;
let outboxSchemaInFlight: Promise<void> | null = null;

/**
 * Vercel does not run db:push automatically. Keep additive outbox delivery
 * fields available before current code inserts or reads them on an older
 * production database.
 */
export async function ensureOutboxDeliverySchema() {
  if (outboxSchemaReady) return;
  if (outboxSchemaInFlight) return outboxSchemaInFlight;

  outboxSchemaInFlight = (async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
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
      outboxSchemaReady = true;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* no-op */ }
      throw error;
    } finally {
      client.release();
      outboxSchemaInFlight = null;
    }
  })();

  return outboxSchemaInFlight;
}
