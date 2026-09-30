import { pool } from "@/db";

let outboxSchemaReady = false;
let outboxSchemaInFlight: Promise<void> | null = null;

/**
 * Production on Vercel does not run drizzle db:push automatically.
 * Keep additive outbox delivery fields available before mailer code reads or
 * writes them against an older production database.
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
          ADD COLUMN IF NOT EXISTS provider_message_id varchar(200),
          ADD COLUMN IF NOT EXISTS delivery_status varchar(32),
          ADD COLUMN IF NOT EXISTS delivery_event_at timestamptz,
          ADD COLUMN IF NOT EXISTS delivery_detail text,
          ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          ADD COLUMN IF NOT EXISTS dedupe_key varchar(220)
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS outbox_dedupe_key_unique
        ON outbox(dedupe_key)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS outbox_org_created_idx
        ON outbox(organization_id, created_at)
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
