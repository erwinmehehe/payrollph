import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canOpenPeopleHome, explicitHcmEmployerId } from "../src/lib/hcm-people-home-scope";

test("HCM requires an explicit canonical employer identifier", () => {
  assert.equal(explicitHcmEmployerId("123"), 123);
  for (const invalid of [undefined, ["123"], "0", "-1", "001", "1e3", "1.0", " 1 ", "9007199254740992"]) {
    assert.equal(explicitHcmEmployerId(invalid), null);
  }
});

test("People Home visibility is limited to company-wide People roles", () => {
  for (const role of ["owner", "admin", "bookkeeper", "hr"]) {
    assert.equal(canOpenPeopleHome({ role, companyWide: true }), true);
    assert.equal(canOpenPeopleHome({ role, companyWide: false }), false);
  }
  for (const role of ["employee", "manager", "checker", "payroll"]) {
    assert.equal(canOpenPeopleHome({ role, companyWide: true }), false);
  }
  assert.equal(canOpenPeopleHome(null), false);
});

test("People Home cannot fall back to an employer or leak payroll data", () => {
  const page = readFileSync("src/app/hcm/command-center/page.tsx", "utf8");
  assert.match(page, /explicitHcmEmployerId\(requestedOrganizationId\)/);
  assert.match(page, /assertOrganizationRole\(user.id, organizationId, PEOPLE_ADMIN_ROLES\)/);
  assert.match(page, /canOpenPeopleHome\(access\)/);
  assert.match(page, /eq\(employees.organizationId, organizationId\)/);
  assert.match(page, /eq\(automationOperationalCases.organizationId, organizationId\)/);
  assert.ok(!page.includes("primaryCompanyOrganizationId"));
  assert.ok(!page.includes("payrollRuns"));
  assert.ok(!page.includes("db.update("));
  assert.ok(!page.includes("db.insert("));
});

test("Workspace preserves chosen employer and validates membership", () => {
  const page = readFileSync("src/app/app/page.tsx", "utf8");
  assert.match(page, /explicitHcmEmployerId\(requestedValue\)/);
  assert.match(page, /getAccess\(user.id, requestedOrganizationId\)/);
  assert.match(page, /const requestedAccess = requestedOrganizationId \? await getAccess\(user.id, requestedOrganizationId\) : null/);
  assert.match(page, /if \(!requestedAccess \|\| requestedAccess\.role === "employee"\) notFound\(\)/,
    "Employee-only membership in another employer cannot access its company workspace");
  assert.match(page, /assertOrganizationSessionPolicy\(user.id, companyOrganizationId\)/);
  assert.ok(page.includes("hcm/command-center?organizationId="));
  assert.match(page, /canOpenPeopleHome\(access\)/);
});
