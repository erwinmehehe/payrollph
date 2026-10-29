import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function hasTenantJoin(source) {
  const start = source.indexOf(".innerJoin(compensationComponents, and(");
  const end = source.indexOf(".where(and(", start);
  if (start < 0 || end < start) return false;
  const join = source.slice(start, end);
  const where = source.slice(end, source.indexOf(".orderBy(", end));
  return [
    "eq(employeeCompensationComponents.componentId, compensationComponents.id)",
    "eq(employeeCompensationComponents.organizationId, compensationComponents.organizationId)",
    "eq(compensationComponents.organizationId, input.organizationId)",
  ].every(guard => join.includes(guard))
    && where.includes("eq(employeeCompensationComponents.organizationId, input.organizationId)")
    && where.includes("eq(compensationComponents.active, true)");
}

test("forecast component join requires matching employer on both sides", () => {
  const source = readFileSync("src/lib/workforce-forecast-server.ts", "utf8");
  assert.equal(hasTenantJoin(source), true);
  // Mutation controls prove this fails if either employer equality is removed.
  assert.equal(hasTenantJoin(source.replace(
    "eq(compensationComponents.organizationId, input.organizationId),", "",
  )), false);
  assert.equal(hasTenantJoin(source.replace(
    "eq(employeeCompensationComponents.organizationId, compensationComponents.organizationId),", "",
  )), false);
  assert.equal(hasTenantJoin(source.replace(
    ".innerJoin(compensationComponents, and(",
    ".innerJoin(compensationComponents, eq(",
  )), false);
});

test("scope coherence precedes forecast bulk database reads", () => {
  const source = readFileSync("src/lib/workforce-forecast-server.ts", "utf8");
  const start = source.indexOf("export async function loadScopedWorkforceForecast(");
  const access = source.indexOf("await getAccess(input.userId, input.organizationId)", start);
  const guard = source.indexOf("coherentWorkforceTenantScope(access, input.organizationId)", access);
  const bulk = source.indexOf("await Promise.all([", start);
  assert.ok(start >= 0 && access > start && guard > access && bulk > guard);
  assert.match(source, /Number\.isSafeInteger\(input\.orgUnitId\)/);
  assert.match(source, /Number\.isSafeInteger\(input\.worksiteId\)/);
});
