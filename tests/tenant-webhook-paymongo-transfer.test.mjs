import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  requireDisposablePaymongoTransferWebhook,
  PAYMONGO_TRANSFER_WEBHOOK_METHODS,
} from "../scripts/qa/tenant-webhook-paymongo-transfer-contract.mjs";

const good = () => ({
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only", TENANT_WEBHOOK_PAYMONGO_MODE: "fictional-pg16-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  PAYMONGO_WEBHOOK_SECRET: "a".repeat(64),
});

test("PayMongo callback tenant proof refuses remote data or provider activation", () => {
  assert.doesNotThrow(() => requireDisposablePaymongoTransferWebhook(good()));
  const refuse = patch => assert.throws(() => requireDisposablePaymongoTransferWebhook({ ...good(), ...patch }),
    /PAYMONGO_WEBHOOK_REFUSED/);
  refuse({ DATABASE_URL: "postgresql://postgres:postgres@live.invalid:5432/app_db" });
  refuse({ DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/prod" });
  refuse({ SECURITY_SMOKE_URL: "https://example.invalid" });
  refuse({ GITHUB_ACTIONS: "false" });
  refuse({ PAYMONGO_DISBURSEMENTS_ENABLED: "true" });
  refuse({ PAYMONGO_SECRET_KEY: "sk_live_never" });
  refuse({ PAYMONGO_WEBHOOK_SECRET: "short" });
});

test("proof is inbound-only, one callback route, zero manifest credits", () => {
  assert.deepEqual(PAYMONGO_TRANSFER_WEBHOOK_METHODS,
    ["src/app/api/webhooks/paymongo/transfers/route.ts POST"]);
  const harness = readFileSync("scripts/qa/tenant-webhook-paymongo-transfer-http.mjs", "utf8");
  const workflow = readFileSync(".github/workflows/tenant-webhook-paymongo-transfer-http.yml", "utf8");
  assert.ok(harness.indexOf("requireDisposablePaymongoTransferWebhook();")
    < harness.indexOf('import("../../src/db/index.ts")'), "refusal must run before DB import");
  for (const term of [
    "cross-bound run/transfer data must not be recorded",
    "victim payroll and audit rows unchanged",
    "concurrent duplicates",
    "forged selectors ignored",
    "productionTested: false",
  ]) {
    assert.ok(harness.includes(term), "missing proof intent: " + term);
  }
  assert.ok(workflow.includes('PAYMONGO_DISBURSEMENTS_ENABLED: "false"'));
  assert.ok(workflow.includes("node --import tsx scripts/qa/tenant-webhook-paymongo-transfer-http.mjs"));
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const entry = manifest.allApiRouteFiles["src/app/api/webhooks/paymongo/transfers/route.ts"];
  assert.ok(entry, "webhook method still inventoried");
  assert.ok(["GAP", "COVERED"].includes(entry.methods.find(m => m.name === "POST")?.status),
    "credit is written only by the restricted credit script after the exact-head run");
  assert.ok(harness.includes("a real foreign run must not be distinguishable from a nonexistent run"), "no-oracle assertion present");
  assert.ok(workflow.includes("paymongo-transfer-webhook-isolation:"), "job name identifies this proof");
});
