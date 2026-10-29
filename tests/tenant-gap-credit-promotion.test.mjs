import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertLiveTenantCounts } from "./helpers/tenant-counts.mjs";
import { verifyPromotionCredits } from "../scripts/qa/tenant-gap-promotion-verify.mjs";
import { verifyFollowOnCredits, assertWorkflowUsesOnlyLoopbackUrls } from "../scripts/qa/tenant-follow-on-credit-verify.mjs";
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
  const independentPost = methods.get("POST hcm/employment-term-decisions/[id]/manager-attestation");
  assert.equal(independentPost?.status, "COVERED", "POST has separate persisted own-write/foreign-denial proof");
  assert.equal(independentPost?.testedBy?.rowFile, "scripts/qa/tenant-table-rows/write/hcm-manager-attestation-post.mjs");
  assert.equal(independentPost?.testedBy?.file, "scripts/qa/tenant-write-table-http.mjs");
  assert.equal(independentPost?.testedBy?.postgresMajor, 18);
  assert.notEqual(independentPost?.testedBy?.verifiedMainCommit, followOnBase,
    "POST may not borrow manager-attestation GET's proof");
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
    "GET year-end", "GET workforce/demand-staffing/policies",
    "PATCH self/profile",
    "POST invitations", "PATCH compliance/filing-validations/[id]",
    "POST web-bundy/consent",
  ];
  for (const key of excluded) {
    assert.equal(methods.get(key)?.status, "GAP", key);
    assert.equal(methods.get(key)?.testedBy, null,
      "do not borrow partial or still-open proof evidence: " + key);
  }
  // HMO POST is distinct from the sixteen historical promotion credits.
  // Its separate executed four-action HTTP receipt must be preserved, never
  // borrowed by the source-only HMO fixture or an unrelated method.
  const hmoPost = methods.get("POST benefits/hmo");
  assert.equal(hmoPost?.status, "COVERED", "HMO POST has its own provisional reviewed method credit");
  assert.equal(hmoPost?.testedBy?.file, "scripts/qa/tenant-hmo-http.mjs",
    "HMO POST cannot borrow the source-only benefits fixture");
  assert.deepEqual(hmoPost?.testedBy?.postActions,
    ["create_plan", "add_dependent", "update_dependent", "update_enrollment"]);
  assert.deepEqual(hmoPost?.testedBy?.ownStatusByAction,
    { create_plan: 201, add_dependent: 201, update_dependent: 200, update_enrollment: 200 });
  assert.equal(hmoPost?.testedBy?.foreignStatus, 403);
  assert.equal(hmoPost?.testedBy?.passedJob,
    "https://github.com/erwinmehehe/payrollph/actions/runs/40675730756/job/122773670031");
  assert.notEqual(hmoPost?.testedBy?.verifiedMainCommit, base,
    "HMO POST must not be double-counted as a historical promotion target");
  const threeNew = [
    "GET self/schedule-receipts",
    "POST self/schedule-receipts",
    "GET workforce/demand-observations/issued",
  ];
  assert.equal(verifyMoreCredits(manifest), 3,
    "only three new distinct, source-matched, fully exercised methods");
  assert.ok(threeNew.every(key => !targets.some(([existing]) => existing === key)),
    "existing #1509 credits must keep their independent proof owners");
  for (const key of threeNew) {
    const method = methods.get(key);
    assert.equal(method?.status, "COVERED", key);
    assert.equal(method?.testedBy?.verifiedMainCommit,
      "fe3ad8901bfa714d59639d9f59a13cf133eeab36", key);
  }
  const profile = methods.get("PATCH self/profile");
  assert.equal(profile?.status, "GAP", "merged #1524 route changed after #1518's proof");
  assert.equal(profile?.testedBy, null);
  assert.equal(profile?.reviewedUncertified?.coverageCredits, 0);
  assert.equal(profile?.reviewedUncertified?.independentReview, "PENDING");
  assert.ok(!reservations.entries.some(entry =>
    entry.pr === 1455 || entry.methods.some(key => [
      "GET self/availability", "POST self/availability"].includes(key))),
    "stale #1455 reservation must be removed after credit");
});

