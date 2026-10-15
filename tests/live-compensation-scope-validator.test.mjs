import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { verifyLiveCompensationPrivacy } from "../scripts/verify-live-compensation-scope.mjs";

function fixture() {
  const company = {
    access: { role: "hr", organizationId: 17, companyWide: true,
      orgUnitId: null, orgUnitName: null },
    cycles: [{ id: 31, name: "Public demo HR scope privacy #1046", budgetPool: "876543.21" }],
    employees: [
      { id: 100, firstName: "Mariel", lastName: "Santos" },
      { id: 102, firstName: "Jonas", lastName: "Reyes" },
      { id: 103, firstName: "Aira", lastName: "Villanueva" },
      { id: 101, firstName: "Rico", lastName: "Mendoza" },
    ],
    proposals: [
      { id: 201, employeeId: 100, reason: "Visible review", proposedAnnual: "290000.00" },
      { id: 202, employeeId: 101, reason: "QA1046 other unit private proposal", proposedAnnual: "950000.00", bandId: 302 },
    ],
    bands: [{ id: 301 }, { id: 302 }],
    legalEntities: [],
  };
  const unit = {
    access: { role: "hr", organizationId: 17, companyWide: false,
      orgUnitId: 77, orgUnitName: "Makati HQ" },
    cycles: [{ id: 31, name: "Public demo HR scope privacy #1046", budgetPool: null }],
    employees: [
      { id: 100, firstName: "Mariel", lastName: "Santos" },
      { id: 102, firstName: "Jonas", lastName: "Reyes" },
      { id: 103, firstName: "Aira", lastName: "Villanueva" },
    ],
    proposals: [{ id: 201, employeeId: 100, reason: "Visible review", proposedAnnual: "290000.00" }],
    bands: [{ id: 301 }],
    legalEntities: [],
  };
  return { company, unit };
}

test("two genuine role HTTP response bodies require explicit scoped budget redaction", () => {
  const { company, unit } = fixture();
  const accepted = verifyLiveCompensationPrivacy(company, unit);
  assert.equal(accepted.budgetRedacted, true);
  assert.equal(accepted.otherUnitWorkersExcluded, true);
});

test("live response contract fails closed for budget, worker and proposal leaks", () => {
  for (const mutate of [
    (g, u) => { u.cycles[0].budgetPool = "876543.21"; },
    (g, u) => { u.cycles = []; },
    (g, u) => { u.access.companyWide = true; },
    (g, u) => { u.access.orgUnitId = null; },
    (g, u) => { u.employees.push({ id: 101 }); },
    (g, u) => { u.proposals.push({ id: 202, employeeId: 101, proposedAnnual: "950000.00" }); },
    (g, u) => { u.note = "QA1046 other unit private proposal"; },
    (g, u) => { u.legalEntities.push({ disbursementAccount: "PRIVATE" }); },
    (g, u) => { g.cycles[0].budgetPool = null; },
    (g, u) => { u.bands.push({ id: 302 }); },
    (g, u) => { u.access.organizationId = 19; },
  ]) {
    const { company, unit } = fixture();
    mutate(company, unit);
    assert.throws(() => verifyLiveCompensationPrivacy(company, unit),
      /Compensation acceptance failed:/);
  }
});

test("production smoke has strict main/SHA guard and shell syntax", () => {
  const script = "scripts/live-compensation-scope-smoke.sh";
  const source = readFileSync(script, "utf8");
  const syntax = spawnSync("bash", ["-n", script], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
  for (const required of [
    "GITHUB_ACTIONS", "GITHUB_REF", "EXPECTED_COMMIT_SHA",
    "PRODUCTION_READINESS_TOKEN", "--proto '=https'",
    "--data \"$data\"", "node scripts/verify-live-compensation-scope.mjs",
    "get_compensation unit-nonmember", "get_compensation anonymous",
    "trap 'rm -rf -- \"$work_dir\"' EXIT",
  ]) assert.ok(source.includes(required), "Missing guarded smoke path: " + required);
  assert.doesNotMatch(source, /echo .*cookie|cat .*response|curl -v|set -x/);
});

test("production demo unit HR auth is secret gated and separate from ordinary HR", () => {
  const route = readFileSync("src/app/api/auth/demo-switch/route.ts", "utf8");
  const fixtureSource = readFileSync("src/lib/public-demo-compensation-scope.ts", "utf8");
  const workflow = readFileSync(".github/workflows/live-rbac-sandbox-smoke.yml", "utf8");
  const beforeTenantProvisioning = route.indexOf("const scopedHrRequested =");
  const tenantProvisioning = route.indexOf("await ensureCoreCompatibilitySchema()");
  assert.ok(beforeTenantProvisioning > 0 && tenantProvisioning > beforeTenantProvisioning);
  assert.match(route, /constantTimeSecretEqual\(request\.headers\.get\("x-readiness-token"\), expected\)/);
  assert.match(route, /scopedOrgUnitId === null \? DEMO_ACCOUNTS\[role\]/);
  assert.match(route, /email: "hr\.unit\.demo@linaw\.ph"/);
  assert.match(route, /localPasswordEnabled: scopedOrgUnitId === null/);
  assert.match(route, /randomToken\(32\)/);
  assert.equal((route.match(/orgUnitId: scopedOrgUnitId/g) ?? []).length, 2);
  assert.match(fixtureSource, /organization\.name !== "Loom & Local" \|\| otherOrganization/);
  assert.match(fixtureSource, /status: "proposed"/);
  assert.doesNotMatch(fixtureSource, /db\.delete\(|db\.update\(|payrollRuns|payRevision|createSession/);
  assert.match(workflow, /run: bash scripts\/live-compensation-scope-smoke\.sh/);
  assert.match(workflow, /PRODUCTION_READINESS_TOKEN: \$\{\{ secrets\.PRODUCTION_READINESS_TOKEN \}\}/);
});
