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
