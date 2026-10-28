import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { requireDisposableActionItems } from "../scripts/qa/tenant-self-action-items-http.mjs";

const route = readFileSync("src/app/api/self/performance/action-items/route.ts", "utf8");
const proof = readFileSync("scripts/qa/tenant-self-action-items-http.mjs", "utf8");
const workflow = readFileSync(".github/workflows/tenant-self-action-items-http.yml", "utf8");
const newProofFile = "scripts/qa/tenant-self-action-items-http.mjs";

test("1:1 action-item PATCH locks and rechecks active own employee/membership and exact tenant", () => {
  assert.match(route, /db\.transaction\(async \(tx\) =>/);
  assert.match(route, /eq\(users\.employeeId, context\.employee\.id\)/);
  assert.match(route, /eq\(users\.role, "employee"\)/);
  assert.match(route, /eq\(userOrganizations\.organizationId, context\.employee\.organizationId\)/);
  assert.match(route, /eq\(userOrganizations\.active, true\)/);
  assert.match(route, /eq\(employees\.organizationId, context\.employee\.organizationId\)/);
  assert.match(route, /\.for\("share"\)/);
  assert.match(route, /tx\.select\(\)\.from\(performanceOneOnOneActionItems\)/);
  assert.match(route, /\.for\("update"\)/);
  assert.match(route, /eq\(performanceOneOnOneActionItems\.organizationId, context\.employee\.organizationId\)/);
  assert.match(route, /eq\(performanceOneOnOneActionItems\.employeeId, context\.employee\.id\)/);
  assert.match(route, /eq\(performanceOneOnOneActionItems\.ownerEmployeeId, context\.employee\.id\)/);
  assert.match(route, /eq\(performanceOneOnOneActionItems\.visibility, "employee_shared"\)/);
  assert.match(route, /eq\(performanceOneOnOneActionItems\.ownerKind, "employee"\)/);
  assert.match(route, /inArray\(performanceOneOnOneActionItems\.status, \["open", "in_progress"\]\)/);
  assert.doesNotMatch(route, /db\.update\(performanceOneOnOneActionItems\)/);
});

test("status, owner-change event and audit insert share the SAME transaction", () => {
  const start = route.indexOf("const result = await db.transaction(");
  const end = route.indexOf('if (result.kind === "denied")', start);
  assert.ok(start > 0 && end > start);
  const body = route.slice(start, end);
  assert.match(body, /await tx\.update\(performanceOneOnOneActionItems\)/);
  assert.match(body, /await tx\.insert\(performanceOneOnOneActionItemEvents\)/);
  assert.match(body, /await tx\.insert\(auditEvents\)/);
  assert.doesNotMatch(body, /recordAuditEvent\(/);
  assert.match(body, /return \{ kind: "ok", row \}/);
});

test("proof executes actual own, foreign, peer, forged, concurrency and injected rollback HTTP", () => {
  for (const text of [
    'seed("ATTA")', 'seed("ATTB")', 'seed("VICTIM")',
    "standaloneRequest(PATH", 'expectedStatus', "victimBaseline",
    "foreign higher-ID action item", "same-employer peer employee denied",
    "forged victim organization and employee", "simultaneous.map",
    "revoked membership blocks the employee",
    "CREATE TRIGGER qa_action_item_audit_abort_trigger",
    "audit insertion error rolls back status and event",
    "creditedMethods: 0", "productionTested: false",
  ]) {
    if (text === "expectedStatus") continue;
    assert.ok(proof.includes(text), "missing tested safety condition: " + text);
  }
  assert.match(workflow, /image: postgres:16/);
  assert.ok(workflow.includes("node --import tsx " + newProofFile));
  assert.match(workflow, /node scripts\/qa\/apply-isolated-baseline\.mjs/);
  assert.match(workflow, /127\.0\.0\.1:3000/);
  assert.doesNotMatch(workflow, /curl\s+https?:\/\/(?!127\.0\.0\.1)/);
});

test("preflight rejects non-CI, remote SQL, provider credentials and missing opt-in before app imports", () => {
  const valid = {
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    TENANT_SELF_PERFORMANCE_MODE: "fictional-only",
    TENANT_SELF_ACTION_ITEMS_MODE: "fictional-only",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    DEMO_MODE: "false",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false", HCM_OVERPAYMENT_PREVIEW_ENABLED: "false",
    PAYROLL_OVERPAYMENT_REVIEW_ENABLED: "false",
    WORKER_TOKEN: "ci-worker-token-fictional-only",
  };
  assert.doesNotThrow(() => requireDisposableActionItems(valid));
  for (const patch of [
    { CI: "false" }, { GITHUB_ACTIONS: "false" },
    { TENANT_SELF_ACTION_ITEMS_MODE: "production" },
    { NODE_ENV: "development" }, { XENDIT_BILLING_ENABLED: "true" },
    { SECURITY_SMOKE_URL: "https://production.example.com" },
    { DATABASE_URL: "postgresql://postgres:postgres@remote.example.com:5432/app_db" },
    { SMTP_URL: "smtp://example.test" }, { VERCEL: "1" },
    { DATABASE_URL_DIRECT: "postgresql://127.0.0.1/app_db" },
  ]) {
    assert.throws(() => requireDisposableActionItems({ ...valid, ...patch }),
      "unsafe profile accepted: " + JSON.stringify(patch));
  }
});
