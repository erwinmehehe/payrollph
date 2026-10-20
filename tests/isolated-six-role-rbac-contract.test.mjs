import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const guard = readFileSync("src/lib/demo-provisioning-boundary.ts", "utf8");
const demo = readFileSync("src/app/api/auth/demo-switch/route.ts", "utf8");
const privateProbe = readFileSync("src/app/api/readiness/demo-provisioning/route.ts", "utf8");
const workflow = readFileSync(".github/workflows/live-rbac-sandbox-smoke.yml", "utf8");
const local = readFileSync("scripts/qa/isolated-six-role-rbac.mjs", "utf8");

test("one DB boundary drives production demo-switch and private diagnostics", () => {
  assert.match(guard, /ne\(organizations\.name, "Loom & Local"\)/);
  assert.match(guard, /"blocked_non_demo_employer"/);
  assert.match(guard, /"unverified"/);
  assert.match(demo, /await productionDemoEmployerBoundary\(\)/);
  assert.match(privateProbe, /await productionDemoEmployerBoundary\(\)/);
  assert.match(demo, /if \(boundary !== "demo_only"\)/);
  assert.match(demo, /status: 503/);
  assert.match(demo, /status: 404/);
});

test("private guard diagnostic authenticates before importing DB and never publishes tenant IDs", () => {
  const tokenCheck = privateProbe.indexOf("constantTimeSecretEqual(request.headers.get");
  const dbImport = privateProbe.indexOf('await import("@/lib/demo-provisioning-boundary")');
  assert.ok(tokenCheck >= 0 && dbImport > tokenCheck);
  assert.match(privateProbe, /Cache-Control": "no-store"/);
  assert.match(privateProbe, /Vary: "x-readiness-token"/);
  assert.doesNotMatch(privateProbe, /organizationId|organizationName|employeeCount|totalEmployers/);
});

test("customer-scope production 404 is proved privately and never counts as role acceptance", () => {
  assert.match(workflow, /id: demo_boundary/);
  assert.match(workflow, /\/api\/readiness\/demo-provisioning/);
  assert.match(workflow, /blocked_non_demo_employer/);
  assert.match(workflow, /if: steps\.demo_boundary\.outputs\.mode == 'demo_only'/);
  assert.match(workflow, /if: steps\.demo_boundary\.outputs\.mode == 'blocked_non_demo_employer'/);
  assert.match(workflow, /role acceptance NOT_RUN/i);
  assert.match(workflow, /Production demo block was not verified/);
  assert.doesNotMatch(workflow, /DEMO_MODE: ['"]?true['"]?[\s\S]{0,300}live-sandbox/);
});

test("isolated role QA may contact only localhost and a disposable PostgreSQL 16 database", () => {
  assert.match(local, /const ORIGIN = "http:\/\/127\.0\.0\.1:3000"/);
  assert.match(local, /assert\.equal\(url\.hostname, "127\.0\.0\.1"\)/);
  assert.match(local, /assert\.equal\(process\.env\.DEMO_MODE, "true"\)/);
  assert.match(local, /assert\.equal\(process\.env\.PAYMONGO_DISBURSEMENTS_ENABLED, "false"\)/);
  assert.match(local, /assert\.equal\(process\.env\.XENDIT_PAYOUTS_ENABLED, "false"\)/);
  assert.match(local, /const ROLES = \["owner", "hr", "payroll", "checker", "bookkeeper", "employee"\]/);
  assert.match(local, /"POST" : "GET"/);
  assert.match(local, /independentHumanUat: false/);
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /ISOLATED_SIX_ROLE_RBAC: disposable-pg16-only/);
  assert.match(workflow, /if: github\.event_name != 'pull_request'/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /run: npx tsx scripts\/qa\/isolated-six-role-rbac\.mjs/,
    "The disposable CI runner must load the real application DB types.");
});

test("cross-employer proof requires existing seeded records and actual second-owner access", () => {
  assert.match(local, /async function seedForeignEmployer\(\)/);
  assert.match(local, /db\.insert\(organizations\)/);
  assert.match(local, /db\.insert\(userOrganizations\)/);
  assert.match(local, /db\.insert\(payrollRuns\)/);
  assert.match(local, /db\.insert\(sessions\)/);
  assert.match(local, /const ownsActualRun =/);
  assert.match(local, /dashboard-own-positive/);
  assert.match(local, /payroll-own-existing-run/);
  assert.match(local, /const foreign = await seedForeignEmployer\(\)/);
  assert.match(local, /cross-tenant-existing-run/);
  assert.match(local, /isDeepStrictEqual\(after, snapshot\)/);
  assert.match(local, /await verifyExistingForeignEmployerDenials\(demoOwner\)/);
  assert.doesNotMatch(local, /org\s*\+\s*1000000/,
    "Guessed or nonexistent organization IDs cannot certify cross-tenant protection.");
  const sixRoles = local.indexOf("for (const role of ROLES)");
  const seedAfterRoles = local.indexOf("await verifyExistingForeignEmployerDenials(demoOwner)");
  assert.ok(sixRoles >= 0 && seedAfterRoles > sixRoles,
    "The second employer must be added only after all public demo role sign-ins.");
});


test("production target identity and schema must be attested before ANY demo login", () => {
  const deployment = workflow.indexOf("- name: Wait for exact production deployment");
  const preflight = workflow.indexOf("- name: Verify private compensation database readiness");
  const boundary = workflow.indexOf("- name: Read protected demo provisioning boundary");
  const demoLogin = workflow.indexOf("- name: Verify guarded demo login 404");
  assert.ok(deployment >= 0 && deployment < preflight && preflight < boundary && boundary < demoLogin,
    "Read-only target/ledger attestation must precede even the guarded demo 404 probe");
  const preflightBlock = workflow.slice(preflight, boundary);
  assert.doesNotMatch(preflightBlock, /^\s*if:\s*steps\.demo_boundary/m,
    "Customer-scope demo guard must NEVER disable production DB target and schema verification");
  assert.match(preflightBlock, /\/api\/readiness\/database-target/);
  assert.match(preflightBlock, /verify-production-compensation-preflight\.mjs/);
  assert.match(workflow,
    /- name: Verify deployed fictional HR compensation privacy \(#1046\)\n        if: steps\.demo_boundary\.outputs\.mode == 'demo_only'/,
    "Mutating fictional HR provisioning must still be limited to verified demo-only target");
});

test("PRs changing any payroll authorization dependency must run disposable six-role tests", () => {
  assert.match(workflow, /  pull_request:\n    branches: \[main\]\n  push:/,
    "No file path allowlist: role guard, schema, middleware and session changes all need RBAC tests");
  assert.doesNotMatch(workflow, /  pull_request:\n    branches: \[main\]\n    paths:/);
  assert.match(workflow, /live-sandbox:\n    if: github\.event_name != 'pull_request'/,
    "Pull-request tests must not use live production secrets");
});
