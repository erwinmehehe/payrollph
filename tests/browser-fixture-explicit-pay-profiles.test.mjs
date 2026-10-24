import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/** Fixtures are explicitly seeded. Never reintroduce a request-time pay-profile backfill. */
test("three authenticated browser fixtures create tenant-bound monthly pay profiles", () => {
  for (const path of [
    "scripts/employee-import-synthetic-fixture.ts",
    "scripts/core-modules-synthetic-fixture.ts",
    "scripts/ess-profile-synthetic-fixture.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /db\.insert\(employeePayProfiles\)\.values\(\{/,
      path + ": a real employee must have an explicit pay profile");
    assert.match(source, /employeeId: (?:employee|workerB)\.id/,
      path + ": the seeded profile must reference the created employee");
    assert.match(source, /organizationId: (?:tenant|tenantB)\.id/,
      path + ": profile must match the employee's employer");
    assert.match(source, /payBasis: "monthly"/);
    assert.match(source, /rateAmount: "30000\.00"/);
    assert.match(source, /standardWorkDaysPerMonth: "22"/);
    assert.match(source, /standardHoursPerDay: "8"/);
  }
});

test("second-pass tenant HTTP and DL-02 synthetic employees get explicit employer-bound pay profiles", () => {
  for (const path of [
    "scripts/qa/tenant-second-pass-http.mjs",
    "scripts/qa/tenant-dl02-http.mjs",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /db\.insert\(employeePayProfiles\)\.values\(/, path);
    assert.match(source, /organizationId: (?:victim|org|orgs\[index \+ 1\])\.id/, path);
    assert.match(source, /employeeId: employee\.id/, path);
    assert.match(source, /payBasis: "monthly"/, path);
    assert.match(source, /standardWorkDaysPerMonth: "22"/, path);
    assert.match(source, /standardHoursPerDay: "8"/, path);
  }
});

test("non-production dev demo seed creates profiles only for verified first-run fictional workers", () => {
  const source = readFileSync("src/db/seed.ts", "utf8");
  assert.match(source, /export const DEMO_MODE = process\.env\.NODE_ENV !== "production"/);
  assert.match(source, /if \(!DEMO_MODE\) \{/);
  const firstSeed = source.indexOf("  const orgValues = [");
  const nextPhase = source.indexOf("  await ensureDemoLegalEmployerLinks();", firstSeed);
  assert.ok(firstSeed > 0 && nextPhase > firstSeed);
  const initialOnly = source.slice(firstSeed, nextPhase);
  assert.match(initialOnly, /const seededEmployees = await db\.insert\(employees\)/);
  assert.match(initialOnly, /DEV_DEMO_PAY_PROFILE_ROSTER_UNVERIFIED/);
  assert.match(initialOnly, /worker\.organizationId !== org\.id/);
  assert.match(initialOnly, /worker\.basicRate !== person\[6\]/);
  assert.match(initialOnly, /await db\.insert\(employeePayProfiles\)\.values\(verifiedProfiles\)/);
  assert.match(initialOnly, /payBasis: "monthly"/);
  assert.match(initialOnly, /standardWorkDaysPerMonth: "22"/);
  assert.match(initialOnly, /standardHoursPerDay: "8"/);
});

test("tenant isolation secondary worker fixtures seed pay profiles before positive dashboard reads", () => {
  const main = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
  const bank = readFileSync("scripts/qa/bank-tenant-http.mjs", "utf8");
  assert.match(main, /await seedSecondPassCoworkerProfile\(attacker\.id, coworker\.id\)/);
  assert.match(main, /SECOND_PASS_COWORKER_PAY_PROFILE_ROSTER_UNVERIFIED/);
  assert.match(main, /db\.insert\(employeePayProfiles\)\.values\(\{/);
  assert.match(bank, /await seedBankFixturePayProfile\(org, worker\)/);
  assert.match(bank, /BANK_TENANT_PAY_PROFILE_FIXTURE_NON_DISPOSABLE_OR_UNVERIFIED/);
  assert.match(bank, /db\.insert\(employeePayProfiles\)\.values\(\{/);
});

test("multi-entity browser fixture verifies exactly twelve tenant-bound fictional pay profiles before UI testing", () => {
  const fixture = readFileSync("scripts/multi-entity-synthetic-fixture.ts", "utf8");
  assert.match(fixture, /process\.env\.MULTI_ENTITY_QA_MODE, "synthetic-postgres-only"/);
  assert.match(fixture, /const baseEmployees = await db\.insert\(employees\)\.values\(\[/);
  assert.match(fixture, /const bVictimEmployees = await db\.insert\(employees\)\.values\(Array\.from\(\{ length: 8 \}/);
  assert.match(fixture, /assert\.deepEqual\(\[tenantA\.id, tenantB\.id, tenantC\.id\], \[1, 2, 3\]/);
  assert.match(fixture, /employeeNo: "A-01", organizationId: tenantA\.id, rateAmount: "20000\.00"/);
  assert.match(fixture, /employeeNo: "A-02", organizationId: tenantA\.id, rateAmount: "24000\.00"/);
  assert.match(fixture, /employeeNo: "B-01", organizationId: tenantB\.id, rateAmount: "28000\.00"/);
  assert.match(fixture, /employeeNo: "C-01", organizationId: tenantC\.id, rateAmount: "30000\.00"/);
  assert.match(fixture, /employeeNo: "B-VICTIM-" \+ index, organizationId: tenantB\.id/);
  assert.match(fixture, /const byEmployeeNo = new Map\(syntheticWorkers\.map/);
  assert.match(fixture, /worker\.organizationId, expected\.organizationId/);
  assert.match(fixture, /worker\.basicRate, expected\.rateAmount/);
  assert.match(fixture, /db\.insert\(employeePayProfiles\)\.values\(syntheticWorkers\.map/);
  assert.match(fixture, /payBasis: "monthly"/);
  assert.match(fixture, /standardWorkDaysPerMonth: "22"/);
  assert.match(fixture, /standardHoursPerDay: "8"/);
});

test("approved-exit PostgreSQL HTTP fixture seeds only verified tenant-bound payroll profiles before real separation", () => {
  const source = readFileSync("scripts/qa/payroll-approved-exit-http.mjs", "utf8");
  assert.match(source, /assert\.equal\(process\.env\.CI, "true"\)/);
  assert.match(source, /assert\.equal\(process\.env\.GITHUB_ACTIONS, "true"\)/);
  assert.match(source, /assert\.equal\(database\.hostname, "127\.0\.0\.1"\)/);
  assert.match(source, /assert\.equal\(database\.pathname, "\/app_db"\)/);
  assert.match(source, /assert\.equal\(worker\.organizationId, own\.id, "EXIT_HTTP_PROFILE_CROSS_TENANT_REFUSED"\)/);
  assert.match(source, /EXIT_HTTP_PROFILE_ROSTER_UNVERIFIED/);
  assert.match(source, /assert\.equal\(worker\.basicRate, "22000\.00", "EXIT_HTTP_PROFILE_RATE_DRIFT_REFUSED"\)/);
  assert.match(source, /db\.insert\(employeePayProfiles\)\.values\(\{/);
  assert.match(source, /employeeId: worker\.id, organizationId: own\.id, payBasis: "monthly"/);
  assert.match(source, /rateAmount: "22000\.00", standardWorkDaysPerMonth: "22", standardHoursPerDay: "8"/);
  const created = source.indexOf("const [worker] = await db.insert(employees)");
  const invocation = source.indexOf("await seedApprovedExitFixtureProfile(own, worker, suffix);", created);
  const post = source.indexOf('const ownCreate = expectStatus(await request("/api/separation", maker, "POST"', invocation);
  const helper = source.indexOf("async function seedApprovedExitFixtureProfile(own, worker, suffix)");
  const profile = source.indexOf("await db.insert(employeePayProfiles).values({", helper);
  assert.ok(created >= 0 && invocation > created && post > invocation && helper > post && profile > helper,
    "Verified synthetic pay profile must be seeded before HTTP separation without moving security proof lines");
  // Source-line-pinned isolation inventory must keep its real HTTP positive/denial evidence.
  const lines = source.split("\n");
  assert.match(lines[64], /const ownCreate = expectStatus\(await request\("\/api\/separation"/);
  assert.match(lines[70], /const ownRead = expectStatus\(await request\("\/api\/separation\?/);
  assert.match(lines[73], /Foreign GET denied/);
  assert.match(lines[74], /Foreign POST denied/);
  assert.match(lines[75], /Foreign PATCH denied/);
  assert.match(lines[77], /assert\.deepEqual\(afterForeign, beforeForeign/);
  assert.match(lines[81], /Foreign payroll creation denied/);
  assert.match(lines[83], /assert\.deepEqual\(payrollAfterForeign, payrollBeforeForeign/);
  assert.match(lines[86], /Actual payroll API creates a draft/);
  assert.match(lines[96], /Distinct checker approves owned package/);
  assert.match(source, /const selfDenied = expectStatus/);
  assert.match(source, /Foreign POST denied/);
});

test("multi-entity browser fixture creates explicit tenant-bound profiles for all 12 fictional workers", () => {
  const source = readFileSync("scripts/multi-entity-synthetic-fixture.ts", "utf8");
  assert.match(source, /assert\.equal\(process\.env\.MULTI_ENTITY_QA_MODE, "synthetic-postgres-only"\)/);
  assert.match(source, /const baseEmployees = await db\.insert\(employees\)\.values\(\[/);
  assert.match(source, /const bVictimEmployees = await db\.insert\(employees\)\.values\(Array\.from\(\{ length: 8 \}/);
  assert.match(source, /const syntheticWorkers = \[\.\.\.baseEmployees, \.\.\.bVictimEmployees\]/);
  assert.match(source, /assert\.equal\(syntheticWorkers\.length, 12/);
  assert.match(source, /assert\.deepEqual\(syntheticWorkers\.map\(worker => worker\.organizationId\)/);
  assert.match(source, /await db\.insert\(employeePayProfiles\)\.values\(syntheticWorkers\.map\(worker => \(\{/);
  assert.match(source, /organizationId: worker\.organizationId, employeeId: worker\.id/);
  assert.match(source, /payBasis: "monthly", rateAmount: worker\.basicRate/);
  assert.match(source, /standardWorkDaysPerMonth: "22", standardHoursPerDay: "8"/);
  assert.match(source, /assert\.equal\(profiles\.length, syntheticWorkers\.length/);
  assert.match(source, /assert\.equal\(profile\.organizationId, worker\.organizationId/);
  assert.match(source, /assert\.equal\(profile\.rateAmount, worker\.basicRate/);
});

test("HRIS integrated browser's three-person roster seeds reviewed fictional pay profiles explicitly", () => {
  const fixture = readFileSync("scripts/hcm-people-home-synthetic-fixture.ts", "utf8");
  const workflow = readFileSync(".github/workflows/hris-journey-browser-qa.yml", "utf8");
  assert.match(workflow, /Seed disposable HCM baseline/);
  assert.match(workflow, /npx tsx scripts\/hcm-people-home-synthetic-fixture\.ts/);
  assert.match(fixture, /process\.env\.CI, "true"/);
  assert.match(fixture, /HCM_PEOPLE_HOME_ACCEPTANCE_MODE, "synthetic-postgres-only"/);
  assert.match(fixture, /dbUrl\.pathname === "\/app_db"/);
  assert.match(fixture, /db\.insert\(employeePayProfiles\)\.values\(explicitProfiles\)/);
  assert.match(fixture, /seededRoster\.length, expectedRoster\.size/);
  assert.match(fixture, /HCM_QA_PAY_PROFILE_ROSTER_UNVERIFIED/);
  assert.match(fixture, /payBasis: "monthly"/);
  assert.match(fixture, /standardWorkDaysPerMonth: "22"/);
  assert.match(fixture, /standardHoursPerDay: "8"/);
  assert.match(fixture, /"SHARED-001:" \+ alpha\.id, "10000\.00"/);
  assert.match(fixture, /"SHARED-001:" \+ beta\.id, "99000\.00"/);
  assert.match(fixture, /"BETA-002:" \+ beta\.id, "88000\.00"/);
  assert.doesNotMatch(fixture, /ON CONFLICT|db\.update\(employeePayProfiles\)/);
});
