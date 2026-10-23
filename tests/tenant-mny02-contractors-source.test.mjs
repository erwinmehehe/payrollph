/**
 * Source-only review gate for six MNY-02 contractor/EWT API methods.
 * It does NOT replace disposable PG16 authenticated HTTP/SQL evidence.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const path = "scripts/qa/tenant-mny02-contractors-http.mjs";
const suite = readFileSync(path, "utf8");
const lines = suite.split("\n");
const runner = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
const source = readFileSync("src/app/api/contractors/payments/route.ts", "utf8");
const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));

const cases = [
  ["GET contractors", 138, 143, 146],
  ["POST contractors", 54, 152, 152],
  ["PATCH contractors", 167, 160, 167],
  ["DELETE contractors", 186, 180, 186],
  ["GET contractors/payments", 194, 201, 205],
  ["POST contractors/payments", 73, 220, 227],
];

test("exactly six actual methods are wired into guarded three-employer real HTTP QA", () => {
  assert.equal(cases.length, 6);
  assert.equal(new Set(cases.map(row => row[0])).size, 6);
  assert.match(runner,
    /await \(await import\("\.\/tenant-mny02-contractors-http\.mjs"\)\)\.verifyMny02ContractorTenantIsolation\(f, \{ request, expectStatus \}\);/);
  for (const [key] of cases) {
    const [method, route] = key.split(" ");
    const endpoint = readFileSync("src/app/api/" + route + "/route.ts", "utf8");
    assert.match(endpoint, new RegExp("export async function " + method + "\\("));
    assert.ok(suite.includes('"' + key + '"'), key + " must be in the review scope list");
  }
  assert.match(suite, /process\.env\.CI, "true"/);
  assert.match(suite, /process\.env\.TENANT_SECOND_PASS_MODE, "isolated-ci-only"/);
  assert.match(suite, /pg\.pathname, "\/app_db"/);
  assert.match(suite, /for \(const idx of \[1, 2\]\)/);
  assert.match(suite, /victimContract\.id > 6 && victimPayment\.id > 6/);
  assert.match(suite, /await victimSnapshot\(victim\.id\)/);
  assert.match(suite, /assert\.deepEqual\(await victimSnapshot\(victim\.id\), originalVictim/);
  assert.match(suite, /noVictimResponse\(foreign/);
});

test("each method has unique real-positive, foreign-denial, forged-selector and SQL invariant line pins", () => {
  for (const [key, own, foreign, forged] of cases) {
    const [method, route] = key.split(" ");
    const row = manifest.allApiRouteFiles["src/app/api/" + route + "/route.ts"]
      ?.methods.find(item => item.name === method);
    assert.equal(row?.status, "COVERED", key + ": provisional proof must be explicitly recorded");
    assert.equal(row?.testedBy?.file, path);
    assert.deepEqual(
      [row.testedBy.line, row.testedBy.ownPositiveLine,
        row.testedBy.foreignDenialLine, row.testedBy.forgedSelectorLine,
        row.testedBy.unchangedDbLine],
      [own, own, foreign, forged, 271],
      key + ": changed test lines require fresh source review",
    );
    assert.match(lines[own - 1], /expectStatus\(await request\(/);
    assert.match(lines[foreign - 1], /expectStatus\(await request\(/);
    const ownSpan = lines.slice(own - 1, own + 10).join("\n");
    const foreignSpan = lines.slice(foreign - 1, foreign + 10).join("\n");
    assert.ok(ownSpan.includes("/api/" + route));
    assert.ok(foreignSpan.includes("/api/" + route));
    const success = method === "POST" ? 201 : 200;
    assert.match(ownSpan, new RegExp("\\),\\s*" + success + ","));
    assert.match(foreignSpan, /\),\s*403,/);
    if (method !== "GET") {
      assert.ok(ownSpan.includes('method: "' + method + '"'));
      assert.ok(foreignSpan.includes('method: "' + method + '"'));
    }
  }
  // #1348 adds two distinct provisional underpayment HTTP/PG16 proofs on top
  // of the six contractor/EWT proofs. Do not discard either proof set or
  // silently credit unrelated methods when the provisional ledger changes.
  const underpaymentFile = "scripts/qa/underpayment-posting-http.mjs";
  const underpaymentSource = readFileSync(underpaymentFile, "utf8").split("\n");
  const underpaymentMethods = manifest.allApiRouteFiles[
    "src/app/api/payroll-underpayments/route.ts"]?.methods ?? [];
  const creditedUnderpayments = underpaymentMethods.filter(method =>
    method.testedBy?.file === underpaymentFile);
  assert.deepEqual(creditedUnderpayments.map(method => method.name).sort(),
    ["PATCH", "POST"], "Only two separately proven underpayment writes receive credit");
  for (const [methodName, own, foreign] of [["POST", 136, 149], ["PATCH", 166, 155]]) {
    const method = creditedUnderpayments.find(item => item.name === methodName);
    assert.equal(method?.status, "COVERED");
    assert.deepEqual([method.testedBy.line, method.testedBy.ownPositiveLine,
      method.testedBy.foreignDenialLine, method.testedBy.forgedSelectorLine,
      method.testedBy.unchangedDbLine], [own, own, foreign, foreign, 126],
    methodName + ": source-pinned own, foreign and unchanged-victim evidence required");
    assert.match(underpaymentSource[own - 1] ?? "",
      methodName === "POST" ? /status\(await request\(/ : /const winner = replies\.find/);
    assert.match(underpaymentSource[foreign - 1] ?? "", /await deny\(v,/);
    assert.match(underpaymentSource[125] ?? "", /assert\.deepEqual\(await snapshot\(v\), before/);
  }
  assert.deepEqual([manifest.metrics.methods, manifest.metrics.coveredAfter,
    manifest.metrics.publicByDesign, manifest.metrics.gap], [493, 147, 10, 336]);
  assert.deepEqual([manifest.metrics.methods,
    manifest.metrics.coveredAfter - creditedUnderpayments.length,
    manifest.metrics.publicByDesign,
    manifest.metrics.gap + creditedUnderpayments.length], [493, 145, 10, 338],
  "Previous six-contractor MNY-02 baseline must remain accounted for separately");
  assert.match(manifest.acceptanceStatus, /^NOT ACCEPTED: 336 API methods/);
});

test("EWT read rejects real cross-tenant FK without silently dropping it or producing a CSV", () => {
  assert.match(source, /\.leftJoin\(contractors, eq\(contractorPayments\.contractorId, contractors\.id\)\)/);
  assert.match(source, /rows\.some\(\(\{ contractor \}\) => !contractor \|\| contractor\.organizationId !== organizationId\)/);
  assert.match(source, /"Contractor payment attribution requires review\."/);
  assert.match(source, /status: 409/);
  assert.match(source, /const verifiedRows = rows\.map/);
  assert.ok(source.indexOf("Contractor payment attribution requires review.")
    < source.indexOf("const aggregate = new Map"),
    "Reject before aggregating liabilities or serializing the foreign name and TIN");
  assert.match(suite, /const blockedJson = expectStatus\(await request\(/);
  assert.match(suite, /const blockedCsv = expectStatus\(await request\(/);
  assert.match(suite, /await db\.insert\(contractorPayments\)\.values/);
  assert.match(suite, /await db\.delete\(contractorPayments\)\.where/);
  assert.match(suite, /restored\.json\?\.payments/);
});

test("real-money actions are not executed or implied by this QA batch", () => {
  assert.match(suite, /process\.env\.XENDIT_PAYOUTS_ENABLED, "true"/);
  assert.match(suite, /process\.env\.PAYMONGO_DISBURSEMENTS_ENABLED, "true"/);
  assert.doesNotMatch(suite, /submitXenditPayroll|submitPaymongo|releasePayroll|fetch\(["']https:\/\/api\./);
  assert.match(suite, /never claim whole MNY-02/i);
});
