import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  FICTIONAL_FIGURES, FICTIONAL_LINE_ITEMS, PILOT_SIGNOFF_METHOD, XENDIT_STATUS_METHOD,
  assertPilotSignedOff, assertRefusal, assertRowsUnchanged, requireDisposablePayrollRunActions,
} from "../scripts/qa/tenant-payroll-run-actions-contract.mjs";

const safeEnv = {
  GITHUB_ACTIONS: "true", CI: "true", TENANT_APPROVAL_TASK_MODE: "fictional-pg16-http", TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  NODE_ENV: "production", DEMO_MODE: "false", SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false", PAYMONGO_SECRET_KEY: "", XENDIT_SECRET_KEY: "", RESEND_API_KEY: "",
};

test("the proof names its methods and carries no credit claim", () => {
  assert.equal(PILOT_SIGNOFF_METHOD, "POST payroll-runs/[id]/pilot-signoff");
  assert.equal(XENDIT_STATUS_METHOD, "GET payroll-runs/[id]/xendit-payout");
});

test("the pre-import guard is the shared disposable-target contract and refuses every payout provider", () => {
  assert.equal(requireDisposablePayrollRunActions(safeEnv), true);
  for (const change of [{ CI: "false" }, { NODE_ENV: "development" }, { WORKER_ENABLED: "true" }, { PAYMONGO_SECRET_KEY: "sk_test_x" },
    { PAYMONGO_WALLET_ID: "wallet_x" }, { XENDIT_PAYOUT_SECRET_KEY: "x" }, { XENDIT_PAYOUTS_LIVE_APPROVED: "true" },
    { PAYMONGO_DISBURSEMENTS_ENABLED: "true" }, { DATABASE_URL: "postgresql://postgres:postgres@neon.tech:5432/app_db" }]) {
    assert.throws(() => requireDisposablePayrollRunActions({ ...safeEnv, ...change }), /REFUSED/);
  }
});

test("the fictional figures are internally consistent with the seeded line items", () => {
  const abs = (codes) => FICTIONAL_LINE_ITEMS.filter((item) => codes.includes(item.code)).reduce((sum, item) => sum + Math.abs(item.amount), 0);
  assert.equal(FICTIONAL_FIGURES.withholdingTax, abs(["WHT"]));
  assert.equal(FICTIONAL_FIGURES.statutoryContributions, abs(["SSS", "PHIC", "HDMF"]));
  assert.equal(FICTIONAL_FIGURES.deductions, abs(["WHT", "SSS", "PHIC", "HDMF"]));
  assert.equal(FICTIONAL_FIGURES.grossPay - FICTIONAL_FIGURES.deductions, FICTIONAL_FIGURES.netPay);
  assert.equal(FICTIONAL_FIGURES.payoutTotal, FICTIONAL_FIGURES.netPay);
});

test("a successful sign-off must echo the exact run, an audit id and the system-derived figures", () => {
  const ok = { status: 200, text: "{}", json: { signedOff: true, runId: 7, auditEventId: 3, verifiedFigures: { ...FICTIONAL_FIGURES } } };
  assert.equal(assertPilotSignedOff(ok, 7).auditEventId, 3);
  assert.throws(() => assertPilotSignedOff(ok, 8), "a different run id must fail");
  assert.throws(() => assertPilotSignedOff({ ...ok, json: { ...ok.json, auditEventId: null } }, 7));
  assert.throws(() => assertPilotSignedOff({ ...ok, json: { ...ok.json, verifiedFigures: { ...FICTIONAL_FIGURES, netPay: 1 } } }, 7));
  assert.throws(() => assertPilotSignedOff({ ...ok, status: 403 }, 7));
});

test("a refusal must carry the exact status and leak none of the forbidden values", () => {
  const refusal = (text) => ({ status: 403, text, json: null, headers: new Headers() });
  assert.equal(assertRefusal(refusal("{}"), 403, ["VICTIM-MARKER"]), null);
  assert.throws(() => assertRefusal(refusal('{"m":"VICTIM-MARKER"}'), 403, ["VICTIM-MARKER"]));
  assert.throws(() => assertRefusal(refusal("{}"), 200, []));
});

test("snapshots must be identical table for table", () => {
  const before = { audit_events: [{ id: 1 }], payroll_runs: [{ id: 2, status: "Released" }] };
  assert.equal(assertRowsUnchanged(before, structuredClone(before), "same"), undefined);
  assert.throws(() => assertRowsUnchanged(before, { ...before, payroll_runs: [{ id: 2, status: "Draft" }] }, "changed"));
  assert.throws(() => assertRowsUnchanged(before, { audit_events: before.audit_events }, "removed"));
});

test("the harness proves real own successes, forged selectors, refusals on every action, and never credits", () => {
  const harness = readFileSync("scripts/qa/tenant-payroll-run-actions-http.mjs", "utf8");
  assert.ok(harness.indexOf("requireDisposablePayrollRunActions();") < harness.indexOf('import("../../src/db/index.ts")'), "guard before any DB import");
  for (const required of [
    "exactly one own sign-off row", "a replayed sign-off is the same single record", "a mismatching independent figure is refused by name",
    "the ledger belongs to the own batch", "the completion is tied to the own accepted bank validation", "exports preflight", "exports disburse",
    "xendit-payout POST preflight", "a cross-site manual completion", "victim after \" + key + \"'s complete journey",
    "A's sign-off evidence cannot satisfy B's", "no sign-off was ever recorded for the victim", "coverageCredits: 0", "providersContacted: 0",
    "for (let i = 0; i < 7; i++)",
  ]) assert.ok(harness.includes(required), "missing harness step " + required);
  assert.doesNotMatch(harness, /\bcoverageCredits: [1-9]/);
});

test("the workflow is fictional-only, path-scoped and runs the contract test and the harness", () => {
  const workflow = readFileSync(".github/workflows/tenant-payroll-run-actions-http.yml", "utf8");
  for (const required of [
    "TENANT_APPROVAL_TASK_MODE: fictional-pg16-http", "image: postgres:16", "node --test tests/tenant-payroll-run-actions-contract.test.mjs",
    "node --import tsx scripts/qa/tenant-payroll-run-actions-http.mjs", "WORKER_ENABLED: 'false'", "XENDIT_PAYOUTS_ENABLED: 'false'",
    "persist-credentials: false", "contents: read", "'src/app/api/payroll-runs/**'",
    "'scripts/qa/tenant-payroll-run-actions-*.mjs'",
  ]) assert.ok(workflow.includes(required), "missing workflow content " + required);
  assert.doesNotMatch(workflow, /secrets\./);
});
