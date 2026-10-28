import assert from "node:assert/strict";
import test from "node:test";
import {
  APPROVAL_METHOD,
  requireDisposableApprovalTask,
  assertApprovalDenial,
  assertOwnApproval,
  assertApprovalAudit,
  assertUnchanged,
} from "../scripts/qa/tenant-approval-task-contract.mjs";

const safeEnv = {
  GITHUB_ACTIONS: "true", CI: "true", TENANT_APPROVAL_TASK_MODE: "fictional-pg16-http",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only", NODE_ENV: "production", DEMO_MODE: "false",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false", WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_SECRET_KEY: "", XENDIT_SECRET_KEY: "", RESEND_API_KEY: "",
};
const own = { id: 13, organizationId: 9, status: "Approved", actor: "Fictional A owner" };
const receipt = {
  status: 200, json: {
    id: own.id, organizationId: own.organizationId, status: own.status, decidedBy: own.actor,
    decidedAt: "2026-10-28T00:00:00Z", payrollRunId: null, approvalChainInstanceId: null,
    delegation: { permitted: true, roleMatched: true }, webhookDeliveries: 0,
  },
};
const audit = [{ organizationId: 9, actor: own.actor, action: "Approval approved",
  metadata: { taskId: 13, previousStatus: "Pending", deciderUserId: 31, payrollRunId: null } }];
const deny = (status = 404, text = '{"error":"Approval task not found."}', headers = new Headers()) => ({
  status, text, json: { error: "Approval task not found." }, headers,
});

test("exact method remains a candidate, not a coverage-credit claim", () => {
  assert.equal(APPROVAL_METHOD, "PATCH approvals/[id]");
});
test("disposable pre-import guard accepts only the exact synthetic CI target", () => {
  assert.equal(requireDisposableApprovalTask(safeEnv), true);
});
test("guard refuses non-CI, a live target, and wrong PG credentials or database", () => {
  for (const change of [
    { CI: "false" }, { GITHUB_ACTIONS: "false" }, { NODE_ENV: "development" },
    { SECURITY_SMOKE_URL: "https://payroll.example.test" },
    { SECURITY_SMOKE_URL: "http://localhost:3000" },
    { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/postgres" },
    { DATABASE_URL: "postgresql://user:password@127.0.0.1:5432/app_db" },
    { DATABASE_URL: "postgresql://postgres:postgres@neon.tech:5432/app_db" },
    { TENANT_APPROVAL_TASK_MODE: "" }, { DEMO_MODE: "true" },
  ]) {
    assert.throws(() => requireDisposableApprovalTask({ ...safeEnv, ...change }), /REFUSED/);
  }
});
test("guard fails closed for workers, payment switches, or external secrets", () => {
  for (const name of ["PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED",
    "XENDIT_BILLING_ENABLED", "WORKER_ENABLED", "CENTRAL_SCHEDULER_ENABLED"]) {
    assert.throws(() => requireDisposableApprovalTask({ ...safeEnv, [name]: "true" }), /REFUSED/);
  }
  for (const name of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "RESEND_API_KEY"]) {
    assert.throws(() => requireDisposableApprovalTask({ ...safeEnv, [name]: "live-secret" }), /REFUSED/);
  }
});
test("own positive verifies real task, employer, authenticated actor and no payroll action", () => {
  assert.equal(assertOwnApproval(receipt, own).organizationId, own.organizationId);
});
test("own positive rejects wrong employer, task, decision, actor or fake authority", () => {
  for (const row of [
    { ...receipt.json, organizationId: 10 }, { ...receipt.json, id: 99 },
    { ...receipt.json, status: "Pending" }, { ...receipt.json, decidedBy: "Imposter" },
    { ...receipt.json, payrollRunId: 12 }, { ...receipt.json, approvalChainInstanceId: 14 },
    { ...receipt.json, delegation: { permitted: false, roleMatched: false } },
    { ...receipt.json, webhookDeliveries: 1 },
  ]) assert.throws(() => assertOwnApproval({ ...receipt, json: row }, own));
});
test("foreign and missing paths are generic 404, not an empty successful read", () => {
  assert.equal(assertApprovalDenial(deny(), 404, ["VICTIM-ONLY"]), true);
  assert.throws(() => assertApprovalDenial({ ...deny(), status: 200 }, 404, []));
  assert.throws(() => assertApprovalDenial({ ...deny(), json: {} }, 404, []));
});
test("forbidden employer marker in response body or header fails", () => {
  assert.throws(() => assertApprovalDenial(deny(404, '{"error":"VICTIM-ONLY"}'), 404, ["VICTIM-ONLY"]));
  assert.throws(() => assertApprovalDenial(deny(404, '{"error":"hidden"}', new Headers({ "x-debug": "VICTIM-ONLY" })), 404, ["VICTIM-ONLY"]));
});
test("audit requires one persisted actor-bound transition and no duplicate", () => {
  assert.equal(assertApprovalAudit(audit, { organizationId: 9, id: 13, status: "Approved", actor: own.actor, userId: 31 }), true);
  assert.throws(() => assertApprovalAudit([], { organizationId: 9, id: 13, status: "Approved", actor: own.actor, userId: 31 }));
  assert.throws(() => assertApprovalAudit([...audit, audit[0]], { organizationId: 9, id: 13, status: "Approved", actor: own.actor, userId: 31 }));
  assert.throws(() => assertApprovalAudit(audit, { organizationId: 9, id: 13, status: "Approved", actor: own.actor, userId: 30 }));
});
test("unchanged financial/victim snapshots reject a single altered row", () => {
  const before = { approvals: [{ id: 71, status: "Pending" }], payroll: [], audit: [] };
  assert.equal(assertUnchanged(before, structuredClone(before), "victim"), true);
  assert.throws(() => assertUnchanged(before, { ...before, approvals: [{ id: 71, status: "Approved" }] }, "victim"));
});
