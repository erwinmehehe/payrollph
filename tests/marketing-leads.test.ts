import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { pool } from "../src/db";
import { recordMarketingLead, updateMarketingLeadNotification } from "../src/lib/marketing-leads";

const read = (path: string) => readFileSync(path, "utf8");

test("public enquiries have their own durable marketing lead record", () => {
  const schema = read("src/db/schema.ts");
  const migration = read("drizzle/0024_marketing_leads.sql");
  const baseline = read("drizzle/baseline.sql");
  const storage = read("src/lib/marketing-leads.ts");

  assert.ok(schema.includes('export const marketingLeads = pgTable('), "Drizzle schema must include marketing leads");
  assert.ok(migration.includes("CREATE TABLE IF NOT EXISTS marketing_leads"), "production migration must create marketing leads");
  assert.ok(storage.includes("ensureMarketingLeadSchema"), "public capture must self-heal an older production database");
  assert.ok(storage.includes("INSERT INTO marketing_leads"), "lead capture must write an independent durable record");
  assert.ok(storage.includes("notification_status"), "lead record must track notification state separately");
  assert.ok(storage.includes("marketing_leads_kind_check"), "runtime upgrade must enforce lead kinds");
  assert.ok(storage.includes("marketing_leads_status_check"), "runtime upgrade must enforce lead lifecycle states");
  assert.ok(migration.includes("notification_attempts integer NOT NULL DEFAULT 0"), "migration must persist retry attempts");
  assert.ok(migration.includes("attribution jsonb NOT NULL DEFAULT '{}'::jsonb"), "migration must persist sanitized attribution");
  assert.ok(baseline.includes('CREATE TABLE IF NOT EXISTS "marketing_leads"'), "fresh database baseline must include marketing leads");
  assert.ok(baseline.includes('"attribution" jsonb'), "fresh database baseline must include durable attribution");
});

test("demo and trial requests persist before best-effort email notification", () => {
  const route = read("src/app/api/demo-requests/route.ts");
  const recordIndex = route.indexOf("recordMarketingLead({");
  const notifyIndex = route.indexOf("notifyMarketingLead(lead.id)");

  assert.ok(recordIndex >= 0, "demo route must persist a marketing lead");
  assert.ok(notifyIndex > recordIndex, "notification must happen only after durable lead capture");
  assert.ok(route.includes('body.requestType === "trial-access"'), "trial access must be distinguishable from a demo");
  assert.ok(route.includes('sourcePath: requestType === "trial-access" ? "/signup" : body.sourcePath === "/contact" ? "/contact" : "/book-demo"'), "lead source path must be explicit");
  assert.ok(route.includes("attribution,"), "sanitized attribution must be stored with the durable lead");
  assert.ok(route.includes("notifyMarketingLead(lead.id)"), "demo route must delegate delivery to the shared recovery workflow");
  assert.ok(!route.includes(".invalid"), "public lead delivery must never target an invalid fallback address");
  assert.ok(route.includes("recorded: true"), "public response must confirm durable capture");
  assert.ok(!route.includes("deliveryCapable"), "public response must not expose mail deployment internals");
});

test("outsourcing enquiries persist before best-effort email notification", () => {
  const route = read("src/app/api/payroll-outsourcing/quote/route.ts");
  const recordIndex = route.indexOf("recordMarketingLead({");
  const notifyIndex = route.indexOf("notifyMarketingLead(lead.id)");

  assert.ok(recordIndex >= 0, "outsourcing route must persist a marketing lead");
  assert.ok(notifyIndex > recordIndex, "notification must happen only after durable lead capture");
  assert.ok(route.includes('kind: "payroll-outsourcing"'), "outsourcing leads must have their own kind");
  assert.ok(route.includes('sourcePath: "/payroll-outsourcing"'), "outsourcing source must be explicit");
  assert.ok(route.includes("notifyMarketingLead(lead.id)"), "outsourcing route must delegate delivery to the shared recovery workflow");
  assert.ok(!route.includes(".invalid"), "outsourcing delivery must never target an invalid fallback address");
});

