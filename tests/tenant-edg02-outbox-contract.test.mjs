import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { requireDisposableEdg02Outbox } from "../scripts/qa/tenant-edg02-outbox-http.mjs";

const safe = {
  GITHUB_ACTIONS: "true",
  CI: "true",
  NODE_ENV: "production",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  APP_BASE_URL: "https://payroll.example.test",
  SMTP_URL: "smtp://127.0.0.1:2525",
  MAIL_FROM: "PayrollPH QA <no-reply@example.invalid>",
  WORKER_ENABLED: "false",
  CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false",
  DEMO_MODE: "false",
};

test("EDG-02 proof accepts only explicit fictional localhost CI settings", () => {
  assert.doesNotThrow(() => requireDisposableEdg02Outbox({ ...safe }));
  for (const [name, value] of [
    ["GITHUB_ACTIONS", "false"],
    ["CI", "false"],
    ["NODE_ENV", "development"],
    ["TENANT_SECOND_PASS_MODE", "other"],
    ["DATABASE_URL", "postgresql://postgres:postgres@db.example.com:5432/app_db"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/prod"],
    ["SECURITY_SMOKE_URL", "https://payroll.example.com"],
    ["APP_BASE_URL", "https://payroll.example.com"],
    ["SMTP_URL", "smtp://smtp.example.com:2525"],
    ["SMTP_URL", "smtps://127.0.0.1:465"],
    ["MAIL_FROM", "outside@example.com"],
    ["WORKER_ENABLED", "true"],
    ["CENTRAL_SCHEDULER_ENABLED", "true"],
    ["PAYMONGO_DISBURSEMENTS_ENABLED", "true"],
    ["XENDIT_PAYOUTS_ENABLED", "true"],
    ["XENDIT_BILLING_ENABLED", "true"],
    ["DEMO_MODE", "true"],
  ]) {
    assert.throws(() => requireDisposableEdg02Outbox({ ...safe, [name]: value }),
      /EDG02_OUTBOX_REFUSED/, name + " must block the proof");
  }
  for (const name of [
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "PAYMONGO_SECRET_KEY",
    "XENDIT_SECRET_KEY", "STRIPE_SECRET_KEY", "DATABASE_AUTH_TOKEN",
  ]) {
    assert.throws(() => requireDisposableEdg02Outbox({ ...safe, [name]: "not-a-real-secret" }),
      /EDG02_OUTBOX_REFUSED/, name + " must not reach the runner");
  }
});

test("EDG-02 outbox lookup, dedupe and retry SQL bind the owning organization", () => {
  const source = readFileSync("src/lib/mailer.ts", "utf8");
  assert.match(source, /function outboxOrganizationScope\(organizationId: number \| null\)/);
  assert.match(source, /isNull\(outbox\.organizationId\)/,
    "NULL-owned system messages must never match an employer message");
  assert.match(source, /eq\(outbox\.organizationId, organizationId\)/);
  assert.match(source, /eq\(outbox\.dedupeKey, input\.dedupeKey\),\s*outboxOrganizationScope\(input\.organizationId \?\? null\)/,
    "Cross-tenant global dedupe collisions must not reveal a foreign row");
  assert.match(source, /eq\(outbox\.id, id\), outboxOrganizationScope\(organizationId\)/);
  const retry = source.split("export async function retryOutboxMessage")[1]
    ?.split("function auditMetadata")[0];
  assert.ok(retry, "Manual retry implementation must exist");
  assert.equal((retry.match(/outboxOrganizationScope\(input\.organizationId\)/g) ?? []).length, 3,
    "Blocked escalation, no-provider fallback and pending claim must all stay scoped");
  const finalizer = source.split("async function finishDeliveryAttempt")[1]
    ?.split("export async function queueMessage")[0];
  assert.ok(finalizer);
  assert.match(finalizer, /outboxOrganizationScope\(input\.row\.organizationId\)/,
    "Completed delivery must not persist across an employer reassignment");
  assert.match(finalizer, /if \(!updated\)/,
    "Do not report success or write audit when the scoped final update matched nothing");
});

test("EDG-02 proof exercises real owned actions and victim data, without credits", () => {
  const proof = readFileSync("scripts/qa/tenant-edg02-outbox-http.mjs", "utf8");
  assert.match(proof, /http\.seedEmployer\("ATTA"/);
  assert.match(proof, /http\.seedEmployer\("ATTB"/);
  assert.match(proof, /http\.seedEmployer\("VICTIM"/);
  assert.match(proof, /victim\.single\.id > 6/);
  assert.match(proof, /standaloneRequest\("\/api\/outbox"/);
  assert.match(proof, /mode: "retry-failed-payslips"/);
  assert.match(proof, /startLocalSmtpSink\(\)/);
  assert.match(proof, /assert\.deepEqual\(await snapshot\(victim\.org\.id\), victimBefore/);
  assert.match(proof, /coverageCredits: 0, accepted: false/,
    "No source-level or unexecuted proof is a coverage promotion");
});
