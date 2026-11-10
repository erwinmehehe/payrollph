import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { activeHrCaseStaffMembership, explicitHrCaseEmployerId, hrCaseStaffRosterScope, linkedEmployeeHrCaseScope } from "../src/lib/hr-case-tenant-scope";

const dialect = new PgDialect();

test("linked employee HR-case query constrains case ID, employer, and employee", () => {
  const query = dialect.sqlToQuery(linkedEmployeeHrCaseScope(701, 11, 37)!);
  assert.deepEqual(query.params, [701, 11, 37]);
  assert.match(query.sql, /"employee_hr_cases"\."id"/);
  assert.match(query.sql, /"employee_hr_cases"\."organization_id"/);
  assert.match(query.sql, /"employee_hr_cases"\."employee_id"/);
});

test("staff HR-case query joins only the session user's active employer membership", () => {
  const query = dialect.sqlToQuery(activeHrCaseStaffMembership(83)!);
  assert.deepEqual(query.params, [83, true]);
  assert.match(query.sql, /"user_organizations"\."organization_id"\s*=\s*"employee_hr_cases"\."organization_id"/);
  assert.match(query.sql, /"user_organizations"\."user_id"/);
  assert.match(query.sql, /"user_organizations"\."active"/);
});

test("PATCH does not fetch unscoped case IDs or distinguish inaccessible case rows", () => {
  const source = readFileSync("src/app/api/hr-cases/route.ts", "utf8");
  const patch = source.split("export async function PATCH(request: Request) {")[1];
  assert.ok(patch, "HR case PATCH must exist");
  assert.doesNotMatch(patch, /db\.select\(\)\.from\(employeeHrCases\)\.where\(eq\(employeeHrCases\.id,\s*caseId\)\)/);
  assert.match(patch, /linkedEmployeeHrCaseScope\(caseId, worker\.organizationId, worker\.id\)/);
  assert.match(patch, /\.innerJoin\(userOrganizations, activeHrCaseStaffMembership\(user\.id\)\)/);
  assert.match(patch, /if \(!existing\) return hrCaseNotFound\(\)/);
  assert.match(patch, /if \(denied\) return hrCaseNotFound\(\)/);
  assert.match(patch, /if \(!scope\.ok\) return hrCaseNotFound\(\)/);
  // The transaction locks the tenant-scoped row; every status write must still
  // carry that same employer identity in its SQL predicate.
  assert.equal((patch.match(/eq\(employeeHrCases\.organizationId, row\.organizationId\)/g) ?? []).length, 2);
  assert.doesNotMatch(patch, /\.where\(eq\(employeeHrCases\.id, caseId\)\)\.returning\(\)/);
  const beforeDecision = patch.split('const action = String(body.action ?? "");')[0];
  assert.doesNotMatch(beforeDecision, /return Response\.json\(\{ error: scope\.error \}/);
});


test("HR-case reads reject duplicate, coerced, missing and unsafe employer selectors", () => {
  assert.equal(explicitHrCaseEmployerId(["1"]), 1);
  assert.equal(explicitHrCaseEmployerId(["999"]), 999);
  for (const values of [
    [], ["1", "2"], ["1", "1"], ["0"], ["01"], ["-1"],
    [" 1"], ["1 "], ["+1"], ["1.0"], ["1e3"], ["Infinity"],
    [String(Number.MAX_SAFE_INTEGER + 1)], ["abc"],
  ]) {
    assert.equal(explicitHrCaseEmployerId(values), null, JSON.stringify(values));
  }
});

test("HR-case staff roster SQL scopes employer and authorized unit before selecting employee data", () => {
  const unit = dialect.sqlToQuery(hrCaseStaffRosterScope(11, 37)!);
  assert.deepEqual(unit.params, [11, 37]);
  assert.match(unit.sql, /"employees"."organization_id"/);
  assert.match(unit.sql, /"employees"."org_unit_id"/);
  const company = dialect.sqlToQuery(hrCaseStaffRosterScope(11, null)!);
  assert.deepEqual(company.params, [11]);
  assert.doesNotMatch(company.sql, /"employees"."org_unit_id"/);
});

test("HR-case GET canonicalizes tenant IDs and the unchanged SSR gate still rejects invalid selectors", () => {
  const api = readFileSync("src/app/api/hr-cases/route.ts", "utf8");
  const get = api.split("export async function GET(request: Request) {")[1]
    ?.split("export async function POST(request: Request) {")[0];
  assert.ok(get, "HR-case GET must exist");
  assert.match(get, /searchParams.getAll\("organizationId"\)/);
  assert.match(get, /explicitHrCaseEmployerId\(selectors\)/);
  assert.match(get, /selectedOrganizationId !== worker!\.organizationId\) return hrCaseNotFound\(\)/);
  assert.match(get, /assertOrganizationRole\(user\.id, organizationId, PEOPLE_PAYROLL_ROLES\)/);
  assert.match(get, /where\(hrCaseStaffRosterScope\(/);
  assert.doesNotMatch(get, /staff\.filter\(row =>/);
  assert.ok(get.indexOf("assertOrganizationRole(") < get.indexOf("hrCaseStaffRosterScope("),
    "Authorize selected employer before loading staff data");
  const page = readFileSync("src/app/hcm/hr-cases/page.tsx", "utf8");
  assert.match(page, /typeof raw !== "string"/);
  assert.match(page, /Number.isSafeInteger\(organizationId\)/);
  assert.ok(page.indexOf("assertOrganizationRole(") < page.indexOf("<EmployeeHrCaseStaffQueue"),
    "SSR must authorize before mounting the HR case queue");
});
