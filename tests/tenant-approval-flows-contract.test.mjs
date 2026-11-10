import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  APPROVAL_FLOWS_METHOD, APPROVAL_FLOWS_TITLE, assertApprovalDenial, assertOwnFlowDecision, assertSnapshotsUnchanged,
  requireDisposableApprovalFlows,
} from "../scripts/qa/tenant-approval-flows-contract.mjs";

const safeEnv = {
  GITHUB_ACTIONS: "true", CI: "true", TENANT_APPROVAL_TASK_MODE: "fictional-pg16-http",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only", NODE_ENV: "production", DEMO_MODE: "false",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false", WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_SECRET_KEY: "", XENDIT_SECRET_KEY: "", RESEND_API_KEY: "",
};
const receipt = (change = {}) => ({
  status: 200, text: "{}", json: {
    id: 21, organizationId: 9, status: "Approved", decidedBy: "Fictional A checker", payrollRunId: null,
    delegation: { permitted: true, roleMatched: true }, leaveUpdated: false, approvalChain: { isChain: false },
    hcmBusinessProcess: { isHcmProcess: true }, automationGate: null, ...change,
  },
});
const own = { id: 21, organizationId: 9, status: "Approved", actor: "Fictional A checker", hcm: true };

test("this is the flow-bound PATCH approval proof and carries no coverage claim", () => {
  assert.equal(APPROVAL_FLOWS_METHOD, "PATCH approvals/[id]");
  assert.equal(APPROVAL_FLOWS_TITLE, "tenant-approval-flows-isolation");
});

test("the disposable pre-import guard is the generic approval-task guard, unchanged", () => {
  assert.equal(requireDisposableApprovalFlows(safeEnv), true);
  for (const change of [{ CI: "false" }, { NODE_ENV: "development" }, { WORKER_ENABLED: "true" }, { RESEND_API_KEY: "x" },
    { DATABASE_URL: "postgresql://postgres:postgres@neon.tech:5432/app_db" }]) {
    assert.throws(() => requireDisposableApprovalFlows({ ...safeEnv, ...change }), /REFUSED/);
  }
});

test("an own flow decision binds the exact task, employer, actor and the flow linkage of its family", () => {
  assert.ok(assertOwnFlowDecision(receipt(), own));
  for (const change of [{ id: 22 }, { organizationId: 10 }, { status: "Declined" }, { decidedBy: "Fictional B checker" }, { payrollRunId: 5 },
    { leaveUpdated: true }, { approvalChain: { isChain: true } }, { hcmBusinessProcess: { isHcmProcess: false } },
    { delegation: { permitted: true, roleMatched: false } }]) {
    assert.throws(() => assertOwnFlowDecision(receipt(change), own), undefined, JSON.stringify(change));
  }
  assert.throws(() => assertOwnFlowDecision({ ...receipt(), status: 404 }, own));
  const chain = receipt({ approvalChain: { isChain: true }, hcmBusinessProcess: { isHcmProcess: false } });
  assert.ok(assertOwnFlowDecision(chain, { ...own, hcm: false, chain: true }));
  assert.throws(() => assertOwnFlowDecision(chain, own), "a chain result is not an HCM process proof");
  const gate = receipt({ status: "Declined", hcmBusinessProcess: { isHcmProcess: false }, automationGate: { status: "failed" } });
  assert.ok(assertOwnFlowDecision(gate, { ...own, status: "Declined", hcm: false, gate: true }));
  assert.throws(() => assertOwnFlowDecision({ ...gate, json: { ...gate.json, automationGate: null } },
    { ...own, status: "Declined", hcm: false, gate: true }), "a gate decision that resumed no execution is not a gate proof");
});

test("denials and snapshots fail closed", () => {
  const denial = (text) => ({ status: 404, text, json: { error: "Approval task not found." }, headers: new Headers() });
  assert.ok(assertApprovalDenial(denial('{"error":"Approval task not found."}'), 404, ["VICTIM-MARKER"]));
  assert.throws(() => assertApprovalDenial(denial('{"error":"x","title":"VICTIM-MARKER"}'), 404, ["VICTIM-MARKER"]));
  const before = { approval_tasks: [{ row: { id: 1, status: "Pending" } }], automation_executions: [] };
  assert.equal(assertSnapshotsUnchanged(before, structuredClone(before), "same"), undefined);
  assert.throws(() => assertSnapshotsUnchanged(before, { ...before, automation_executions: [{ row: { id: 2 } }] }, "changed"));
});

test("the harness proves four flow families, forged pointers and the victim-unchanged invariant, and never credits", () => {
  const harness = readFileSync("scripts/qa/tenant-approval-flows-http.mjs", "utf8");
  assert.ok(harness.indexOf("requireDisposableApprovalFlows();") < harness.indexOf('import("../../src/db/index.ts")'),
    "the disposable guard must run before any database import");
  for (const required of [
    "for (const attacker of [a, b])", "startHcmBusinessProcessTx", "createApprovalFromConfiguredChain", "loadGovernedHandoffSource",
    'sourceType: "workforce_plan_scenario"', 'sourceType: "wfm_roster_claim_review"', 'status: "waiting_approval"',
    "await hcmProcess(a, \"forged\", fv.hcmFlow.instance.employeeId)", "await scenarioFlow(a, \"forged\", fv.scenario.scenario.id)",
    "await handoffApproval(a, victim.org.id, fv.claim.claim, \"forged\", fv.claim.claim.employeeId)",
    '"no longer has a valid employee"', '"not linked to a valid staffing scenario"', '"source changed after submission"',
    "HCM requester self-approval must name the maker-checker control", "for (const cookie of [attacker.cookie, mine.hr.cookie, mine.checker.cookie])",
    "the victim process is untouched by this attacker's journey", "the victim roster claim is untouched",
    "victim after both complete attacker journeys", "coverageCredits: 0", "independentlyAccepted: false",
  ]) assert.ok(harness.includes(required), "missing harness step " + required);
  assert.match(harness, /for \(let i = 0; i < 7; i\+\+\) await bundle\(filler/, "seven filler bundles keep victim IDs above six");
  assert.doesNotMatch(harness, /\bcoverageCredits: [1-9]/);
});

test("the workflow is fictional-only, path-scoped, and runs both the contract test and the harness", () => {
  const workflow = readFileSync(".github/workflows/tenant-approval-flows-http.yml", "utf8");
  for (const required of [
    "TENANT_APPROVAL_TASK_MODE: fictional-pg16-http", "image: postgres:16", "node --test tests/tenant-approval-flows-contract.test.mjs",
    "node --import tsx scripts/qa/tenant-approval-flows-http.mjs", "WORKER_ENABLED: 'false'", "XENDIT_PAYOUTS_ENABLED: 'false'",
    "PAYMONGO_DISBURSEMENTS_ENABLED: 'false'", "persist-credentials: false", "contents: read",
    "'src/app/api/approvals/**'", "'src/lib/hcm-business-process.ts'", "'src/lib/governed-approval-handoffs.ts'",
    "'src/lib/automation.ts'", "'scripts/qa/tenant-approval-flows-*.mjs'",
  ]) assert.ok(workflow.includes(required), "missing workflow content " + required);
  assert.doesNotMatch(workflow, /secrets\./, "no secret may reach a fictional proof");
});
