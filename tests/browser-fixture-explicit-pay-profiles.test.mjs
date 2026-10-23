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
