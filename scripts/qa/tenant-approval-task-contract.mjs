import assert from "node:assert/strict";

export const APPROVAL_METHOD = "PATCH approvals/[id]";

/** Refuse to import database/application code except in the disposable GitHub Actions job. */
export function requireDisposableApprovalTask(env = process.env) {
  let app, database;
  try {
    app = new URL(env.SECURITY_SMOKE_URL ?? "");
    database = new URL(env.DATABASE_URL ?? "");
  } catch {
    throw new Error("APPROVAL_TASK_PROOF_REFUSED: explicit localhost targets required");
  }
  const disabled = [
    "PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED",
    "XENDIT_BILLING_ENABLED", "WORKER_ENABLED", "CENTRAL_SCHEDULER_ENABLED",
  ];
  const absent = ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "RESEND_API_KEY"];
  const safe = env.GITHUB_ACTIONS === "true" && env.CI === "true" &&
    env.TENANT_APPROVAL_TASK_MODE === "fictional-pg16-http" &&
    env.TENANT_SECOND_PASS_MODE === "isolated-ci-only" &&
    env.NODE_ENV === "production" && env.DEMO_MODE === "false" &&
    app.href === "http://127.0.0.1:3000/" &&
    database.href === "postgresql://postgres:postgres@127.0.0.1:5432/app_db" &&
    disabled.every(name => env[name] === "false") &&
    absent.every(name => !env[name]);
  if (!safe) throw new Error(
    "APPROVAL_TASK_PROOF_REFUSED: fresh fictional PG16/localhost CI with provider and worker gates OFF required",
  );
  return true;
}

export function assertApprovalDenial(response, status, forbidden = []) {
  assert.equal(response?.status, status, "incorrect denial status");
  assert.ok(typeof response.text === "string", "a real HTTP body is required");
  assert.ok(response.json && typeof response.json.error === "string" && response.json.error.length,
    "denial must expose a generic error, not data or an HTML success page");
  const textAndHeaders = response.text + "\n" + [...(response.headers ?? [])]
    .map(([name, value]) => name + ":" + value).join("\n");
  for (const marker of forbidden) {
    assert.ok(typeof marker === "string" && marker.length > 0, "missing forbidden marker");
    assert.ok(!textAndHeaders.includes(marker), "foreign employer/session detail leaked");
  }
  return true;
}

export function assertOwnApproval(response, { id, organizationId, status, actor }) {
  assert.equal(response?.status, 200, "own decision must succeed over HTTP");
  const row = response.json;
  assert.ok(row && typeof row === "object" && !Array.isArray(row), "real JSON decision required");
  assert.equal(row.id, id, "wrong task returned");
  assert.equal(row.organizationId, organizationId, "cross-employer decision returned");
  assert.equal(row.status, status, "decision did not persist expected status");
  assert.equal(row.decidedBy, actor, "wrong authenticated decision maker");
  assert.ok(row.decidedAt && Number.isFinite(Date.parse(row.decidedAt)),
    "persisted decision timestamp required");
  assert.equal(row.payrollRunId, null, "proof must not approve a payroll run");
  assert.equal(row.approvalChainInstanceId, null, "proof must not advance a governed approval chain");
  assert.equal(row.delegation?.permitted, true, "decision must have active approver authority");
  assert.equal(row.delegation?.roleMatched, true, "actor must have the actual employer's owner role");
  assert.equal(row.webhookDeliveries, 0, "fictional task must not deliver webhooks");
  return row;
}

export function assertApprovalAudit(rows, { organizationId, id, status, actor, userId }) {
  assert.ok(Array.isArray(rows), "persisted audit rows required");
  const matching = rows.filter(event => Number(event.metadata?.taskId) === id);
  assert.equal(matching.length, 1, "exactly one audit record per approved/declined task");
  const [audit] = matching;
  assert.equal(audit.organizationId, organizationId, "audit written to foreign employer");
  assert.equal(audit.actor, actor, "audit actor mismatch");
  assert.equal(audit.action, "Approval " + status.toLowerCase(), "audit action mismatch");
  assert.equal(audit.metadata?.previousStatus, "Pending", "audit must record pending source");
  assert.equal(audit.metadata?.deciderUserId, userId, "audit must bind the authenticated user ID");
  assert.equal(audit.metadata?.payrollRunId, null, "no payroll audit source allowed");
  return true;
}

export function assertUnchanged(before, after, label) {
  assert.deepEqual(after, before, label + ": denied request modified persisted business/audit state");
  return true;
}
