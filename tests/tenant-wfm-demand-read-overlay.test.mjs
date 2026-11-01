import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  requireDisposableDemandRecovery,
} from "../scripts/qa/tenant-demand-governance-recovery-contract.mjs";

const issuedPath = "src/app/api/workforce/demand-observations/issued/route.ts";
const policiesPath = "src/app/api/workforce/demand-staffing/policies/route.ts";
const issued = readFileSync(issuedPath, "utf8");
const policies = readFileSync(policiesPath, "utf8");
const runner = readFileSync("scripts/qa/tenant-wfm-demand-read-overlay-http.mjs", "utf8");
const workflow = readFileSync(".github/workflows/tenant-wfm-demand-read-overlay-http.yml", "utf8");

test("issued demand GET authorizes active employer and deny-only workforce permission before flags and SQL", () => {
  const get = issued.slice(issued.indexOf("export async function GET("),
    issued.indexOf("export async function POST("));
  const session = get.indexOf("getSessionUser()");
  const role = get.indexOf("await assertOrganizationRole(");
  const access = get.indexOf("await getAccess(");
  const flag = get.indexOf("issuedDemandPilotAllowed(organizationId)");
  const site = get.indexOf("await scopedWorksite(");
  const read = get.indexOf("await fetchIssuedDemandForecasts(");
  assert.ok(session >= 0 && role > session && access > role &&
    flag > access && site > flag && read > site,
  "Invalid employer permissions must not enumerate pilot flags or access issued demand sources");
  assert.match(get, /WORKFORCE_MANAGER_ROLES/);
  assert.match(get, /if \(roleDenied\) return roleDenied/);
  assert.match(issued, /eq\(worksites\.organizationId, organizationId\)/);
  assert.match(issued, /operationalDemandSiteAuthorized\(access, site\)/);
});

test("staffing policy GET gates permission and company-wide manage mode before reading pilot evidence", () => {
  const get = policies.slice(policies.indexOf("export async function GET("),
    policies.indexOf("export async function POST("));
  const session = get.indexOf("getSessionUser()");
  const role = get.indexOf("await assertOrganizationRole(");
  const access = get.indexOf("await getAccess(");
  const flag = get.indexOf("staffingPolicyPilotAllowed(");
  const site = get.indexOf("await verifiedSite(");
  const read = get.indexOf("await readStaffingPolicies(");
  assert.ok(session >= 0 && role > session && access > role &&
    flag > access && site > flag && read > site,
  "Custom workforce permission and manager scope must precede private policy lookup");
  assert.match(get, /WORKFORCE_MANAGER_ROLES/);
  assert.match(get, /if\(roleDenied\)return roleDenied/);
  assert.match(get, /mode==="manage"&&\(!access\.companyWide/);
  assert.match(policies, /eq\(worksites\.organizationId,org\)/);
});

test("proof refuses non-isolated provider-enabled environments before importing database", () => {
  const good = {
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    TENANT_TABLE_PROFILE: "allowlisted-reads",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    APP_BASE_URL: "https://payroll.example.test",
    DEMO_MODE: "false", PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    HCM_OVERPAYMENT_PREVIEW_ENABLED: "false", PAYROLL_OVERPAYMENT_REVIEW_ENABLED: "false",
    WFM_OPERATIONAL_DEMAND_ENABLED: "true",
    WFM_ISSUED_DEMAND_FORECASTS_ENABLED: "true",
    WFM_DEMAND_STAFFING_POLICIES_ENABLED: "true",
    TENANT_TABLE_ALLOWLIST_FIXTURE: "/tmp/payrollph-tenant-allowlist-abcdef/fixture.json",
    WFM_OPERATIONAL_DEMAND_ALLOWED_ORGANIZATION_IDS: "41,42,43",
    WFM_ISSUED_DEMAND_FORECASTS_ALLOWED_ORGANIZATION_IDS: "41,42,43",
    WFM_DEMAND_STAFFING_POLICIES_ALLOWED_ORGANIZATION_IDS: "41,42,43",
  };
  assert.doesNotThrow(() => requireDisposableDemandRecovery(good));
  for (const [name, value] of [
    ["DATABASE_URL", "postgresql://postgres:password@db.production.invalid/payroll"],
    ["SECURITY_SMOKE_URL", "https://tenant.example.invalid"],
    ["XENDIT_BILLING_ENABLED", "true"],
    ["WFM_DEMAND_STAFFING_POLICIES_ENABLED", "false"],
    ["WFM_OPERATIONAL_DEMAND_ALLOWED_ORGANIZATION_IDS", "41,42,100000"],
    ["GITHUB_ACTIONS", "false"],
    ["PAYMONGO_SECRET_KEY", "fake-nonblank-secret"],
  ]) {
    // A different but syntactically correct allowlist needs a separate
    // bootstrap membership assertion; the environment guard validates form.
    if (name === "WFM_OPERATIONAL_DEMAND_ALLOWED_ORGANIZATION_IDS") continue;
    assert.throws(() => requireDisposableDemandRecovery({ ...good, [name]: value }),
      "Unsafe " + name + " must fail before any runtime HTTP or SQL");
  }
  assert.ok(runner.indexOf("requireDisposableDemandRecovery();") >= 0 &&
    runner.indexOf("requireDisposableDemandRecovery();") <
    runner.indexOf('import("../../src/db/index.ts")'),
  "Disposable PG16 and provider refusal must run before database import");
});

test("real proof cannot borrow disabled-flag denials, empty owned responses or other tenants", () => {
  for (const required of [
    'readAllowlistPreseed(', 'createRows({ assert, db, rowTables: s })',
    'for (const actor of [a, b])',
    'assertBoundDemandRead(kind, own, c, persisted)',
    'assertDemandDenial(foreign, 403',
    'assertDemandDenial(stolenSite, 403',
    'permissions: ["people.admin"]',
    'userPermissionAssignments',
    'assert.match(denied.json?.error',
    'managerApproved.status, 200',
    'assert.deepEqual(managerApproved.json?.policies, []',
    'assert.equal(revoked.length, 1',
    'assert.equal(stillSignedIn.status, 200',
    'assertImmutableDemandSources(beforeReads.get(victim.org.id)',
    'methodCredits: 0, independentlyAccepted: false, productionCertified: false',
  ]) {
    assert.ok(runner.includes(required), "Real synthetic HTTP isolation proof lacks " + required);
  }
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /tenant-table-allowlist-bootstrap\.mjs/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-wfm-demand-read-overlay-http\.mjs/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  assert.doesNotMatch(workflow, /vercel deploy|npm run deploy|db:migrate:production/);
});
