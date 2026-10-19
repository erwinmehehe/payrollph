/**
 * Static proof-integrity gate for the first high-risk tenant audit batch.
 * Does not claim HTTP coverage; live results must pass the original Security
 * HTTP Smoke workflow using disposable PG16 and localhost production server.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync("scripts/qa/tenant-high-risk-01-http.mjs", "utf8");
const harness = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
const names = [...source.matchAll(/^\s+"(GET [^"]+)",$/gm)].map((m) => m[1]);

test("high-risk batch has 16 unique exported GET methods with actual route files", () => {
  assert.equal(names.length, 16, "Exactly 16 explicitly selected high-risk methods");
  assert.equal(new Set(names).size, 16, "No duplicated credit for a single handler");
  for (const spec of names) {
    const [method, route] = spec.split(" ");
    assert.equal(method, "GET");
    const path = "src/app/api/" + route + "/route.ts";
    const routeSource = readFileSync(path, "utf8");
    assert.match(routeSource, /export\s+async\s+function\s+GET\s*\(/,
      spec + " must exist as actual production HTTP method");
  }
});

test("live batch is executed from existing disposable two-attacker PG/HTTP harness", () => {
  assert.match(harness, /import \{ verifyHighRiskBatchOne \} from "\.\/tenant-high-risk-01-http\.mjs";/);
  assert.match(harness, /await verifyCrossTenant\(f\);[\s\S]*await verifyHighRiskBatchOne\(f, \{ request, expectStatus, makeSession \}\);/);
  assert.match(harness, /function requireDisposable\(\)/);
  assert.match(harness, /app\.hostname !== "127\.0\.0\.1"/);
  assert.match(source, /process\.env\.TENANT_SECOND_PASS_MODE, "isolated-ci-only"/);
  assert.match(source, /await request\(item\.own, \{ cookie: ownerCookie \}\)/);
  assert.match(source, /await request\(item\.foreign, \{ cookie: ownerCookie \}\)/);
  assert.match(source, /expectStatus\(await request\(item\.foreign, \{ cookie: ownerCookie \}\), 403/);
});

test("every method requires real seeded owner-positive, real victim denial and no victim DB mutation", () => {
  assert.match(source, /const ownEntry = \(await db\.select\(\)\.from\(payrollEntries\)/);
  assert.match(source, /victimEntry\?\.id > 6/);
  assert.match(source, /const owned = expectStatus\(await request\(item\.own, \{ cookie: ownerCookie \}\), 200/);
  assert.match(source, /assertNoVictimBytes\(foreign, victimMarker\)/);
  assert.match(source, /await takeVictimSnapshot\(victim\.id\)/);
  assert.match(source, /assert\.deepEqual\(victimAfter, victimBefore/);
  assert.match(source, /throw new AggregateError/);
  assert.match(source, /assert\.equal\(passed\.size, 36/);
  assert.match(source, /assert\.deepEqual\(ownPositive, \[16, 16\]\)/);
  assert.match(source, /assert\.deepEqual\(deniedForeign, \[17, 17\]\)/);
});

test("self-service routes use real employee sessions and revoke real memberships", () => {
  assert.match(source, /employeeId: f\.ownedEmployees\[idx - 1\]\.id/);
  assert.match(source, /await makeSession\(account\.id\)/);
  assert.match(source, /await db\.update\(userOrganizations\)\.set\(\{ active: false \}\)/);
  assert.match(source, /assert\.equal\(revoked\[0\]\?\.active, false\)/);
  assert.match(source, /assert\.equal\(destination\[0\]\?\.active, true\)/);
  assert.match(source, /expectStatus\(await request\("\/api\/account", \{ cookie: employeeCookie \}\), 200/);
  assert.match(source, /expectStatus\(await request\(endpoint, \{ cookie: employeeCookie \}\), 403/);
  assert.match(source, /"GET self\/payslips\/\[id\]\/explain"/);
  assert.match(source, /"GET self\/documents"/);
});
