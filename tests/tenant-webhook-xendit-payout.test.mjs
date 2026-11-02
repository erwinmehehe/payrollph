import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  XENDIT_PAYOUT_WEBHOOK_METHODS, requireDisposableXenditPayoutWebhook,
} from "../scripts/qa/tenant-webhook-xendit-payout-contract.mjs";

const good = () => ({
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production", TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  TENANT_WEBHOOK_XENDIT_PAYOUT_MODE: "fictional-pg16-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db", SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false", PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  XENDIT_PAYOUT_ALLOWED_ORGANIZATION_ID: "1", XENDIT_PAYOUT_ALLOWED_LEGAL_ENTITY_ID: "1",
  XENDIT_PAYOUT_CALLBACK_TOKEN: "a".repeat(48), XENDIT_PAYOUT_BUSINESS_ID: "biz-synthetic-" + "b".repeat(20),
});

test("the xendit payout webhook proof refuses anything but the exact disposable profile", () => {
  assert.doesNotThrow(() => requireDisposableXenditPayoutWebhook(good()));
  const refuse = patch => assert.throws(() => requireDisposableXenditPayoutWebhook({ ...good(), ...patch }), /XENDIT_PAYOUT_WEBHOOK_REFUSED/);
  refuse({ DATABASE_URL: "postgresql://postgres:postgres@db.example.test:5432/app_db" });
  refuse({ XENDIT_PAYOUTS_ENABLED: "true" });
  refuse({ PAYMONGO_DISBURSEMENTS_ENABLED: "true" });
  refuse({ XENDIT_PAYOUT_SECRET_KEY: "xnd_live_never" });
  refuse({ XENDIT_PAYOUT_ALLOWED_ORGANIZATION_ID: "7" });
  refuse({ XENDIT_PAYOUT_CALLBACK_TOKEN: "short" });
  refuse({ XENDIT_PAYOUT_BUSINESS_ID: "biz-live-real" });
  refuse({ GITHUB_ACTIONS: "false" });
});

test("scope is exactly the one route, the harness never reaches a provider and stays zero-credit", () => {
  assert.deepEqual(XENDIT_PAYOUT_WEBHOOK_METHODS, ["src/app/api/webhooks/xendit-payout/route.ts POST"]);
  const harness = readFileSync("scripts/qa/tenant-webhook-xendit-payout-http.mjs", "utf8");
  const workflow = readFileSync(".github/workflows/tenant-webhook-xendit-payout-http.yml", "utf8");
  assert.ok(harness.indexOf("requireDisposableXenditPayoutWebhook();") < harness.indexOf('import("../../src/db/index.ts")'), "guard must precede database imports");
  for (const evidence of ["a real foreign run must not be distinguishable from a nonexistent run", "SQL must not change",
    "victim.payout.run.id > a.payout.run.id", "duplicate: true", "providerEvents.length, before.ATTA.providerEvents.length + 1"]) {
    assert.ok(harness.includes(evidence), "harness lacks " + evidence);
  }
  assert.ok(workflow.includes("XENDIT_PAYOUTS_ENABLED: \"false\"") && workflow.includes("PAYMONGO_DISBURSEMENTS_ENABLED: \"false\""));
  assert.ok(workflow.includes("node --import tsx scripts/qa/tenant-webhook-xendit-payout-http.mjs"));
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const route = manifest.allApiRouteFiles["src/app/api/webhooks/xendit-payout/route.ts"];
  assert.ok(route, "route stays in the manifest");
  for (const method of route.methods) assert.ok(["GAP", "COVERED"].includes(method.status), "credit is written only by the restricted credit script after the exact-head run");
});
