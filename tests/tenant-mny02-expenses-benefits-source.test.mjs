/**
 * Source review gate for the MNY-02 expenses/de minimis six-method partial proof.
 * This never substitutes for the actual guarded production-mode PG16 HTTP/SQL job.
 * Legacy expenses flag-OFF only; reviewed Spend feature-ON is separately unaccepted.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const proofPath = "scripts/qa/tenant-mny02-expenses-benefits-http.mjs";
const source = readFileSync(proofPath, "utf8");
const lines = source.split("\n");
const runner = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const cases = [
  ["GET expenses", 147, 153, 158],
  ["POST expenses", 57, 162, 169],
  ["PATCH expenses", 181, 192, 181],
  ["GET de-minimis", 199, 205, null],
  ["POST de-minimis", 73, 209, 216],
  ["DELETE de-minimis", 230, 224, 230],
];

test("six distinct money-linked methods run in existing real HTTP/PG16 three-employer harness", () => {
  assert.equal(cases.length, 6);
  assert.equal(new Set(cases.map(([key]) => key)).size, 6);
  assert.match(runner, /verifyMny02ExpensesBenefitsIsolation\(f, \{ request, expectStatus, makeSession \}\)/);
  assert.match(source, /process\.env\.CI, "true"/);
  assert.match(source, /process\.env\.TENANT_SECOND_PASS_MODE, "isolated-ci-only"/);
  assert.match(source, /pg\.pathname, "\/app_db"/);
  assert.match(source, /for \(const idx of \[1, 2\]\)/);
  assert.match(source, /assert\.ok\(victimExpense\.id > 6 && victimGrant\.id > 6/);
  assert.match(source, /assert\.deepEqual\(await victimSnapshot\(victim\.id\), baseline/);
  assert.match(source, /spendPayrollEnabled\(\), false/);
  assert.match(source, /const checker = await makeIndependentChecker/);
  assert.match(source, /assert\.match\(selfReview\.json\?\.error/);
  assert.match(source, /noVictimLeak\(foreign/);
});

test("method-specific source links prove real own positive, foreign denial and exact victim SQL invariant", () => {
  for (const [key, own, foreign, forged] of cases) {
    const [verb, route] = key.split(" ");
    const path = "src/app/api/" + route + "/route.ts";
    const endpoint = readFileSync(path, "utf8");
    assert.match(endpoint, new RegExp("export async function " + verb + "\\("));
    const record = manifest.allApiRouteFiles[path];
    const method = record?.methods?.find(item => item.name === verb);
    assert.equal(method?.status, "COVERED", key + ": no credit without approved executable proof");
    assert.equal(method?.testedBy?.file, proofPath);
    assert.deepEqual([
      method.testedBy.line, method.testedBy.ownPositiveLine,
      method.testedBy.foreignDenialLine, method.testedBy.unchangedDbLine,
      method.testedBy.victimIdOrderingLine,
    ], [own, own, foreign, 242, 133], key + ": proof source lines changed");
    assert.match(lines[own - 1] ?? "", /expectStatus\(await request\(/);
    assert.match(lines[foreign - 1] ?? "", /expectStatus\(await request\(/);
    const ownSpan = lines.slice(own - 1, own + 6).join("\n");
    const foreignSpan = lines.slice(foreign - 1, foreign + 6).join("\n");
    assert.ok(ownSpan.includes("/api/" + route), key + ": own endpoint missing");
    assert.ok(foreignSpan.includes("/api/" + route), key + ": foreign endpoint missing");
    assert.match(ownSpan, new RegExp("\\),\\s*" + (verb === "POST" ? 201 : 200) + ","),
      key + ": a successful nonempty own response is required");
    assert.match(foreignSpan, /\),\s*403,/, key + ": genuine foreign access must be denied");
    assert.equal(method.testedBy.forgedSelectorLine, forged ?? undefined,
      key + ": forged selector pointer must reference the reviewed request");
    if (forged != null && verb === "POST") {
      assert.match(lines[forged - 1] ?? "", /expectStatus\(await request\(/,
        key + ": forged employee proof must be a real second request");
      assert.match(lines.slice(forged - 1, forged + 7).join("\n"), /\)\s*,\s*404\s*,/,
        key + ": forged victim employee must be denied with 404");
    }
    if (["POST", "PATCH", "DELETE"].includes(verb)) {
      assert.ok(ownSpan.includes('method: "' + verb + '"'),
        key + ": owned write must exercise the real HTTP method");
      assert.ok(foreignSpan.includes('method: "' + verb + '"'),
        key + ": foreign denial must exercise the same mutation method");
    }
  }
  assert.deepEqual([
    manifest.metrics.methods, manifest.metrics.coveredAfter,
    manifest.metrics.publicByDesign, manifest.metrics.gap,
  ], [493, 154, 10, 329]);
  assert.match(manifest.acceptanceStatus, /^NOT ACCEPTED: 329 API methods and 19 page\/action GAPs remain\./);
});

test("no provider payment or feature-ON claim is made from a flag-OFF expense test", () => {
  assert.doesNotMatch(source, /submitXenditPayroll|submitPaymongo|releasePayroll|fetch\(["']https:\/\/api\./);
  assert.match(source, /reviewed Spend feature-ON/);
  assert.match(source, /no reimbursement payout/i);
  assert.match(source, /never claim/i);
});
