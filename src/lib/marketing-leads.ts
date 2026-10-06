import { pool } from "@/db";
import { deliveryCapable } from "@/lib/mail-provider";
import { queueMessage, retryOutboxMessage } from "@/lib/mailer";

export type MarketingLeadKind = "demo" | "trial-access" | "payroll-outsourcing";
export type MarketingLeadNotificationStatus = "not-configured" | "queued" | "sent" | "failed";

type MarketingLeadRow = {
  id: number;
  kind: MarketingLeadKind;
  name: string;
  email: string;
  company: string;
  headcount: string | null;
  payroll_frequency: string | null;
  entities: string | null;
  notes: string | null;
  attribution: Record<string, string>;
  notification_status: MarketingLeadNotificationStatus;
  notification_provider: string | null;
  notification_outbox_id: number | null;
  notification_attempts: number;
};

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
          attribution jsonb NOT NULL DEFAULT '{}'::jsonb,
          status varchar(24) NOT NULL DEFAULT 'new',
          notification_status varchar(24) NOT NULL DEFAULT 'not-configured',
          notification_provider varchar(40),
          notification_outbox_id integer,
          notification_attempts integer NOT NULL DEFAULT 0,
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
        ALTER TABLE marketing_leads
          ADD COLUMN IF NOT EXISTS notification_attempts integer NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS attribution jsonb NOT NULL DEFAULT '{}'::jsonb
      `);
      await client.query(`
        DO $compat$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_leads_kind_check') THEN
            ALTER TABLE marketing_leads
              ADD CONSTRAINT marketing_leads_kind_check
              CHECK (kind IN ('demo', 'trial-access', 'payroll-outsourcing'));
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_leads_status_check') THEN
            ALTER TABLE marketing_leads
              ADD CONSTRAINT marketing_leads_status_check
              CHECK (status IN ('new', 'contacted', 'qualified', 'closed'));
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_leads_notification_status_check') THEN
            ALTER TABLE marketing_leads
              ADD CONSTRAINT marketing_leads_notification_status_check
              CHECK (notification_status IN ('not-configured', 'queued', 'sent', 'failed'));
          END IF;
        END
        $compat$;
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
  attribution?: Record<string, string>;
}) {
  await ensureMarketingLeadSchema();
  const result = await pool.query<{ id: number; created_at: Date }>(
    `INSERT INTO marketing_leads (
       kind, name, email, company, headcount, payroll_frequency, entities, notes, source_path, attribution
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
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
      JSON.stringify(input.attribution ?? {}),
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
  attempted?: boolean;
}) {
  await ensureMarketingLeadSchema();
  await pool.query(
    `UPDATE marketing_leads
     SET notification_status = $2,
         notification_provider = $3,
         notification_outbox_id = $4,
         notification_attempts = notification_attempts + CASE WHEN $5::boolean THEN 1 ELSE 0 END,
         updated_at = NOW()
     WHERE id = $1`,
    [input.id, input.status, input.provider ?? null, input.outboxId ?? null, input.attempted === true],
  );
}


function operatorInbox(kind: MarketingLeadKind) {
  if (kind === "payroll-outsourcing") {
    return process.env.PAYROLL_OUTSOURCING_INBOX?.trim()
      || process.env.DEMO_REQUEST_INBOX?.trim()
      || null;
  }
  return process.env.DEMO_REQUEST_INBOX?.trim() || null;
}

function notificationPurpose(kind: MarketingLeadKind) {
  if (kind === "trial-access") return "trial-access-request";
  if (kind === "payroll-outsourcing") return "payroll-outsourcing-enquiry";
  return "demo-request";
}

function notificationSubject(lead: MarketingLeadRow) {
  if (lead.kind === "trial-access") return `Trial access request: ${lead.company}`;
  if (lead.kind === "payroll-outsourcing") return `Payroll outsourcing enquiry: ${lead.company}`;
  return `Demo request: ${lead.company}`;
}

function notificationBody(lead: MarketingLeadRow) {
  const heading = lead.kind === "trial-access"
    ? "A trial access request was submitted from the public site."
    : lead.kind === "payroll-outsourcing"
      ? "A payroll outsourcing enquiry was submitted from the public site."
      : "A demo was requested from the public site.";

  return [
    heading,
    "",
    `Lead ID:   ${lead.id}`,
    `Name:      ${lead.name}`,
    `Email:     ${lead.email}`,
    `Company:   ${lead.company}`,
    `Headcount: ${lead.headcount || "not stated"}`,
    ...(lead.kind === "payroll-outsourcing"
      ? [
          `Frequency: ${lead.payroll_frequency || "not stated"}`,
          `Entities:  ${lead.entities || "not stated"}`,
        ]
      : []),
    "",
    lead.kind === "payroll-outsourcing" ? "Requested scope / notes:" : "Notes:",
    lead.notes || "(none)",
  ].join("\n");
}

async function getMarketingLead(id: number) {
  await ensureMarketingLeadSchema();
  const result = await pool.query<MarketingLeadRow>(
    `SELECT id, kind, name, email, company, headcount, payroll_frequency, entities, notes, attribution,
            notification_status, notification_provider, notification_outbox_id, notification_attempts
     FROM marketing_leads
     WHERE id = $1
     LIMIT 1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function notifyMarketingLead(id: number) {
  const lead = await getMarketingLead(id);
  if (!lead) {
    return { notified: false as const, status: "failed" as const, reason: "lead-not-found" };
  }
  if (lead.notification_status === "sent") {
    return { notified: true as const, status: "sent" as const, alreadySent: true as const };
  }
  if (lead.notification_attempts >= 4) {
    return { notified: false as const, status: "failed" as const, reason: "notification-retry-limit" };
  }

  const recipient = operatorInbox(lead.kind);
  if (!recipient || !deliveryCapable()) {
    await updateMarketingLeadNotification({
      id: lead.id,
      status: "not-configured",
      provider: null,
      outboxId: lead.notification_outbox_id,
      attempted: false,
    });
    return { notified: false as const, status: "not-configured" as const };
  }

  if (lead.notification_outbox_id) {
    const retried = await retryOutboxMessage({
      id: lead.notification_outbox_id,
      organizationId: null,
      actor: "system:marketing-lead-worker",
      trigger: "automatic",
    });
    const status: MarketingLeadNotificationStatus = retried.ok
      ? "sent"
      : ("queued" in retried && retried.queued ? "queued" : "failed");
    await updateMarketingLeadNotification({
      id: lead.id,
      status,
      provider: "provider" in retried ? String(retried.provider ?? "") || null : null,
      outboxId: lead.notification_outbox_id,
      attempted: true,
    });
    return {
      notified: retried.ok,
      status,
      reason: retried.ok ? null : retried.error,
    };
  }

  const result = await queueMessage({
    recipient,
    subject: notificationSubject(lead),
    purpose: notificationPurpose(lead.kind),
    dedupeKey: `marketing-lead:${lead.id}`,
    metadata: {
      marketing: {
        requestType: lead.kind === "trial-access" ? "trial" : "demo",
        headcount: lead.headcount || "not stated",
        ...(lead.attribution ?? {}),
      },
    },
    body: notificationBody(lead),
  });
  const status: MarketingLeadNotificationStatus = result.delivered
    ? "sent"
    : result.queued
      ? "queued"
      : "failed";

  await updateMarketingLeadNotification({
    id: lead.id,
    status,
    provider: result.provider,
    outboxId: result.id,
    attempted: true,
  });

  return {
    notified: result.delivered,
    status,
    reason: result.reason ?? null,
  };
}

export async function drainMarketingLeadNotifications(limit = 20) {
  await ensureMarketingLeadSchema();
  if (!deliveryCapable()) return [];

  const configuredKinds: MarketingLeadKind[] = [];
  if (process.env.DEMO_REQUEST_INBOX?.trim()) configuredKinds.push("demo", "trial-access");
  if (process.env.PAYROLL_OUTSOURCING_INBOX?.trim() || process.env.DEMO_REQUEST_INBOX?.trim()) {
    configuredKinds.push("payroll-outsourcing");
  }
  if (configuredKinds.length === 0) return [];

  const result = await pool.query<{ id: number }>(
    `SELECT id
     FROM marketing_leads
     WHERE kind = ANY($1::text[])
       AND notification_status IN ('not-configured', 'queued', 'failed')
       AND notification_attempts < 4
       AND (
         notification_status = 'not-configured'
         OR updated_at <= NOW() - INTERVAL '5 minutes'
       )
     ORDER BY created_at ASC
     LIMIT $2`,
    [configuredKinds, Math.max(1, Math.min(limit, 100))],
  );

  const outcomes = [];
  for (const row of result.rows) {
    outcomes.push({ id: row.id, ...(await notifyMarketingLead(row.id)) });
  }
  return outcomes;
}
