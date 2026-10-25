// Source contract only. Actual localhost HTTP/PG16 must separately pass CI.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const suite = readFileSync("scripts/qa/tenant-worksites-http.mjs", "utf8");
const runner = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const route = readFileSync("src/app/api/workforce/worksites/route.ts", "utf8");

test("guarded disposable second-pass runner must await the worksite batch", () => {
  assert.match(runner, /await \(await import\("\.\/tenant-worksites-http\.mjs"\)\)\.verifyWorksiteIsolation\(f, \{ request, expectStatus, makeSession \}\)/);
  for (const literal of ['process.env.CI, "true"', 'process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only"',
    '"http://127.0.0.1:3000/"', 'pg.pathname, "/app_db"', 'pg.port, "5432"',
    'process.env.REQUIRE_PRIVILEGED_MFA, "false"', '"PAYMONGO_SECRET_KEY"', '"XENDIT_SECRET_KEY"']) {
    assert.ok(suite.includes(literal), literal);
  }
  assert.match(suite, /requireIsolated\(\);/);
});

test("two independent attackers require populated reads and persisted own action success", () => {
  for (const method of ["GET", "POST"]) assert.ok(route.includes("export async function " + method + "("));
  assert.match(suite, /for \(const idx of \[1, 2\]\)/);
  for (const label of ["GET populated owned worksite", "GET foreign employer denied",
    "POST create owned worksite", "POST update owned site", "POST assign owned employee to owned worksite",
    "POST create foreign employer denied", "POST create foreign organization unit denied",
    "POST update foreign site within own employer denied", "POST update foreign employer denied",
    "POST assign foreign employee denied", "POST assign foreign worksite denied", "POST assign foreign employer denied"]) {
    assert.ok(suite.includes(label), label);
  }
  assert.match(suite, /foreignSite.id > 6 && ownSites.every/);
  assert.match(suite, /victimAssignments.at\(-1\).id > 6 && priorAssignments.every/);
  assert.match(suite, /persisted.orgUnitId, f.ownedUnits\[idx\].id/);
  assert.match(suite, /updated.name, updateBody.name/);
  assert.match(suite, /assignment.worksiteId, newSite.id/);
  assert.match(suite, /closedPrior.effectiveUntil, "2027-01-31"/);
  assert.match(suite, /row.metadata\?\.employeeWorksiteAssignmentId === assignment.id/);
});

test("negative actions require victim workforce, employee, payroll and audit immutability", () => {
  for (const table of ["worksites", "employeeWorksiteAssignments", "hcmWorkArrangements",
    "hcmWorksiteAuthorizations", "employees", "payrollRuns", "auditEvents"]) {
    assert.ok(suite.includes("db.select().from(" + table + ").where(eq(" + table + ".organizationId, id))"));
  }
  assert.match(suite, /assert.deepEqual\(await snapshot\(victim.id\), before, label/);
  assert.match(suite, /response.text.includes\(secret\)/);
  assert.match(suite, /response.headers/);
  assert.match(suite, /forged.json.worksites.every\(row => row.organizationId === org.id\)/);
});

test("role, unit scope, MFA and active membership remain independently required", () => {
  for (const label of ["Unit-scoped manager cannot create company master data",
    "Unit-scoped manager cannot update company master data", "Owned worksite mutation still requires MFA",
    "Employee role GET denied", "Employee role POST denied", "Same revoked session remains signed in",
    "Revoked membership GET denied", "Revoked membership action denied: ",
    "Anonymous worksite GET denied", "Anonymous worksite POST denied"]) assert.ok(suite.includes(label), label);
  assert.match(suite, /mfaDenied.json.code, "MFA_REQUIRED"/);
  assert.match(suite, /for \(const body of \[createBody, updateBody, assignBody\]\)/);
  assert.match(suite, /assert.deepEqual\(await snapshot\(org.id\), ownedBefore/);
});

test("fixture unique keys cannot collide and unexecuted partial actions cannot inflate coverage", () => {
  assert.match(suite, /assert.notEqual\(createBody.code, site.code/);
  const prior = suite.match(/const PRIOR_START = "([\d-]+)";/)?.[1];
  const next = suite.match(/const NEXT_START = "([\d-]+)";/)?.[1];
  assert.ok(prior && next && next > prior);
  for (const method of manifest.allApiRouteFiles["src/app/api/workforce/worksites/route.ts"].methods) {
    // GET may close only through the separate seeded table proof, never through this candidate suite.
    if (method.name === "GET" && method.status === "COVERED") {
      assert.equal(method.testedBy?.file, "scripts/qa/tenant-table-http.mjs");
      continue;
    }
    assert.equal(method.status, "GAP");
  }
  assert.match(suite, /inventoryCreditsAdded: 0/);
  assert.match(suite, /remainingWorksiteActionsUnaccepted: true/);
});

test("create fixture uses canonical uppercase worksite code and verifies exact persistence", () => {
  assert.match(route, /function cleanCode[\s\S]*?\.toUpperCase\(\)/);
  assert.match(suite, /code: \("NEW-" \+ nonce \+ "-" \+ idx\)\.toUpperCase\(\)/);
  assert.match(suite, /assert.equal\(persisted.code, createBody.code\)/);
});
