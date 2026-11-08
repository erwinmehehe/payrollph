import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  TRANSFERS_PATCH_METHOD, TRANSFERS_POST_METHOD, TRANSFERS_TITLE,
  assertRefusal, assertRowsUnchanged, assertSameAnswer, dayBefore, manilaToday, requireDisposableTransfers,
} from "../scripts/qa/tenant-transfers-contract.mjs";

const safeEnv = {
  GITHUB_ACTIONS: "true", CI: "true", TENANT_APPROVAL_TASK_MODE: "fictional-pg16-http", TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  NODE_ENV: "production", DEMO_MODE: "false", SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false", PAYMONGO_SECRET_KEY: "", XENDIT_SECRET_KEY: "", RESEND_API_KEY: "",
  MULTI_ENTITY_ENABLED: "true", MULTI_ENTITY_TRANSFERS_ENABLED: "true",
};

test("the proof names its two methods and carries no credit claim", () => {
  assert.equal(TRANSFERS_POST_METHOD, "POST multi-entity/transfers");
  assert.equal(TRANSFERS_PATCH_METHOD, "PATCH multi-entity/transfers");
  assert.equal(TRANSFERS_TITLE, "tenant-multi-entity-transfers-isolation");
});

test("the pre-import guard is the shared disposable-target contract, requires both flags and refuses every provider", () => {
  assert.equal(requireDisposableTransfers(safeEnv), true);
  for (const change of [{ CI: "false" }, { NODE_ENV: "development" }, { WORKER_ENABLED: "true" }, { PAYMONGO_SECRET_KEY: "sk_test_x" },
    { PAYMONGO_WALLET_ID: "wallet_x" }, { XENDIT_PAYOUT_SECRET_KEY: "x" }, { XENDIT_PAYOUTS_LIVE_APPROVED: "true" },
    { PAYMONGO_DISBURSEMENTS_ENABLED: "true" }, { DATABASE_URL: "postgresql://postgres:postgres@neon.tech:5432/app_db" },
    { MULTI_ENTITY_ENABLED: "false" }, { MULTI_ENTITY_TRANSFERS_ENABLED: "" }]) {
    assert.throws(() => requireDisposableTransfers({ ...safeEnv, ...change }), /REFUSED/);
  }
});

test("Manila today and the day before are exact calendar dates, independent of the runner's zone", () => {
  assert.equal(manilaToday(new Date("2026-11-07T16:30:00Z")), "2026-11-08", "16:30 UTC is already the next day in Manila");
  assert.equal(manilaToday(new Date("2026-11-07T15:59:00Z")), "2026-11-07");
  assert.equal(dayBefore("2026-11-08"), "2026-11-07");
  assert.equal(dayBefore("2026-03-01"), "2026-02-28");
  assert.equal(dayBefore("2028-03-01"), "2028-02-29");
  assert.equal(dayBefore("2027-01-01"), "2026-12-31");
  assert.throws(() => dayBefore("2026-1-1"));
});

test("a refusal must carry the exact status and leak none of the forbidden values", () => {
  const refusal = (status, text) => ({ status, text, json: null, headers: new Headers() });
  assert.equal(assertRefusal(refusal(403, "{}"), 403, ["VICTIM-MARKER"]), null);
  assert.throws(() => assertRefusal(refusal(403, '{"m":"VICTIM-MARKER"}'), 403, ["VICTIM-MARKER"]));
  assert.throws(() => assertRefusal(refusal(200, "{}"), 403, []));
});

test("a foreign ID and an absent ID must produce the identical answer", () => {
  const a = { status: 404, text: '{"error":"Transfer not found."}' };
  assert.equal(assertSameAnswer(a, { ...a }, "same"), undefined);
  assert.throws(() => assertSameAnswer(a, { ...a, status: 403 }, "status"));
  assert.throws(() => assertSameAnswer(a, { ...a, text: '{"error":"Forbidden"}' }, "body"));
});

test("snapshots must be identical table for table", () => {
  const before = { entity_transfer_requests: [{ id: 1, status: "pending_approval" }], employees: [{ id: 2, legal_entity_id: 9 }] };
  assert.equal(assertRowsUnchanged(before, structuredClone(before), "same"), undefined);
  assert.throws(() => assertRowsUnchanged(before, { ...before, employees: [{ id: 2, legal_entity_id: 10 }] }, "moved"));
  assert.throws(() => assertRowsUnchanged(before, { employees: before.employees }, "removed"));
});

test("the harness is a source-pinned, credit-free proof that is executed only by its own workflow", () => {
  const harness = readFileSync("scripts/qa/tenant-transfers-http.mjs", "utf8");
  assert.ok(harness.indexOf("requireDisposableTransfers()") < harness.indexOf('import("../../src/db/index.ts")'),
    "the disposable guard must run before any database or application import");
  assert.ok(harness.includes("coverageCredits: 0") && harness.includes("independentlyAccepted: false"), "the proof claims no credit");
  assert.ok(harness.includes("x-legal-entity-id"), "the proof selects the source employer through the real selector header");
  for (const needed of ["maker", "checker", "assertSameAnswer", "assertRowsUnchanged"]) {
    assert.ok(harness.includes(needed), "the harness must exercise: " + needed);
  }
  const workflow = readFileSync(".github/workflows/tenant-transfers-http.yml", "utf8");
  assert.ok(workflow.includes("node --import tsx scripts/qa/tenant-transfers-http.mjs"));
  assert.ok(workflow.includes("MULTI_ENTITY_TRANSFERS_ENABLED") || workflow.includes("tenant-table-env.mjs multi-entity"),
    "the workflow must enable the multi-entity profile");
  for (const forbidden of ["secrets.", "PAYMONGO_SECRET_KEY: sk", "XENDIT_SECRET_KEY: xnd"]) {
    assert.ok(!workflow.includes(forbidden), "the workflow must hold no secret: " + forbidden);
  }
});
