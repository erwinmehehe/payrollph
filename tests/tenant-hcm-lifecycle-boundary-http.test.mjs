import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { requireDisposableLifecycleBoundary, requirePrivateNoLeak,
  requireOneTaskTransition } from "../scripts/qa/tenant-hcm-lifecycle-boundary-contract.mjs";

const safe = {
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production", DEMO_MODE: "false",
  TENANT_HCM_LIFECYCLE_BOUNDARY_MODE: "fictional-pg16-http",
  TENANT_APPROVAL_TASK_MODE: "fictional-pg16-http",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false",
};

test("disposable HCM proof refuses live DB, HTTP, providers, and workers", () => {
  assert.equal(requireDisposableLifecycleBoundary(safe), true);
  for (const change of [
    { GITHUB_ACTIONS: "false" }, { CI: "false" }, { NODE_ENV: "development" },
    { DEMO_MODE: "true" }, { TENANT_HCM_LIFECYCLE_BOUNDARY_MODE: "other" },
    { TENANT_APPROVAL_TASK_MODE: "other" }, { TENANT_SECOND_PASS_MODE: "other" },
    { SECURITY_SMOKE_URL: "https://example.com" },
    { DATABASE_URL: "postgresql://postgres:postgres@db.example.com/app_db" },
    { WORKER_ENABLED: "true" }, { CENTRAL_SCHEDULER_ENABLED: "true" },
    { XENDIT_PAYOUTS_ENABLED: "true" }, { PAYMONGO_DISBURSEMENTS_ENABLED: "true" },
    { RESEND_API_KEY: "secret" }, { SMTP_URL: "smtp://mail.example.com" },
    { NEON_DATABASE_URL: "postgresql://live" },
  ]) assert.throws(() => requireDisposableLifecycleBoundary({ ...safe, ...change }), /REFUSED/);
});

const fake = (status, body, headers = {}) => ({
  status, text: JSON.stringify(body), json: body, headers: new Headers(headers),
});
test("positive must be private and foreign data cannot enter response", () => {
  const good = fake(200, { tasks: [] }, { "cache-control": "private, no-store" });
  assert.doesNotThrow(() => requirePrivateNoLeak(good,
    { status: 200, forbidden: ["victim"], label: "own GET" }));
  assert.doesNotThrow(() => requirePrivateNoLeak(
    fake(200, { tasks: [] }, { "cache-control": "no-store, private, must-revalidate" }),
    { status: 200, forbidden: ["victim"], label: "reordered secure cache" }));
  for (const response of [
    fake(200, { tasks: [], marker: "victim" }, { "cache-control": "private, no-store" }),
    fake(200, { tasks: [] }, { "cache-control": "public" }),
    fake(404, { error: "Missing" }, { "cache-control": "private, no-store" }),
    fake(200, { tasks: [] }),
  ]) assert.throws(() => requirePrivateNoLeak(response,
    { status: 200, forbidden: ["victim"], label: "forged success" }));
});

test("audit and event receipts are mandatory and no payroll or worker change is permitted", () => {
  const before = { tasks: [{ id: 7, organizationId: 5, status: "open" }],
    events: [], audits: [], employees: [{ id: 9 }], payroll: [] };
  const after = { tasks: [{ id: 7, organizationId: 5, status: "acknowledged" }],
    events: [{ id: 1, taskId: 7, organizationId: 5, eventType: "acknowledged", actorName: "Owner" }],
    audits: [{ id: 1, organizationId: 5, actor: "Owner",
      action: "HCM lifecycle notification acknowledged", metadata: { lifecycleTaskId: 7 } }],
    employees: [{ id: 9 }], payroll: [] };
  assert.doesNotThrow(() => requireOneTaskTransition(before, after, 7, "acknowledged", { name: "Owner" }));
  for (const mutation of [
    r => { r.events = []; }, r => { r.audits = []; },
    r => { r.employees.push({ id: 10 }); },
    r => { r.events[0].organizationId = 6; },
  ]) { const copy = structuredClone(after); mutation(copy);
    assert.throws(() => requireOneTaskTransition(before, copy, 7, "acknowledged", { name: "Owner" })); }
});

test("dedicated real HTTP run covers two owners, nonmatching worker, all actions and audit veto", () => {
  const script = readFileSync("scripts/qa/tenant-hcm-lifecycle-boundary-http.mjs", "utf8");
  assert.ok(script.indexOf("requireDisposableLifecycleBoundary();") <
    script.indexOf('import("../../src/db/index.ts")'));
  for (const marker of [
    'seedEmployer("ATTA"', 'seedEmployer("ATTB"', 'seedEmployer("VICTIM"',
    'for (const [e, manager] of [[a, managers[0]], [b, managers[1]]])',
    'createTask(victim, "VICTIM-ONLY-SECRET")',
    "employeeId: victim.worker.id", "requireOneTaskTransition(",
    'withDisposableInsertVeto(pool, "audit_events", e.org.id',
    'for (const action of ["assign", "snooze", "acknowledge", "dismiss"])',
    "assert.deepEqual(await snapshot(victim), beforeVictim",
    "coverageCreditsAdded: 0", 'independentSecurityReview: "PENDING"',
  ]) assert.ok(script.includes(marker), "required real proof missing: " + marker);
  const workflow = readFileSync(".github/workflows/tenant-hcm-lifecycle-boundary-http.yml", "utf8");
  for (const item of ["image: postgres:16", "contents: read", "persist-credentials: false",
    "npm run db:push", "npm run build",
    "node --import tsx scripts/qa/tenant-hcm-lifecycle-boundary-http.mjs"])
    assert.ok(workflow.includes(item), "missing safe isolated step: " + item);
  assert.doesNotMatch(workflow, /workflow_dispatch|secrets\./);
});
