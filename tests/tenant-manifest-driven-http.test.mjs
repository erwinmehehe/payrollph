/**
 * Method-adapter integrity: any "covered" assertion must be based on a
 * current manifest method (GAP or previously covered regression) plus real own success,
 * exact denied status and identical victim DB snapshot. Actual HTTP is
 * exercised by the production-mode isolated PostgreSQL workflow.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const src = readFileSync("scripts/qa/tenant-manifest-driven-http.mjs", "utf8");
const harness = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
const specs = [...src.matchAll(/^\s+"(GET [^"]+)": \{$/gm)].map((x) => x[1]);

test("single table-driven test reads ALL 493 methods without claiming precovered GET as a new GAP", () => {
  assert.equal(manifest.metrics.methods, 493, "493 actual methods including the three inherited #641 handlers");
  assert.equal(manifest.metrics.gap, 356, "Retain all unverified tenant method GAPs");
  assert.equal(manifest.metrics.coveredAfter, 127, "Maintain exact source-pinned own/foreign method proofs");
  const workforceProof = readFileSync("scripts/qa/workforce-attendance-sweep-http.mjs", "utf8").split("\n");
  for (const [route, methods] of [
    ["src/app/api/workforce/attendance-exception-events/route.ts", ["GET","POST"]],
    ["src/app/api/workforce/attendance-exceptions/route.ts", ["GET"]],
    ["src/app/api/workforce/attendance-locks/route.ts", ["GET","POST"]],
  ]) {
    const sourceMethods = manifest.allApiRouteFiles[route]?.methods ?? [];
    for (const name of methods) {
      const method = sourceMethods.find((value) => value.name === name);
      assert.equal(method?.status, "COVERED", route + " " + name + " requires real independent tenant proof");
      assert.equal(method?.testedBy?.file, "scripts/qa/workforce-attendance-sweep-http.mjs");
      assert.match(workforceProof[method.testedBy.ownPositiveLine - 1], /expectStatus\(await request\(/);
      assert.match(workforceProof[method.testedBy.foreignDenialLine - 1], /expectStatus\(await request\(/);
      assert.match(workforceProof[method.testedBy.foreignDenialLine - 1], /403/);
      if (name === "POST")
        assert.match(workforceProof[method.testedBy.unchangedDbLine - 1], /assert\.deepEqual\(/);
    }
  }
  const governanceMethod = manifest.allApiRouteFiles["src/app/api/hcm/governance-readiness/route.ts"]?.methods.find((method) => method.name === "GET");
  assert.equal(governanceMethod?.status, "COVERED", "HCM governance read requires real own/foreign proof");
  assert.equal(governanceMethod?.testedBy?.file, "scripts/qa/tenant-second-pass-http.mjs");
  const proofLines = harness.split("\n");
  assert.match(proofLines[governanceMethod.testedBy.ownPositiveLine - 1], /\/api\/hcm\/governance-readiness.*\), 200,/);
  assert.match(proofLines[governanceMethod.testedBy.foreignDenialLine - 1], /\/api\/hcm\/governance-readiness.*victim\.id.*\), 403,/);
  assert.match(harness, /await verifyGovernanceTenantRead\(f\)/);
  assert.equal(manifest.metrics.coveredAfter + manifest.metrics.publicByDesign + manifest.metrics.gap, 493,
    "No method may disappear from the audited 493-route-method inventory");
  assert.equal(manifest.sourceTraceCandidates.length, 34);
  assert.equal(manifest.scopedPages.length, 20);
  const registry = new Map(Object.entries(manifest.allApiRouteFiles).flatMap(([path, info]) =>
    info.methods.map((m) => [m.name + " " + info.route, { path, ...m }])));
  assert.equal(specs.length, 7);
  assert.equal(new Set(specs).size, specs.length);
  for (const spec of specs) {
    const method = registry.get(spec);
    assert.ok(method && ["GAP", "COVERED"].includes(method.status),
      spec + " must map to a real manifest method, never an invented case");
  }
  assert.deepEqual(specs.filter((spec) => registry.get(spec).status === "GAP"), ["GET compliance/remittance-actions"]);
  const expectedCovered = [
    "GET compliance/bir-1601c-remittances",
    "GET compliance/government-loan-remittances",
    "GET compliance/statutory-remittances",
    "GET compliance/statutory-remittances/payment-evidence",
    "GET compliance/statutory-remittances/payment-evidence/[id]",
    "GET compliance/statutory-remittances/posting-evidence/[id]",
  ];
  assert.deepEqual(specs.filter((spec) => registry.get(spec).status === "COVERED").sort(),
    expectedCovered.sort(), "Preserve all six independently verified HTTP GET adapters");
  for (const spec of expectedCovered) {
    const proof = registry.get(spec).testedBy;
    assert.ok(proof?.file && proof.ownPositiveLine && proof.foreignDenialLine,
      spec + ": source-pinned independent own and victim evidence is mandatory");
  }
  assert.match(src, /const gaps = methodGaps\(\);/);
  assert.match(src, /for \(const item of candidates\)/);
  assert.match(src, /if \(!adapter\) continue; \/\/ GAP remains open;/);
  assert.match(src, /unadaptedGapMethodsStillOpen: gaps.length - \(FIRST_ADAPTED_METHODS.length - alreadyCoveredCases.length\)/);
});

test("real-HTTP and disposable DB proof requirements cannot be weakened", () => {
  assert.match(harness, /await \(await import\("\.\/tenant-manifest-driven-http\.mjs"\)\)\.verifyManifestDrivenStatutoryBatch\(f, \{ request, expectStatus, makeSession \}\)/);

  assert.match(src, /process\.env\.TENANT_SECOND_PASS_MODE, "isolated-ci-only"/);
  assert.match(src, /const own = expectStatus\(await request\(urls\.own, \{ cookie \}\), 200/);
  assert.match(src, /const foreign = expectStatus\(await request\(urls\.foreign, \{ cookie \}\), adapter\.denial/);
  assert.match(src, /assert\.deepEqual\(after, before,/);
  assert.match(src, /evidence\[7\]\.id > 6/);
  assert.match(src, /tasks\[7\]\.id > 6/);
  assert.match(src, /victimDatabaseUnchanged: true, productionTested: false, certified: false/);
  assert.match(src, /sha256\(bytes\[i\]\)/);
  assert.match(src, /assert\.equal\(account\.json\?\.profile\?\.id, f\.owners\[idx\]\.id\)/);
});

test("workspace readiness 503 containment remains a GAP until a positive tenant-bound read exists", () => {
  const method = manifest.allApiRouteFiles["src/app/api/readiness/workspace/route.ts"]?.methods.find((m) => m.name === "GET");
  assert.equal(method?.status, "GAP", "503 own is not successful readiness evidence");
  assert.equal(method?.testedBy, null, "Foreign denial alone must not certify a method");
  assert.equal(method?.reviewedUncertified?.routeBlobSha, "10121c3378f2e4ee983ab9b9551498a6f8dccdfd");
  assert.equal(method?.reviewedUncertified?.ownStatus, 503);
  assert.match(harness, /verifyWorkspaceReadinessIsolation\(f, \{ request, expectStatus \}\)/);
  const proof = readFileSync("scripts/qa/workspace-readiness-http.mjs", "utf8");
  assert.match(proof, /process\.env\.TENANT_SECOND_PASS_MODE/);
  assert.match(proof, /WORKSPACE_READINESS_UNAVAILABLE/);
  assert.match(proof, /\), 503,/);
  assert.match(proof, /\), 403,/);
});

test("HCM business-process and lifecycle own/foreign proof is source-pinned", () => {
  const suite = readFileSync("scripts/qa/hcm-work-queue-http.mjs", "utf8").split("\n");
  for (const route of ["hcm/business-processes/inbox", "hcm/lifecycle-notifications"]) {
    const entry = manifest.allApiRouteFiles["src/app/api/" + route + "/route.ts"];
    for (const method of entry.methods) {
      assert.equal(method.status, "COVERED", route + " " + method.name);
      assert.equal(method.testedBy?.file, "scripts/qa/hcm-work-queue-http.mjs");
      assert.match(suite[method.testedBy.ownPositiveLine - 1], /expectStatus\(await request\(/);
      assert.match(suite[method.testedBy.foreignDenialLine - 1], /expectStatus\(await request\(/);
      const foreignSpan = suite.slice(method.testedBy.foreignDenialLine - 1,
        method.testedBy.foreignDenialLine + 5).join("\n");
      assert.match(foreignSpan, /\), 403,/,
        "The source-pinned victim-only request must assert HTTP 403");
      if (method.name !== "GET") assert.match(suite[method.testedBy.unchangedDbLine - 1], /assert\.deepEqual\(/);
    }
  }
  assert.match(harness, /verifyHcmWorkQueueIsolation\(f, \{ request, expectStatus \}\)/);
});

test("government-loan GET and POST must retain real own/foreign PG16 proof", () => {
  const entry = manifest.allApiRouteFiles["src/app/api/compliance/government-loan-remittances/route.ts"];
  const suite = readFileSync("scripts/qa/government-loan-read-http.mjs", "utf8").split("\n");
  for (const method of entry.methods) {
    assert.equal(method.status, "COVERED");
    assert.equal(method.testedBy?.file, "scripts/qa/government-loan-read-http.mjs");
    assert.match(suite[method.testedBy.ownPositiveLine - 1], /expectStatus\(await request\(/);
    assert.match(suite[method.testedBy.foreignDenialLine - 1], /expectStatus\(await request\(/);
    const foreignSpan = suite.slice(method.testedBy.foreignDenialLine - 1,
      method.testedBy.foreignDenialLine + 7).join("\n");
    assert.match(foreignSpan, /\), 403,/,
      "The exact source-pinned foreign request must assert HTTP 403");
    if (method.name === "POST") assert.match(suite[method.testedBy.unchangedDbLine - 1], /assert\.deepEqual\(/);
  }
  assert.match(harness, /verifyGovernmentLoanRemittanceIsolation\(f, \{ request, expectStatus \}\)/);
});
