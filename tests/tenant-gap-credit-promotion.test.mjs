import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertLiveTenantCounts } from "./helpers/tenant-counts.mjs";
import { verifyPromotionCredits } from "../scripts/qa/tenant-gap-promotion-verify.mjs";
import { verifyMoreCredits } from "../scripts/qa/tenant-more-credit-verify.mjs";

// Reconciliation-only source pins: the executable PG16/HTTP runs live in their
// respective proof workflows. These source tests are NOT runtime evidence.
const manifest = JSON.parse(readFileSync(
  "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const reservations = JSON.parse(readFileSync(
  "scripts/qa/tenant-gap-reservations.json", "utf8"));
const base = "a7dc1f5184f59f3c5ac348e37b4ca88810f10651";
const targets = [
  ["GET self/availability", 1455, 40444843870],
  ["POST self/availability", 1455, 40444843870],
  ["POST leave/preview", 1488, 40515729369],
  ["GET workforce/roster-batches", 1473, 40500780327],
  ["GET auth/me", 1475, 40503386113],
  ["GET account", 1475, 40503386113],
  ["GET self/workforce", 1478, 40497504543],
  ["POST self/workforce", 1478, 40497504543],
  ["POST loans/schedule-preview", 1482, 40510286524],
  ["GET v1/journal-entries", 1484, 40514472303],
  ["GET self/identifiers", 1486, 40527544388],
  ["POST self/identifiers", 1486, 40527544388],
  ["POST attendance/offline-claims", 1494, 40529565588],
  ["PATCH attendance/offline-claims", 1494, 40529565588],
  ["POST payroll-overpayment-preview", 1495, 40538867815],
  ["GET self/take-home-estimate", 1503, 40540826027],
];
const methods = new Map(Object.values(manifest.allApiRouteFiles).flatMap(route =>
  route.methods.map(method => [method.name + " " + route.route, method])));

test("credit sweep only updates 16 distinct verified GAP methods with four source pins", () => {
  assert.equal(targets.length, 16);
  assert.equal(new Set(targets.map(([key]) => key)).size, targets.length);
  assertLiveTenantCounts(assert, manifest);
  assert.equal(verifyPromotionCredits(manifest), targets.length);
  const credited = [...methods].filter(([, method]) =>
    method.testedBy?.verifiedMainCommit === base);
  assert.equal(credited.length, targets.length, "no unrelated GAP method gets this credit");
  for (const [key, pr, run] of targets) {
    const method = methods.get(key);
    assert.equal(method?.status, "COVERED", key);
    const evidence = method.testedBy;
    assert.ok(evidence, key + " must contain distinct executed evidence");
    assert.equal(evidence.prNumber, pr, key);
    assert.equal(evidence.workflowRunId, run, key);
    assert.equal(evidence.postgresMajor, 16);
    assert.equal(evidence.verifiedMainCommit, base);
    assert.equal(evidence.line, evidence.ownPositiveLine);
    assert.match(evidence.evidence,
      new RegExp("/actions/runs/" + run + "(?:\\D|$)"));
    const source = readFileSync(evidence.file, "utf8").split("\n");
    for (const pin of ["ownPositiveLine", "foreignDenialLine",
      "unchangedDbLine", "forgedSelectorLine"]) {
      const line = evidence[pin];
      assert.ok(Number.isSafeInteger(line) && line > 0 && line <= source.length,
        key + " invalid source anchor " + pin);
      assert.ok(source[line - 1].trim().length > 0,
        key + " source line is blank " + pin);
    }
  }
});

test("already credited and partial-action methods are not double-counted", () => {
  const already = [
    "GET holidays", "POST holidays", "PATCH holidays", "DELETE holidays",
    "GET self/documents", "GET assets", "POST assets", "PATCH assets",
    "DELETE assets",
  ];
  for (const key of already) {
    assert.equal(methods.get(key)?.status, "COVERED", key);
    assert.notEqual(methods.get(key)?.testedBy?.verifiedMainCommit, base,
      "preexisting method must retain original owner: " + key);
  }
  const excluded = [
    "POST workforce/roster-batches", "PATCH loans", "POST hcm/capabilities",
    "PATCH recruitment/privacy", "PATCH performance/follow-through-governance",
    "PATCH careers/admin", "POST workforce-planning/allocations",
    "GET year-end", "GET workforce/demand-staffing/policies",
    "GET hcm/employment-term-decisions/[id]/manager-attestation",
    "POST invitations", "PATCH compliance/filing-validations/[id]",
    "POST benefits/hmo", "POST web-bundy/consent",
  ];
  for (const key of excluded) {
    assert.equal(methods.get(key)?.status, "GAP", key);
    assert.equal(methods.get(key)?.testedBy, null,
      "do not borrow partial or still-open proof evidence: " + key);
  }
  // The issued-demand GET was proven and credited by a separate merged
  // PG16/localhost workflow, not by the original 16-method sweep.
  // Independently verify all four newer source/receipt pins and that their
  // method identities are disjoint from this older promotion catalogue.
  const newCredits = [
    "GET self/schedule-receipts", "POST self/schedule-receipts",
    "PATCH self/profile", "GET workforce/demand-observations/issued",
  ];
  assert.equal(verifyMoreCredits(manifest), newCredits.length);
  assert.ok(newCredits.every(key => !targets.some(([target]) => target === key)),
    "the existing 16 promotion credits cannot be double-counted");
  for (const key of newCredits) {
    assert.equal(methods.get(key)?.status, "COVERED", key);
    assert.equal(methods.get(key)?.testedBy?.verifiedMainCommit,
      "fe3ad8901bfa714d59639d9f59a13cf133eeab36", key);
    assert.notEqual(methods.get(key)?.testedBy?.verifiedMainCommit, base,
      "historical promotion receipt must remain owned by its original batch");
  }
  assert.ok(!reservations.entries.some(entry =>
    entry.pr === 1455 || entry.methods.some(key => [
      "GET self/availability", "POST self/availability"].includes(key))),
    "stale #1455 reservation must be removed after credit");
});

test("closure plan reconciles all twelve frozen batches, without claiming acceptance", () => {
  const doc = readFileSync("docs/engineering/tenant-isolation-closure-plan.md", "utf8");
  assert.match(doc, /334 COVERED \/ 10 PUBLIC-BY-DESIGN \/ 154 GAP/);
  assert.match(doc, /tenant-isolation acceptance/i);
  const expected = new Map([
    ["DL-01", [26,19,2,5]], ["DL-02", [26,22,0,4]],
    ["MNY-01", [33,20,0,13]], ["MNY-02", [33,21,0,12]],
    ["STA-01", [27,21,0,6]], ["PII-01", [39,31,0,8]],
    ["PII-02", [38,24,0,14]], ["WRK-01", [39,20,0,19]],
    ["WRK-02", [39,23,0,16]], ["WRK-03", [40,29,0,11]],
    ["EDG-01", [33,3,0,30]], ["EDG-02", [33,17,0,16]],
  ]);
  const lines = doc.split("\n").filter(line => /^\| [1-6] \| \*\*/.test(line));
  assert.equal(lines.length, 12);
  for (const line of lines) {
    const m = line.match(/^\| [1-6] \| \*\*([A-Z]+-\d+)\*\* \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| INCOMPLETE \|$/);
    assert.ok(m, "unparseable batch row: " + line);
    assert.deepEqual(m.slice(2).map(Number), expected.get(m[1]), m[1]);
  }
});
