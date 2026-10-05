import { pool } from "@/db";

export type MarketingLeadKind = "demo" | "trial-access" | "payroll-outsourcing";
export type MarketingLeadNotificationStatus = "not-configured" | "queued" | "sent" | "failed";

let schemaReady = false;
let schemaInFlight: Promise<void> | null = null;

export async function ensureMarketingLeadSchema() {
  if (schemaReady) return;
  if (schemaInFlight) return schemaInFlight;

  schemaInFlight = (async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('linaw_marketing_leads_v1'))");
      await client.query(`
        CREATE TABLE IF NOT EXISTS marketing_leads (
          id serial PRIMARY KEY,
          kind varchar(32) NOT NULL,
          name varchar(120) NOT NULL,
          email varchar(180) NOT NULL,
          company varchar(160) NOT NULL,
          headcount varchar(40),
          payroll_frequency varchar(40),
          entities varchar(40),
          notes text,
          source_path varchar(120) NOT NULL,
          status varchar(24) NOT NULL DEFAULT 'new',
          notification_status varchar(24) NOT NULL DEFAULT 'not-configured',
          notification_provider varchar(40),
          notification_outbox_id integer,
          created_at timestamptz NOT NULL DEFAULT NOW(),
          updated_at timestamptz NOT NULL DEFAULT NOW(),
          CONSTRAINT marketing_leads_kind_check
            CHECK (kind IN ('demo', 'trial-access', 'payroll-outsourcing')),
          CONSTRAINT marketing_leads_status_check
            CHECK (status IN ('new', 'contacted', 'qualified', 'closed')),
          CONSTRAINT marketing_leads_notification_status_check
            CHECK (notification_status IN ('not-configured', 'queued', 'sent', 'failed'))
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS marketing_leads_status_created_idx
        ON marketing_leads(status, created_at DESC)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS marketing_leads_kind_created_idx
        ON marketing_leads(kind, created_at DESC)
      `);
      await client.query("COMMIT");
      schemaReady = true;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
      schemaInFlight = null;
    }
  })();

  return schemaInFlight;
}

export async function recordMarketingLead(input: {
  kind: MarketingLeadKind;
  name: string;
  email: string;
  company: string;
  headcount?: string | null;
  payrollFrequency?: string | null;
  entities?: string | null;
  notes?: string | null;
  sourcePath: string;
}) {
  await ensureMarketingLeadSchema();
  const result = await pool.query<{ id: number; created_at: Date }>(
    `INSERT INTO marketing_leads (
       kind, name, email, company, headcount, payroll_frequency, entities, notes, source_path
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id, created_at`,
    [
      input.kind,
      input.name,
      input.email,
      input.company,
      input.headcount || null,
      input.payrollFrequency || null,
      input.entities || null,
      input.notes || null,
      input.sourcePath,
    ],
  );
  const created = result.rows[0];
  if (!created) throw new Error("Marketing lead insert did not return a row.");
  return {
    id: created.id,
    createdAt: created.created_at,
  };
}

export async function updateMarketingLeadNotification(input: {
  id: number;
  status: MarketingLeadNotificationStatus;
  provider?: string | null;
  outboxId?: number | null;
}) {
  await ensureMarketingLeadSchema();
  await pool.query(
    `UPDATE marketing_leads
     SET notification_status = $2,
         notification_provider = $3,
         notification_outbox_id = $4,
         updated_at = NOW()
     WHERE id = $1`,
    [input.id, input.status, input.provider ?? null, input.outboxId ?? null],
  );
}
