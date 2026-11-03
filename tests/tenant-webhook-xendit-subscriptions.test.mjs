import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  requireDisposableXenditSubscriptionsWebhook,
  XENDIT_SUBSCRIPTIONS_WEBHOOK_METHODS,
} from "../scripts/qa/tenant-webhook-xendit-subscriptions-contract.mjs";

const good = () => ({
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only", TENANT_WEBHOOK_XENDIT_SUBSCRIPTIONS_MODE: "fictional-pg16-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "true",
  XENDIT_CALLBACK_TOKEN: "a".repeat(64),
  XENDIT_BUSINESS_ID: "biz-synthetic-" + "b".repeat(16),
});

test("Xendit subscription callback tenant proof refuses remote data or provider activation", () => {
  assert.doesNotThrow(() => requireDisposableXenditSubscriptionsWebhook(good()));
  const refuse = patch => assert.throws(() => requireDisposableXenditSubscriptionsWebhook({ ...good(), ...patch }),
    /XENDIT_SUBSCRIPTIONS_WEBHOOK_REFUSED/);
  refuse({ DATABASE_URL: "postgresql://postgres:postgres@live.invalid:5432/app_db" });
  refuse({ DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/prod" });
  refuse({ SECURITY_SMOKE_URL: "https://example.invalid" });
  refuse({ GITHUB_ACTIONS: "false" });
  refuse({ XENDIT_BILLING_ENABLED: "false" });
  refuse({ XENDIT_PAYOUTS_ENABLED: "true" });
  refuse({ PAYMONGO_DISBURSEMENTS_ENABLED: "true" });
  refuse({ XENDIT_SECRET_KEY: "xnd_production_never" });
  refuse({ XENDIT_CALLBACK_TOKEN: "short" });
  refuse({ XENDIT_BUSINESS_ID: "real-merchant" });
});

test("proof is inbound-only, one callback route, zero manifest credits", () => {
  assert.deepEqual(XENDIT_SUBSCRIPTIONS_WEBHOOK_METHODS,
    ["src/app/api/webhooks/xendit/subscriptions/route.ts POST"]);
  const harness = readFileSync("scripts/qa/tenant-webhook-xendit-subscriptions-http.mjs", "utf8");
  const workflow = readFileSync(".github/workflows/tenant-webhook-xendit-subscriptions-http.yml", "utf8");
  assert.ok(harness.indexOf("requireDisposableXenditSubscriptionsWebhook();")
    < harness.indexOf('import("../../src/db/index.ts")'), "refusal must run before DB import");
  for (const term of [
    "a real foreign pair must not be distinguishable from a nonexistent pair",
    "other employer billing and audit rows unchanged",
    "concurrent duplicates must not double-write",
    "forged selectors ignored",
    "stale plan ignored",
    "productionTested: false",
    "methodCoverageCredit: false",
  ]) {
    assert.ok(harness.includes(term), "missing proof intent: " + term);
  }
  assert.ok(workflow.includes('PAYMONGO_DISBURSEMENTS_ENABLED: "false"'));
  assert.ok(workflow.includes('XENDIT_PAYOUTS_ENABLED: "false"'));
  assert.ok(workflow.includes('XENDIT_BILLING_ENABLED: "true"'), "billing is enabled only inside this disposable job");
  assert.ok(workflow.includes("node --import tsx scripts/qa/tenant-webhook-xendit-subscriptions-http.mjs"));
  assert.ok(workflow.includes("xendit-subscriptions-webhook-isolation:"), "job name identifies this proof");
  assert.ok(!/XENDIT_SECRET_KEY=[^\s"]/.test(workflow), "the job must never carry a provider secret key");
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const entry = manifest.allApiRouteFiles["src/app/api/webhooks/xendit/subscriptions/route.ts"];
  assert.ok(entry, "webhook method still inventoried");
  assert.ok(["GAP", "COVERED"].includes(entry.methods.find(m => m.name === "POST")?.status),
    "credit is written only by the restricted credit script after the exact-head run");
});
