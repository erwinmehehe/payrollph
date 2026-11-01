import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Source contract only. NOT signed-in PG16/HTTP method acceptance or coverage credit.
const src = readFileSync("src/app/api/workforce-planning/scenarios/route.ts", "utf8");
const start = src.indexOf("export async function POST(request: Request) {");
const end = src.indexOf("export async function PATCH(request: Request) {", start);
assert.ok(start > 0 && end > start, "POST source region must exist");
const post = src.slice(start, end);

function tenantGuard(region) {
  assert.ok(region.includes("eq(orgUnits.id, orgUnitId)"), "Missing exact requested unit ID");
  assert.ok(region.includes("eq(orgUnits.organizationId, organizationId)"), "Missing authenticated employer ownership predicate");
  assert.ok(region.includes('error: "Organization unit not found."'), "Unknown/foreign unit response must be the same");
  assert.ok(region.includes("status: 404"), "Denied reference must be a stable not-found response");
}

test("scenarios POST checks employer ownership before forecast or scenario persistence", () => {
  const guardAt = post.indexOf("if (orgUnitId != null) {");
  const forecastAt = post.indexOf("const result = await loadScopedWorkforceForecast(");
  const insertAt = post.indexOf("await db.insert(workforcePlanningScenarios)");
  assert.ok(guardAt >= 0 && guardAt < forecastAt && forecastAt < insertAt);
  tenantGuard(post.slice(guardAt, forecastAt));
  assert.throws(() => tenantGuard(post.slice(guardAt, forecastAt).replace(
    "eq(orgUnits.organizationId, organizationId)", "",
  )), /Missing authenticated employer ownership/);
});

test("scenarios POST sends no raw SQL or unexpected exception text to clients", () => {
  const catchAt = post.lastIndexOf("} catch (error) {");
  assert.ok(catchAt >= 0, "Expected safe POST error handler");
  const handler = post.slice(catchAt);
  assert.ok(handler.includes("accessErrors.includes(message)"));
  assert.ok(handler.includes("validationErrors.includes(message)"));
  assert.ok(handler.includes('error: "Scenario could not be calculated."'), "Unexpected errors must be generic");
  assert.ok(!handler.includes("const status = /access|required|outside your assigned/i"), "Raw SQL error classifier must be removed");
});

test("candidate HTTP write-table scenario uses two attackers, immutable state and equal unknown/foreign denials", () => {
  const table = readFileSync("scripts/qa/tenant-table-rows/write/workforce-planning.mjs", "utf8");
  const start = table.indexOf('key: "POST workforce-planning/scenarios"');
  // POST remains after the historical PATCH row so previously reviewed line
  // pins in the tenant method inventory do not drift.
  const patch = table.indexOf('key: "PATCH workforce-planning/scenarios"');
  const end = table.indexOf("\n  ];", start);
  assert.ok(patch >= 0 && patch < start && end > start,
    "The dedicated POST row must follow the historical PATCH proof row");
  const candidate = table.slice(start, end);
  for (const proof of [
    "status: 201", 'seed: async (e) => plan(e, "scenario plan")', "state: scenarioState",
    "ownBody:", "foreignBody:", "forged:", "status: 404", "expect:", "exercise:",
    "added(before.scenarios, after.scenarios",
    "await scenarioState(c.victim.org.id)",
    "assert.equal(refusals[0], refusals[1]",
    "assert.deepEqual(await scenarioState(c.orgId), own",
    "assert.deepEqual(await scenarioState(c.victim.org.id), victimBefore",
    "own org unit scope", "second version",
    "scopeOrgUnitId: c.unitId", "row.scopeOrgUnitId, c.unitId", "row.snapshot?.scope?.orgUnitId, c.unitId",
    'SQLFaultInjection: "SYNTHETIC_PG16_HTTP"', "methodCoverageCredit: false",
    "requireTenantTableDisposable()", "CREATE TRIGGER qa_wfp_scenario_post_fault_1655",
    "QA1655_PRIVATE_SQL_SENTINEL", "own pre-fault positive control",
    "CREATE FUNCTION public.qa_wfp_scenario_post_fault_1655_fn() RETURNS trigger AS $qa1655$",
    "\"END;\"", "$qa1655$ LANGUAGE plpgsql",
    'denied.json, { error: "Scenario could not be calculated." }',
    "assert.deepEqual(await scenarioState(c.orgId), ownBeforeFault",
    "DROP TRIGGER IF EXISTS qa_wfp_scenario_post_fault_1655",
    "DROP FUNCTION IF EXISTS public.qa_wfp_scenario_post_fault_1655_fn()",
  ]) assert.ok(candidate.includes(proof), "Missing additional scenario POST isolation control: " + proof);
  assert.ok(!candidate.includes('RETURNS trigger AS $"'),
    "A lone dollar sign is invalid PostgreSQL function syntax");
  assert.ok(candidate.indexOf("RETURNS trigger AS $qa1655$") < candidate.indexOf("$qa1655$ LANGUAGE plpgsql"),
    "PL/pgSQL function body must use matching tagged-dollar delimiters");
  assert.equal((table.match(/key: "POST workforce-planning\/scenarios"/g) ?? []).length, 1,
    "A merge must not duplicate the scenarios POST family row");
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const post = manifest.allApiRouteFiles["src/app/api/workforce-planning/scenarios/route.ts"].methods.find(method => method.name === "POST");
  assert.equal(post.status, "GAP", "Current main requires SQL-error injection and independent review before a method credit");
  assert.equal(post.testedBy, null);
});
