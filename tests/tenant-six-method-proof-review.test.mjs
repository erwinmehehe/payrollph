import {verifyApprovalsCredit,APPROVALS_PATH} from '../scripts/qa/tenant-approvals-credit.mjs';
import {verifyStudioPostCredit,STUDIO_POST_PATH} from '../scripts/qa/tenant-studio-post-credit.mjs';
import {ROUTE_PATH as READINESS_GET_PATH,verifyWorkspaceReadinessCredit} from '../scripts/qa/tenant-workspace-readiness-credit.mjs';
import { verifyInvitationAcceptCredits } from "../scripts/qa/tenant-invitation-accept-credit.mjs";
import { verifyCheckoutCredit, CHECKOUT_PATH } from '../scripts/qa/tenant-billing-checkout-credit.mjs';
import {verifyFilingPatchCredit,FILING_PATH} from "../scripts/qa/tenant-filing-patch-credit.mjs";
import {verifySecurityCredits,SECURITY_TARGETS,readSecurityEvidence} from '../scripts/qa/tenant-security-write-credit.mjs';
import { verifyEnterprisePostCredit } from "../scripts/qa/tenant-enterprise-admin-credit.mjs";
import { verifyAccountEmailRequestCredit } from "../scripts/qa/tenant-account-email-request-credit.mjs";
import {verifySpendManaged, TARGETS as spendManagedTargets} from '../scripts/qa/tenant-spend-managed-credit.mjs';
import {verifyRecoveryCredits,RECOVERY_TARGETS} from '../scripts/qa/tenant-merged-recovery-credit.mjs';
import { YEAR_END_RECEIPTS, isYearEndHeld, verifyYearEndCredits, verifyYearEndHold, verifyYearEndPairState } from "../scripts/qa/tenant-year-end-credit.mjs";
/**
 * Non-credentialled, source-only guard on six merged proof candidates.
 * Keeps historical coverage + live metrics unchanged until the exact four-part
 * contract is satisfied on a final-head, independent PG16 HTTP run.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifyPayoutProfileCredit } from "../scripts/qa/tenant-payout-profile-credit.mjs";
import { verifyReceiptCredits } from "../scripts/qa/tenant-receipt-credit.mjs";
import { verifyRootCredits } from "../scripts/qa/tenant-root-planning-credit.mjs";
import { verifyEmailCredit } from "../scripts/qa/tenant-email-verification-credit.mjs";
import { verifyCareersPatchCredit } from "../scripts/qa/tenant-careers-patch-credit.mjs";
import { verifyBillingSubscriptionCredits } from "../scripts/qa/tenant-billing-subscription-credit.mjs";
import { verifyMigrationPostCredit } from "../scripts/qa/tenant-migrations-post-credit.mjs";
import { verifyStaffingPolicyGetCredit, STAFFING_GET_EVIDENCE } from "../scripts/qa/tenant-staffing-policy-get-credit.mjs";
import { EVIDENCE, verifyFiveMethodCredits } from "../scripts/qa/tenant-five-method-credit-verify.mjs";

const m = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const cases = [
  ["POST", "bir/annual-employer/candidate", 1676, "abe1600a2df31f513cda152bed828fd5567fd72e",
    "b0344f6af31b58456772cd46a07af46291c11ad0", 136, 153, 157, 170, 68, "object ID > 6"],
  ["POST", "leave/conversion", 1789, "b9ae9ca73fea870eac0ebbab42e2a7f3446613cb",
    "bc90fac8e0023c4e8f8d879c31447bd4f666787f", 111, 128, 130, 141, 96, "victim"],
  ["POST", "payroll/overpayment-preflight", 1674, "ec0e8b081c52bb8b22b7911c886c2005e45312f2",
    "24a475e0c695a97789d01b22da22ebd3d361f3f6", 84, 95, 99, 114, 58, "victim"],
  ["POST", "multi-entity/transfers", 1662, "c7001c59b9f60b55192bfb1d1876a18e0f18f482",
    "21909753364cda9cead239a8a495b1e2a40abc9d", 139, 153, 160, 224, 131, "Two independent own-employer"],
  ["PATCH", "multi-entity/transfers", 1662, "c7001c59b9f60b55192bfb1d1876a18e0f18f482",
    "21909753364cda9cead239a8a495b1e2a40abc9d", 176, 156, 166, 224, 131, "Two independent own-employer"],
  ["PATCH", "compliance/filing-validations/[id]", 1501, "893977583b4ac7e4d49da5b03327f7bc5c8e4a53",
    "c7e0660e218646d5848e56c3e60aaeb0b283f4b4", 112, 125, 129, 149, 74, "accepted-outcome"],
];
const skipOpenCredit = new Set(["POST leave/conversion", "POST payroll/overpayment-preflight"]);
// Later dedicated two-attacker proof (#1853) credits both transfer methods and supersedes the uncredited #1662 hold.
const dedicatedTransferCredit = new Set(["POST multi-entity/transfers", "PATCH multi-entity/transfers"]);
// Later dedicated two-attacker proof (#1891) credits the BIR candidate POST (all three actions) and supersedes the template-only #1676 review hold.
const dedicatedBirCredit = new Set(["POST bir/annual-employer/candidate"]);
const blobSha = filename => {
  const data = readFileSync(filename);
  return createHash("sha1").update(Buffer.from("blob " + data.length + "\0")).update(data).digest("hex");
};
const allMethods = Object.entries(m.allApiRouteFiles).flatMap(([path, value]) =>
  value.methods.map(method => ({ path, method })));
const inventory = readFileSync("docs/engineering/tenant-isolation-coverage-inventory.md", "utf8");
const plan = readFileSync("docs/engineering/tenant-isolation-closure-plan.md", "utf8");

// The independently source-pinned method verifiers construct the expected main
// ledger below. Use that ledger when counting the frozen source links rather
// than maintaining a second, hand-summed allowance of merged PR credits.
function verifiedFrozenMethodStatus(manifest, path, verb, verifiedStatus, snapshotStatuses = {}) {
  const route = manifest.allApiRouteFiles[path];
  const row = route?.methods.find(method => method.name === verb);
  const label = verb + " " + path;
  assert.ok(row, label + ": frozen source link must resolve to a method");
  assert.ok(["COVERED", "GAP", "PUBLIC-BY-DESIGN",
    "PRIVILEGED-OPERATIONS-TOKEN-ONLY"].includes(verifiedStatus),
    label + ": missing independently reconciled main status");
  assert.equal(row.status, verifiedStatus,
    label + ": a status promotion without its verified proof is forbidden");
  if (row.status === "COVERED") {
    const proof = row.testedBy;
    assert.ok(proof && typeof proof.file === "string" && proof.file.startsWith("scripts/qa/"),
      label + ": COVERED requires a source-pinned proof citation");
    // These are citation *shapes*, not a whitelist of PRs or an acceptance
    // bypass. Individual proof verifiers above still enforce exact SHA,
    // executed receipts, route/method ownership and remaining GAPs.
    const hasCitation =
      (Number.isSafeInteger(proof.prNumber) && proof.prNumber > 0) ||
      (Number.isSafeInteger(proof.proofPullRequest) && proof.proofPullRequest > 0) ||
      (typeof proof.receiptFile === "string" && typeof proof.receiptBlobSha === "string") ||
      (Number.isSafeInteger(proof.workflowRunId) && proof.workflowRunId > 0 &&
        typeof proof.evidence === "string") ||
      (typeof proof.sourceHead === "string" && typeof proof.proofBlobSha === "string") ||
      (typeof proof.workflowFile === "string" && typeof proof.workflowBlobSha === "string" &&
        typeof proof.proofBlobSha === "string") ||
      // The original source-sealed 2026-11-03 snapshot contains historical
      // COVERED proof records predating merged-PR citation metadata.
      (typeof proof.scope === "string" && typeof proof.ownPositiveLine === "number");
    // Historical snapshot credits are already immutable in the 2026-11-03
    // fixture. Only later GAP-to-COVERED promotions require these newer
    // merge/receipt citation shapes; older proof metadata is not retrofitted.
    if (snapshotStatuses[path]?.[verb] !== "COVERED") {
      assert.ok(hasCitation, label + ": credited method lacks a merged-proof citation");
    }
  }
  if (row.status === "GAP") {
    assert.equal(row.testedBy, null, label + ": an unproved method must remain GAP");
  }
  return row.status;
}

test("four uncredited methods stay GAP; two main-owned provisional credits are preserved", () => {
  assert.equal(cases.length, 6);
  for (const [verb, route, pr, head, proofSha, own, foreign, forged, unchanged, ordering, missing] of cases) {
    const path = "src/app/api/" + route + "/route.ts";
    const entry = m.allApiRouteFiles[path];
    assert.ok(entry, path);
    const method = entry.methods.find(row => row.name === verb);
    const label = verb + " " + route;
    if (label === "PATCH compliance/filing-validations/[id]") {
      assert.equal(verifyFilingPatchCredit(m), 1,
        "Filing PATCH requires the sealed accepted/rejected/role-guard three-leg PG16 proof");
      assert.equal(method?.status, "COVERED");
      assert.equal(method.reviewedUncertified, undefined);
      continue;
    }
    if (skipOpenCredit.has(label)) {
      // #1727 has now merged these two source-matched provisional credits to
      // main. This review must leave their existing proof and credit untouched.
      assert.equal(method?.status, "COVERED", label + ": preserve already-merged main credit");
      assert.equal(method.testedBy?.proofHeadSha, head, label + " original verified head");
      assert.equal(method.testedBy?.proofBlobSha, proofSha, label + " original proof bytes");
      assert.equal(method.testedBy?.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY");
      assert.equal(method.testedBy?.independentlyAccepted, false);
      assert.equal(method.testedBy?.productionCertified, false);
      assert.equal(method.reviewedUncertified, undefined, label + ": no new method review metadata");
      const skippedRow = inventory.split("\n").find(line =>
        line.includes("[`" + route + "` " + verb + "]("));
      assert.ok(skippedRow?.includes("**COVERED**") && skippedRow.includes("PG16 own POST"),
        label + ": inventory must keep main's existing provisional proof");
      continue;
    }
    if (dedicatedTransferCredit.has(label)) {
      assert.equal(method?.status, "COVERED", label + ": dedicated two-attacker credit");
      assert.equal(method.testedBy?.file, "scripts/qa/tenant-transfers-http.mjs", label);
      assert.equal(method.testedBy?.proofPullRequest, 1853, label);
      assert.equal(method.testedBy?.independentSecurityReview, "PENDING", label);
      assert.equal(method.testedBy?.independentlyAccepted, false, label);
      assert.equal(method.reviewedUncertified, undefined, label + ": the superseded hold is removed, not kept beside a credit");
      const creditedRow = inventory.split("\n").find(line => line.includes("[`" + route + "` " + verb + "]("));
      assert.ok(creditedRow?.includes("**COVERED**") && creditedRow.includes("transfers dedicated proof"),
        label + ": inventory must show the dedicated proof");
      continue;
    }
    if (dedicatedBirCredit.has(label)) {
      assert.equal(method?.status, "COVERED", label + ": dedicated two-attacker credit");
      assert.equal(method.testedBy?.file, "scripts/qa/tenant-bir1604c-candidate-post-http.mjs", label);
      assert.equal(method.testedBy?.proofPullRequest, 1891, label);
      assert.equal(method.testedBy?.independentSecurityReview, "PENDING", label);
      assert.equal(method.testedBy?.independentlyAccepted, false, label);
      assert.equal(method.reviewedUncertified, undefined, label + ": the superseded hold is removed, not kept beside a credit");
      const creditedRow = inventory.split(String.fromCharCode(10)).find(line => line.includes("[`" + route + "` " + verb + "]("));
      assert.ok(creditedRow?.includes("**COVERED**") && creditedRow.includes("BIR candidate dedicated proof"),
        label + ": inventory must show the dedicated proof");
      continue;
    }
    assert.equal(method?.status, "GAP", label);
    assert.equal(method.testedBy, null, label + " must never borrow a partial receipt");
    assert.match(method.reason, /Still GAP:/, label);
    const review = method.reviewedUncertified?.reconciliationReview;
    assert.ok(review && typeof review === "object", label);
    assert.equal(review.proofPr, pr, label);
    assert.equal(review.proofFinalHead, head, label);
    assert.match(review.passedJob, /https:\/\/github\.com\/erwinmehehe\/payrollph\/actions\/runs\/\d+\/job\/\d+$/, label);
    assert.equal(review.proofBlobShaAtFinalHead, proofSha, label);
    if (pr === 1662) {
      // Historical #1662 source is superseded by merged #1711, not a current credit.
      assert.equal(review.reviewedRouteBlobSha,
        method.reviewedUncertified.originalRouteBlobSha, label + " historical route");
      assert.equal(method.reviewedUncertified.routeBlobSha, entry.gitBlobSha,
        label + " current source pin");
      assert.equal(blobSha(method.reviewedUncertified.proofFile),
        method.reviewedUncertified.proofBlobSha, label + " newer uncredited fault proof");
      assert.notEqual(blobSha(review.proofFile), proofSha,
        label + " historical receipt must not be reused as current proof");
    } else {
      assert.equal(review.reviewedRouteBlobSha, entry.gitBlobSha, label);
    }
    assert.equal(blobSha(path), entry.gitBlobSha, label + " route changed since review");
    assert.equal(review.fullMethodCoverageCredits, 0, label);
    assert.equal(review.independentReview, "PENDING", label);
    assert.equal(review.productionTested, false, label);
    assert.ok(review.missingParts.join(" ").includes(missing), label + " missing-part text");
    assert.deepEqual(review.sourceAnchors,
      { ownPositiveLine:own, foreignDenialLine:foreign, forgedSelectorLine:forged,
        unchangedDbLine:unchanged, victimIdOrderingLine:ordering }, label + " source anchors drifted");
    const proofPath = review.sharedRunner ?? review.proofFile;
    const lines = readFileSync(proofPath, "utf8").split("\n");
    if (pr === 1676) {
      // The #1676 hashes and line numbers remain HISTORICAL metadata. The
      // current BIR runner has new, UNACCEPTED real-HTTP check/download paths.
      // Never silently pretend its new lines were the exact merged #1676 head.
      assert.equal(blobSha(proofPath), "237fdbb7a704064ecf892f79c6421ea413052b95",
        "BIR recovery candidate changed: obtain new exact-head PG16 proof first");
      assert.notEqual(blobSha(proofPath), proofSha,
        "a changed recovery runner cannot borrow the template-only #1676 job");
      const current = lines.join("\n");
      for (const evidence of [
        'for (const name of ["ATTA", "ATTB", "VICTIM"])',
        'victim.org.id > 6 && victim.worker.id > 6 && victim.entity.id > 6',
        'const checked = expect(await e.context.post(',
        'const downloaded = expect(await e.context.post(',
        'actualSha === checkResult.fileSha256',
        'for (const mode of ["template", "check", "download"])',
        'legalEntityId: victim.entity.id',
        'employeeNo: victim.worker.employeeNo',
        'assert.deepEqual(await snapshot(victim), before.get(victim.org.id)',
        'assert.deepEqual(await snapshot(attacker), before.get(attacker.org.id)',
        'owned === 3 && ownedChecks === 3 && ownedDownloads === 3',
        'denied === 16',
        'credits: 0',
      ]) assert.ok(current.includes(evidence),
        "New BIR recovery source lost a required real-HTTP guard: " + evidence);
    } else if (pr === 1662) {
      // Old line anchors remain only historical citations after source hardening.
      assert.equal(method.reviewedUncertified.coverageCredits, 0, label);
      assert.equal(method.reviewedUncertified.exactHeadPg16Http, "PENDING", label);
      assert.equal(method.reviewedUncertified.productionCertified, false, label);
      assert.equal(review.fullMethodCoverageCredits, 0, label);
    } else {
      for (const [kind, n] of Object.entries(review.sourceAnchors)) {
        assert.ok(Number.isSafeInteger(n) && n > 0 && n <= lines.length, label + " " + kind);
        assert.ok(lines[n - 1].trim().length > 0, label + " " + kind + " is blank");
      }
      const ownText = lines[own - 1], foreignText = lines[foreign - 1];
      const forgedText = lines[forged - 1], invariantText = lines[unchanged - 1];
      assert.match(ownText, /(?:context\.post\(|request\(|post\(|call\(|expectStatus\(await request\()/, label + " own request");
      assert.match(foreignText, /(?:context\.post\(|request\(|post\(|call\(|expectStatus\(await request\()/, label + " victim request");
      assert.match(forgedText, /(?:context\.post\(|request\(|post\(|call\(|expectStatus\(await request\()/, label + " forged request");
      assert.match(invariantText, /assert\.deepEqual\(/, label + " actual victim DB comparison");
    }
    if (pr !== 1501 && pr !== 1676 && pr !== 1662) {
      assert.equal(blobSha(review.proofFile), proofSha, label + " proof changed since exact final head");
    } else if (pr === 1501) {
      // Historical #1501 was rejection-only. A new synthetic ACCEPTED-branch
      // HTTP/PG16 candidate is in the current family row; no successful job
      // or accepted coverage credit is implied until its exact-head run.
      assert.equal(blobSha(review.proofFile), "c7c7bf0a1b6b8b4eb4eade869ec8184beefe4fba",
        "new fictional accepted-path family proof changed; rerun exact-head CI");
      assert.notEqual(blobSha(review.proofFile),
        method.reviewedUncertified.proofBlobSha,
        "new accepted-path source cannot masquerade as merged #1501 evidence");
      const current = readFileSync(review.proofFile, "utf8");
      for (const token of [
        'for (let pad = 0; pad < 6; pad++)',
        'Number.isSafeInteger(filing.id) && filing.id > 6',
        'const [acceptFixture] = await db.insert(governmentFilingValidations).values({',
        'const acceptedHttp = expectStatus(await request(',
        'persistedAccepted.status, "accepted"',
        'acceptedAudit.action, "SSS R-3 filing accepted"',
        'acceptedOwnDecisionPG16: true',
        'acceptedForeignAndForgedDenied: true',
        'acceptedVictimDbAndAuditUnchanged: true',
        'acceptedAuditInsertRollbackProven: true',
        'const [vetoRun] = await db.insert(payrollRuns).values({',
        'const vetoWorksheet = await generateGovernmentDraft(vetoRun.id, "sss-r3")',
        'fileSha256: vetoHash',
        'accepted filing outcome must roll back on a failed audit insert',
        'proveFilingStateUntouched(victimBeforeAccepted,',
        'method: "PATCH", cookie, body: deniedCase.body',
      ]) assert.ok(current.includes(token),
        "current filing accepted branch lacks executable source control: " + token);
      assert.equal(method.reviewedUncertified.acceptedOutcomePositiveProven, false,
        "filing remains GAP until a fresh complete accepted HTTP/PG16 CI receipt passes");
      assert.equal(method.reviewedUncertified.fullMethodCoverageCredits, 0);
    }
    if (pr === 1676) {
      const handler = readFileSync(path, "utf8");
      for (const mode of ['"template"', '"check"', '"download"'])
        assert.ok(handler.includes(mode), "BIR POST action " + mode + " must be reviewed individually");
      assert.ok(review.missingParts.join(" ").includes("mode=check") &&
        review.missingParts.join(" ").includes("mode=download"),
        "Template-only BIR evidence must not silently certify check/download");
    }
    if ([1675,1674].includes(pr)) {
      assert.ok(!/>\s*6\b/.test(lines[ordering - 1]),
        label + ": the final-head ordering assertion itself does not prove the >6 floor");
    }
    const invRow = inventory.split("\n").find(line => line.includes("[\x60" + route + "\x60 " + verb + "]("));
    assert.ok(invRow?.includes("**GAP**") && invRow.includes("tenant-six-method-proof-review-2026-11-02.md"),
      label + " overview must cite review-only evidence without a credit");
    assert.ok(plan.includes("\x60" + verb + " " + route + "\x60"), label + " closure plan must list this hold");
  }
  const cited = allMethods.filter(({ method }) => method.reviewedUncertified?.reconciliationReview);
  assert.deepEqual(cited.map(({ path, method }) => method.name + " " + path.slice("src/app/api/".length, -"/route.ts".length)).sort(),
    cases.filter(c => c[1] !== "compliance/filing-validations/[id]" && !skipOpenCredit.has(c[0] + " " + c[1]) && !dedicatedTransferCredit.has(c[0] + " " + c[1]) && !dedicatedBirCredit.has(c[0] + " " + c[1])).map(c => c[0] + " " + c[1]).sort(), "no unreviewed method or open-PR credit may borrow this hold");
});

test("six-method review permits only 3 #1728 compliance and 4 #1730 year-end credits", () => {
  const counts = { COVERED: 0, "PUBLIC-BY-DESIGN": 0, GAP: 0, "PRIVILEGED-OPERATIONS-TOKEN-ONLY": 0 };
  for (const { method } of allMethods) {
    assert.ok(Object.hasOwn(counts, method.status));
    counts[method.status]++;
  }
  assert.equal(allMethods.length, 498);

  // GitHub Actions shallow PR checkouts do not necessarily have origin/main.
  // Pin *every* main method status and the frozen subtotal to the reviewed
  // exact-base snapshot. This is a strict fallback, not an acceptance waiver.
  const fixtureFile = "tests/fixtures/tenant-six-method-main-ledger-20261103.json";
  const snapshot = JSON.parse(readFileSync(fixtureFile, "utf8"));
  assert.equal(blobSha(fixtureFile), "52f8a171b5f76b70571326c5dbe9307642d7bb8a",
    "Main ledger fixture changed; renew source-level security review");
  assert.equal(snapshot.schema, "payrollph-six-method-main-ledger-snapshot-v1");
  assert.equal(snapshot.sourceCommit, "78a8a69b3c924200ad9e522ff7e716c376a7ce20");
  assert.equal(snapshot.sourceManifestGitBlobSha, "656b0f190924e40c337e8b6291c14a0776b6f746");
  assert.equal(snapshot.sourceClosurePlanGitBlobSha, "86a92231daafa1accc8c0a263d30c6112c8ba8ba");
  assert.equal(Object.keys(snapshot.methodStatuses).length, 295);
  const methodStatuses = manifest => Object.fromEntries(
    Object.entries(manifest.allApiRouteFiles).map(([path, data]) => [
      path, Object.fromEntries(data.methods.map(row => [row.name, row.status])),
    ]),
  );
  // The six-method review itself grants ZERO credits. A separate and already
  // source-pinned #1728 proposal adds exactly three disjoint STA-01 POSTs.
  // Keep the reviewed 498-method baseline immutable, then apply ONLY those
  // three explicitly named, proven, non-production changes for this PR.
  const compliancePostCredits = [
    ["src/app/api/compliance/contribution-issues/route.ts",
      "scripts/qa/tenant-table-rows/write/compliance-contribution-post.mjs",
      "dfcf1615be01bb151e13a5d74c080299575ce53a"],
    ["src/app/api/compliance/payroll-month-close/route.ts",
      "scripts/qa/tenant-table-rows/write/compliance-payroll-month-close-post.mjs",
      "21daf9c24d55f4fb01ce84c6f5aef822ce0f3193"],
    ["src/app/api/compliance/statutory-remittances/route.ts",
      "scripts/qa/tenant-table-rows/write/compliance-statutory-remittances-post.mjs",
      "f24a7349c902dae0bc41a3989c8a88df24aedb6f"],
  ];
  const expectedStatuses = JSON.parse(JSON.stringify(snapshot.methodStatuses));
  for (const [path, sourceRowFile, sourceRowSha] of compliancePostCredits) {
    assert.equal(expectedStatuses[path]?.POST, "GAP", path + ": source baseline must be GAP");
    const route = m.allApiRouteFiles[path];
    const method = route?.methods.find(row => row.name === "POST");
    assert.equal(method?.status, "COVERED", path + ": #1728 POST status");
    const proof = method.testedBy;
    assert.ok(proof, path + ": a provisional credit requires source-pinned evidence");
    assert.equal(proof.prNumber, 1728, path + ": unique PR owner");
    assert.equal(proof.verifiedPrHeadSha, "d3cdcf020a559ae85c813d656620832dd0a46d4e");
    assert.equal(proof.workflowRunId, 41446327305);
    assert.equal(proof.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY");
    assert.equal(proof.postgresMajor, 16);
    assert.equal(proof.independentlyAccepted, false);
    assert.equal(proof.productionCertified, false);
    assert.equal(proof.productionTested, false);
    assert.equal(proof.sourceRowFile, sourceRowFile);
    assert.equal(proof.sourceRowBlobSha, sourceRowSha);
    assert.equal(blobSha(sourceRowFile), sourceRowSha,
      path + ": fictional PG16 proof row modified without review");
    assert.equal(proof.routeBlobSha, route.gitBlobSha);
    assert.equal(blobSha(path), route.gitBlobSha,
      path + ": handler changed since source review");
    assert.equal(proof.proofBlobSha, blobSha("scripts/qa/tenant-write-table-http.mjs"));
    assert.equal(proof.workflowBlobSha,
      blobSha(".github/workflows/tenant-compliance-post-candidate.yml"));
    expectedStatuses[path].POST = "COVERED";
  }
  const expectedMainStatuses = JSON.parse(JSON.stringify(expectedStatuses));
  const issuedPromotions = [
    {
      path: "src/app/api/workforce/demand-observations/issued/route.ts",
      verb: "POST",
      routeSha: "549156b2e143c71bd33385fb1cc49a95cb120dfc",
      proofFile: "scripts/qa/tenant-issued-demand-http.mjs",
      proofSha: "a63e9aa94b9c85000433e9a40c778af449888757",
      workflowFile: ".github/workflows/tenant-issued-demand-http.yml",
      workflowSha: "caf01bd8e2c17e8cd5bfd17528cd56d7503aa312",
      proofHead: "1834b73aab8e162e19b4b260e51b32e6fa1fbbec",
      workflowRunId: 41444835667,
    },
    {
      path: "src/app/api/workforce/demand-observations/issued/score/route.ts",
      verb: "POST",
      routeSha: "5658c67c7758e78c68738f0e848edfcfc8bd17c3",
      proofFile: "scripts/qa/tenant-issued-demand-http.mjs",
      proofSha: "a63e9aa94b9c85000433e9a40c778af449888757",
      workflowFile: ".github/workflows/tenant-issued-demand-http.yml",
      workflowSha: "caf01bd8e2c17e8cd5bfd17528cd56d7503aa312",
      proofHead: "1834b73aab8e162e19b4b260e51b32e6fa1fbbec",
      workflowRunId: 41444835667,
    },
  ];
  for (const pin of issuedPromotions) {
    const label = pin.verb + " " + pin.path;
    assert.equal(expectedStatuses[pin.path]?.[pin.verb], "GAP", label + " must start GAP on main");
    const row = m.allApiRouteFiles[pin.path]?.methods.find(method => method.name === pin.verb);
    assert.equal(row?.status, "COVERED", label + " is the only permitted credit");
    const receipt = row.testedBy;
    assert.equal(receipt?.prNumber, 1731, label + " proof must belong to this PR");
    assert.equal(receipt?.proofHeadCommit, pin.proofHead, label + " executed proof head");
    assert.equal(receipt?.workflowRunId, pin.workflowRunId, label + " executed workflow");
    assert.ok(receipt?.evidence?.includes("/actions/runs/" + pin.workflowRunId + "/job/"),
      label + " must cite the executed proof job");
    assert.equal(receipt?.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY");
    assert.equal(receipt?.ownerIsOnlyReviewer, true);
    assert.equal(receipt?.independentlyAccepted, false);
    assert.equal(receipt?.productionCertified, false);
    assert.equal(receipt?.postgresMajor, 16);
    for (const [field, file, expectedSha] of [
      ["routeBlobSha", pin.path, pin.routeSha],
      ["proofBlobSha", pin.proofFile, pin.proofSha],
      ["workflowBlobSha", pin.workflowFile, pin.workflowSha],
    ]) {
      assert.equal(receipt?.[field], expectedSha, label + " immutable " + field);
      assert.equal(blobSha(file), expectedSha, label + " actual file hash " + file);
    }
    assert.equal(receipt?.file, pin.proofFile);
    assert.equal(receipt?.workflowFile, pin.workflowFile);
    expectedStatuses[pin.path][pin.verb] = "COVERED";
  }
  assert.equal(blobSha("scripts/qa/tenant-issued-demand-contract.mjs"),
    "a4a7714a42ada86a55192b160e3f5f2761af0500",
    "The original contract must remain byte-identical to the passed source proof");
  assert.equal(blobSha("tests/tenant-issued-demand-contract.test.mjs"),
    "0df0028ceda0413256575f3847c950194f6e73f3",
    "The original contract tests must remain byte-identical to the passed source proof");
  for (const pin of issuedPromotions) expectedMainStatuses[pin.path][pin.verb] = "COVERED";

  const permittedPromotions = [
    {
      path: "src/app/api/year-end/route.ts",
      verb: "GET",
      routeSha: "7572c6111cf40d398b3cc8c1f940efd0a9b8d362",
      proofFile: "scripts/qa/tenant-table-rows/write/year-end-annualization-post.mjs",
      proofSha: "9e64fc18a1a5b76c3ec583a0668ea680efd1ed19",
      workflowFile: ".github/workflows/tenant-year-end-post-candidate.yml",
      workflowSha: "9e6ca6431b168e05afecc5e40a42b1973ad1f675",
      proofHead: "066c1d6b405365ff9ddacc229b8d0ce5cbc68aa5",
      workflowRunId: 41446394887,
      actions: ["json", "preflight", "2316", "2316-print", "alphalist"],
    },
    {
      path: "src/app/api/year-end/route.ts",
      verb: "POST",
      routeSha: "7572c6111cf40d398b3cc8c1f940efd0a9b8d362",
      proofFile: "scripts/qa/tenant-table-rows/write/year-end-annualization-post.mjs",
      proofSha: "9e64fc18a1a5b76c3ec583a0668ea680efd1ed19",
      workflowFile: ".github/workflows/tenant-year-end-post-candidate.yml",
      workflowSha: "9e6ca6431b168e05afecc5e40a42b1973ad1f675",
      proofHead: "066c1d6b405365ff9ddacc229b8d0ce5cbc68aa5",
      workflowRunId: 41446394887,
      actions: ["annualization", "bind-run"],
    },
    {
      path: "src/app/api/year-end/prior-evidence/route.ts",
      verb: "GET",
      routeSha: "d2fc2fa7c4257d7e33545c8a23ea310abae7077d",
      proofFile: "scripts/qa/tenant-sta01-prior-evidence-http.mjs",
      proofSha: "350d22bee1fdbd726b85a32967d510994f6bfe00",
      workflowFile: ".github/workflows/tenant-sta01-prior-evidence-http.yml",
      workflowSha: "91bc91ceb677ac7ebf52c8edf78bcd2e43f3528d",
      proofHead: "066c1d6b405365ff9ddacc229b8d0ce5cbc68aa5",
      workflowRunId: 41446394999,
      actions: ["read-decrypted"],
    },
    {
      path: "src/app/api/year-end/prior-evidence/route.ts",
      verb: "POST",
      routeSha: "d2fc2fa7c4257d7e33545c8a23ea310abae7077d",
      proofFile: "scripts/qa/tenant-sta01-prior-evidence-http.mjs",
      proofSha: "350d22bee1fdbd726b85a32967d510994f6bfe00",
      workflowFile: ".github/workflows/tenant-sta01-prior-evidence-http.yml",
      workflowSha: "91bc91ceb677ac7ebf52c8edf78bcd2e43f3528d",
      proofHead: "066c1d6b405365ff9ddacc229b8d0ce5cbc68aa5",
      workflowRunId: 41446394999,
      actions: ["save", "approve"],
    },
  ];
  const creditedYearEndPromotions = permittedPromotions.filter(pin =>
    pin.path !== "src/app/api/year-end/route.ts");
  for (const pin of permittedPromotions) {
    const label = pin.verb + " " + pin.path;
    if (pin.path === "src/app/api/year-end/route.ts") {
      const held = m.allApiRouteFiles[pin.path]?.methods.find(method => method.name === pin.verb);
      assert.equal(expectedStatuses[pin.path]?.[pin.verb], "GAP", label + " historical status");
      if (isYearEndHeld(m)) {
        // Withdrawn to the exact zero-credit hold (annualization source moved): no receipt, no credit.
        assert.equal(held?.status, "GAP", label + " is held at zero credit");
        assert.equal(held?.testedBy, null);
        assert.equal(verifyYearEndHold(m), 0);
        assert.equal(blobSha(pin.path), "f040f5bbbc3df275d32d23f1728b1b0345f77814");
        continue;
      }
      assert.equal(held?.status, "COVERED", label + " needs distinct current-source #1804 proof");
      assert.equal(held?.testedBy?.proofPullRequest, 1804);
      assert.equal(held?.testedBy?.workflowRunId, 43178709246);
      assert.equal(held?.testedBy?.independentlyAccepted, false);
      assert.equal(held?.reviewedUncertified, undefined);
      assert.equal(blobSha(pin.path), "f040f5bbbc3df275d32d23f1728b1b0345f77814");
      continue;
    }
    assert.equal(expectedStatuses[pin.path]?.[pin.verb], "GAP", label + " must start GAP on main");
    const row = m.allApiRouteFiles[pin.path]?.methods.find(method => method.name === pin.verb);
    assert.equal(row?.status, "COVERED", label + " is the only permitted credit");
    const receipt = row.testedBy;
    assert.equal(receipt?.prNumber, 1730, label + " proof must belong to this PR");
    assert.equal(receipt?.verifiedPrHeadSha, pin.proofHead, label + " executed proof head");
    assert.equal(receipt?.workflowRunId, pin.workflowRunId, label + " executed workflow");
    assert.ok(receipt?.evidence?.includes("/actions/runs/" + pin.workflowRunId),
      label + " must cite the executed proof run");
    assert.equal(receipt?.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY");
    assert.equal(receipt?.ownerIsOnlyReviewer, true);
    assert.equal(receipt?.independentlyAccepted, false);
    assert.equal(receipt?.productionCertified, false);
    assert.equal(receipt?.productionTested, false);
    assert.equal(receipt?.postgresMajor, 16);
    assert.deepEqual(receipt?.methodActions, pin.actions, label + " exact actions proven");
    for (const [field, file, expectedSha] of [
      ["routeBlobSha", pin.path, pin.routeSha],
      ["proofBlobSha", pin.proofFile, pin.proofSha],
      ["workflowBlobSha", pin.workflowFile, pin.workflowSha],
    ]) {
      assert.equal(receipt?.[field], expectedSha, label + " immutable " + field);
      assert.equal(blobSha(file), expectedSha, label + " actual file hash " + file);
    }
    assert.equal(receipt?.file, pin.proofFile);
    assert.equal(receipt?.workflowFile, pin.workflowFile);
    expectedStatuses[pin.path][pin.verb] = "COVERED";
  }
  const expectedBeforePayout = JSON.parse(JSON.stringify(expectedStatuses));
  const payoutCredits = verifyPayoutProfileCredit(m);
  assert.equal(expectedStatuses["src/app/api/payout-profiles/route.ts"].PATCH, "GAP");
  expectedStatuses["src/app/api/payout-profiles/route.ts"].PATCH = "COVERED";
  const expectedAfterPayout = JSON.parse(JSON.stringify(expectedStatuses));

  // Three unrelated methods have now passed on their own exact-final-head
  // fictional-PG16/real-HTTP receipts. Run the strict byte/anchor/CI-receipt
  // verifier before allowing ONLY these three distinct new promotions.
  const recovery = verifyFiveMethodCredits(m);
  assert.equal(recovery.methodsCredited, 3);
  assert.equal(recovery.methodsHeld, 0);
  for (const evidence of EVIDENCE) {
    const path = "src/app/api/" + evidence.route + "/route.ts";
    assert.equal(expectedStatuses[path]?.[evidence.method], "GAP",
      path + ": only a previously GAP method may receive new proof credit");
    const method = m.allApiRouteFiles[path].methods.find(row => row.name === evidence.method);
    assert.equal(method.testedBy.workflowRunId, evidence.run);
    assert.equal(method.testedBy.routeBlobSha, evidence.routeSha);
    assert.equal(method.testedBy.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY");
    assert.equal(method.testedBy.independentlyAccepted, false);
    expectedStatuses[path][evidence.method] = "COVERED";
  }
  // One provider-callback credit after the reviewed snapshot: webhooks/resend POST (merged proof #1763). Its pins are verified
  // by the dedicated inventory test; here only the exact method and receipt identity may move from GAP.
  const resendPath = "src/app/api/webhooks/resend/route.ts";
  assert.equal(expectedStatuses[resendPath]?.POST, "GAP", "Resend POST must start GAP in the reviewed snapshot");
  const resendMethod = m.allApiRouteFiles[resendPath].methods.find(row => row.name === "POST");
  assert.equal(resendMethod?.status, "COVERED");
  assert.equal(resendMethod.testedBy?.file, "scripts/qa/tenant-webhook-resend-http.mjs");
  assert.equal(resendMethod.testedBy.proofPullRequest, 1763);
  assert.equal(resendMethod.testedBy.independentSecurityReview, "PENDING");
  assert.equal(resendMethod.testedBy.productionTested, false);
  expectedStatuses[resendPath].POST = "COVERED";
  const resendCredits = 1;
  // Second provider-callback credit after the snapshot: webhooks/xendit/subscriptions POST (merged proof refresh #1777), counted under the
  // bounded documentedRetryRefusal exception. Only the exact method and receipt identity may move from GAP.
  const subscriptionsPath = "src/app/api/webhooks/xendit/subscriptions/route.ts";
  assert.equal(expectedStatuses[subscriptionsPath]?.POST, "GAP", "Xendit subscriptions POST must start GAP in the reviewed snapshot");
  const subscriptionsMethod = m.allApiRouteFiles[subscriptionsPath].methods.find(row => row.name === "POST");
  assert.equal(subscriptionsMethod?.status, "COVERED");
  assert.equal(subscriptionsMethod.testedBy?.file, "scripts/qa/tenant-webhook-xendit-subscriptions-http.mjs");
  assert.equal(subscriptionsMethod.testedBy.proofPullRequest, 1777);
  assert.equal(subscriptionsMethod.testedBy.ruleException, "proofPolicy.providerCallback.documentedRetryRefusal");
  assert.equal(subscriptionsMethod.testedBy.independentSecurityReview, "PENDING");
  assert.equal(subscriptionsMethod.testedBy.productionTested, false);
  expectedStatuses[subscriptionsPath].POST = "COVERED";
  const subscriptionsCredits = 1;
// #1761: one separately source-pinned staffing-policy GET, both manage and approved proof modes.
  const staffingGetCredits = verifyStaffingPolicyGetCredit(m);
  const staffingGetPath = "src/app/api/workforce/demand-staffing/policies/route.ts";
  assert.equal(staffingGetCredits, 1);
  assert.equal(expectedStatuses[staffingGetPath]?.GET, "GAP");
  expectedStatuses[staffingGetPath].GET = "COVERED";
// Dedicated-harness credit after the snapshot: hcm/effective-changes POST (merged proof #1779). Only the exact method and receipt identity may move from GAP.
  const effectiveChangePath = "src/app/api/hcm/effective-changes/route.ts";
  assert.equal(expectedStatuses[effectiveChangePath]?.POST, "GAP", "effective-changes POST must start GAP in the reviewed snapshot");
  const effectiveChangeMethod = m.allApiRouteFiles[effectiveChangePath].methods.find(row => row.name === "POST");
  assert.equal(effectiveChangeMethod?.status, "COVERED");
  assert.equal(effectiveChangeMethod.testedBy?.file, "scripts/qa/tenant-hcm-effective-change-post-http.mjs");
  assert.equal(effectiveChangeMethod.testedBy.proofPullRequest, 1779);
  assert.equal(effectiveChangeMethod.testedBy.independentSecurityReview, "PENDING");
  assert.equal(effectiveChangeMethod.testedBy.productionTested, false);
  expectedStatuses[effectiveChangePath].POST = "COVERED";
  const effectiveChangeCredits = 1;
  // Separate provisional PII-02 MWE PATCH, in addition to HCM POST and payroll review/release credits.
  const mweDecisionPath = "src/app/api/employees/[id]/mwe-classifications/[classificationId]/route.ts";
  assert.equal(expectedStatuses[mweDecisionPath]?.PATCH, "GAP");
  const mweDecision = m.allApiRouteFiles[mweDecisionPath].methods.find(row => row.name === "PATCH");
  assert.equal(mweDecision?.status, "COVERED");
  assert.equal(mweDecision?.testedBy?.file, "scripts/qa/tenant-mwe-decision-http.mjs");
  assert.equal(mweDecision?.testedBy?.routeBlobSha, m.allApiRouteFiles[mweDecisionPath].gitBlobSha);
  assert.equal(mweDecision?.testedBy?.workflowBlobSha, "584d159f2d2c250e182d0942188f293baebc2141");
  assert.equal(mweDecision?.testedBy?.independentlyAccepted, false);
  assert.equal(mweDecision?.testedBy?.productionCertified, false);
  expectedStatuses[mweDecisionPath].PATCH = "COVERED";
  const mweDecisionCredits = 1;
  // Credit after the snapshot: POST account/password, from its dedicated two-attacker harness (merged proof #1794). The inventory
  // test verifies the receipt, blob identity and cited lines exactly.
  const accountPasswordPath = "src/app/api/account/password/route.ts";
  assert.equal(expectedStatuses[accountPasswordPath]?.POST, "GAP", "account/password POST must start GAP in the reviewed snapshot");
  const accountPassword = m.allApiRouteFiles[accountPasswordPath].methods.find(row => row.name === "POST");
  assert.equal(accountPassword?.status, "COVERED");
  assert.equal(accountPassword.testedBy?.file, "scripts/qa/tenant-account-password-http.mjs");
  assert.equal(accountPassword.testedBy.proofPullRequest, 1794);
  assert.equal(accountPassword.testedBy.independentSecurityReview, "PENDING");
  assert.equal(accountPassword.testedBy.productionTested, false);
  expectedStatuses[accountPasswordPath].POST = "COVERED";
  const accountPasswordCredits = 1;
  // Credit after the snapshot: POST payout-reconciliation, from the existing real-HTTP PayMongo isolation harness's exact main-head receipt
  // (loopback-synthetic provider only). The inventory test verifies the receipt, blob identity and cited lines exactly.
  const payoutReconciliationPath = "src/app/api/payroll-runs/[id]/payout-reconciliation/route.ts";
  assert.equal(expectedStatuses[payoutReconciliationPath]?.POST, "GAP", "payout-reconciliation POST must start GAP in the reviewed snapshot");
  const payoutReconciliation = m.allApiRouteFiles[payoutReconciliationPath].methods.find(row => row.name === "POST");
  assert.equal(payoutReconciliation?.status, "COVERED");
  assert.equal(payoutReconciliation.testedBy?.file, "scripts/qa/paymongo-export-isolation-local.mjs");
  assert.equal(payoutReconciliation.testedBy.providerMode, "loopback-synthetic-paymongo");
  assert.equal(payoutReconciliation.testedBy.independentSecurityReview, "PENDING");
  assert.equal(payoutReconciliation.testedBy.productionTested, false);
  expectedStatuses[payoutReconciliationPath].POST = "COVERED";
  const payoutReconciliationCredits = 1;
  // Credit after the snapshot: POST payroll-runs/[id]/exports, from its dedicated three-mode proof on a loopback-synthetic PayMongo
  // (cited run on main). The inventory test verifies the receipt, blob identity and cited lines exactly.
  const exportsPostPath = "src/app/api/payroll-runs/[id]/exports/route.ts";
  assert.equal(expectedStatuses[exportsPostPath]?.POST, "GAP", "exports POST must start GAP in the reviewed snapshot");
  const exportsPost = m.allApiRouteFiles[exportsPostPath].methods.find(row => row.name === "POST");
  assert.equal(exportsPost?.status, "COVERED");
  assert.equal(exportsPost.testedBy?.file, "scripts/qa/tenant-payroll-exports-post-http.mjs");
  assert.equal(exportsPost.testedBy.providerMode, "loopback-synthetic-paymongo");
  assert.equal(exportsPost.testedBy.independentSecurityReview, "PENDING");
  assert.equal(exportsPost.testedBy.productionTested, false);
  expectedStatuses[exportsPostPath].POST = "COVERED";
  const exportsPostCredits = 1;
  // Credit after the snapshot: POST pilot-signoff and GET xendit-payout, from the dedicated payroll-run-actions harness (merged proof #1803).
  // The inventory test verifies the receipt, blob identity and cited lines exactly.
  const pilotSignoffPath = "src/app/api/payroll-runs/[id]/pilot-signoff/route.ts";
  const xenditPayoutPath = "src/app/api/payroll-runs/[id]/xendit-payout/route.ts";
  assert.equal(expectedStatuses[pilotSignoffPath]?.POST, "GAP", "pilot-signoff POST must start GAP in the reviewed snapshot");
  assert.equal(expectedStatuses[xenditPayoutPath]?.GET, "GAP", "xendit-payout GET must start GAP in the reviewed snapshot");
  for (const [path, name] of [[pilotSignoffPath, "POST"], [xenditPayoutPath, "GET"]]) {
    const credited = m.allApiRouteFiles[path].methods.find(row => row.name === name);
    assert.equal(credited?.status, "COVERED");
    assert.equal(credited.testedBy?.file, "scripts/qa/tenant-payroll-run-actions-http.mjs");
    assert.equal(credited.testedBy.independentSecurityReview, "PENDING");
    assert.equal(credited.testedBy.productionTested, false);
    expectedStatuses[path][name] = "COVERED";
  }
  assert.equal(m.allApiRouteFiles[xenditPayoutPath].methods.find(row => row.name === "POST").status, "GAP", "xendit-payout POST stays GAP");
  const payrollRunActionsCredits = 2;
  // Credit after the snapshot: GET/POST loyverse and square-sandbox, from the dedicated POS-demand harness (merged proof #1806). The
  // inventory test verifies the receipt, blob identity and cited lines exactly.
  const posDemandPaths = ["src/app/api/workforce/demand-observations/loyverse/route.ts", "src/app/api/workforce/demand-observations/square-sandbox/route.ts"];
  for (const path of posDemandPaths) {
    for (const name of ["GET", "POST"]) {
      assert.equal(expectedStatuses[path]?.[name], "GAP", path + " " + name + " must start GAP in the reviewed snapshot");
      const credited = m.allApiRouteFiles[path].methods.find(row => row.name === name);
      assert.equal(credited?.status, "COVERED");
      assert.equal(credited.testedBy?.file, "scripts/qa/tenant-pos-demand-http.mjs");
      assert.equal(credited.testedBy.independentSecurityReview, "PENDING");
      assert.equal(credited.testedBy.productionTested, false);
      expectedStatuses[path][name] = "COVERED";
    }
  }
  const spendManagedCredits=verifySpendManaged(m);
  for(const key of spendManagedTargets){ const [verb,route]=key.split(" "); expectedStatuses["src/app/api/"+route+"/route.ts"][verb]="COVERED"; }
  const posDemandCredits = 4;
  // Credit after the snapshot: POST/PATCH multi-entity/transfers, from the dedicated two-attacker harness (merged proof #1853).
  // The inventory test verifies the receipt, blob identity and cited lines exactly.
  const transfersPath = "src/app/api/multi-entity/transfers/route.ts";
  for (const name of ["POST", "PATCH"]) {
    assert.equal(expectedStatuses[transfersPath]?.[name], "GAP", "transfers " + name + " must start GAP in the reviewed snapshot");
    const credited = m.allApiRouteFiles[transfersPath].methods.find(row => row.name === name);
    assert.equal(credited?.status, "COVERED");
    assert.equal(credited.testedBy?.file, "scripts/qa/tenant-transfers-http.mjs");
    assert.equal(credited.testedBy.proofPullRequest, 1853);
    assert.equal(credited.testedBy.independentSecurityReview, "PENDING");
    assert.equal(credited.testedBy.productionTested, false);
    expectedStatuses[transfersPath][name] = "COVERED";
  }
  const transfersCredits = 2;
  // Credit after the snapshot: POST bir/annual-employer/candidate, from its dedicated two-attacker harness (merged proof #1891).
  const birCandidatePath = "src/app/api/bir/annual-employer/candidate/route.ts";
  assert.equal(expectedStatuses[birCandidatePath]?.POST, "GAP", "BIR candidate POST must start GAP in the reviewed snapshot");
  const birCandidate = m.allApiRouteFiles[birCandidatePath].methods.find(row => row.name === "POST");
  assert.equal(birCandidate?.status, "COVERED");
  assert.equal(birCandidate.testedBy?.file, "scripts/qa/tenant-bir1604c-candidate-post-http.mjs");
  assert.equal(birCandidate.testedBy.proofPullRequest, 1891);
  assert.equal(birCandidate.testedBy.independentSecurityReview, "PENDING");
  assert.equal(birCandidate.testedBy.productionTested, false);
  expectedStatuses[birCandidatePath].POST = "COVERED";
  const birCandidateCredits = 1;
  // Credit after the snapshot: POST auth/logout, from its dedicated two-attacker harness (merged proof #1795). The inventory
  // test verifies the receipt, blob identity and cited lines exactly.
  const authLogoutPath = "src/app/api/auth/logout/route.ts";
  assert.equal(expectedStatuses[authLogoutPath]?.POST, "GAP", "auth/logout POST must start GAP in the reviewed snapshot");
  const authLogout = m.allApiRouteFiles[authLogoutPath].methods.find(row => row.name === "POST");
  assert.equal(authLogout?.status, "COVERED");
  assert.equal(authLogout.testedBy?.file, "scripts/qa/tenant-auth-logout-http.mjs");
  assert.equal(authLogout.testedBy.proofPullRequest, 1795);
  assert.equal(authLogout.testedBy.independentSecurityReview, "PENDING");
  assert.equal(authLogout.testedBy.productionTested, false);
  expectedStatuses[authLogoutPath].POST = "COVERED";
  const authLogoutCredits = 1;
  const receiptCredits = verifyReceiptCredits(m);
  const rootCredits = verifyRootCredits(m);
  const emailCredits = verifyEmailCredit(m, JSON.parse(readFileSync("scripts/qa/tenant-email-verification-credit-receipt.json","utf8")));
  assert.equal(expectedStatuses["src/app/api/account/email/verify/route.ts"].POST,"GAP");
  expectedStatuses["src/app/api/account/email/verify/route.ts"].POST="COVERED";
  const careersPath = "src/app/api/careers/admin/route.ts";
  assert.equal(expectedStatuses[careersPath]?.PATCH, "GAP", "Careers PATCH originally uncredited");
  const careersPatchCredits = verifyCareersPatchCredit(m);
  assert.equal(careersPatchCredits, 1);
  expectedStatuses[careersPath].PATCH = "COVERED";
  // #1826 is disjoint from the two year-end methods already credited on main.
  // Both POST claims are backed by the same immutable fictional PG16 receipt.
  const billingCredits = verifyBillingSubscriptionCredits(m);
  assert.equal(billingCredits, 2);
  for (const path of ["src/app/api/billing/subscription/start/route.ts",
                      "src/app/api/billing/subscription/cancel/route.ts"]) {
    assert.equal(expectedStatuses[path]?.POST, "GAP",
      "Billing POST must begin uncredited in the historical six-method snapshot");
    expectedStatuses[path].POST = "COVERED";
  }
  const migrationPath = "src/app/api/migrations/route.ts";
  assert.equal(expectedStatuses[migrationPath]?.POST, "GAP");
  const migrationCredits = verifyMigrationPostCredit(m);
  assert.equal(migrationCredits, 1);
  expectedStatuses[migrationPath].POST = "COVERED";
  for (const verb of ["POST","PATCH"]) {
    assert.equal(expectedStatuses["src/app/api/workforce-planning/route.ts"][verb],"GAP");
    expectedStatuses["src/app/api/workforce-planning/route.ts"][verb]="COVERED";
  }
  for (const verb of ["GET", "POST"]) {
    assert.equal(expectedStatuses["src/app/api/expenses/receipts/route.ts"][verb], "GAP");
    expectedStatuses["src/app/api/expenses/receipts/route.ts"][verb] = "COVERED";
  }
  // Credit after the snapshot: payroll submit-review and release, from the existing two-attacker money-lifecycle journey's
  // exact-main-head receipt (both matrix legs). The inventory test verifies the receipt and blob identity exactly.
  const reviewReleasePaths = ["src/app/api/payroll-runs/[id]/submit-review/route.ts", "src/app/api/payroll-runs/[id]/release/route.ts"];
  for (const path of reviewReleasePaths) {
    assert.equal(expectedStatuses[path]?.POST, "GAP", path + " POST must start GAP in the reviewed snapshot");
    const method = m.allApiRouteFiles[path].methods.find(row => row.name === "POST");
    assert.equal(method?.status, "COVERED");
    assert.equal(method.testedBy?.file, "scripts/qa/tenant-money-lifecycle-http.mjs");
    assert.equal(method.testedBy.workflowRunId, 42063867383);
    assert.equal(method.testedBy.independentSecurityReview, "PENDING");
    assert.equal(method.testedBy.productionTested, false);
    expectedStatuses[path].POST = "COVERED";
  }
  const reviewReleaseCredits = reviewReleasePaths.length;
  // Preserve #1764's one static-public catalog exception, without tenant credit.
  const publicCatalogPath = "src/app/api/v1/route.ts";
  assert.equal(expectedStatuses[publicCatalogPath]?.GET, "GAP");
  const publicCatalog = m.allApiRouteFiles[publicCatalogPath]?.methods.find(row => row.name === "GET");
  assert.equal(publicCatalog?.status, "PUBLIC-BY-DESIGN");
  assert.equal(publicCatalog?.testedBy, null);
  expectedStatuses[publicCatalogPath].GET = "PUBLIC-BY-DESIGN";
  const yearEndCredits = verifyYearEndPairState(m);
  assert.equal(yearEndCredits, isYearEndHeld(m) ? 0 : 2, "Two distinct source-current #1804 methods, or held at zero credit");
  for (const spec of YEAR_END_RECEIPTS) {
    assert.equal(expectedStatuses[spec.path]?.[spec.method], "GAP",
      "Only a previously uncredited method may be promoted: " + spec.method);
    if (yearEndCredits) expectedStatuses[spec.path][spec.method] = "COVERED";
  }
  const invitationAcceptCredits = verifyInvitationAcceptCredits(m);
  assert.equal(invitationAcceptCredits, 2);
  for (const verb of ["GET", "POST"]) {
    const p = "src/app/api/invitations/accept/route.ts";
    assert.equal(expectedStatuses[p]?.[verb], "GAP", "Frozen invitation method starts GAP");
    expectedStatuses[p][verb] = "COVERED";
  }
  const enterpriseCredits = verifyEnterprisePostCredit(m);
  assert.equal(expectedStatuses["src/app/api/enterprise/route.ts"].POST, "GAP");
  expectedStatuses["src/app/api/enterprise/route.ts"].POST = "COVERED";
  const securityCredits=verifySecurityCredits(m);assert.equal(securityCredits,3);
  for(const t of SECURITY_TARGETS){assert.equal(expectedStatuses[t.path][t.method],'GAP');expectedStatuses[t.path][t.method]='COVERED';}
  const mergedRecoveryCredits = verifyRecoveryCredits(m);
  assert.equal(mergedRecoveryCredits, 3);
  for (const target of RECOVERY_TARGETS) {
    assert.equal(expectedStatuses[target.path]?.[target.method], "GAP",
      "Only distinct previously GAP methods may be credited");
    expectedStatuses[target.path][target.method] = "COVERED";
  }
  // Approved 2026-11-09 non-session classifications are NOT tenant proof credits.
  // Pin each route and method explicitly; all other original credits remain immutable.
  const ownerTokenClassifications = [["src/app/api/jobs/cron/route.ts","GET"],["src/app/api/jobs/dispatch-readiness/route.ts","GET"],["src/app/api/jobs/status/route.ts","GET"],["src/app/api/jobs/tick/route.ts","POST"],["src/app/api/webhooks/drain/route.ts","POST"],["src/app/api/capabilities/route.ts","GET"],["src/app/api/readiness/route.ts","GET"],["src/app/api/readiness/billing/route.ts","GET"],["src/app/api/readiness/database-target/route.ts","GET"],["src/app/api/readiness/deployment/route.ts","GET"],["src/app/api/readiness/pilot-status/route.ts","GET"]];
  for (const [path, verb] of ownerTokenClassifications) {
    assert.equal(expectedStatuses[path][verb], "GAP", "Only a GAP can be owner-reclassified");
    const row = m.allApiRouteFiles[path].methods.find(value => value.name === verb);
    assert.equal(row.status, "PRIVILEGED-OPERATIONS-TOKEN-ONLY");
    assert.equal(row.testedBy, null, "Authentication classification cannot invent method proof");
    assert.equal(row.privilegedOperation?.approvedOn, "2026-11-09");
    assert.equal(row.privilegedOperation?.methodCoverageCredits, 0);
    assert.equal(row.privilegedOperation?.productionCertified, false);
    expectedStatuses[path][verb] = "PRIVILEGED-OPERATIONS-TOKEN-ONLY";
  }
  const accountEmailRequestCredits = verifyAccountEmailRequestCredit(m);
  assert.equal(expectedStatuses["src/app/api/account/email/route.ts"].POST, "GAP", "Only an uncredited account-email method may be promoted");
  expectedStatuses["src/app/api/account/email/route.ts"].POST = "COVERED";
  // Owner-approved 2026-11-09 public classifications are NOT tenant-private method credits.
  const ownerClassifications = [["src/app/api/careers/route.ts","GET"],["src/app/api/careers/route.ts","POST"],["src/app/api/demo-requests/route.ts","POST"],["src/app/api/payroll-outsourcing/quote/route.ts","POST"]];
  for (const [path, verb] of ownerClassifications) {
    assert.equal(expectedStatuses[path][verb], "GAP", "Only a GAP may be reclassified");
    const row = m.allApiRouteFiles[path].methods.find(value => value.name === verb);
    assert.equal(row.status, "PUBLIC-BY-DESIGN");
    assert.equal(row.testedBy, null, "Public status may not borrow tenant-method proof");
    assert.equal(row.publicBoundary?.approvedOn, "2026-11-09");
    assert.equal(row.publicBoundary?.fourPartMethodCredit, false);
    expectedStatuses[path][verb] = "PUBLIC-BY-DESIGN";
  }
  // 2026-11-11: distinct source-reviewed architecture classifications from
  // previously uncredited GAPs. These are NOT tenant-private method credits.
  // Their already-merged route/proof SHA and zero-credit evidence are checked
  // by tenant-architectural-gap-classifications.test.mjs on this same checkout.
  const architecturePublic = [
    ["src/app/api/setup/route.ts", "GET"],
    ["src/app/api/setup/route.ts", "POST"],
    ["src/app/api/intake-challenge/route.ts", "POST"],
    ["src/app/api/signup/route.ts", "POST"],
    ["src/app/api/signup/resend/route.ts", "POST"],
    ["src/app/api/signup/verify/route.ts", "POST"],
    ["src/app/api/auth/saml/start/[providerId]/route.ts", "GET"],
    ["src/app/api/auth/saml/acs/[providerId]/route.ts", "POST"],
  ];
  for (const [path, verb] of architecturePublic) {
    assert.equal(expectedStatuses[path]?.[verb], "GAP",
      "Architecture classification may replace only a previously GAP method");
    const row = m.allApiRouteFiles[path].methods.find(item => item.name === verb);
    assert.equal(row.status, "PUBLIC-BY-DESIGN");
    assert.equal(row.testedBy, null, "Public entrypoint is never a tenant-private COVERED credit");
    assert.equal(row.classificationEvidence?.methodCoverageCredits, 0);
    assert.equal(row.classificationEvidence?.sourceBlobSha, m.allApiRouteFiles[path].gitBlobSha);
    assert.equal(row.classificationEvidence?.productionCertified, false);
    expectedStatuses[path][verb] = "PUBLIC-BY-DESIGN";
  }
  const architectureToken = ["src/app/api/hcm/work-items/escalate/route.ts", "POST"];
  assert.equal(expectedStatuses[architectureToken[0]]?.[architectureToken[1]], "GAP");
  const workerMethod = m.allApiRouteFiles[architectureToken[0]].methods.find(
    row => row.name === architectureToken[1]);
  assert.equal(workerMethod.status, "PRIVILEGED-OPERATIONS-TOKEN-ONLY");
  assert.equal(workerMethod.testedBy, null, "Token-only scheduler earns no tenant-private credit");
  assert.equal(workerMethod.privilegedOperation?.methodCoverageCredits, 0);
  assert.equal(workerMethod.privilegedOperation?.routeBlobSha,
    m.allApiRouteFiles[architectureToken[0]].gitBlobSha);
  assert.equal(workerMethod.privilegedOperation?.productionCertified, false);
  expectedStatuses[architectureToken[0]][architectureToken[1]] =
    "PRIVILEGED-OPERATIONS-TOKEN-ONLY";
  const filingPatchCredits = verifyFilingPatchCredit(m);
  assert.equal(filingPatchCredits, 1);
  assert.equal(expectedStatuses[FILING_PATH].PATCH, "GAP");
  expectedStatuses[FILING_PATH].PATCH = "COVERED";
  const approvalCredits=verifyApprovalsCredit(m);assert.equal(expectedStatuses[APPROVALS_PATH].PATCH,'GAP');expectedStatuses[APPROVALS_PATH].PATCH='COVERED';
  const studioCredits=verifyStudioPostCredit(m);assert.equal(expectedStatuses[STUDIO_POST_PATH].POST,'GAP');expectedStatuses[STUDIO_POST_PATH].POST='COVERED';
  const readinessGetCredits=verifyWorkspaceReadinessCredit(m);assert.equal(expectedStatuses[READINESS_GET_PATH].GET,'GAP');expectedStatuses[READINESS_GET_PATH].GET='COVERED';
  const checkoutCredits = verifyCheckoutCredit(m);
  assert.equal(expectedStatuses[CHECKOUT_PATH].POST, 'GAP');
  expectedStatuses[CHECKOUT_PATH].POST = 'COVERED';
  // The Worker 360 GET was formerly credited only for parent-organization
  // isolation. Its source now adds legal-employer checks, so that historical
  // method receipt may not certify the new route until exact-head PG16 proof.
  const worker360Path = "src/app/api/hcm/worker-360/route.ts";
  assert.equal(expectedStatuses[worker360Path].GET, "COVERED",
    "Frozen main snapshot must preserve the previously credited GET");
  const worker360File = m.allApiRouteFiles[worker360Path];
  const worker360Get = worker360File.methods.find(entry => entry.name === "GET");
  assert.equal(worker360File.gitBlobSha, "19875021d750b722fc69e0fe939e57928a158af9");
  assert.equal(blobSha(worker360Path), worker360File.gitBlobSha);
  assert.equal(worker360Get.status, "GAP");
  assert.equal(worker360Get.testedBy, null);
  assert.equal(worker360Get.reviewedUncertified?.kind,
    "worker360-legal-employer-source-supersession-zero-credit");
  assert.equal(worker360Get.reviewedUncertified?.oldSourceBlobSha,
    "78874e3800c9648b2e9e8895a4c0f1b2db9e2e62");
  assert.equal(worker360Get.reviewedUncertified?.historicalProof?.file,
    "scripts/qa/tenant-table-http.mjs");
  assert.equal(worker360Get.reviewedUncertified?.coverageCredits, 0);
  assert.equal(worker360Get.reviewedUncertified?.independentSecurityReview, "PENDING");
  expectedStatuses[worker360Path].GET = "GAP";
  assert.deepEqual(methodStatuses(m), expectedStatuses,
    "Preserves inherited receipts and newer exports credit, with only source-pinned Worker 360 demoted");
  const expectedCounts = {
    COVERED: snapshot.counts.COVERED + compliancePostCredits.length + creditedYearEndPromotions.length + issuedPromotions.length + payoutCredits + recovery.methodsCredited + resendCredits + subscriptionsCredits + staffingGetCredits + effectiveChangeCredits + reviewReleaseCredits + mweDecisionCredits + accountPasswordCredits + authLogoutCredits + receiptCredits + rootCredits + payoutReconciliationCredits + exportsPostCredits + payrollRunActionsCredits + emailCredits + careersPatchCredits + billingCredits + posDemandCredits + transfersCredits + birCandidateCredits + yearEndCredits + spendManagedCredits + migrationCredits + mergedRecoveryCredits + securityCredits + enterpriseCredits + accountEmailRequestCredits + invitationAcceptCredits,
    "PUBLIC-BY-DESIGN": snapshot.counts["PUBLIC-BY-DESIGN"] + 1,
    GAP: snapshot.counts.GAP - compliancePostCredits.length - creditedYearEndPromotions.length - issuedPromotions.length - payoutCredits - recovery.methodsCredited - resendCredits - subscriptionsCredits - staffingGetCredits - effectiveChangeCredits - reviewReleaseCredits - mweDecisionCredits - accountPasswordCredits - authLogoutCredits - receiptCredits - rootCredits - payoutReconciliationCredits - exportsPostCredits - payrollRunActionsCredits - emailCredits - careersPatchCredits - billingCredits - posDemandCredits - transfersCredits - birCandidateCredits - yearEndCredits - spendManagedCredits - migrationCredits - mergedRecoveryCredits - securityCredits - enterpriseCredits - accountEmailRequestCredits - invitationAcceptCredits - 1,
  };
  expectedCounts.COVERED += studioCredits + approvalCredits + readinessGetCredits + filingPatchCredits + checkoutCredits;
  expectedCounts.COVERED -= 1; // Revised Worker 360 source invalidates old organization-only GET credit.
  expectedCounts.GAP -= studioCredits + approvalCredits + readinessGetCredits + filingPatchCredits + checkoutCredits;
  expectedCounts.GAP += 1; // No worker 360 legal-employer method acceptance is claimed.
  expectedCounts.GAP -= ownerClassifications.length;
  expectedCounts["PUBLIC-BY-DESIGN"] += ownerClassifications.length;
  expectedCounts.GAP -= ownerTokenClassifications.length;
  expectedCounts["PRIVILEGED-OPERATIONS-TOKEN-ONLY"] = ownerTokenClassifications.length;
  expectedCounts.GAP -= architecturePublic.length + 1;
  expectedCounts["PUBLIC-BY-DESIGN"] += architecturePublic.length;
  expectedCounts["PRIVILEGED-OPERATIONS-TOKEN-ONLY"] += 1;
  assert.deepEqual(counts, expectedCounts,
    "The source-revoked year-end pair remains GAP; three exact-head method receipts are added");
  assert.equal(m.metrics.methods, allMethods.length);
  assert.equal(m.metrics.coveredAfter, counts.COVERED);
  assert.equal(m.metrics.publicByDesign, counts["PUBLIC-BY-DESIGN"]);
  assert.equal(m.metrics.privilegedOperationsTokenOnly, counts["PRIVILEGED-OPERATIONS-TOKEN-ONLY"]);
  assert.equal(m.metrics.gap, counts.GAP);
  assert.equal(m.metrics.scopedPagesAndActions, 21);
  assert.match(m.acceptanceStatus, /^NOT ACCEPTED:/);
  assert.ok(inventory.includes(String(counts.COVERED) + " COVERED"));
  const yearEndHeldMethods = 2 - yearEndCredits;
  const frozenCovered = 367 - yearEndHeldMethods + studioCredits + approvalCredits + readinessGetCredits + filingPatchCredits + checkoutCredits + exportsPostCredits - 1;
  const frozenPublic = 7 + architecturePublic.length;
  const frozenPrivileged = 11 + 1; // The HCM SLA worker is token-only, never a tenant-method credit.
  const frozenGaps = 21 + yearEndHeldMethods - studioCredits - approvalCredits - readinessGetCredits - filingPatchCredits - checkoutCredits - exportsPostCredits
    - architecturePublic.length - 1 + 1; // Revoke historical Worker 360 GET credit.
  assert.equal(frozenCovered + frozenPublic + frozenPrivileged + frozenGaps, 406,
    "The original frozen batch population must not change");
  assert.equal(frozenGaps, m.metrics.gap, "The classification may not hide other remaining method GAPs");
  assert.ok(plan.includes(
    "Frozen subtotal (2026-11-11 classification proposal): **" + frozenCovered + " COVERED + "
    + frozenPublic + " PUBLIC-BY-DESIGN + " + frozenPrivileged
    + " PRIVILEGED-OPERATIONS-TOKEN-ONLY + " + frozenGaps + " GAP = 406**"),
    "Current frozen subtotal must preserve prior credits while tracking only nine relabels");
  assert.ok(plan.includes("ZERO CREDITS / NOT ACCEPTED"));

  // When a full checkout has origin/main, also verify that it agrees with the
  // exact-base fixture. A changed main requires a deliberate re-review/re-pin.
  let hasMainRef = false;
  try {
    execFileSync("git", ["rev-parse", "--verify", "refs/remotes/origin/main"],
      { stdio: "ignore" });
    hasMainRef = true;
  } catch {
    // Missing remote ref is normal in CI with fetch-depth: 1.
  }
  if (hasMainRef) {
    const baseline = JSON.parse(execFileSync("git",
      ["show", "origin/main:scripts/qa/tenant-isolation-coverage-manifest.json"],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));
    const payoutMethod = baseline.allApiRouteFiles["src/app/api/payout-profiles/route.ts"]
      .methods.find(method => method.name === "PATCH");
    const baselineHasPayout = payoutMethod?.status === "COVERED";
    if (baselineHasPayout) verifyPayoutProfileCredit(baseline);
    const mainYearEnd = baseline.allApiRouteFiles["src/app/api/year-end/route.ts"];
    const baselineHasAnyYearEnd = mainYearEnd.methods.every(method => method.status === "COVERED");
    const baselineHasOldRoute = baselineHasAnyYearEnd &&
      mainYearEnd.gitBlobSha === "7572c6111cf40d398b3cc8c1f940efd0a9b8d362";
    const baselineHasCurrentRoute = baselineHasAnyYearEnd &&
      mainYearEnd.gitBlobSha === "f040f5bbbc3df275d32d23f1728b1b0345f77814";
    assert.ok(!baselineHasAnyYearEnd || baselineHasOldRoute || baselineHasCurrentRoute,
      "Changed year-end source cannot inherit old proof");
    if (baselineHasOldRoute) {
      assert.equal(mainYearEnd.gitBlobSha, "7572c6111cf40d398b3cc8c1f940efd0a9b8d362",
        "old-source year-end receipts must be pinned before supersession");
      for (const method of mainYearEnd.methods) {
        assert.equal(method.testedBy?.routeBlobSha, mainYearEnd.gitBlobSha);
        assert.equal(method.testedBy?.workflowRunId, 41446394887);
        assert.equal(method.testedBy?.independentlyAccepted, false);
      }
    } else if (baselineHasCurrentRoute && isYearEndHeld(m)) {
      // This change withdraws the credit (annualization source moved): the merged baseline must be the exact #1804 receipt.
      for (const method of mainYearEnd.methods) {
        assert.equal(method.status, "COVERED");
        assert.equal(method.testedBy?.proofPullRequest, 1804);
        assert.equal(method.testedBy?.workflowRunId, 42254117862);
        assert.equal(method.testedBy?.verifiedPrHeadSha, "d79db85b2a2ca0276810634dccaf904fd4469099");
      }
      assert.equal(verifyYearEndHold(m), 0);
    } else if (baselineHasCurrentRoute) {
      assert.equal(verifyYearEndCredits(baseline), 2,
        "Merged current-source year-end evidence must match exact source and PG16 job");
    } else {
      for (const method of mainYearEnd.methods) {
        assert.equal(method.status, "GAP");
        assert.equal(method.testedBy, null);
      }
    }
    // Main now contains the three individually source-pinned #1760 recoveries.
    // Either ALL three exact-method credits are present or none is. Never
    // infer coverage from a loose count or permit an unreviewed partial merge.
    const mainRecoveryCredits = EVIDENCE.map(e =>
      baseline.allApiRouteFiles["src/app/api/" + e.route + "/route.ts"]
        ?.methods.find(row => row.name === e.method)?.status === "COVERED");
    assert.ok(mainRecoveryCredits.every(credited => credited === mainRecoveryCredits[0]),
      "origin/main must not contain a partial five-method proof recovery");
    const baselineHasRecovery = mainRecoveryCredits[0];
    // Transfer POST/PATCH must be reconciled as a pair even when the three
    // separate historical recovery receipts are absent from the base branch.
    const baselineTransferCredits = ["POST", "PATCH"].filter(verb =>
      baseline.allApiRouteFiles["src/app/api/multi-entity/transfers/route.ts"]
        .methods.find(method => method.name === verb)?.status === "COVERED").length;
    assert.ok([0, 2].includes(baselineTransferCredits),
      "The two transfer credits must be either both held or both independently evidenced");
    if (baselineHasRecovery) {
      // Verify the historical main ledger against main's own bytes for each historical proof source, not this feature's revised files.
      const readMainFile = path => execFileSync("git", ["show", "origin/main:" + path], { maxBuffer: 16 * 1024 * 1024 });
      const receipt = verifyFiveMethodCredits(baseline, readMainFile);
      assert.equal(receipt.methodsCredited, 3);
      assert.equal(receipt.methodsHeld, 2 - baselineTransferCredits,
        "Historical five-method holds must reflect only the dedicated validated transfer promotion");
    }
    // Provider-callback credits merged to main after the reviewed snapshot. Each is accepted on main only when the
    // exact method carries its own receipt under proofPolicy.providerCallback with independent review still PENDING;
    // a credit that is absent from main is simply not expected, so this block never goes stale on merge order.
    const mainProviderCredits = [
      ["src/app/api/webhooks/resend/route.ts", "scripts/qa/tenant-webhook-resend-http.mjs"],
      ["src/app/api/webhooks/xendit/subscriptions/route.ts", "scripts/qa/tenant-webhook-xendit-subscriptions-http.mjs"],
    ].filter(([path, receipt]) => {
      const row = baseline.allApiRouteFiles[path]?.methods.find(item => item.name === "POST");
      if (row?.status !== "COVERED") return false;
      assert.equal(row.testedBy?.file, receipt, path + ": main credit must carry its own receipt");
      assert.equal(row.testedBy.rule, "proofPolicy.providerCallback");
      assert.equal(row.testedBy.independentSecurityReview, "PENDING");
      return true;
    });
    // Dedicated-harness credits merged to main after the reviewed snapshot (#1781 effective-change POST; payroll
    // submit-review/release from the money-lifecycle receipt). Each counts only with its own receipt file and review PENDING;
    // all three sit in the frozen 406-method queue.
    const mainDedicatedCredits = [
      ["src/app/api/hcm/effective-changes/route.ts", "scripts/qa/tenant-hcm-effective-change-post-http.mjs"],
      // #1794 was merged independently; accept this main-only credit only with its matching receipt.
      ["src/app/api/account/password/route.ts", "scripts/qa/tenant-account-password-http.mjs"],
      ["src/app/api/auth/logout/route.ts", "scripts/qa/tenant-auth-logout-http.mjs"],
      ["src/app/api/payroll-runs/[id]/payout-reconciliation/route.ts", "scripts/qa/paymongo-export-isolation-local.mjs"],
      ["src/app/api/payroll-runs/[id]/exports/route.ts", "scripts/qa/tenant-payroll-exports-post-http.mjs"],
      ["src/app/api/payroll-runs/[id]/pilot-signoff/route.ts", "scripts/qa/tenant-payroll-run-actions-http.mjs"],
      ["src/app/api/payroll-runs/[id]/xendit-payout/route.ts", "scripts/qa/tenant-payroll-run-actions-http.mjs", "GET"],
      ["src/app/api/multi-entity/transfers/route.ts", "scripts/qa/tenant-transfers-http.mjs"],
      ["src/app/api/multi-entity/transfers/route.ts", "scripts/qa/tenant-transfers-http.mjs", "PATCH"],
      ["src/app/api/bir/annual-employer/candidate/route.ts", "scripts/qa/tenant-bir1604c-candidate-post-http.mjs"],
      ["src/app/api/workforce/demand-observations/loyverse/route.ts", "scripts/qa/tenant-pos-demand-http.mjs", "GET"],
      ["src/app/api/workforce/demand-observations/loyverse/route.ts", "scripts/qa/tenant-pos-demand-http.mjs"],
      ["src/app/api/workforce/demand-observations/square-sandbox/route.ts", "scripts/qa/tenant-pos-demand-http.mjs", "GET"],
      ["src/app/api/workforce/demand-observations/square-sandbox/route.ts", "scripts/qa/tenant-pos-demand-http.mjs"],
      ["src/app/api/payroll-runs/[id]/submit-review/route.ts", "scripts/qa/tenant-money-lifecycle-http.mjs"],
      ["src/app/api/payroll-runs/[id]/release/route.ts", "scripts/qa/tenant-money-lifecycle-http.mjs"],
    ].filter(([path, receipt, verb = "POST"]) => {
      const row = baseline.allApiRouteFiles[path]?.methods.find(item => item.name === verb);
      if (row?.status !== "COVERED") return false;
      assert.equal(row.testedBy?.file, receipt, path + ": main credit must carry its own receipt");
      assert.equal(row.testedBy.independentSecurityReview, "PENDING");
      assert.equal(row.testedBy.productionTested, false);
      return true;
    });
    // #1776 introduced exactly one additional callback credit on main.
    // Recognize it ONLY if its entire pinned source/receipt record matches
    // the expected Resend method, not because the aggregate count changed.
    const baselineResend = baseline.allApiRouteFiles[resendPath]
      .methods.find(row => row.name === "POST");
    const baselineHasResend = baselineResend?.status === "COVERED";
    if (baselineHasResend) {
      assert.deepEqual(baselineResend, resendMethod,
        "origin/main Resend POST must match the complete #1763 source-pinned receipt");
      assert.equal(baselineResend.testedBy?.workflowRunId, 41829420219);
      assert.equal(baselineResend.testedBy?.workflowJobId, 126572429402);
      assert.equal(baselineResend.testedBy?.verifiedPrHeadSha,
        "5e1aeba102cc66486c251d8f6d50432fcb4a4cdc");
      assert.equal(baselineResend.testedBy?.independentSecurityReview, "PENDING");
      assert.equal(baselineResend.testedBy?.productionTested, false);
    } else {
      assert.equal(baselineResend?.status, "GAP");
      assert.equal(baselineResend?.testedBy, null);
    }
    const baselineSecurity=SECURITY_TARGETS.filter(t=>baseline.allApiRouteFiles[t.path].methods.find(x=>x.name===t.method).status==='COVERED');
    if(baselineSecurity.length){assert.equal(baselineSecurity.length,3);verifySecurityCredits(baseline);}
    const expectedOriginalMain = JSON.parse(JSON.stringify(
      baselineHasPayout ? expectedAfterPayout : expectedBeforePayout));
    for(const t of baselineSecurity)expectedOriginalMain[t.path][t.method]='COVERED';

    // Recognize only the merged enterprise POST if the complete #1846
    // source-pinned receipt validates on this branch. No independent approval.
    const baselineEnterprise = baseline.allApiRouteFiles["src/app/api/enterprise/route.ts"]
      ?.methods.find(row => row.name === "POST");
    const baselineEnterpriseCredits = baselineEnterprise?.status === "COVERED" ? 1 : 0;
    if (baselineEnterpriseCredits) {
      assert.equal(verifyEnterprisePostCredit(baseline), 1);
      expectedOriginalMain["src/app/api/enterprise/route.ts"].POST = "COVERED";
    } else {
      assert.equal(baselineEnterprise?.status, "GAP");
      assert.equal(baselineEnterprise?.testedBy, null);
    }

    const baselineRecovery=RECOVERY_TARGETS.filter(t=>baseline.allApiRouteFiles[t.path].methods.find(x=>x.name===t.method).status==='COVERED');
    if(baselineRecovery.length){assert.equal(baselineRecovery.length,3);verifyRecoveryCredits(baseline);}
    for(const t of baselineRecovery)expectedOriginalMain[t.path][t.method]='COVERED';
    for (const [path] of mainProviderCredits) expectedOriginalMain[path].POST = "COVERED";
    for (const [path, , verb = "POST"] of mainDedicatedCredits) expectedOriginalMain[path][verb] = "COVERED";
    if (baselineHasRecovery) {
      for (const e of EVIDENCE) {
        expectedOriginalMain["src/app/api/" + e.route + "/route.ts"][e.method] = "COVERED";
      }
    }
    assert.equal(baseline.allApiRouteFiles[publicCatalogPath].methods.find(row => row.name === "GET")?.status,
      "PUBLIC-BY-DESIGN", "Current main must retain #1764 public catalog evidence");
    expectedOriginalMain[publicCatalogPath].GET = "PUBLIC-BY-DESIGN";
    if (baselineHasOldRoute || baselineHasCurrentRoute) {
      expectedOriginalMain["src/app/api/year-end/route.ts"].GET = "COVERED";
      expectedOriginalMain["src/app/api/year-end/route.ts"].POST = "COVERED";
    }
    const baselineEffective = baseline.allApiRouteFiles[effectiveChangePath]?.methods.find(row => row.name === "POST");
    const baselineEffectiveCredits = baselineEffective?.status === "COVERED" ? 1 : 0;
    if (baselineEffectiveCredits) {
      const normalizedEffective = structuredClone(baselineEffective);
      for (const companion of ["forgedSelectorFile", "secondaryForeignDenialFile"]) {
        assert.equal(effectiveChangeMethod.testedBy[companion], effectiveChangeMethod.testedBy.helperFile);
        normalizedEffective.testedBy[companion] ??= normalizedEffective.testedBy.helperFile;
      }
      assert.deepEqual(normalizedEffective, effectiveChangeMethod,
        "main's effective-change receipt must match the complete reviewed #1779 evidence");
      // Carry forward exact-source HCM evidence checks alongside the now-current main payroll credits.
      assert.equal(baseline.allApiRouteFiles[effectiveChangePath].gitBlobSha,
        m.allApiRouteFiles[effectiveChangePath].gitBlobSha, "HCM POST source blob must match");
      assert.equal(baselineEffective.testedBy?.workflowRunId, 42029419930);
      assert.equal(baselineEffective.testedBy?.workflowJobId, 127251740192);
      assert.equal(baselineEffective.testedBy?.verifiedPrHeadSha, "3a3296210692d2b80f92fd8b4cbd3fc67e4aecd4");
      assert.equal(baselineEffective.testedBy?.proofBlobSha, "334c54382e84cac342239086e9ed1b2dfb0a072c");
      assert.equal(baselineEffective.testedBy?.helperBlobSha, "6a2cd6ddedc79266061dd19ae066f405baf2b703");
      expectedOriginalMain[effectiveChangePath].POST = "COVERED";
    } else {
      assert.equal(baselineEffective?.status, "GAP");
      assert.equal(baselineEffective?.testedBy, null);
    }
    // Merged main also has a separately receipt-verified staffing-policy GET.
    const baselineStaffingGet = baseline.allApiRouteFiles[staffingGetPath]?.methods.find(row => row.name === "GET");
    // main predates #1793's supplement. Compare it with the immutable
    // historical #1637 receipt ONLY. The current helper's upgraded integrity
    // guard is independently validated on m above and MUST NOT treat the old
    // proof as evidence for the new helper.
    const baselineStaffingCredits = baselineStaffingGet?.status === "COVERED" ? (() => {
      if (baselineStaffingGet.testedBy?.integrityReproof) {
        return verifyStaffingPolicyGetCredit(baseline);
      }
      const { integrityReproof: supplemental, ...legacyProof } = STAFFING_GET_EVIDENCE;
      assert.ok(supplemental && supplemental.coverageCredits === 0 &&
        supplemental.reviewStatus === "PENDING", "new helper proof cannot grant retroactive credit");
      assert.deepEqual(baselineStaffingGet.testedBy, legacyProof,
        "base main must retain the exact original staffing GET evidence, with no invented reproof");
      assert.equal(baseline.allApiRouteFiles[staffingGetPath].gitBlobSha,
        legacyProof.routeBlobSha, "main staffing GET route must remain byte-pinned");
      assert.equal(baselineStaffingGet.testedBy.independentlyAccepted, false);
      assert.equal(baselineStaffingGet.testedBy.productionCertified, false);
      return 1;
    })() : 0;
    if (baselineStaffingCredits) expectedOriginalMain[staffingGetPath].GET = "COVERED";
    const baselineMwe = baseline.allApiRouteFiles[mweDecisionPath]?.methods.find(row => row.name === "PATCH");
    const baselineMweCredits = baselineMwe?.status === "COVERED" ? 1 : 0;
    if (baselineMweCredits) {
      assert.deepEqual(baselineMwe, mweDecision, "main must retain the immutable MWE PATCH proof");
      assert.equal(baselineMwe.testedBy?.workflowBlobSha, "584d159f2d2c250e182d0942188f293baebc2141");
      assert.equal(baselineMwe.testedBy?.independentlyAccepted, false);
      assert.equal(baselineMwe.testedBy?.productionCertified, false);
      expectedOriginalMain[mweDecisionPath].PATCH = "COVERED";
    } else {
      assert.equal(baselineMwe?.status, "GAP");
      assert.equal(baselineMwe?.testedBy, null);
    }
    const baselineReceiptCredits=baseline.allApiRouteFiles["src/app/api/expenses/receipts/route.ts"].methods.some(m => m.status === "COVERED")?verifyReceiptCredits(baseline):0;
    if (baselineReceiptCredits) {
      for (const verb of ["GET", "POST"]) expectedOriginalMain["src/app/api/expenses/receipts/route.ts"][verb] = "COVERED";
    }
    const baselineRootCredits=baseline.allApiRouteFiles["src/app/api/workforce-planning/route.ts"].methods.some(m=>["POST","PATCH"].includes(m.name)&&m.status==="COVERED")?verifyRootCredits(baseline):0;
    if(baselineRootCredits)for(const verb of ["POST","PATCH"])expectedOriginalMain["src/app/api/workforce-planning/route.ts"][verb]="COVERED";
    const baselineEmailCredits = baseline.allApiRouteFiles["src/app/api/account/email/verify/route.ts"].methods.some(row=>row.status==="COVERED") ?
      verifyEmailCredit(baseline,JSON.parse(readFileSync("scripts/qa/tenant-email-verification-credit-receipt.json","utf8"))) : 0;
    if(baselineEmailCredits) expectedOriginalMain["src/app/api/account/email/verify/route.ts"].POST="COVERED";
    const baselineMigrationCredits = baseline.allApiRouteFiles["src/app/api/migrations/route.ts"].methods.some(row => row.name === "POST" && row.status === "COVERED") ? verifyMigrationPostCredit(baseline) : 0;
    if (baselineMigrationCredits) expectedOriginalMain["src/app/api/migrations/route.ts"].POST = "COVERED";
    // The base branch can already include the separately proven careers PATCH credit.
    // Reconcile it without borrowing its evidence for migration POST.
    const baselineCareersCredits = baseline.allApiRouteFiles["src/app/api/careers/admin/route.ts"].methods.some(row => row.name === "PATCH" && row.status === "COVERED")
      ? verifyCareersPatchCredit(baseline) : 0;
    if (baselineCareersCredits) expectedOriginalMain["src/app/api/careers/admin/route.ts"].PATCH = "COVERED";
    const baselineSpendManagedCredits=baseline.allApiRouteFiles['src/app/api/spend/route.ts'].methods.some(row=>row.name==='POST'&&row.status==='COVERED')?verifySpendManaged(baseline):0;
    if(baselineSpendManagedCredits)for(const key of spendManagedTargets){const [verb,route]=key.split(' ');expectedOriginalMain['src/app/api/'+route+'/route.ts'][verb]='COVERED';}
    const billingPaths = ["src/app/api/billing/subscription/start/route.ts",
      "src/app/api/billing/subscription/cancel/route.ts"];
    const baselineBillingCredits = billingPaths.filter(path => {
      const row = baseline.allApiRouteFiles[path].methods.find(r => r.name === "POST");
      if (row.status === "GAP") {
        assert.equal(row.testedBy, null, "Uncredited billing must not claim proof");
        return false;
      }
      assert.equal(row.status, "COVERED");
      assert.equal(row.testedBy?.proofPullRequest, 1804);
      assert.equal(row.testedBy?.workflowRunId, 42254118161);
      assert.equal(row.testedBy?.independentSecurityReview, "PENDING");
      assert.equal(row.testedBy?.productionTested, false);
      return true;
    }).length;
    assert.ok([0, 2].includes(baselineBillingCredits), "Billing credits must merge as a complete two-method PR");
    if (baselineBillingCredits) for (const path of billingPaths) expectedOriginalMain[path].POST = "COVERED";
    // Current main also contains the independently source-pinned three-method
    // TOTP/scenario reconciliation from merged #1855. This is a BASELINE
    // reconciliation only: no part of the account-email request proof borrows it.
    const baselineMergedCredits = RECOVERY_TARGETS.every(target =>
      baseline.allApiRouteFiles[target.path].methods
        .find(row => row.name === target.method)?.status === "COVERED")
      ? verifyRecoveryCredits(baseline) : 0;
    assert.ok([0, RECOVERY_TARGETS.length].includes(baselineMergedCredits),
      "TOTP/scenario recovery must be complete or absent on main");
    if (baselineMergedCredits) {
      for (const target of RECOVERY_TARGETS) {
        expectedOriginalMain[target.path][target.method] = "COVERED";
      }
    }
    // A merged account-email request credit is allowed in main only when
    // its separate source-pinned two-attacker PG16/SMTP receipt verifies.
    const baselineAccountEmailRow = baseline.allApiRouteFiles["src/app/api/account/email/route.ts"]
      ?.methods.find(row => row.name === "POST");
    const baselineAccountEmailRequestCredits = baselineAccountEmailRow?.status === "COVERED"
      ? verifyAccountEmailRequestCredit(baseline) : 0;
    if (baselineAccountEmailRequestCredits) {
      assert.equal(baselineAccountEmailRequestCredits, 1);
      expectedOriginalMain["src/app/api/account/email/route.ts"].POST = "COVERED";
    } else {
      assert.equal(baselineAccountEmailRow?.status, "GAP");
      assert.equal(baselineAccountEmailRow?.testedBy, null);
    }
    // Recognize the four owner-approved non-session public classifications on
    // origin/main only as public methods, never as tenant-private proof credits.
    const baselinePublicSpecs = [
      ["src/app/api/careers/route.ts", "GET"],
      ["src/app/api/careers/route.ts", "POST"],
      ["src/app/api/demo-requests/route.ts", "POST"],
      ["src/app/api/payroll-outsourcing/quote/route.ts", "POST"],
    ];
    const baselinePublicReclassifications = baselinePublicSpecs.filter(([path, verb]) => {
      const row = baseline.allApiRouteFiles[path]?.methods.find(m => m.name === verb);
      if (row?.status === "GAP") {
        assert.equal(row.testedBy, null, "Unclassified public method cannot borrow proof");
        return false;
      }
      assert.equal(row?.status, "PUBLIC-BY-DESIGN", "Only four owner-approved public methods may change");
      assert.equal(row.testedBy, null, "Public classification cannot claim tenant method credit");
      assert.equal(row.publicBoundary?.approvedOn, "2026-11-09");
      assert.equal(row.publicBoundary?.fourPartMethodCredit, false);
      return true;
    }).length;
    assert.ok([0, baselinePublicSpecs.length].includes(baselinePublicReclassifications),
      "Public approval set must be entirely present or absent on main");
    if (baselinePublicReclassifications) {
      for (const [path, verb] of baselinePublicSpecs)
        expectedOriginalMain[path][verb] = "PUBLIC-BY-DESIGN";
    }

    // Only the 11 owner-reviewed non-session operations may be token-only
    // on origin/main. This baseline reconciliation carries NO tenant-method
    // credit and must preserve each exact source-bound, zero-credit record.
    const baselineTokenClassifications = ownerTokenClassifications.filter(([path, verb]) =>
      baseline.allApiRouteFiles[path]?.methods.find(row => row.name === verb)?.status ===
        "PRIVILEGED-OPERATIONS-TOKEN-ONLY").length;
    assert.ok([0, ownerTokenClassifications.length].includes(baselineTokenClassifications),
      "main token-only operations must be an exact all-or-none approved set");
    for (const [path, verb] of ownerTokenClassifications) {
      const baselineFile = baseline.allApiRouteFiles[path];
      const baselineRow = baselineFile?.methods.find(row => row.name === verb);
      const reviewedFile = m.allApiRouteFiles[path];
      const reviewedRow = reviewedFile?.methods.find(row => row.name === verb);
      assert.ok(baselineRow && reviewedRow, "Missing approved token-only route method: " + path);
      if (baselineTokenClassifications) {
        assert.equal(baselineFile.gitBlobSha, reviewedFile.gitBlobSha,
          "Existing token-only route source must not change");
        assert.deepEqual(baselineRow, reviewedRow,
          "Previously merged token-only metadata must remain exact, without extra credit");
        assert.equal(baselineRow.testedBy, null,
          "Operational token denial is never tenant-method proof");
        assert.equal(baselineRow.privilegedOperation?.methodCoverageCredits, 0);
        assert.equal(baselineRow.privilegedOperation?.productionCertified, false);
        expectedOriginalMain[path][verb] = "PRIVILEGED-OPERATIONS-TOKEN-ONLY";
      } else {
        assert.equal(baselineRow.status, "GAP",
          "Only a previously GAP operation may be newly classified token-only");
        assert.equal(baselineRow.testedBy, null,
          "Unclassified operation may not claim a method proof");
      }
    }
    // Invitation GET and POST may already be provisionally covered by merged
    // #1872. Check both original receipts and require an all-or-none pair.
    // This is reconciliation of main, not new token-only or tenant-method credit.
    const baselineInvitationPath = "src/app/api/invitations/accept/route.ts";
    const baselineInvitations = ["GET", "POST"].map(verb =>
      baseline.allApiRouteFiles[baselineInvitationPath]?.methods.find(row => row.name === verb));
    const alreadyMergedInvitations = baselineInvitations.every(row => row?.status === "COVERED");
    const baselineInvitationCredits = alreadyMergedInvitations ? verifyInvitationAcceptCredits(baseline) : 0;
    if (baselineInvitationCredits) {
      assert.equal(baselineInvitationCredits, 2);
      for (const verb of ["GET", "POST"]) expectedOriginalMain[baselineInvitationPath][verb] = "COVERED";
    } else {
      for (const row of baselineInvitations) {
        assert.equal(row?.status, "GAP", "Invitation credits must merge as a complete GET/POST pair");
        assert.equal(row?.testedBy, null, "Uncovered invitation cannot claim executed receipt");
      }
    }
    const baselineBirPath = "src/app/api/bir/annual-employer/candidate/route.ts";
    const baselineBir = baseline.allApiRouteFiles[baselineBirPath].methods.find(row => row.name === "POST");
    const baselineBirCredits = baselineBir?.status === "COVERED" ? 1 : 0;
    // The BIR POST is already counted by mainDedicatedCredits. Verify its exact
    // dedicated proof below, but do not add the same method to counts twice.
    assert.equal(mainDedicatedCredits.filter(([path, , verb = "POST"]) =>
      path === baselineBirPath && verb === "POST").length, baselineBirCredits,
      "The BIR candidate must be counted exactly once through mainDedicatedCredits");
    if (baselineBirCredits) {
      assert.equal(baselineBir.testedBy?.file, "scripts/qa/tenant-bir1604c-candidate-post-http.mjs");
      assert.equal(baselineBir.testedBy?.proofPullRequest, 1891);
      assert.equal(baselineBir.testedBy?.independentlyAccepted, false);
      assert.equal(baselineBir.testedBy?.independentSecurityReview, "PENDING");
      expectedOriginalMain[baselineBirPath].POST = "COVERED";
    }
    const baselineFiling = baseline.allApiRouteFiles[FILING_PATH].methods.find(row => row.name === "PATCH");
    const baselineFilingCredits = baselineFiling?.status === "COVERED" ? verifyFilingPatchCredit(baseline) : 0;
    if (baselineFilingCredits) expectedOriginalMain[FILING_PATH].PATCH = "COVERED";
    const baselineCheckout = baseline.allApiRouteFiles[CHECKOUT_PATH].methods.find(row => row.name === 'POST');
    const baselineCheckoutCredits = baselineCheckout.status === 'COVERED' ? verifyCheckoutCredit(baseline) : 0;
    if (baselineCheckoutCredits) expectedOriginalMain[CHECKOUT_PATH].POST = 'COVERED';
    const baselineReadinessCredits=baseline.allApiRouteFiles[READINESS_GET_PATH].methods.find(x=>x.name==='GET').status==='COVERED'?verifyWorkspaceReadinessCredit(baseline):0;if(baselineReadinessCredits)expectedOriginalMain[READINESS_GET_PATH].GET='COVERED';
    const baselineApprovalCredits=baseline.allApiRouteFiles[APPROVALS_PATH].methods.find(x=>x.name==='PATCH').status==='COVERED'?verifyApprovalsCredit(baseline):0;if(baselineApprovalCredits)expectedOriginalMain[APPROVALS_PATH].PATCH='COVERED';
    const baselineStudioCredits=baseline.allApiRouteFiles[STUDIO_POST_PATH].methods.find(x=>x.name==='POST').status==='COVERED'?verifyStudioPostCredit(baseline):0;if(baselineStudioCredits)expectedOriginalMain[STUDIO_POST_PATH].POST='COVERED';
    // Once the 2026-11-11 zero-credit architecture classifications are merged, origin/main carries them too. Accept each only with
    // its own zero-credit evidence; they are never tenant-private COVERED credits and everything else must still be GAP.
    let baselineArchPublic = 0, baselineArchToken = 0;
    for (const [path, verb] of architecturePublic) {
      const row = baseline.allApiRouteFiles[path].methods.find(item => item.name === verb);
      if (row.status !== "PUBLIC-BY-DESIGN") continue;
      baselineArchPublic++;
      assert.equal(row.testedBy, null, "Public status may not borrow tenant-method proof");
      assert.equal(row.classificationEvidence?.methodCoverageCredits, 0);
      assert.equal(row.classificationEvidence?.sourceBlobSha, baseline.allApiRouteFiles[path].gitBlobSha);
      assert.equal(row.classificationEvidence?.productionCertified, false);
      expectedOriginalMain[path][verb] = "PUBLIC-BY-DESIGN";
    }
    const baselineWorker = baseline.allApiRouteFiles[architectureToken[0]].methods.find(item => item.name === architectureToken[1]);
    if (baselineWorker.status === "PRIVILEGED-OPERATIONS-TOKEN-ONLY") {
      assert.equal(baselineWorker.testedBy, null);
      assert.equal(baselineWorker.privilegedOperation?.methodCoverageCredits, 0);
      assert.equal(baselineWorker.privilegedOperation?.productionCertified, false);
      expectedOriginalMain[architectureToken[0]][architectureToken[1]] = "PRIVILEGED-OPERATIONS-TOKEN-ONLY";
      baselineArchToken = 1;
    }
    assert.ok([0, architecturePublic.length].includes(baselineArchPublic) && baselineArchPublic === architecturePublic.length * baselineArchToken,
      "The nine architecture classifications are present on origin/main entirely or not at all");
    const baselineArch = baselineArchPublic + baselineArchToken;
    // Merged #1933 superseded Worker 360's old organization-only proof.
    // Accept only its precisely pinned GAP downgrade on main, with zero new
    // credits. Do not silently treat changed legal-employer reads as COVERED.
    const mainWorker360File = baseline.allApiRouteFiles[worker360Path];
    const mainWorker360Get = mainWorker360File?.methods.find(row => row.name === "GET");
    let mainWorker360Supersession = 0;
    if (mainWorker360Get?.status === "GAP") {
      assert.equal(mainWorker360File.gitBlobSha,
        "19875021d750b722fc69e0fe939e57928a158af9");
      assert.equal(mainWorker360Get.testedBy, null);
      const hold = mainWorker360Get.reviewedUncertified;
      assert.equal(hold?.kind, "worker360-legal-employer-source-supersession-zero-credit");
      assert.equal(hold?.oldSourceBlobSha, "78874e3800c9648b2e9e8895a4c0f1b2db9e2e62");
      assert.equal(hold?.newSourceBlobSha, mainWorker360File.gitBlobSha);
      assert.equal(hold?.coverageCredits, 0);
      assert.equal(hold?.independentSecurityReview, "PENDING");
      assert.equal(hold?.productionCertified, false);
      expectedOriginalMain[worker360Path].GET = "GAP";
      mainWorker360Supersession = 1;
    } else {
      assert.equal(mainWorker360Get?.status, "COVERED",
        "Historical receipt or exact zero-credit supersession required");
      assert.equal(mainWorker360File.gitBlobSha, "78874e3800c9648b2e9e8895a4c0f1b2db9e2e62",
        "An unreviewed Worker 360 source cannot inherit the original GET credit");
      assert.equal(mainWorker360Get.testedBy?.file, "scripts/qa/tenant-table-http.mjs",
        "Historical credit must retain its actual own/victim proof source");
    }
    assert.deepEqual(methodStatuses(baseline), expectedOriginalMain,
      "origin/main may contain only independently pinned credits; unknown methods remain GAP");
    const expectedMainYearEndCredits = creditedYearEndPromotions.length +
      (baselineHasOldRoute || baselineHasCurrentRoute ? 2 : 0);
    assert.deepEqual({
      COVERED: baseline.metrics.coveredAfter,
      "PUBLIC-BY-DESIGN": baseline.metrics.publicByDesign,
      "PRIVILEGED-OPERATIONS-TOKEN-ONLY": baseline.metrics.privilegedOperationsTokenOnly ?? 0,
      GAP: baseline.metrics.gap,
    }, {
      COVERED: baselineStudioCredits + baselineApprovalCredits + baselineReadinessCredits + baselineCheckoutCredits + baselineFilingCredits + snapshot.counts.COVERED - mainWorker360Supersession + compliancePostCredits.length +
        issuedPromotions.length + expectedMainYearEndCredits +
        (baselineHasPayout ? payoutCredits : 0) +
        (baselineHasRecovery ? EVIDENCE.length : 0) + mainProviderCredits.length + mainDedicatedCredits.length + baselineStaffingCredits + baselineMweCredits + baselineReceiptCredits + baselineRootCredits + baselineEmailCredits + baselineCareersCredits + baselineSpendManagedCredits + baselineMigrationCredits + baselineBillingCredits + baselineEnterpriseCredits + baselineRecovery.length + baselineSecurity.length + baselineAccountEmailRequestCredits + baselineInvitationCredits,
      "PUBLIC-BY-DESIGN": snapshot.counts["PUBLIC-BY-DESIGN"] + 1 + baselinePublicReclassifications + baselineArchPublic,
      "PRIVILEGED-OPERATIONS-TOKEN-ONLY": baselineTokenClassifications + baselineArchToken,
      GAP: snapshot.counts.GAP + mainWorker360Supersession - baselineArch - baselineStudioCredits - baselineApprovalCredits - baselineReadinessCredits - baselineCheckoutCredits - baselineFilingCredits - compliancePostCredits.length -
        issuedPromotions.length - expectedMainYearEndCredits -
        (baselineHasPayout ? payoutCredits : 0) -
        (baselineHasRecovery ? EVIDENCE.length : 0) - mainProviderCredits.length - mainDedicatedCredits.length - baselineStaffingCredits - baselineMweCredits - baselineReceiptCredits - baselineRootCredits - baselineEmailCredits - baselineCareersCredits - baselineSpendManagedCredits - baselineMigrationCredits - baselineBillingCredits - baselineEnterpriseCredits - baselineRecovery.length - baselineSecurity.length - baselineAccountEmailRequestCredits - baselineInvitationCredits - 1 - baselinePublicReclassifications - baselineTokenClassifications,
    }, "origin/main has unexplained method count drift");
    const baselinePlan = execFileSync("git",
      ["show", "origin/main:docs/engineering/tenant-isolation-closure-plan.md"],
      { encoding: "utf8" });
    // Frozen subtotal is derived only after each source link is reconciled
    // against independently verified main method statuses below.
    // Compute the descriptive batch line from the immutable source-linked
    // frozen method queue and current main manifest, not an old blanket
    // "all twelve incomplete" assumption. Never count a zero-GAP batch as
    // independently accepted: these remain explicitly PROVISIONAL.
    const frozenQueue = baselinePlan.split("### Batch DL-01 —")[1]
      ?.split("## Page and server-action closure")[0];
    assert.ok(frozenQueue, "origin/main must retain its 12 source-linked frozen batches");
    const frozenSections = ("### Batch DL-01 —" + frozenQueue)
      .split("### Batch ").slice(1);
    assert.equal(frozenSections.length, 12, "all frozen batches must remain in main");
    const statuses = [];
    const reviewedStatuses = [];
    const provisionalBatches = frozenSections.filter(section => {
      const links = section.split("\n").filter(line =>
        line.startsWith("- `") && line.includes(" — [source](../../src/app/api/"));
      assert.ok(links.length > 0, "each batch must link its frozen API methods");
      const sectionStatuses = links.map(line => {
        const method = line.split("`")[1]?.split(" ")[0];
        const path = line.split(" — [source](../../")[1]?.split("#L")[0];
        const verifiedStatus = expectedOriginalMain[path]?.[method];
        const status = verifiedFrozenMethodStatus(baseline, path, method, verifiedStatus, snapshot.methodStatuses);
        reviewedStatuses.push(verifiedStatus);
        statuses.push(status);
        return status;
      });
      return sectionStatuses.every(status => status !== "GAP");
    }).map(section => section.split(" ")[0]);
    assert.equal(statuses.length, 406, "the frozen queue must still contain exactly 406 methods");
    const frozenCovered = reviewedStatuses.filter(status => status === "COVERED").length;
    assert.equal(statuses.filter(status => status === "COVERED").length, frozenCovered,
      "the frozen queue must match current main source-credited methods");
    assert.equal(statuses.filter(status => status === "PUBLIC-BY-DESIGN").length, 3 + baselinePublicReclassifications + baselineArchPublic);
    assert.equal(statuses.filter(status => status === "PRIVILEGED-OPERATIONS-TOKEN-ONLY").length, baselineTokenClassifications + baselineArchToken,
      "Every approved token-only operation must remain inside the frozen 406-method queue");
    assert.equal(statuses.filter(status => status === "GAP").length,
      403 - frozenCovered - baselinePublicReclassifications - baselineTokenClassifications - baselineArch);
    const incomplete = 12 - provisionalBatches.length;
    const names = provisionalBatches.length < 2 ? provisionalBatches[0] :
      provisionalBatches.slice(0, -1).join(", ") + " and " + provisionalBatches.at(-1);
    const word = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven",
      "Eight", "Nine", "Ten", "Eleven", "Twelve"][incomplete];
    const batchSummary = provisionalBatches.length === 0
      ? "All 12 batches remain INCOMPLETE."
      : baselineMergedCredits
        // Merged #1855 reformatted only this descriptive sentence, not any
        // frozen membership, source receipt, total or security acceptance gate.
        ? `${incomplete} batches remain INCOMPLETE; ${provisionalBatches.join(", ")} remain PROVISIONAL — NOT ACCEPTED.`
        : `${word} ${incomplete === 1 ? "batch remains" : "batches remain"} INCOMPLETE; ${names} ${provisionalBatches.length === 1 ? "remains" : "remain"} PROVISIONAL — NOT ACCEPTED.`;
    const expectedMainFrozen = snapshot.frozenSubtotal
      .replace("313 COVERED", frozenCovered + " COVERED")
      .replace("2 PUBLIC-BY-DESIGN", (3 + baselinePublicReclassifications + baselineArchPublic) + " PUBLIC-BY-DESIGN")
      .replace("91 GAP",
        (baselineTokenClassifications + baselineArchToken
          ? (baselineTokenClassifications + baselineArchToken) + " PRIVILEGED-OPERATIONS-TOKEN-ONLY + "
          : "") +
        (403 - frozenCovered - baselinePublicReclassifications - baselineTokenClassifications - baselineArch) + " GAP")
.replace("All 12 batches remain INCOMPLETE.", batchSummary);
    // Current main dates the frozen subtotal; earlier snapshots used a plain label.
    // Normalize ONLY that heading, never the verified counts or credited methods.
    const mainFrozenSubtotal = baselinePlan.split("\n").find(line =>
      line.startsWith("Frozen subtotal: **") ||
      line.startsWith("Frozen subtotal (2026-11-04 proposal): **"));
    const normalizeCaption=line=>line?.replace(/^Frozen subtotal \(2026-11-04 proposal\):/, 'Frozen subtotal:')
      .replace(`${word} ${incomplete === 1 ? 'batch remains' : 'batches remain'}`,`${incomplete} ${incomplete === 1 ? 'batch remains' : 'batches remain'}`)
      .replace(`${names} ${provisionalBatches.length === 1 ? 'remains' : 'remain'} PROVISIONAL`,`${provisionalBatches.join(', ')} ${provisionalBatches.length === 1 ? 'remains' : 'remain'} PROVISIONAL`);
    const actualMainFrozen = normalizeCaption(mainFrozenSubtotal);
    const correctMainFrozen = normalizeCaption(expectedMainFrozen);
    const datedMainFrozen = baselinePlan.split("\n").find(line =>
      line.startsWith("Frozen subtotal (2026-11-11 classification proposal): **"));
    if (datedMainFrozen) {
      // Main's 2026-11-11 caption restates the batch narrative. Its numbers are still held to the verified baseline: the frozen
      // queue counts derived from the source-linked statuses above, never a figure copied from a prior merge.
      const figures = /\*\*(\d+) COVERED \+ (\d+) PUBLIC-BY-DESIGN \+ (\d+) PRIVILEGED-OPERATIONS-TOKEN-ONLY \+ (\d+) GAP = 406\*\*/.exec(datedMainFrozen);
      assert.ok(figures, "main's dated frozen subtotal must carry the four verified figures");
      assert.deepEqual(figures.slice(1).map(Number), [
        frozenCovered, 3 + baselinePublicReclassifications + baselineArchPublic, baselineTokenClassifications + baselineArchToken,
        403 - frozenCovered - baselinePublicReclassifications - baselineTokenClassifications - baselineArch,
      ], "origin/main's dated frozen subtotal must equal the verified baseline counts");
    } else if (actualMainFrozen !== correctMainFrozen) {
      // Historical main's summary accidentally omits PII-02 even though its
      // frozen-row table explicitly marks 36 COVERED + 2 PUBLIC + 0 GAP.
      // Only tolerate that exact *description* omission; never skip the 406
      // source-linked method, proof, status, or count invariants above.
      const documentedPii02 = baselineTokenClassifications
        ? "| 4 | **PII-02** | 38 | 36 | 2 | 0 | 0 | PROVISIONAL — NOT ACCEPTED |"
        : "| 4 | **PII-02** | 38 | 36 | 2 | 0 | PROVISIONAL — NOT ACCEPTED |";
      assert.ok(baselinePlan.includes(documentedPii02),
        "PII-02 must retain the precise provisional frozen-batch row on main");
      assert.deepEqual(provisionalBatches,
        ["DL-02", "PII-02", "WRK-01", "WRK-02", "WRK-03"],
        "Only the known PII-02 summary omission can be normalized");
      const legacyMainFrozen = correctMainFrozen.replace(
        "DL-02, PII-02, WRK-01, WRK-02, WRK-03 remain PROVISIONAL",
        "DL-02, WRK-01, WRK-02, WRK-03 remain PROVISIONAL");
      assert.notEqual(legacyMainFrozen, correctMainFrozen,
        "The exact historical omission must be present in the derived caption");
      assert.equal(actualMainFrozen, legacyMainFrozen,
        "origin/main frozen ledger drift beyond its documented PII-02 caption omission");
    }
  }
});

test("frozen credit guard rejects an uncited or unproved method", () => {
  const creditedPath = "src/app/api/billing/route.ts";
  const uncited = structuredClone(m);
  const billed = uncited.allApiRouteFiles[creditedPath].methods.find(row => row.name === "POST");
  assert.equal(billed.status, "COVERED");
  billed.testedBy = null;
  assert.throws(() => verifiedFrozenMethodStatus(uncited, creditedPath, "POST", "COVERED"),
    /COVERED requires a source-pinned proof citation/);

  const uncoveredPath = "src/app/api/payroll-runs/[id]/xendit-payout/route.ts";
  const unproved = structuredClone(m);
  const held = unproved.allApiRouteFiles[uncoveredPath].methods.find(row => row.name === "POST");
  assert.equal(held.status, "GAP");
  held.status = "COVERED";
  held.testedBy = { file: "scripts/qa/tenant-fabricated-credit.mjs" };
  assert.throws(() => verifiedFrozenMethodStatus(unproved, uncoveredPath, "POST", "GAP"),
    /status promotion without its verified proof is forbidden/);
});
