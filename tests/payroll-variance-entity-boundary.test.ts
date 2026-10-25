import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { varianceRosterMatchesRunEmployer } from "../src/lib/payroll-variance-entity-boundary";

const base = {
  organizationId: 10, legalEntityId: 101,
  entryEmployeeIds: [11, 12],
  employees: [
    { id: 11, organizationId: 10, legalEntityId: 101 },
    { id: 12, organizationId: 10, legalEntityId: 101 },
  ],
};

test("current and previous payroll entries must all belong to the frozen run employer", () => {
  assert.equal(varianceRosterMatchesRunEmployer(base), true);
  assert.equal(varianceRosterMatchesRunEmployer({
    ...base, entryEmployeeIds: [11], employees: [base.employees[0]],
  }), true);
  assert.equal(varianceRosterMatchesRunEmployer({
    ...base, entryEmployeeIds: [], employees: [],
  }), true);
  assert.equal(varianceRosterMatchesRunEmployer({
    ...base, employees: [base.employees[1], base.employees[0]],
  }), true);
});

test("same-tenant other employer and transferred former employee fail closed", () => {
  assert.equal(varianceRosterMatchesRunEmployer({
    ...base, employees: [base.employees[0], { id: 12, organizationId: 10, legalEntityId: 102 }],
  }), false);
  assert.equal(varianceRosterMatchesRunEmployer({
    ...base, employees: [base.employees[0], { id: 12, organizationId: 10, legalEntityId: null }],
  }), false);
  assert.equal(varianceRosterMatchesRunEmployer({
    ...base, employees: [base.employees[0], { id: 12, organizationId: 30, legalEntityId: 101 }],
  }), false);
});

test("missing, foreign, duplicate and invalid employee evidence cannot be silently dropped", () => {
  const variants = [
    { ...base, employees: [base.employees[0]] },
    { ...base, employees: [...base.employees, base.employees[0]] },
    { ...base, employees: [base.employees[0], { id: 999, organizationId: 10, legalEntityId: 101 }] },
    { ...base, entryEmployeeIds: [11, 11] },
    { ...base, entryEmployeeIds: [11, 0] },
    { ...base, entryEmployeeIds: [11, -1] },
    { ...base, entryEmployeeIds: [11, Number.MAX_SAFE_INTEGER + 1] },
    { ...base, organizationId: 0 },
    { ...base, legalEntityId: null },
  ];
  for (const item of variants) assert.equal(varianceRosterMatchesRunEmployer(item), false);
});

