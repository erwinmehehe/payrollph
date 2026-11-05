import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  APPROVAL_SOURCES_METHOD,
  APPROVAL_SOURCES_TITLE,
  assertApprovalDenial,
  assertOwnSourceDecision,
  assertSnapshotsUnchanged,
  requireDisposableApprovalSources,
} from "../scripts/qa/tenant-approval-sources-contract.mjs";

const safeEnv = {
  GITHUB_ACTIONS: "true", CI: "true", TENANT_APPROVAL_TASK_MODE: "fictional-pg16-http",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only", NODE_ENV: "production", DEMO_MODE: "false",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false", WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_SECRET_KEY: "", XENDIT_SECRET_KEY: "", RESEND_API_KEY: "",
};
const leaveReceipt = (change = {}) => ({
  status: 200, text: "{}", json: {
    id: 21, organizationId: 9, status: "Approved", decidedBy: "Fictional A owner", payrollRunId: null,
    delegation: { permitted: true, roleMatched: true }, leaveUpdated: true, approvalChain: { isChain: false }, ...change,
  },
});
const own = { id: 21, organizationId: 9, status: "Approved", actor: "Fictional A owner", leave: true };

test("this is the source-bound PATCH approval proof and carries no coverage claim", () => {
  assert.equal(APPROVAL_SOURCES_METHOD, "PATCH approvals/[id]");
  assert.equal(APPROVAL_SOURCES_TITLE, "tenant-approval-sources-isolation");
});

test("the disposable pre-import guard is the generic approval-task guard, unchanged", () => {
  assert.equal(requireDisposableApprovalSources(safeEnv), true);
  for (const change of [{ CI: "false" }, { NODE_ENV: "development" }, { WORKER_ENABLED: "true" }, { RESEND_API_KEY: "x" },
    { DATABASE_URL: "postgresql://postgres:postgres@neon.tech:5432/app_db" }]) {
    assert.throws(() => requireDisposableApprovalSources({ ...safeEnv, ...change }), /REFUSED/);
  }
});

test("an own source decision proof binds the exact task, employer, actor, leave linkage and chain linkage", () => {
  assert.ok(assertOwnSourceDecision(leaveReceipt(), own));
  for (const change of [{ id: 22 }, { organizationId: 10 }, { status: "Declined" }, { decidedBy: "Fictional B owner" }, { payrollRunId: 5 },
    { leaveUpdated: false }, { approvalChain: { isChain: true } }, { delegation: { permitted: true, roleMatched: false } }]) {
    assert.throws(() => assertOwnSourceDecision(leaveReceipt(change), own), undefined, JSON.stringify(change));
  }
  assert.throws(() => assertOwnSourceDecision({ ...leaveReceipt(), status: 404 }, own));
  const chain = leaveReceipt({ leaveUpdated: false, approvalChain: { isChain: true } });
  assert.ok(assertOwnSourceDecision(chain, { ...own, leave: false, chain: true }));
  assert.throws(() => assertOwnSourceDecision(chain, own), "a chain result is not a leave proof");
});

test("a denial must expose a generic error and none of the forbidden markers", () => {
  const denial = (text) => ({ status: 404, text, json: { error: "Approval task not found." }, headers: new Headers() });
  assert.ok(assertApprovalDenial(denial('{"error":"Approval task not found."}'), 404, ["VICTIM-MARKER"]));
  assert.throws(() => assertApprovalDenial(denial('{"error":"x","title":"VICTIM-MARKER"}'), 404, ["VICTIM-MARKER"]));
  assert.throws(() => assertApprovalDenial(denial("{}"), 409, []));
});

test("snapshots must be byte-identical across every table", () => {
  const before = { approval_tasks: [{ row: { id: 1, status: "Pending" } }], audit_events: [] };
  assert.ok(assertSnapshotsUnchanged(before, structuredClone(before), "same") === undefined);
  assert.throws(() => assertSnapshotsUnchanged(before, { ...before, approval_tasks: [{ row: { id: 1, status: "Approved" } }] }, "changed"));
  assert.throws(() => assertSnapshotsUnchanged(before, { approval_tasks: before.approval_tasks }, "table removed"));
});

test("the harness proves both source families, forged pointers and the victim-unchanged invariant, and never credits", () => {
  const harness = readFileSync("scripts/qa/tenant-approval-sources-http.mjs", "utf8");
  assert.ok(harness.indexOf("requireDisposableApprovalSources();") < harness.indexOf('import("../../src/db/index.ts")'),
    "the disposable guard must run before any database import");
  for (const required of [
    "for (const attacker of [a, b])", "payrollRunId: victimRun.id", "approvalChainInstanceId: fv.chainInstance.id",
    '"own task whose payroll pointer names the victim run"', '"own task whose chain pointer names the victim chain instance"',
    '"requester self-approval"', "LEAVE_SELF_APPROVAL", "A's real HTTP result must fail B's own-object proof",
    "victim after both complete attacker journeys", "coverageCredits: 0", "independentlyAccepted: false",
    "fv.ownLeave.task", "fv.chainTask", "createApprovalFromConfiguredChain", "victim leave untouched by attacker A",
  ]) assert.ok(harness.includes(required), "missing harness step " + required);
  assert.match(harness, /for \(let i = 0; i < 7; i\+\+\) \{\s*await bundle\(filler/, "seven filler bundles keep victim IDs above six");
  assert.doesNotMatch(harness, /\bcoverageCredits: [1-9]/);
});

test("the workflow is fictional-only, path-scoped, and runs both the contract test and the harness", () => {
  const workflow = readFileSync(".github/workflows/tenant-approval-sources-http.yml", "utf8");
  for (const required of [
    "TENANT_APPROVAL_TASK_MODE: fictional-pg16-http", "image: postgres:16", "node --test tests/tenant-approval-sources-contract.test.mjs",
    "node --import tsx scripts/qa/tenant-approval-sources-http.mjs", "WORKER_ENABLED: 'false'", "XENDIT_PAYOUTS_ENABLED: 'false'",
    "PAYMONGO_DISBURSEMENTS_ENABLED: 'false'", "persist-credentials: false", "contents: read",
    "'src/app/api/approvals/**'", "'src/lib/approval-chains.ts'", "'scripts/qa/tenant-approval-sources-*.mjs'",
  ]) assert.ok(workflow.includes(required), "missing workflow content " + required);
  assert.doesNotMatch(workflow, /secrets\./, "no secret may reach a fictional proof");
});
