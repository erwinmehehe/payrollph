import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { explicitPayrollReviewEmployerId } from "../src/lib/tenant-payroll-review-page";

test("tax review employer selector requires one canonical safe positive id", () => {
  assert.equal(explicitPayrollReviewEmployerId("1"), 1);
  assert.equal(explicitPayrollReviewEmployerId("9007199254740991"), Number.MAX_SAFE_INTEGER);
  for (const forged of [undefined, null, 1, 0, false, "", "0", "-1", "+1",
    "01", "1e2", "1.0", " 1", "1 ", "1&organizationId=2",
    "9007199254740992", ["1"], ["1", "2"], {}, NaN, Infinity]) {
    assert.equal(explicitPayrollReviewEmployerId(forged), null, JSON.stringify(forged));
  }
});

for (const file of [
  "src/app/workspace/2316/page.tsx",
  "src/app/workspace/prior-employer/page.tsx",
]) {
  test(file + " enforces tenant, custom permissions, company scope before client mount", () => {
    const source = readFileSync(file, "utf8");
    const session = source.indexOf("await getSessionUser()");
    const selector = source.indexOf("explicitPayrollReviewEmployerId(query.organizationId)");
    const denied = source.indexOf("await assertOrganizationRole(");
    const access = source.indexOf("await getAccess(");
    const render = source.indexOf(file.includes("2316") ? "<Certificate2316Review" : "<YearEndPriorReview");
    assert.ok(session >= 0 && selector > session && denied > selector &&
      access > denied && render > access, "Private form must mount only after full server authorization");
    assert.match(source, /if \(denied \|\| !access\?\.companyWide\) notFound\(\)/);
    assert.match(source, /PAYROLL_OPERATOR_ROLES/);
    assert.match(source, /Authorized payroll employer: #\{organizationId\}/);
    assert.doesNotMatch(source, /Number\(query\.organizationId\)/);
    assert.match(source, /query\.organizationId === undefined/);
  });
}

test("2316 selected-worker and frozen released-employer context bind before private form mount", () => {
  const source = readFileSync("src/app/workspace/2316/page.tsx", "utf8");
  const role = source.indexOf("await assertOrganizationRole(");
  const entity = source.indexOf("await resolveMultiEntityContext(");
  const worker = source.indexOf("const [worker] = await db.select(");
  const separation = source.indexOf("const [separation] = await db.select(");
  const frozen = source.indexOf("frozenFinalPayLegalEntityId(separation.snapshot)");
  const mount = source.indexOf("<Certificate2316Review");
  assert.ok(role >= 0 && entity > role && worker > entity &&
    separation > worker && frozen > separation && mount > frozen,
    "Authenticated employer, worker, released separation and entity grant must precede the private form");
  for (const token of [
    "canonicalPriorReviewWorkerId(employeeId)",
    "if (selectedWorkerId === false) notFound()",
    "if (selectedSeparationId !== null && selectedWorkerId === null) notFound()",
    "eq(employees.organizationId, organizationId)",
    "eq(employees.id, selectedWorkerId)",
    "eq(separationRecords.organizationId, organizationId)",
    "eq(separationRecords.employeeId, selectedWorkerId!)",
    "eq(separationRecords.id, selectedSeparationId)",
    'separation.status !== "released"',
    'separation.lastDay.startsWith(String(selectedYear) + "-")',
    "assertEntityResource(",
    "if (entityScope.context.enabled && selectedSeparationId === null)",
    "initialEmployeeId={selectedWorkerId === null ?",
    "key={String(organizationId)",
  ]) assert.ok(source.includes(token), "Missing 2316 tenant boundary: " + token);
  assert.ok(!source.slice(worker, mount).includes("catch"),
    "Source failure must not render an unverified worker or separation shell");
  assert.doesNotMatch(source, /Number\(query\.employeeId\)|Number\(query\.separationId\)/);
});
