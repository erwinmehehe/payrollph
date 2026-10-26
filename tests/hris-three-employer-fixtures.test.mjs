import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("shared HRIS/People Home source fixture keeps three employer IDs and a real victim", () => {
  const workflow = read(".github/workflows/hris-journey-browser-qa.yml");
  const seed = read("scripts/hcm-people-home-synthetic-fixture.ts");
  const hris = read("scripts/hris-journey-synthetic-fixture.ts");
  assert.match(workflow, /HCM_PEOPLE_HOME_ORG_IDS: "1,2,3"/);
  assert.match(seed, /assert\.equal\(process\.env\.HCM_PEOPLE_HOME_ORG_IDS, "1,2,3"\)/);
  assert.match(seed, /Synthetic Victim Only Employer/);
  assert.match(seed, /victimWorker/);
  assert.match(hris, /\[1, 2, 3\]/);
  assert.match(hris, /"HCM-QA-BRANCH"/);
  assert.match(hris, /victimEmployerOnly: 3/);
  assert.ok(workflow.indexOf("Guard shared three-employer synthetic fixtures before touching PG16") <
    workflow.indexOf("Seed disposable HCM baseline"), "Fixture guard must run before DB seeding");
});

test("ESS identity remains bound to the original authorized employer, never to the victim", () => {
  const source = read("scripts/hr-cases-synthetic-employee-link.ts");
  assert.match(source, /\[1, 2, 3\]/);
  assert.match(source, /eq\(userOrganizations\.organizationId, 1\)/);
  assert.match(source, /eq\(userOrganizations\.organizationId, 3\)/);
  assert.match(source, /assert\.equal\(victimMembership, undefined/);
  assert.match(source, /eq\(employees\.employeeNo, "SHARED-001"\)/);
});

test("first-payroll self-serve employer never reuses the protected third employer", () => {
  const fixture = read("scripts/first-payroll-mobile-synthetic-fixture.ts");
  const browser = read("scripts/first-payroll-zero-tenant-browser.mjs");
  assert.match(fixture, /\{ id: 3, name: "Synthetic Victim Only Employer" \}/);
  assert.match(fixture, /assert\.equal\(gamma\.id, 4,/);
  assert.match(fixture, /userOrganizations\)\.values\(\[1, 2\]/);
  assert.match(browser, /fixture\.organizationId > 3/);
  assert.match(browser, /fixture\.label,"disposable-synthetic-only"/);
});

test("browser installation is headless and time-bounded without apt mirror installation", () => {
  const workflow = read(".github/workflows/hris-journey-browser-qa.yml");
  assert.match(workflow, /timeout 240s npx playwright install --only-shell chromium/);
  assert.doesNotMatch(workflow, /playwright install --with-deps/);
  assert.match(workflow, /PAYMONGO_DISBURSEMENTS_ENABLED: "false"/);
  assert.match(workflow, /XENDIT_PAYOUTS_ENABLED: "false"/);
  assert.match(workflow, /POSTGRES_DB: app_db/);
});