test("authorized HTTP variance report verifies all current and prior entry employees BEFORE salary and audit reads", () => {
  const route = readFileSync("src/app/api/payroll-runs/[id]/variance/route.ts", "utf8");
  const runAuth = route.indexOf("const entityDenied = assertEntityResource(entityContext.context, run.legalEntityId)");
  const entries = route.indexOf("const [currentEntries, previousEntries]");
  const roster = route.indexOf("const employeeRows = employeeIds.length");
  const guard = route.indexOf("varianceRosterMatchesRunEmployer({");
  const revisions = route.indexOf("const [relevantRevisions, periodAudit]");
  const salaries = route.indexOf("const rows = employeeIds.flatMap");
  const response = route.indexOf("return Response.json({\n    organizationId: run.organizationId");
  assert.ok(runAuth > 0 && entries > runAuth && roster > entries);
  assert.ok(guard > roster && revisions > guard && salaries > revisions && response > salaries,
    "Foreign/legacy/transferred employee rows must be denied before sensitive projections");
  assert.match(route, /if \(entityContext\.context\.enabled && !varianceRosterMatchesRunEmployer\(\{/);
  assert.match(route, /entryEmployeeIds: employeeIds/);
  assert.match(route, /employees: employeeRows\.map/);
  assert.match(route, /status: 409/);
  assert.match(route, /PAYROLL_VARIANCE_ENTITY_RECONCILIATION_REQUIRED/);
  assert.match(route, /Cache-Control": "private, no-store"/);
  assert.doesNotMatch(route, /filtered\.length|filter\(.*legalEntityId ===/,
    "Do not silently omit other-employer rows and misrepresent payroll balances as accurate");
});

test("disposable HTTPS proof is wired into the original multi-entity acceptance and never auto-certifies payroll", () => {
  const suite = readFileSync("scripts/qa/payroll-variance-entity-http.mjs", "utf8");
  const browser = readFileSync("scripts/multi-entity-synthetic-browser.mjs", "utf8");
  const workflow = readFileSync(".github/workflows/multi-entity-browser-qa.yml", "utf8");
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const route = "src/app/api/payroll-runs/[id]/variance/route.ts";
  const proof = manifest.allApiRouteFiles[route]?.methods.find((method: { name: string }) => method.name === "GET");
  assert.equal(proof?.status, "COVERED", "Retain prior independent own/foreign high-risk proof, not a new method credit");
  assert.equal(proof?.testedBy?.file, "scripts/qa/tenant-high-risk-01-http.mjs");
  assert.equal(manifest.metrics.coveredAfter, 158, "Preserve all six independent upstream MNY-02 expense/benefit method credits");
  assert.equal(manifest.metrics.gap, 326, "Do not claim any new variance-method credit or regress upstream coverage");
  assert.equal(manifest.metrics.publicByDesign, 10);
  assert.match(manifest.acceptanceStatus, /^NOT ACCEPTED:/);
  assert.match(browser, /import \{ verifyPayrollVarianceEmployerIsolation \} from "\.\/qa\/payroll-variance-entity-http\.mjs"/);
  assert.match(browser, /await verifyPayrollVarianceEmployerIsolation\(\{\s*newSyntheticContext, login, request, on, off, checks,/);
  assert.match(workflow, /run: npx tsx --test tests\/payroll-variance-entity-boundary\.test\.ts|npx tsx --test tests\/payroll-variance-entity-boundary\.test\.ts/);
  assert.match(workflow, /node --check scripts\/qa\/payroll-variance-entity-http\.mjs/);
  assert.match(workflow, /node scripts\/multi-entity-synthetic-browser\.mjs/);
  assert.match(workflow, /image: postgres:16/);
  for (const assertion of [
    /process\.env\.GITHUB_ACTIONS, "true"/,
    /process\.env\.MULTI_ENTITY_QA_MODE, "synthetic-postgres-only"/,
    /process\.env\.MULTI_ENTITY_ENABLED, "true"/,
    /process\.env\.PAYMONGO_DISBURSEMENTS_ENABLED, "false"/,
    /process\.env\.XENDIT_PAYOUTS_ENABLED, "false"/,
    /url\.hostname, "127\.0\.0\.1"/,
    /url\.pathname, "\/app_db"/,
    /const actors = \[/,
    /for \(const actor of actors\)/,
    /assert\.equal\(own\.status, 200/,
    /assert\.equal\(victim\.status, 403/,
    /assert\.equal\(wrongSelection\.status, 403/,
    /assert\.equal\(wrongPrior\.status, 409/,
    /assert\.equal\(moved\.status, 409/,
    /assert\.equal\(wrongSameTenant\.status, 409/,
    /assert\.equal\(malformed\.status, 409/,
    /assert\.equal\(restored\.status, 200/,
    /assert\.equal\(offOwn\.status, 200/,
    /SET LOCAL session_replication_role = replica/,
    /assert\.deepEqual\(afterC, beforeC/,
    /await changeSyntheticRow\(database, "employees", mutatedEmployeeId/,
    /await changeSyntheticRow\(database, "payroll_entries", mutatedEntryId/,
    /sentMoney: false, productionCertified: false, accepted: false/,
  ]) assert.match(suite, assertion);
  assert.match(suite, /await database\.end\(\)/, "Synthetic PG connection must be closed");
  assert.match(suite, /DELETE FROM payroll_entries WHERE payroll_run_id=ANY/, "Synthetic rows must be cleaned up");
});