test("marketing lead notifications are provider-gated, idempotent and recoverable", () => {
  const storage = read("src/lib/marketing-leads.ts");
  const mailer = read("src/lib/mailer.ts");
  const worker = read("scripts/worker.ts");
  const scheduler = read("src/lib/scheduler.ts");

  assert.ok(storage.includes("operatorInbox(lead.kind)"), "notification workflow must resolve an explicitly configured operator inbox");
  assert.ok(storage.includes("!recipient || !deliveryCapable()"), "lead notification must not create mail when delivery is unconfigured");
  assert.ok(storage.includes('dedupeKey: `marketing-lead:${lead.id}`'), "lead notification must be idempotent");
  assert.ok(storage.includes("retryOutboxMessage({"), "failed platform notifications must be retryable");
  assert.ok(storage.includes("organizationId: null"), "platform lead retries must remain outside tenant scope");
  assert.ok(storage.includes("notification_attempts < 4"), "marketing lead retries must stop after the bounded attempt budget");
  assert.ok(storage.includes("INTERVAL '5 minutes'"), "failed marketing notifications must back off before retry");
  assert.ok(storage.includes("drainMarketingLeadNotifications"), "lead notification recovery must have a worker drain");
  assert.ok(!storage.includes(".invalid"), "shared notification logic must never use invalid fallback recipients");
  assert.ok(mailer.includes("organizationId: number | null"), "mailer retry scope must support platform-only outbox rows");
  assert.ok(mailer.includes('"demo-request"') && mailer.includes('"trial-access-request"') && mailer.includes('"payroll-outsourcing-enquiry"'), "marketing notifications must carry the same bounded outbox retry budget");
  assert.ok(mailer.includes("isNull(outbox.organizationId)"), "null-organization retries must be explicitly scoped");
  assert.ok(worker.includes("drainMarketingLeadNotifications"), "dedicated worker must recover lead notifications");
  assert.ok(scheduler.includes("drainMarketingLeadNotifications"), "remote scheduler must recover lead notifications");
});


test("public forms label demo and trial requests explicitly", () => {
  const demo = read("src/components/marketing/book-demo-form.tsx");
  const trial = read("src/components/marketing/access-request-form.tsx");
  const quote = read("src/components/marketing/payroll-quote-form.tsx");

  assert.ok(demo.includes('requestType: "demo"'), "book-demo form must label demo requests");
  assert.ok(trial.includes('requestType: "trial-access"'), "trial form must label trial-access requests");
  assert.ok(demo.includes("leadId: number") && demo.includes("recorded: boolean"), "demo form must use durable capture response");
  assert.ok(quote.includes("leadId: number") && quote.includes("recorded: boolean"), "quote form must use durable capture response");
});


test("operators can inspect durable leads without exposing them in tenant navigation", () => {
  const script = read("scripts/list-marketing-leads.ts");
  const packageJson = read("package.json");
  const nav = read("src/components/workspace/nav.ts");

  assert.ok(script.includes("FROM marketing_leads"), "operator report must read the durable lead store");
  assert.ok(script.includes("ORDER BY created_at DESC"), "operator report must show newest enquiries first");
  const statusScript = read("scripts/update-marketing-lead-status.ts");
  const retention = read("src/lib/data-retention.ts");
  assert.ok(packageJson.includes('"leads:list": "tsx scripts/list-marketing-leads.ts"'), "lead report must be runnable through npm");
  assert.ok(packageJson.includes('"leads:set-status": "tsx scripts/update-marketing-lead-status.ts"'), "operators must be able to update lead lifecycle state");
  assert.ok(statusScript.includes('"contacted", "qualified", "closed"'), "lead status command must use a bounded lifecycle");
  assert.ok(retention.includes("retentionDaysAfterLastUpdate: 365"), "marketing PII must have a bounded inactivity retention window");
  assert.ok(retention.includes("deletedMarketingLeads"), "daily retention purge must delete expired marketing leads");
  assert.ok(!nav.includes("Marketing leads"), "prospect PII must not be exposed in tenant workspace navigation");
});


test("a marketing lead remains queryable even before email is configured", async () => {
  const unique = `lead-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
  const lead = await recordMarketingLead({
    kind: "trial-access",
    name: "Lead Capture QA",
    email: unique,
    company: "Lead Capture QA Co.",
    headcount: "11-50",
    notes: "Database durability test",
    sourcePath: "/signup",
  });

  try {
    const before = await pool.query<{
      kind: string;
      email: string;
      status: string;
      notification_status: string;
    }>(
      "SELECT kind, email, status, notification_status FROM marketing_leads WHERE id = $1",
      [lead.id],
    );
    assert.equal(before.rows[0]?.kind, "trial-access");
    assert.equal(before.rows[0]?.email, unique);
    assert.equal(before.rows[0]?.status, "new");
    assert.equal(before.rows[0]?.notification_status, "not-configured");

    await updateMarketingLeadNotification({
      id: lead.id,
      status: "failed",
      provider: "resend",
    });

    const after = await pool.query<{ notification_status: string; notification_provider: string | null }>(
      "SELECT notification_status, notification_provider FROM marketing_leads WHERE id = $1",
      [lead.id],
    );
    assert.equal(after.rows[0]?.notification_status, "failed");
    assert.equal(after.rows[0]?.notification_provider, "resend");
  } finally {
    await pool.query("DELETE FROM marketing_leads WHERE id = $1", [lead.id]);
  }
});
