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
  assert.match(harness, /await \(await import\("\.\/tenant-high-risk-01-http\.mjs"\)\)\.verifyHighRiskBatchOne\(f, \{ request, expectStatus, makeSession \}\);/);
  assert.match(harness, /await verifyCrossTenant\(f\);[\s\S]*await \(await import\("\.\/tenant-high-risk-01-http\.mjs"\)\)\.verifyHighRiskBatchOne\(f, \{ request, expectStatus, makeSession \}\);/);
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
  assert.match(source, /employeeAccounts\.map\(\(account\) => makeSession\(account\.id\)\)/);
  assert.match(source, /await db\.update\(userOrganizations\)\.set\(\{ active: false \}\)/);
  assert.match(source, /assert\.equal\(revoked\[0\]\?\.active, false\)/);
  assert.match(source, /assert\.equal\(destination\[0\]\?\.active, true\)/);
  assert.match(source, /expectStatus\(await request\("\/api\/account", \{ cookie: employeeCookie \}\), 200/);
  assert.match(source, /expectStatus\(await request\(endpoint, \{ cookie: employeeCookie \}\), 403/);
  assert.match(source, /"GET self\/payslips\/\[id\]\/explain"/);
  assert.match(source, /"GET self\/documents"/);
});

test("12 net-new Batch 01 high-risk GET receipts preserve current-main tenant proofs", () => {
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const cases = [...source.matchAll(/^\s+"(GET [^"]+)",$/gm)].map((m) => m[1]);
  assert.equal(cases.length, 16, "Never silently narrow the tested Batch 01 method set");
  assert.equal(new Set(cases).size, 16);
  const pendingReview = [];
  for (const spec of cases) {
    const route = spec.slice("GET ".length);
    const method = manifest.allApiRouteFiles["src/app/api/" + route + "/route.ts"]?.methods.find((m) => m.name === "GET");
    assert.equal(method?.status, "COVERED", spec + " must have actual executed own/victim evidence");
    if (method.testedBy.file !== "scripts/qa/tenant-high-risk-01-http.mjs") continue;
    pendingReview.push(spec);
    const proof = method.testedBy;
    const lines = source.split("\n");
    const signature = lines[proof.line - 1];
    assert.ok(signature && (signature.includes('key: "' + spec + '"') ||
      signature.includes('await caseCheck("' + spec + '"')),
      spec + ": must link a unique route-specific case, not a generic handler");
    assert.match(lines[proof.ownPositiveLine - 1] ?? "", /expectStatus\(await request\(/);
    assert.match(lines[proof.foreignDenialLine - 1] ?? "", /expectStatus\(await request\(/);
    assert.match(lines[proof.unchangedDbLine - 1] ?? "", /assert\.deepEqual\(victimAfter, victimBefore/);
    assert.match(method.reason, /^Provisional:/);
    assert.match(proof.scope, /independent|Two independent/);
  }
  assert.equal(pendingReview.length, 12, "The thirteenth GET has newer independent current-main proof; never double-credit it");
  const payExplain = manifest.allApiRouteFiles["src/app/api/self/payslips/[id]/explain/route.ts"]
    ?.methods.find((m) => m.name === "GET");
  assert.equal(payExplain?.status, "COVERED");
  assert.equal(payExplain?.testedBy?.file, "scripts/qa/tenant-second-pass-http.mjs",
    "Keep the newer source-matched own/foreign real-HTTP pay-explanation proof");
  // Preserve all 88 previously accepted main-branch method receipts. Newly
  // credited routes may only add to this historical count when their specific
  // isolated two-attacker HTTP suite is wired into the real PG16 harness.
  // Never "fix" this gate by substituting a new total without proof.
  const additionalSuites = [
    {
      file: "scripts/qa/compliance-read-sweep-http.mjs",
      entrypoint: "verifyComplianceReadSweep",
      methods: [
        "GET bir/annual-employer/module-evidence",
        "POST bir/annual-employer/module-evidence",
        "GET compliance/dole-13th-month",
        "POST compliance/dole-13th-month",
        "GET compliance/government-loan-remittances",
        "POST compliance/government-loan-remittances",
        "GET compliance/statutory-remittances/payment-evidence",
        "POST compliance/statutory-remittances/payment-evidence",
      ],
    },
    {
      file: "scripts/qa/hcm-probation-sweep-http.mjs",
      entrypoint: "verifyHcmProbationSweep",
      methods: [
        "GET hcm/probation-reviews",
        "POST hcm/probation-reviews",
        "PATCH hcm/probation-reviews",
      ],
    },
  ];
  const methodsByKey = new Map(Object.values(manifest.allApiRouteFiles).flatMap((route) =>
    route.methods.map((method) => [method.name + " " + route.route, method])));
  let additionalSourcePinnedMethods = 0;
  for (const suite of additionalSuites) {
    const statuses = suite.methods.map((key) => {
      const method = methodsByKey.get(key);
      assert.ok(method, key + ": reviewed route and method must still exist");
      assert.ok(method.status === "GAP" ||
        (method.status === "COVERED" && method.testedBy?.file === suite.file),
        key + ": a historical GAP can only close with its reviewed own/victim HTTP evidence");
      if (method.status === "GAP") assert.equal(method.testedBy, null);
      return method.status;
    });
    const added = statuses.filter((status) => status === "COVERED").length;
    assert.ok(added === 0 || added === suite.methods.length,
      suite.file + ": an incomplete/partial proof suite cannot silently receive credit");
    if (!added) continue;
    const runner = readFileSync(suite.file, "utf8");
    assert.ok(harness.includes(suite.entrypoint + "(f, { request, expectStatus })"),
      suite.file + ": actual disposable HTTP/PG16 harness must execute the suite");
    assert.match(runner, /process\.env\.TENANT_SECOND_PASS_MODE/);
    assert.match(runner, /for \(const idx of \[1, 2\]\)/);
    const proofLines = runner.split("\n");
    for (const key of suite.methods) {
      const method = methodsByKey.get(key);
      assert.equal(method.testedBy.file, suite.file);
      const { ownPositiveLine, foreignDenialLine, unchangedDbLine } = method.testedBy;
      assert.match(proofLines[ownPositiveLine - 1] ?? "",
        /expectStatus\(await request(?:Multipart)?\(/,
        key + ": source-pinned authenticated own-employer HTTP success is required");
      assert.match(proofLines[foreignDenialLine - 1] ?? "", /403\s*,/,
        key + ": source-pinned real victim-employer HTTP denial is required");
      if (!key.startsWith("GET ")) {
        assert.match(proofLines[unchangedDbLine - 1] ?? "", /assert\.deepEqual\(/,
          key + ": denied writes must leave victim PostgreSQL rows unchanged");
      }
    }
    additionalSourcePinnedMethods += added;
  }
  assert.equal(manifest.metrics.coveredAfter - additionalSourcePinnedMethods, 91,
    "All 91 historical covered methods must remain, excluding only source-pinned additions");
  assert.equal(manifest.metrics.gap + additionalSourcePinnedMethods, 394,
    "Historical GAP count cannot shrink without a full linked real-HTTP proof suite");
  assert.match(harness, /await \(await import\("\.\/tenant-high-risk-01-http\.mjs"\)\)\.verifyHighRiskBatchOne\(f, \{ request, expectStatus, makeSession \}\)/);
  assert.match(source, /for \(const idx of \[1, 2\]\)/);
  assert.match(source, /assert\.equal\(passed\.size, 36/);
  assert.match(source, /assert\.deepEqual\(victimAfter, victimBefore/);
});
