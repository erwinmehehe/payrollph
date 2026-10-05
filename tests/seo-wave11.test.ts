import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("demo and trial attribution is stored as structured non-PII outbox metadata", () => {
  const route = read("src/app/api/demo-requests/route.ts");
  assert.ok(route.includes("metadata: {"));
  assert.ok(route.includes("marketing: {"));
  assert.ok(route.includes("requestType"));
  assert.ok(route.includes("headcount: headcount || \"not stated\""));
  assert.ok(route.includes("...attribution"));
});

test("queueMessage supports durable metadata without requiring an audit context", () => {
  const mailer = read("src/lib/mailer.ts");
  assert.ok(mailer.includes("metadata?: Record<string, unknown>;"));
  assert.ok(mailer.includes("metadata: input.metadata ?? input.audit?.metadata ?? {}"));
});

test("marketing lead report aggregates attribution dimensions only", () => {
  const report = read("src/lib/marketing-report.ts");
  assert.ok(report.includes('eq(outbox.purpose, "demo-request")'));
  assert.ok(report.includes("byRequestType"));
  assert.ok(report.includes("byLandingPath"));
  assert.ok(report.includes("bySourceMedium"));
  assert.ok(report.includes("byCampaign"));
  assert.ok(report.includes("byHeadcount"));
  assert.ok(report.includes("byDay"));

  for (const piiField of ["recipient:", "body:", "subject:", "company:", "email:", "name:"]) {
    assert.ok(!report.includes(piiField), `aggregate report must not select/expose ${piiField}`);
  }
});

test("marketing report is disabled by default and requires authenticated allowlisted MFA access", () => {
  const route = read("src/app/api/marketing/leads/route.ts");
  assert.ok(route.includes("getSessionUser()"));
  assert.ok(route.includes("MARKETING_REPORT_EMAILS"));
  assert.ok(route.includes("allowed.size === 0"));
  assert.ok(route.includes("allowed.has(user.email.toLowerCase())"));
  assert.ok(route.includes("requireSensitiveActionMfa(user)"));
  assert.ok(route.includes("Aggregated report only."));
});

test("marketing report never returns raw lead PII", () => {
  const route = read("src/app/api/marketing/leads/route.ts");
  const report = read("src/lib/marketing-report.ts");

  for (const forbidden of [
    "companyName",
    "contactName",
    "contactEmail",
    "messageBody",
    "freeTextNotes",
  ]) {
    assert.ok(!route.includes(forbidden));
    assert.ok(!report.includes(forbidden));
  }

  assert.ok(route.includes("Names, emails, company names, notes and message bodies are not returned"));
});

test("report lookback is bounded to one year", () => {
  const report = read("src/lib/marketing-report.ts");
  assert.ok(report.includes("Math.max(1, Math.min(Math.trunc(days), 365))"));
  assert.ok(report.includes(".limit(5000)"));
});

test("marketing reporting allowlist is documented and opt-in", () => {
  const env = read(".env.local.example");
  const docs = read("docs/seo-conversion-measurement.md");
  assert.ok(env.includes("MARKETING_REPORT_EMAILS="));
  assert.ok(env.includes("Leave empty to keep the report disabled."));
  assert.ok(docs.includes("GET /api/marketing/leads?days=90"));
  assert.ok(docs.includes("Leave `MARKETING_REPORT_EMAILS` empty to disable the report completely."));
});
