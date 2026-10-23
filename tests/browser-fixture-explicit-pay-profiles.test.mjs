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

test("multi-entity browser fixture creates verified tenant-bound pay profiles before UI testing", () => {
  const fixture = readFileSync("scripts/multi-entity-synthetic-fixture.ts", "utf8");
  assert.match(fixture, /process\.env\.MULTI_ENTITY_QA_MODE, "synthetic-postgres-only"/);
  assert.match(fixture, /const seededEmployees = await db\.insert\(employees\)\.values\(\[/);
  assert.match(fixture, /assert\.deepEqual\(\[tenantA\.id, tenantB\.id\], \[1, 2\]/);
  assert.match(fixture, /employeeNo: "A-01", organizationId: tenantA\.id, rateAmount: "20000\.00"/);
  assert.match(fixture, /employeeNo: "A-02", organizationId: tenantA\.id, rateAmount: "24000\.00"/);
  assert.match(fixture, /employeeNo: "B-01", organizationId: tenantB\.id, rateAmount: "28000\.00"/);
  assert.match(fixture, /worker\.organizationId, expected\.organizationId/);
  assert.match(fixture, /worker\.basicRate, expected\.rateAmount/);
  assert.match(fixture, /db\.insert\(employeePayProfiles\)\.values\(profiles\)/);
  assert.match(fixture, /payBasis: "monthly"/);
  assert.match(fixture, /standardWorkDaysPerMonth: "22"/);
  assert.match(fixture, /standardHoursPerDay: "8"/);
});