test("closure plan reconciles all twelve frozen batches, without claiming acceptance", () => {
  const doc = readFileSync("docs/engineering/tenant-isolation-closure-plan.md", "utf8");
  assert.match(doc, /tenant-isolation acceptance/i);
  assert.match(doc, /NOT ACCEPTED/);
  // Current figures must come from the method manifest, never a previously merged PR.
  const live = `${manifest.metrics.methods} methods = ${manifest.metrics.coveredAfter} COVERED + ${manifest.metrics.publicByDesign} PUBLIC-BY-DESIGN + ${manifest.metrics.gap} GAP`;
  assert.ok(doc.includes(live), "Current closure plan totals must match live method counts");
  // Freeze original batch names and sizes, but derive changing statuses from the actual method records.
  const baselineBatches = new Map([
    ["DL-01", 26], ["DL-02", 26], ["MNY-01", 33], ["MNY-02", 33],
    ["STA-01", 27], ["PII-01", 39], ["PII-02", 38], ["WRK-01", 39],
    ["WRK-02", 39], ["WRK-03", 40], ["EDG-01", 33], ["EDG-02", 33],
  ]);
  const current = doc.split("### Current 406-method frozen batch queue — 2026-10-29")[1]
    ?.split("### Three narrowly promoted API methods")[0];
  assert.ok(current, "Current batch reconciliation table is required");
  const rows = current.split("\n").filter(line => line.startsWith("| ") && line.includes("**"));
  assert.equal(rows.length, baselineBatches.size, "Every frozen batch must appear exactly once");
  const frozen = doc.split("### Batch DL-01 —")[1]?.split("## Page and server-action closure")[0];
  assert.ok(frozen, "Frozen 406-method closure queue is required");
  const sections = ("### Batch DL-01 —" + frozen).split("### Batch ").slice(1);
  assert.deepEqual(sections.map(section => section.split(" ")[0]), [...baselineBatches.keys()]);
  const seen = new Set();
  const total = { COVERED: 0, "PUBLIC-BY-DESIGN": 0, GAP: 0 };
  for (const section of sections) {
    const [header, ...body] = section.split("\n");
    const id = header.split(" ")[0];
    const expectedSize = baselineBatches.get(id);
    const links = body.filter(line => line.startsWith("- `") && line.includes(" — [source](../../src/app/api/"));
    assert.equal(links.length, expectedSize, id + ": frozen source-link count changed");
    const count = { COVERED: 0, "PUBLIC-BY-DESIGN": 0, GAP: 0 };
    for (const link of links) {
      const identity = link.split("`")[1];
      const [verb, url] = identity.split(" ");
      const file = link.split(" — [source](../../")[1]?.split("#L")[0];
      assert.ok(file?.startsWith("src/app/api/"), id + ": missing exact route source link");
      const route = manifest.allApiRouteFiles[file];
      assert.equal("/api/" + route?.route, url, identity + ": source path must match method");
      const method = route.methods.find(item => item.name === verb);
      assert.ok(method, identity + ": absent from current manifest");
      assert.ok(!seen.has(identity), identity + ": duplicated in frozen queue");
      seen.add(identity);
      assert.ok(Object.hasOwn(count, method.status), identity + ": unsupported method status");
      count[method.status]++;
      total[method.status]++;
    }
    const matching = rows.filter(line => line.includes("**" + id + "**"));
    assert.equal(matching.length, 1, id + ": exactly one batch summary row required");
    const columns = matching[0].split("|").map(value => value.trim());
    assert.deepEqual([Number(columns[3]), Number(columns[4]), Number(columns[5]), Number(columns[6])],
      [expectedSize, count.COVERED, count["PUBLIC-BY-DESIGN"], count.GAP],
      id + ": documented batch status must match source-linked live method records");
    assert.equal(columns[7], "INCOMPLETE", id + ": cannot claim an accepted batch");
    assert.ok(count.GAP > 0, id + ": still has unproven methods");
  }
  assert.equal(seen.size, 406, "The historic 406-method queue cannot shrink or grow");
  assert.equal(total.COVERED + total["PUBLIC-BY-DESIGN"] + total.GAP, seen.size);
  assert.ok(current.includes(`Frozen subtotal: **${total.COVERED} COVERED + ${total["PUBLIC-BY-DESIGN"]} PUBLIC-BY-DESIGN + ${total.GAP} GAP = 406**`),
    "The frozen queue subtotal must reflect the actual source-linked statuses");
  assert.equal(total.GAP, manifest.metrics.gap, "Every live method GAP must remain in the frozen closure queue");
});
