import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertLiveTenantCounts } from "./helpers/tenant-counts.mjs";
import { verifyPromotionCredits } from "../scripts/qa/tenant-gap-promotion-verify.mjs";
import { verifyFollowOnCredits, assertWorkflowUsesOnlyLoopbackUrls } from "../scripts/qa/tenant-follow-on-credit-verify.mjs";

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

test("follow-on 2026-10-28 sweep credits exactly six independently proven GAP methods", () => {
  const followOnBase = "dd890dd65f14a3a508ef5df7227fd84655c21fcd";
  const followOnTargets = [
    [
      "GET self/probation-reviews",
      1507,
      40623884094,
      "scripts/qa/tenant-self-probation-http.mjs",
      "be00791a82412f08e79a1b4f6f9a497eef80729f"
    ],
    [
      "POST self/probation-reviews",
      1507,
      40623884094,
      "scripts/qa/tenant-self-probation-http.mjs",
      "be00791a82412f08e79a1b4f6f9a497eef80729f"
    ],
    [
      "GET hcm/employment-term-decisions/[id]/manager-attestation",
      1512,
      40624278478,
      "scripts/qa/tenant-hcm-manager-attestation-recovery-http.mjs",
      "5783f860414d0076ce837c46a37fc8e1b10f5907"
    ],
    [
      "GET self/performance",
      1513,
      40620797757,
      "scripts/qa/tenant-self-performance-http.mjs",
      "328d1a3fd1371bfba9694a3933cdc38aab3f4dee"
    ],
    [
      "POST self/performance",
      1513,
      40620797757,
      "scripts/qa/tenant-self-performance-http.mjs",
      "328d1a3fd1371bfba9694a3933cdc38aab3f4dee"
    ],
    [
      "PATCH self/performance",
      1513,
      40620797757,
      "scripts/qa/tenant-self-performance-http.mjs",
      "328d1a3fd1371bfba9694a3933cdc38aab3f4dee"
    ]
  ];
  assertLiveTenantCounts(assert, manifest);
  assert.equal(verifyFollowOnCredits(manifest), 6);
  // assertLiveTenantCounts already reconciles every live total with the
  // complete method inventory and the PR base. Do not re-pin moving totals.
  const followOnCredited = [...methods].filter(([, method]) =>
    method.testedBy?.verifiedMainCommit === followOnBase);
  assert.equal(followOnCredited.length, 6, "only the six newly reviewed methods are credited");
  for (const [key, pr, run, file, blob] of followOnTargets) {
    const method = methods.get(key);
    assert.equal(method?.status, "COVERED", key);
    const evidence = method.testedBy;
    assert.ok(evidence, key + " has its own four-part evidence");
    assert.equal(evidence.file, file);
    assert.equal(evidence.proofBlobSha, blob);
    assert.equal(evidence.prNumber, pr);
    assert.equal(evidence.workflowRunId, run);
    assert.equal(evidence.postgresMajor, 16);
    assert.equal(evidence.verifiedMainCommit, followOnBase);
    assert.equal(evidence.line, evidence.ownPositiveLine);
    assert.ok(evidence.scope && evidence.scope.length > 50);
    assert.match(evidence.evidence, new RegExp("/actions/runs/" + run + "(?:\\D|$)"));
    const source = readFileSync(file, "utf8").split("\n");
    for (const pin of ["ownPositiveLine", "foreignDenialLine", "unchangedDbLine", "forgedSelectorLine"]) {
      const line = evidence[pin];
      assert.ok(Number.isSafeInteger(line) && line > 0 && line <= source.length, key + ": " + pin);
      assert.ok(source[line - 1].trim(), key + ": blank source assertion " + pin);
    }
  }
  assert.equal(methods.get("POST hcm/employment-term-decisions/[id]/manager-attestation")?.status, "GAP");
});


