import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  FIXTURE_KEY, requireFictionalPaymongoEnv, simulatedPaymongoFetch,
} from "../scripts/qa/tenant-billing-paymongo-preload.mjs";

const routePath = "src/app/api/billing/route.ts";
const proofPath = "scripts/qa/tenant-billing-paymongo-http.mjs";
const preloadPath = "scripts/qa/tenant-billing-paymongo-preload.mjs";
const workflowPath = ".github/workflows/tenant-billing-paymongo-http.yml";
const read = path => readFileSync(path, "utf8");

const valid = {
  CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
  TENANT_PAYMONGO_PROOF: "fiction-only",
  PAYMONGO_SECRET_KEY: FIXTURE_KEY,
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  APP_BASE_URL: "https://payroll.example.test",
  XENDIT_BILLING_ENABLED: "false", DEMO_MODE: "false",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false",
};

test("fictional checkout proof refuses prod DB, real providers and missing CI guard", () => {
  assert.doesNotThrow(() => requireFictionalPaymongoEnv(valid));
  for (const [field, value] of [
    ["CI", "false"], ["GITHUB_ACTIONS", "false"],
    ["NODE_ENV", "development"], ["TENANT_PAYMONGO_PROOF", ""],
    ["PAYMONGO_SECRET_KEY", "sk_live_do_not_send"],
    ["PAYMONGO_SECRET_KEY", ""],
    ["DATABASE_URL", "postgresql://user:pwd@prod.example.com:5432/app_db"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/production"],
    ["SECURITY_SMOKE_URL", "https://customer.example.com"],
    ["APP_BASE_URL", "https://real-customer.example"],
    ["XENDIT_BILLING_ENABLED", "true"],
    ["PAYMONGO_DISBURSEMENTS_ENABLED", "true"],
    ["WORKER_ENABLED", "true"],
    ["XENDIT_PAYOUTS_ENABLED", "true"],
    ["RESEND_API_KEY", "real-email"],
    ["SMTP_URL", "smtp://external.example"],
    ["PAYMONGO_WEBHOOK_SECRET", "real-callback"],
  ]) {
    assert.throws(() => requireFictionalPaymongoEnv({ ...valid, [field]: value }),
      "Unsafe fixture accepted " + field);
  }
  const proof = read(proofPath);
  assert.ok(proof.indexOf("requireFictionalPaymongoEnv();") <
    proof.indexOf('import("../../src/db/index.ts")'),
  "Proof must refuse unsafe targets before importing the database");
});

test("fictional provider only permits validated PayMongo checkout and no live requests", async () => {
  const body = {
    data: {
      attributes: {
        success_url: "https://payroll.example.test/?billing=success",
        cancel_url: "https://payroll.example.test/?billing=cancelled",
        line_items: [{ amount: 150000, currency: "PHP", quantity: 1 }],
        metadata: {
          organization_id: "42", invoice_number: "INV-2026-1234567",
          plan: "Core", billing_cycle: "monthly",
        },
      },
    },
  };
  const events = [];
  const url = "https://api.paymongo.com/v1/checkout_sessions";
  const options = {
    method: "POST", body: JSON.stringify(body),
    headers: { Authorization: "Basic " + Buffer.from(FIXTURE_KEY + ":").toString("base64") },
  };
  const response = await simulatedPaymongoFetch(url, options, e => events.push(e));
  assert.equal(response.status, 201);
  const data = await response.json();
  assert.ok(data.data.id.startsWith("cs_ci_42_"));
  assert.ok(data.data.attributes.checkout_url.includes("fictional-42-"));
  assert.deepEqual(events, [{
    kind: "checkout", organizationId: 42,
    invoiceNumber: "INV-2026-1234567", amountCents: 150000,
    plan: "Core", billingCycle: "monthly",
  }]);
  for (const badUrl of [
    "https://api.paymongo.com/v1/payments",
    "https://api.paymongo.com/v1/checkout_sessions?other=1",
    "http://api.paymongo.com/v1/checkout_sessions",
    "https://evil.example/v1/checkout_sessions",
  ]) {
    await assert.rejects(() => simulatedPaymongoFetch(badUrl, options));
  }
  await assert.rejects(() => simulatedPaymongoFetch(url, { ...options, method: "GET" }));
  await assert.rejects(() => simulatedPaymongoFetch(url, {
    method: "POST", body: JSON.stringify({
      ...body, data: {
        ...body.data, attributes: {
          ...body.data.attributes, metadata: {
            ...body.data.attributes.metadata, organization_id: "NaN",
          },
        },
      },
    }),
  }));
  assert.equal(events.length, 1, "Rejected provider requests must not emit receipts");
});

test("POST has access, RBAC, MFA and company-wide guards before finance writes", () => {
  const source = read(routePath).split("export async function POST(request: Request)")[1];
  assert.ok(source, "Legacy billing POST must still exist");
  for (const token of [
    "enforceSameOriginMutation(request)", "await getSessionUser()",
    "publicDemoMutationDenied(", "assertOrganizationRole(",
    "BILLING_ADMIN_ROLES", "!access?.companyWide",
    "requireSensitiveActionMfa(user)", "rateLimitDistributed(",
    "createPaymongoCheckout(", "db.insert(invoices)",
    "recordAuditEvent(",
  ]) assert.ok(source.includes(token), "Missing billing guard: " + token);
  const afterAuthorization = source.indexOf("const denied = await assertOrganizationRole(");
  assert.ok(afterAuthorization >= 0);
  for (const write of [
    source.indexOf("db.insert(invoices)"),
    source.indexOf("db.update(subscriptions)"),
    source.indexOf("db.insert(subscriptions)"),
    source.indexOf("createPaymongoCheckout("),
  ]) assert.ok(write > afterAuthorization,
    "Billing write or provider call occurred before tenant authorization");
  assert.ok(source.indexOf("requireSensitiveActionMfa(user)") <
    source.indexOf("db.insert(invoices)"));
  assert.ok(source.includes('status: "pending_payment"'));
  assert.ok(source.includes("only after PayMongo confirms payment"));
});

test("PG16 proof rejects denial-only success and pins victim audit invariants", () => {
  const proof = read(proofPath), mock = read(preloadPath), wf = read(workflowPath);
  for (const phrase of [
    'seedEmployer("ATTA"', 'seedEmployer("ATTB"', 'seedEmployer("VICTIM"',
    "victim.org.id > a.org.id", "subVictim.id > subA.id",
    'dbIdentity.database, "app_db"', "dbIdentity.version / 10000",
    "crossSite.status, 403",
    "await snapshot(victim.org.id)", "victimBefore",
    "assert.equal(own.status, 201", "assert.equal(after.subscriptions.length, 1)",
    'after.subscriptions[0].status, "pending_payment"',
    "assert.deepEqual(await snapshot(victim.org.id), victimBefore",
    "forgedForeignSelectorsIgnored: true", "coverageCredits: 0",
  ]) assert.ok(proof.includes(phrase), "Missing method proof: " + phrase);
  assert.ok(mock.includes("TENANT_PAYMONGO_EGRESS_BLOCKED"));
  assert.ok(wf.includes("postgres:16"));
  assert.ok(wf.includes("persist-credentials: false"));
  assert.ok(wf.includes("git rev-parse HEAD"));
  assert.ok(wf.includes("npm run build"));
  assert.ok(wf.includes("tenant-billing-paymongo-preload.mjs"));
  assert.ok(wf.includes("node --import tsx scripts/qa/tenant-billing-paymongo-http.mjs"));
  assert.ok(wf.includes("PAYMONGO_DISBURSEMENTS_ENABLED: \"false\""));
  assert.ok(wf.includes("XENDIT_PAYOUTS_ENABLED: \"false\""));
  assert.doesNotMatch(wf, /vercel deploy|production migration|db:migrate:production/i);
});
