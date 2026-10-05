import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("public enquiries have their own durable marketing lead record", () => {
  const schema = read("src/db/schema.ts");
  const migration = read("drizzle/0024_marketing_leads.sql");
  const storage = read("src/lib/marketing-leads.ts");

  assert.ok(schema.includes('export const marketingLeads = pgTable('), "Drizzle schema must include marketing leads");
  assert.ok(migration.includes("CREATE TABLE IF NOT EXISTS marketing_leads"), "production migration must create marketing leads");
  assert.ok(storage.includes("ensureMarketingLeadSchema"), "public capture must self-heal an older production database");
  assert.ok(storage.includes("INSERT INTO marketing_leads"), "lead capture must write an independent durable record");
  assert.ok(storage.includes("notification_status"), "lead record must track notification state separately");
});

test("demo and trial requests persist before best-effort email notification", () => {
  const route = read("src/app/api/demo-requests/route.ts");
  const recordIndex = route.indexOf("recordMarketingLead({");
  const emailIndex = route.indexOf("queueMessage({");

  assert.ok(recordIndex >= 0, "demo route must persist a marketing lead");
  assert.ok(emailIndex > recordIndex, "email notification must happen only after durable lead capture");
  assert.ok(route.includes('body.requestType === "trial-access"'), "trial access must be distinguishable from a demo");
  assert.ok(route.includes('sourcePath: requestType === "trial-access" ? "/signup" : "/book-demo"'), "lead source path must be explicit");
  assert.ok(route.includes("if (OPERATOR_INBOX && deliveryCapable())"), "email notification must require both an operator inbox and a live mail provider");
  assert.ok(!route.includes(".invalid"), "public lead delivery must never target an invalid fallback address");
  assert.ok(route.includes("recorded: true"), "public response must confirm durable capture");
  assert.ok(!route.includes("deliveryCapable"), "public response must not expose mail deployment internals");
});

test("outsourcing enquiries persist before best-effort email notification", () => {
  const route = read("src/app/api/payroll-outsourcing/quote/route.ts");
  const recordIndex = route.indexOf("recordMarketingLead({");
  const emailIndex = route.indexOf("queueMessage({");

  assert.ok(recordIndex >= 0, "outsourcing route must persist a marketing lead");
  assert.ok(emailIndex > recordIndex, "email notification must happen only after durable lead capture");
  assert.ok(route.includes('kind: "payroll-outsourcing"'), "outsourcing leads must have their own kind");
  assert.ok(route.includes('sourcePath: "/payroll-outsourcing"'), "outsourcing source must be explicit");
  assert.ok(route.includes("if (OPERATOR_INBOX && deliveryCapable())"), "notification must require both an operator inbox and a live mail provider");
  assert.ok(!route.includes(".invalid"), "outsourcing delivery must never target an invalid fallback address");
  assert.ok(route.includes('dedupeKey: `marketing-lead:${lead.id}`'), "lead notification must be idempotent");
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
  assert.ok(packageJson.includes('"leads:list": "tsx scripts/list-marketing-leads.ts"'), "lead report must be runnable through npm");
  assert.ok(!nav.includes("Marketing leads"), "prospect PII must not be exposed in tenant workspace navigation");
});
