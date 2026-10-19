import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { activeHrCaseStaffMembership, linkedEmployeeHrCaseScope } from "../src/lib/hr-case-tenant-scope";

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
  const beforeDecision = patch.split('const action = String(body.action ?? "");')[0];
  assert.doesNotMatch(beforeDecision, /return Response\.json\(\{ error: scope\.error \}/);
});