test("six-credit proof-source guard fails closed on borrowed, altered or seventh claims", () => {
  const key = "src/app/api/hcm/employment-term-decisions/[id]/manager-attestation/route.ts";
  const alter = change => {
    const changed = structuredClone(manifest);
    const method = changed.allApiRouteFiles[key].methods.find(x => x.name === "GET");
    change(changed, method);
    assert.throws(() => verifyFollowOnCredits(changed));
  };
  alter((_m, method) => { method.testedBy.prNumber = 1479; });
  alter((_m, method) => { method.testedBy.foreignDenialLine = 193; });
  alter((_m, method) => { method.testedBy.proofBlobSha = "0".repeat(40); });
  alter((_m, method) => { method.status = "GAP"; });
  alter((_m, method) => { method.testedBy.file = "scripts/qa/tenant-table-http.mjs"; });
  alter((changed) => {
    changed.allApiRouteFiles["src/app/api/invitations/route.ts"].methods
      .find(x => x.name === "POST").testedBy = {
        verifiedMainCommit: "dd890dd65f14a3a508ef5df7227fd84655c21fcd",
      };
  });
  const script = "scripts/qa/tenant-hcm-manager-attestation-recovery-http.mjs";
  assert.throws(() => verifyFollowOnCredits(manifest, file =>
    file === script ? readFileSync(file, "utf8") + "\n// tampered" :
      readFileSync(file, "utf8")), /source blob drift/);
});

test("source-pinned proof workflows reject external and lookalike URL destinations", () => {
  assert.doesNotThrow(() =>
    assertWorkflowUsesOnlyLoopbackUrls('curl "http://127.0.0.1:3000/login"'));
  for (const target of [
    "https://api.paymongo.com/v1",
    "https://api.xendit.co/v2",
    "http://api.paymongo.com/v1",
    "https://attacker.invalid/path/https://api.paymongo.com",
    "http://127.0.0.1.attacker.invalid:3000/login",
    "http://127.0.0.1@attacker.invalid/login",
    "http://localhost:3000/login",
    "https://127.0.0.1:3000/login",
    "http://untrusted.invalid:3000/login",
  ]) {
    assert.throws(() => assertWorkflowUsesOnlyLoopbackUrls(
      "curl " + target), /proof workflow/,
    "source guard must reject " + target);
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
    "PATCH approvals/[id]",
    "PATCH recruitment/privacy", "PATCH performance/follow-through-governance",
    "PATCH careers/admin", "POST workforce-planning/allocations",
    "GET year-end", "GET workforce/demand-observations/issued",
    "GET workforce/demand-staffing/policies",
    "POST hcm/employment-term-decisions/[id]/manager-attestation",
    "POST invitations", "PATCH compliance/filing-validations/[id]",
    "POST benefits/hmo", "POST web-bundy/consent",
  ];
  for (const key of excluded) {
    assert.equal(methods.get(key)?.status, "GAP", key);
    assert.equal(methods.get(key)?.testedBy, null,
      "do not borrow partial or still-open proof evidence: " + key);
  }
  assert.ok(!reservations.entries.some(entry =>
    entry.pr === 1455 || entry.methods.some(key => [
      "GET self/availability", "POST self/availability"].includes(key))),
    "stale #1455 reservation must be removed after credit");
});

test("closure plan reconciles all twelve frozen batches, without claiming acceptance", () => {
  const doc = readFileSync("docs/engineering/tenant-isolation-closure-plan.md", "utf8");
  assert.match(doc, /336 COVERED \/ 10 PUBLIC-BY-DESIGN \/ 152 GAP/);
  assert.match(doc, /tenant-isolation acceptance/i);
  const expected = new Map([
    ["DL-01", [26,19,2,5]], ["DL-02", [26,22,0,4]],
    ["MNY-01", [33,20,0,13]], ["MNY-02", [33,21,0,12]],
    ["STA-01", [27,21,0,6]], ["PII-01", [39,32,0,7]],
    ["PII-02", [38,26,0,12]], ["WRK-01", [39,19,0,20]],
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
