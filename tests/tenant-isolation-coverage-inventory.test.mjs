import { verifyInvitationAcceptCredits } from "../scripts/qa/tenant-invitation-accept-credit.mjs";
import {verifySecurityCredits,SECURITY_TARGETS,readSecurityEvidence} from '../scripts/qa/tenant-security-write-credit.mjs';
import { verifyAccountEmailRequestCredit } from '../scripts/qa/tenant-account-email-request-credit.mjs';
import {verifySpendManaged, TARGETS as spendManagedTargets} from '../scripts/qa/tenant-spend-managed-credit.mjs';
import {verifyRecoveryCredits, RECOVERY_TARGETS} from '../scripts/qa/tenant-merged-recovery-credit.mjs';
import { YEAR_END_SOURCE_PINS, verifyYearEndCredits } from "../scripts/qa/tenant-year-end-credit.mjs";
import { verifyCredit as verifyClockCredit } from "../scripts/qa/tenant-clock-credit.mjs";
import { verifyReceiptCredits } from "../scripts/qa/tenant-receipt-credit.mjs";
import { verifyRootCredits } from "../scripts/qa/tenant-root-planning-credit.mjs";
import { verifyEmailCredit } from "../scripts/qa/tenant-email-verification-credit.mjs";
import { verifyCareersPatchCredit } from "../scripts/qa/tenant-careers-patch-credit.mjs";
import { verifyBillingSubscriptionCredits } from "../scripts/qa/tenant-billing-subscription-credit.mjs";
import { verifyMigrationPostCredit } from "../scripts/qa/tenant-migrations-post-credit.mjs";
import { verifyDocumentCallerReproof } from "../scripts/qa/tenant-document-caller-reproof-verify.mjs";
import { verifyPayoutProfileCredit, PAYOUT_PATCH_EVIDENCE } from "../scripts/qa/tenant-payout-profile-credit.mjs";
import { verifyCredit as verifyOnboardingCredit } from "../scripts/qa/tenant-onboarding-credit.mjs";
import { verifyPost1523Credits } from "../scripts/qa/tenant-post1523-credit-verify.mjs";
import { verifyPromotionCredits } from "../scripts/qa/tenant-gap-promotion-verify.mjs";
import { verifyFollowOnCredits } from "../scripts/qa/tenant-follow-on-credit-verify.mjs";
import { verifyMoreCredits } from "../scripts/qa/tenant-more-credit-verify.mjs";
import { EVIDENCE as FIVE_METHOD_EVIDENCE, verifyFiveMethodCredits } from "../scripts/qa/tenant-five-method-credit-verify.mjs";
import { verifyMergedProofCredits } from "../scripts/qa/tenant-merged-proof-credits.mjs";
import { verifyCredits as verifySelfDevelopmentCredits } from "../scripts/qa/tenant-self-development-credit.mjs";
import { verifyReconciledFamilyCredits, verifyEnterprisePostAuditSource } from "../scripts/qa/tenant-family-reconciliation.mjs";
import { verifyEnterprisePostCredit } from "../scripts/qa/tenant-enterprise-admin-credit.mjs";
import { verifyCredit as verifyPerformanceCoreCredit } from "../scripts/qa/tenant-performance-core-credit.mjs";
import { verifyStaffingPolicyGetCredit } from "../scripts/qa/tenant-staffing-policy-get-credit.mjs";
/**
 * Complete-surface tenant-isolation manifest and drift guard.
 *
 * Existing untested methods are OPEN GAPs, never certified as safe by this test.
 * An unchanged, source-pinned historical GAP can remain only while it is being
 * resolved; every new/modified route with an employer-scoped handler must bring
 * valid own-tenant + real victim-denial evidence or a public-by-design rationale.
 *
 * This test supplements (never replaces) the existing second-pass inventory and
 * the isolated PostgreSQL live HTTP security smoke.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import test from "node:test";
import { assertLiveTenantCounts } from "./helpers/tenant-counts.mjs";
import { tenantFamilyCatalog } from "../scripts/qa/tenant-table-catalog.mjs";
import { validateTenantPathBinding } from "../scripts/qa/tenant-table-path.mjs";
import { TENANT_TABLE_PROFILES } from "../scripts/qa/tenant-table-env.mjs";

const ROOT = "src/app";
const API = "src/app/api";
const BASE = "8c2a62135fd6e23db4603197822339cc1020ec27";
const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
verifyMergedProofCredits(manifest);
verifyReconciledFamilyCredits(manifest);
const baseline = JSON.parse(readFileSync("scripts/qa/tenant-isolation-inventory/baseline.json", "utf8"));

function normalize(value) { return value.split(sep).join("/"); }
function allFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? allFiles(path) : [normalize(path)];
  });
}
function routeFiles() {
  return allFiles(API).filter((file) => file.endsWith("/route.ts")).sort();
}
function appFiles() {
  return allFiles(ROOT).filter((file) =>
    !file.startsWith(API + "/") && /\.(?:ts|tsx|js|jsx)$/.test(file)
  ).sort();
}
function methodsIn(source) {
  return [...source.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+(GET|POST|PATCH|PUT|DELETE|OPTIONS|HEAD)\b/g)]
    .map((match) => match[1]).sort();
}
function gitBlobSha(bytes) {
  return createHash("sha1").update(Buffer.from("blob " + bytes.length + "\0"))
    .update(bytes).digest("hex");
}
// Reconstruct the pre-hardening source byte-for-byte. A source-only handler
// reorder may not silently alter historical GET credits or unrelated logic.
function restoreIssuedDemandPostPilotOrder(source) {
  const postAt = source.indexOf("export async function POST(");
  const accessStart = source.indexOf(
    "  const access = await getAccess(user.id, input.organizationId);", postAt);
  const pilotStart = source.indexOf(
    "  if (!issuedDemandPilotAllowed(input.organizationId)) {", accessStart);
  const mfaStart = source.indexOf(
    "  const mfa = requireSensitiveActionMfa(user);", pilotStart);
  assert.ok(postAt >= 0 && accessStart > postAt &&
    pilotStart > accessStart && mfaStart > pilotStart,
    "Issued-demand POST must authorize employer before examining pilot status");
  const roleGuard = source.slice(accessStart, pilotStart);
  const pilotGuard = source.slice(pilotStart, mfaStart);
  assert.match(roleGuard, /!access\.companyWide/);
  assert.match(roleGuard, /PEOPLE_ADMIN_ROLES/);
  assert.match(roleGuard, /status: 403/);
  assert.match(pilotGuard, /status: 404/);
  return source.slice(0, accessStart) + pilotGuard + roleGuard + source.slice(mfaStart);
}

function readableLines(path) {
  return readFileSync(path, "utf8").split("\n");
}
function evidenceLine(path, number, subject) {
  assert.equal(typeof path, "string", subject + ": test path required");
  assert.match(path, /^(?:tests\/|scripts\/qa\/)/, subject + ": test must live in a test/QA source");
  const lines = readableLines(path);
  assert.ok(Number.isInteger(number) && number > 0 && number <= lines.length,
    subject + ": proof requires an existing file:line reference");
  return lines[number - 1];
}
/**
 * Payroll submit-review and release credits borrow the existing two-attacker money-lifecycle journey, never the
 * negative-only seven-path batch. Each must carry the exact receipt of BOTH matrix legs, and the route, harness and
 * workflow must be byte-identical to what that receipt executed.
 */
const PAYROLL_REVIEW_RELEASE_RECEIPT = Object.freeze({
  workflowRunId: 42063867383,
  workflowJobIds: { exactLinksFalse: 127372516860, exactLinksTrue: 127372517320 },
  verifiedHeadSha: "53ae6fa31a41c104a4f509f6a3446f3aa05a28c6",
  runLabel: "GitHub Actions 42063867383/127372516860+127372517320 PG16 money-lifecycle PASS",
  routeBlobs: {
    "src/app/api/payroll-runs/[id]/submit-review/route.ts": "98abed695eee9462a233f3da78b794e60f40c581",
    "src/app/api/payroll-runs/[id]/release/route.ts": "87fb97879aa19473a67ff9815c9db2e4b9f5d0b9",
  },
  confirmations: {
    "src/app/api/payroll-runs/[id]/submit-review/route.ts": '"own review task and independent checker"',
    "src/app/api/payroll-runs/[id]/release/route.ts": '"SQL confirms own release"',
  },
});
function verifyPayrollReviewReleaseCredit(method, routePath, proof, harness) {
  const receipt = PAYROLL_REVIEW_RELEASE_RECEIPT;
  assert.equal(method.name, "POST", routePath + ": only POST is credited");
  assert.ok(receipt.routeBlobs[routePath], routePath + ": not one of the two credited lifecycle routes");
  assert.equal(gitBlobSha(readFileSync(routePath)), receipt.routeBlobs[routePath],
    "Payroll lifecycle route changed since the money-lifecycle receipt: re-run both matrix legs and re-credit");
  assert.equal(proof.routeBlobSha, receipt.routeBlobs[routePath]);
  assert.equal(gitBlobSha(readFileSync(proof.file)), proof.proofBlobSha,
    "Money-lifecycle harness changed since its receipt: re-run both matrix legs and re-credit");
  assert.equal(proof.workflowFile, ".github/workflows/tenant-money-lifecycle.yml");
  assert.equal(gitBlobSha(readFileSync(proof.workflowFile)), proof.workflowBlobSha,
    "Money-lifecycle workflow changed since its receipt: re-run both matrix legs and re-credit");
  assert.equal(proof.workflowRunId, receipt.workflowRunId);
  assert.deepEqual(proof.workflowJobIds, receipt.workflowJobIds);
  assert.equal(proof.verifiedHeadSha, receipt.verifiedHeadSha);
  assert.equal(proof.runLabel, receipt.runLabel);
  assert.equal(proof.evidence, "https://github.com/erwinmehehe/payrollph/actions/runs/" + receipt.workflowRunId + "/job/" + receipt.workflowJobIds.exactLinksFalse);
  assert.equal(proof.secondEvidence, "https://github.com/erwinmehehe/payrollph/actions/runs/" + receipt.workflowRunId + "/job/" + receipt.workflowJobIds.exactLinksTrue);
  assert.equal(proof.postgresMajor, 16);
  assert.equal(proof.independentSecurityReview, "PENDING");
  assert.equal(proof.productionTested, false);
  assert.equal(method.reviewedUncertified, undefined, routePath + ": a credited method cannot also carry the zero-credit exception");
  const lines = harness.split("\n");
  assert.ok(lines[proof.ownConfirmationLine - 1]?.includes(receipt.confirmations[routePath]),
    routePath + ": the own-success SQL/response confirmation moved");
  assert.ok(proof.ownConfirmationLine > proof.ownPositiveLine && proof.ownConfirmationLine - proof.ownPositiveLine <= 2);
  assert.ok(lines[proof.twoAttackerLoopLine - 1]?.includes("for (const attacker of [a, b]) {") &&
    lines[proof.twoAttackerLoopLine - 1].includes("await lifecycle(v, attacker); }"),
    routePath + ": both attacker employers must run the full lifecycle");
  assert.ok(lines[proof.victimIdOrderingLine - 1]?.includes('"real victim IDs exceed attacker IDs and 6"'));
  assert.ok(lines[proof.victimUnchangedAfterBothLine - 1]?.includes('"victim unchanged across both complete attacker journeys"'));
}
/** Exact-source sole-owner verification for the two distinct issued-demand POST methods.
 * The old GET overlay proof does NOT authorize either POST. */
function verifyIssuedDemandSoloRecovery(method, routePath, currentBlob) {
  const specs = {
    "src/app/api/workforce/demand-observations/issued/route.ts": {
      own: 262, foreign: 300, forged: 310, unchanged: 102, ordered: 62,
      routeSha: "549156b2e143c71bd33385fb1cc49a95cb120dfc",
      endpoint: "ISSUE_PATH",
    },
    "src/app/api/workforce/demand-observations/issued/score/route.ts": {
      own: 340, foreign: 389, forged: 397, unchanged: 102, ordered: 249,
      routeSha: "5658c67c7758e78c68738f0e848edfcfc8bd17c3",
      endpoint: "SCORE_PATH",
    },
  };
  const spec = specs[routePath];
  assert.ok(spec, routePath + ": no unreviewed method can borrow the solo recovery");
  assert.equal(method.name, "POST");
  assert.equal(method.status, "COVERED");
  assert.equal(currentBlob, spec.routeSha, "changed handler needs new PG16 four-part proof");
  const proof = method.testedBy;
  assert.equal(proof?.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY");
  assert.equal(proof.ownerReviewer, "erwinmehehe");
  assert.equal(proof.ownerIsOnlyReviewer, true);
  assert.equal(proof.independentlyAccepted, false, "do not invent a second reviewer");
  assert.equal(proof.prNumber, 1731);
  assert.equal(proof.postgresMajor, 16);
  assert.equal(proof.proofHeadCommit, "1834b73aab8e162e19b4b260e51b32e6fa1fbbec");
  assert.equal(proof.workflowRunId, 41444835667);
  assert.equal(proof.workflowJobId, 125275257980);
  assert.equal(proof.evidence,
    "https://github.com/erwinmehehe/payrollph/actions/runs/41444835667/job/125275257980");
  assert.deepEqual([
    proof.line, proof.ownPositiveLine, proof.foreignDenialLine, proof.unchangedDbLine,
    proof.forgedSelectorLine, proof.victimIdOrderingLine,
  ], [spec.own, spec.own, spec.foreign, spec.unchanged, spec.forged, spec.ordered],
  "distinct own/foreign/forged/unchanged proof citations must stay exact");
  const blobPins = [
    [routePath, proof.routeBlobSha, spec.routeSha],
    [proof.file, proof.proofBlobSha, "a63e9aa94b9c85000433e9a40c778af449888757"],
    ["scripts/qa/tenant-issued-demand-contract.mjs", proof.contractBlobSha, "a4a7714a42ada86a55192b160e3f5f2761af0500"],
    ["tests/tenant-issued-demand-contract.test.mjs", proof.testBlobSha, "0df0028ceda0413256575f3847c950194f6e73f3"],
    [proof.workflowFile, proof.workflowBlobSha, "caf01bd8e2c17e8cd5bfd17528cd56d7503aa312"],
  ];
  for (const [file, pinned, expected] of blobPins) {
    assert.equal(pinned, expected, file + ": unexpected proof source");
    assert.equal(gitBlobSha(readFileSync(file)), expected,
      file + ": edited route/proof/contract/workflow requires exact-head revalidation");
  }
  assert.equal(proof.file, "scripts/qa/tenant-issued-demand-http.mjs");
  const lines = readableLines(proof.file);
  assert.ok(lines[spec.own - 1].includes("const result = await allowed(" + spec.endpoint),
    "real owned HTTP 201 must execute the exact POST");
  assert.ok(lines[spec.foreign - 1].includes("await refused(" + spec.endpoint),
    "real victim employer must be denied by the same POST");
  assert.ok(lines[spec.forged - 1].includes("await refused(" + spec.endpoint),
    "real victim selector must be refused");
  assert.match(lines[spec.unchanged - 1], /await unchangedAll\(before, label\)/,
    "every negative request must compare all four employers' PostgreSQL/audit snapshots");
  assert.match(lines[spec.ordered - 1], /victim\.(?:org|scorableIssue)\.id > Math\.max/,
    "real seeded victim ID must exceed both attacker IDs");
  const suite = lines.join("\n");
  assert.match(suite, /for \(const actor of attackers\)/);
  assert.match(suite, /assertCompleteIssuedDemandProofCounts\(counts\)/);
  assert.match(suite, /assert\.equal\(created\.length, 1\)/);
  assert.match(suite, /assertNoOtherEmployerLeak/);
  assert.match(suite, /requireDisposableIssuedDemand\(\)/);
  assert.ok(suite.indexOf("requireDisposableIssuedDemand();") <
    suite.indexOf('import("../../src/db/index.ts")'),
    "strict disposable guard must precede all database imports");
  const workflow = readFileSync(proof.workflowFile, "utf8");
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /npm start -- -H 127\.0\.0\.1/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-issued-demand-http\.mjs/);
  assert.match(workflow, /XENDIT_PAYOUTS_ENABLED: "false"/);
  assert.match(workflow, /WFM_LOYVERSE_POS_ENABLED: "false"/);
  assert.match(workflow, /WFM_SQUARE_SANDBOX_ENABLED: "false"/);
  assert.equal(proof.productionCertified, false);
  assert.equal(proof.providerCalls, 0);
  assert.equal(proof.payrollWrites, 0);
  assert.equal(proof.rosterWrites, 0);
}

function reviewedStatus(method, key, isNewOrChanged, currentBlob) {
  if (SECURITY_TARGETS.some(t=>key===t.path+' '+t.method) && method.status==='COVERED') {
    assert.equal(verifySecurityCredits(manifest),3);
    assert.equal(currentBlob,readSecurityEvidence().pins[key.slice(0,key.lastIndexOf(' '))]);return true;
  }
  if (["src/app/api/enterprise/route.ts GET", "src/app/api/enterprise/route.ts POST"].includes(key)) {
    assert.equal(currentBlob, "be3e320df828d681ad34c034b6469cf4940846cc");
    verifyEnterprisePostAuditSource(readFileSync("src/app/api/enterprise/route.ts", "utf8"), "3f282ea06dbf33e087b650a7adfdf4b70f91724e4bcdbb496bbe0cdcd937d9b3");
    assert.equal(method.status, "COVERED");
    if (method.name === "POST") assert.equal(verifyEnterprisePostCredit(manifest), 1);
    return true;
  }
  if(method.status === 'COVERED' && spendManagedTargets.some(t=>{const [verb,route]=t.split(' ');return key==='src/app/api/'+route+'/route.ts '+verb;})){
    assert.equal(verifySpendManaged(manifest),3);return true;
  }
  if (key === "src/app/api/careers/admin/route.ts PATCH" && method.status === "COVERED") {
    assert.equal(currentBlob, "fc7920e19fc75389c5f5e7fe3cb4f90046028f00");
    assert.equal(verifyCareersPatchCredit(manifest), 1);
    return true;
  }
  if (method.status === "COVERED" && [
      "src/app/api/billing/subscription/start/route.ts POST",
      "src/app/api/billing/subscription/cancel/route.ts POST",
    ].includes(key)) {
    const path = key.slice(0, key.lastIndexOf(" "));
    assert.equal(currentBlob, manifest.allApiRouteFiles[path].gitBlobSha,
      "Changed billing route needs new source-current PG16 evidence");
    assert.equal(verifyBillingSubscriptionCredits(manifest), 2);
    return true;
  }
  if (key === "src/app/api/migrations/route.ts POST" && method.status === "COVERED") {
    assert.equal(currentBlob, "6f2aabfe906a2c38594ea8b20d17b27a90dafb95");
    assert.equal(verifyMigrationPostCredit(manifest), 1);
    return true;
  }
  if (method.status === "COVERED" && ["src/app/api/workforce-planning/route.ts POST","src/app/api/workforce-planning/route.ts PATCH"].includes(key)) {
    assert.equal(verifyRootCredits(manifest),2);
    return true;
  }
  assert.ok(["COVERED", "PUBLIC-BY-DESIGN", "PRIVILEGED-OPERATIONS-TOKEN-ONLY", "GAP"].includes(method.status),
    key + ": invalid coverage status");
  if (method.status === "PRIVILEGED-OPERATIONS-TOKEN-ONLY") {
    const approved = new Map([
      ["GET jobs/cron", ["authorization", "CRON_SECRET", 401]],
      ["GET jobs/dispatch-readiness", ["x-worker-token", "WORKER_TOKEN", 401]],
      ["GET jobs/status", ["x-scheduler-monitor-token", "SCHEDULER_MONITOR_TOKEN", 401]],
      ["POST jobs/tick", ["x-worker-token", "WORKER_TOKEN", 401]],
      ["POST webhooks/drain", ["x-worker-token", "WORKER_TOKEN", 401]],
      ["GET capabilities", ["x-readiness-token", "READINESS_TOKEN", 404]],
      ["GET readiness", ["x-readiness-token", "READINESS_TOKEN", 401]],
      ["GET readiness/billing", ["x-health-token", "HEALTH_TOKEN", 404]],
      ["GET readiness/database-target", ["x-readiness-token", "READINESS_TOKEN", 404]],
      ["GET readiness/deployment", ["x-readiness-token", "READINESS_TOKEN", 404]],
      ["GET readiness/pilot-status", ["x-readiness-token", "READINESS_TOKEN", 404]],
    ]);
    const label = method.name + " " + manifest.allApiRouteFiles[key.slice(0, key.lastIndexOf(" "))].route;
    const expected = approved.get(label);
    assert.ok(expected, label + ": unapproved operations classification");
    assert.equal(currentBlob, method.privilegedOperation?.routeBlobSha);
    assert.equal(method.privilegedOperation?.approvedOn, "2026-11-09");
    assert.equal(method.privilegedOperation?.requiredHeader, expected[0]);
    assert.equal(method.privilegedOperation?.credentialEnvironment, expected[1]);
    assert.equal(method.privilegedOperation?.denialStatus, expected[2]);
    assert.equal(method.privilegedOperation?.denialHarness, "scripts/qa/tenant-privileged-token-only-http.mjs");
    assert.equal(method.privilegedOperation?.methodCoverageCredits, 0);
    assert.equal(method.privilegedOperation?.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY");
    assert.equal(method.privilegedOperation?.productionCertified, false);
    assert.equal(method.testedBy, null, "token-only denial cannot become employer-scoped COVERED proof");
    const src = readFileSync(key.slice(0, key.lastIndexOf(" ")), "utf8");
    assert.ok(src.includes(expected[0]) || (label === "GET jobs/cron" && src.includes("cronAuthorization(request)")) ||
      (["POST jobs/tick", "POST webhooks/drain"].includes(label) && src.includes("requireGlobalWorkerToken(")),
      label + ": token auth disappeared from source");
    if (label === "GET readiness") {
      assert.equal(method.privilegedOperation.documentedAlternateHeader, "x-worker-token");
      assert.match(src, /request\.headers\.get\("x-readiness-token"\) \?\? request\.headers\.get\("x-worker-token"\)/);
    }
  }

  if (method.status === "PUBLIC-BY-DESIGN") {
    assert.ok(typeof method.reason === "string" && method.reason.trim().length >= 20,
      key + ": public endpoint needs a concrete reviewed reason");
  }
  if (method.status === "COVERED") {
    if (key.startsWith("src/app/api/expenses/receipts/route.ts ")) verifyReceiptCredits(manifest);
    const proof = method.testedBy;
    assert.ok(proof && typeof proof === "object", key + ": COVERED requires a valid proof reference");
    evidenceLine(proof.file, proof.line, key);
    if (proof.file === "scripts/qa/tenant-onboarding-http.mjs") {
      const route = manifest.allApiRouteFiles[key.slice(0, key.lastIndexOf(" "))].route;
      verifyOnboardingCredit(method.name + " " + route, method);
    }
  if (isNewOrChanged) {
      // Newly introduced or changed code cannot borrow a single anonymous/invalid-request
      // status assertion as proof of actual cross-employer isolation.
      evidenceLine(proof.file, proof.ownPositiveLine, key + " attacker-own positive");
      evidenceLine(proof.file, proof.foreignDenialLine, key + " victim-only denial");
      if (["POST", "PATCH", "PUT", "DELETE"].includes(method.name)) {
        evidenceLine(proof.file, proof.unchangedDbLine, key + " DB unchanged");
      }
    }
  }
  // Distinct provisional account-email REQUEST credit from source-identical passing PG16 HTTP/local SMTP job.
  if (key === "src/app/api/account/email/route.ts POST") {
    assert.equal(currentBlob, "b9c759114b8082b3493ef3c4671134dabbf7e72e",
      "changed account-email handler needs new real-HTTP proof");
    assert.equal(verifyAccountEmailRequestCredit(manifest), 1);
    return true;
  }

  // POST-only immutable-timeline SQL fix: exact-source, review-only and zero credit.
  // Reconstruct the original route, and retain the employer guard and both
  // current HTTP proof plus contract/workflow identities. GET is unchanged.
  if (isNewOrChanged &&
      key === "src/app/api/compliance/contribution-issues/route.ts POST") {
    const routeFile = "src/app/api/compliance/contribution-issues/route.ts";
    const original = "4d18274c78b8c6c5006490ea3190843c6f72b106";
    const fixed = "8c2ac7e8d59c862295f44023ed3d12b1d900f26a";
    assert.equal(currentBlob, fixed, "Contribution case source drift requires security review");
    assert.equal(manifest.allApiRouteFiles[routeFile].gitBlobSha, fixed);
    assert.equal(method.status, "COVERED", "Exact-head PG16 own/victim/forged/unchanged four-part method proof required");
    assert.equal(method.testedBy?.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY");
    assert.equal(method.testedBy?.workflowRunId, 41446327305);
    assert.equal(method.testedBy?.ownerReviewer, "@erwinmehehe");
    assert.equal(method.testedBy?.ownerIsOnlyReviewer, true);
    assert.equal(method.testedBy?.routeBlobSha, currentBlob);
    const review = method.reviewedUncertified;
    assert.deepEqual(review, {
      kind: "contribution-referral-SQL-event-contract-PG16-review-only",
      originalRouteBlobSha: original, routeBlobSha: fixed,
      proofFile: "scripts/qa/tenant-table-rows/write/compliance-contribution-post.mjs",
      proofBlobSha: "dfcf1615be01bb151e13a5d74c080299575ce53a",
      contractFile: "tests/statutory-contribution-case-resolution-gates-v5.test.ts",
      contractBlobSha: "ad68fc98c56f25cd7d9423bce8a98baebf4db003",
      timelineContractFile: "tests/statutory-contribution-case-timeline.test.ts",
      timelineContractBlobSha: "39e8a235c7b0d480416bd0ac23fd206653067e50",
      workflowFile: ".github/workflows/tenant-compliance-post-candidate.yml",
      workflowBlobSha: "e9641c0a85bb97101ec28803c0b36d2387667114",
      credits: 0, exactHeadPg16Http: "PENDING",
      independentSecurityReview: "PENDING", productionCertified: false,
    });
    for (const [file, sha] of [
      [review.proofFile, review.proofBlobSha],
      [review.contractFile, review.contractBlobSha],
      [review.timelineContractFile, review.timelineContractBlobSha],
      [review.workflowFile, review.workflowBlobSha],
    ]) assert.equal(gitBlobSha(readFileSync(file)), sha,
      "Contribution proof/contract/workflow drift requires fresh review: " + file);
    const src = readFileSync(routeFile, "utf8");
    const oldEvent = '          eventType: "referred_to_agency",';
    const newEvent =
      '          // Agency referral keeps the case in review; the immutable timeline permits payroll_update, not a separate referral event type.\n' +
      '          eventType: "payroll_update",';
    assert.equal(src.split(newEvent).length, 2, "Exact referral source correction required once");
    assert.equal(gitBlobSha(Buffer.from(src.replace(newEvent, oldEvent))), original,
      "Authorization, case writes and all other route bytes must match reviewed source");
    const post = src.slice(src.indexOf("export async function POST("));
    const auth = post.indexOf("const denied = await requirePayrollOperator(user.id, organizationId)");
    const read = post.indexOf("const [issue] = await db.select().from(statutoryContributionIssueCases)");
    assert.ok(auth > 0 && read > auth, "Scope must be authorized before case read");
    for (const guard of [
      "enforceSameOriginMutation(request)", "getSessionUser()",
      "enforceSensitiveActionRateLimit(request",
      "eq(statutoryContributionIssueCases.id, caseId)",
      "eq(statutoryContributionIssueCases.organizationId, organizationId)",
    ]) assert.ok(post.includes(guard), "Cannot weaken contribution check: " + guard);
    const begin = post.indexOf('if (resolutionOutcome === "referred_to_agency")');
    const end = post.indexOf("return Response.json({ case: result, resolved: false });", begin);
    assert.ok(begin > 0 && end > begin, "Referral must remain an open-case outcome");
    const referral = post.slice(begin, end);
    assert.match(referral, /status:\s*"in_review"/);
    assert.match(referral, /resolvedAt:\s*null/);
    assert.match(referral, /eventType:\s*"payroll_update"/);
    assert.match(referral, /visibility:\s*"employee"/);
    assert.match(referral, /Referred to the agency for verification\./);
    const proof = readFileSync(review.proofFile, "utf8");
    for (const token of [
      "key: 'POST compliance/contribution-issues'",
      "'add_update'", "resolutionOutcome: 'referred_to_agency'",
      "resolutionOutcome: 'employee_advised'",
      "for (const [action, extra, status, eventType] of actionBodies)",
      "requestBody(c.victim.org.id, c.victimSeeded.id, action, extra)",
      "requestBody(c.orgId, c.victimSeeded.id, action, extra)",
      "assert.deepEqual(await victimState(), seededVictim",
      "credit: 0",
    ]) assert.ok(proof.includes(token), "Lost real victim/four-action proof: " + token);
    const wf = readFileSync(review.workflowFile, "utf8");
    assert.match(wf, /image: postgres:16/);
    assert.match(wf, /node --import tsx scripts\/qa\/tenant-write-table-http\.mjs/);
    return;
  }

  // Transfer write hardening remains a strictly uncredited PG16 review
  // candidate. The historical GET source and exact method credit are preserved.
  if (isNewOrChanged && key.startsWith("src/app/api/multi-entity/transfers/route.ts ")) {
    const source = readFileSync("src/app/api/multi-entity/transfers/route.ts", "utf8");
    assert.equal(currentBlob, "a4ac9ec92df17492c4c0918f08114660bc4c6ebe",
      "Transfer endpoint changed since typed-error security review");
    const typedClass = "// Only explicit business conflicts may be shown. SQL and driver failures\n// must receive a generic response, even if their text matches a business error.\nclass TransferDecisionConflict extends Error {\n  constructor(message: string) {\n    super(message);\n    this.name = \"TransferDecisionConflict\";\n  }\n}\n\n";
    const expectedPostCatch = "  } catch {\n    return fail(\"Could not request transfer.\");\n  }\n}\n\nexport async function PATCH";
    const expectedPatchCatch = "  } catch (error) {\n    return fail(error instanceof TransferDecisionConflict\n      ? error.message : \"Transfer could not be decided.\");\n  }\n}\n";
    assert.ok(source.includes(typedClass),
      "A dedicated trusted business-conflict error class must exist");
    assert.equal(source.split("throw new TransferDecisionConflict(").length - 1, 9,
      "Only the nine known business-conflict throw sites may return detailed errors");
    assert.ok(source.includes(expectedPostCatch) && source.includes(expectedPatchCatch),
      "Both transaction exceptions must fail closed");
    const restored = source
      .replace(typedClass, "")
      .replace(expectedPostCatch, "  } catch (error) {\n    return fail(error instanceof Error ? error.message : \"Could not request transfer.\");\n  }\n}\n\nexport async function PATCH")
      .replace(expectedPatchCatch, "  } catch (error) {\n    return fail(error instanceof Error ? error.message : \"Transfer could not be decided.\");\n  }\n}\n")
      .replaceAll("throw new TransferDecisionConflict(", "throw new Error(");
    assert.equal(gitBlobSha(Buffer.from(restored)), "a27a0b307cd5dd0ef2bb26a83eae0bb94248e733",
      "No source change beyond the reviewed POST/PATCH error boundary is allowed");
    const dedicatedCredit = method.name !== "GET" && method.status === "COVERED" && method.testedBy?.file === "scripts/qa/tenant-transfers-http.mjs";
    if (dedicatedCredit) {
      // Credited by the later dedicated two-attacker proof (#1853); its exact pins are verified by the dedicated test at the end of this file.
      assert.equal(method.reviewedUncertified, undefined, "the superseded candidate hold is removed, not kept beside a credit");
    } else {
    assert.equal(method.status, method.name === "GET" ? "COVERED" : "GAP",
      "Source hardening must not grant unreviewed write-method credit");
    }
    if (dedicatedCredit) {
      // no further hold checks apply to a credited method
    } else if (method.name === "GET") {
      assert.equal(method.testedBy?.file, "scripts/qa/tenant-table-http.mjs",
        "Preserve the earlier GET own/foreign proof");
    } else {
      assert.ok(method.name === "POST" || method.name === "PATCH");
      assert.equal(method.testedBy, null);
      assert.deepEqual(method.reviewedUncertified, {"kind":"multi-entity-transfers-typed-conflict-PG16-fault-proof-uncredited","originalRouteBlobSha":"a27a0b307cd5dd0ef2bb26a83eae0bb94248e733","routeBlobSha":"a4ac9ec92df17492c4c0918f08114660bc4c6ebe","proofFile":"scripts/qa/tenant-multi-entity-transfers-write-http.mjs","proofBlobSha":"f628eb48ac5bd0064c7da5915d8b51c990ab3a32","contractFile":"tests/tenant-multi-entity-transfers-write-candidate.test.mjs","contractBlobSha":"98015ffb48b1832c5f618405b1c9b230e99876bb","workflowFile":".github/workflows/multi-entity-browser-qa.yml","workflowBlobSha":"ae71b132c1e495f58a0589a5fc44a956e85fc924","coverageCredits":0,"exactHeadPg16Http":"PENDING","independentSecurityReview":"PENDING","productionCertified":false,"reconciliationReview":{"kind":"exact-final-merged-head-four-part-review-withheld-2026-11-02","proofPr":1662,"proofFinalHead":"c7001c59b9f60b55192bfb1d1876a18e0f18f482","passedJob":"https://github.com/erwinmehehe/payrollph/actions/runs/41221508614/job/124596856463","proofFile":"scripts/qa/tenant-multi-entity-transfers-write-http.mjs","proofBlobShaAtFinalHead":"21909753364cda9cead239a8a495b1e2a40abc9d","reviewedRouteBlobSha":"a27a0b307cd5dd0ef2bb26a83eae0bb94248e733","sourceAnchors":method.name === "PATCH" ? {"ownPositiveLine":176,"foreignDenialLine":156,"forgedSelectorLine":166,"unchangedDbLine":224,"victimIdOrderingLine":131} : {"ownPositiveLine":139,"foreignDenialLine":153,"forgedSelectorLine":160,"unchangedDbLine":224,"victimIdOrderingLine":131},"missingParts":[method.name === "PATCH" ? "Two independent own-employer positive PATCH controls missing (all reject/approve/apply are organization 1)." : "Two independent own-employer positive POST controls missing (both owns use organization 1).","Real victim transfer ID greater than both own comparator transfer IDs is unproven (victim inserted first)."],"fullMethodCoverageCredits":0,"independentReview":"PENDING","productionTested":false}},
        "Source and PG16 evidence must match the uncredited transfer review");
    }
    for (const [file, sha] of [
      // Repinned after #1853: this candidate test now asserts the dedicated credit instead of the GAP hold. Reviewed together with the dedicated proof.
      ["tests/tenant-multi-entity-transfers-write-candidate.test.mjs", "6c552aa240f537c54db74815b44a5b66339d6649"],
      ["scripts/qa/tenant-multi-entity-transfers-write-http.mjs", "f628eb48ac5bd0064c7da5915d8b51c990ab3a32"],
      [".github/workflows/multi-entity-browser-qa.yml", "ae71b132c1e495f58a0589a5fc44a956e85fc924"],
    ]) assert.equal(gitBlobSha(readFileSync(file)), sha,
      "A changed transfer security test must receive new exact-source review: " + file);
    const proof = readFileSync("scripts/qa/tenant-multi-entity-transfers-write-http.mjs", "utf8");
    assert.match(proof, /CREATE TRIGGER ci_transfer_post_error/);
    assert.match(proof, /CREATE TRIGGER ci_transfer_patch_error/);
    assert.match(proof, /const cProposed = status\(await call\(attackerC, "POST"/);
    assert.match(proof, /const cRejected = status\(await call\(cChecker, "PATCH"/);
    assert.match(proof, /orderedVictim\.id > Math\.max\(6, ownId, nextId, due\.id, cOwnId, cOwnNextId\)/);
    assert.match(proof, /assert\.deepEqual\(await snapshot\(2\), newVictimBefore/);
    assert.ok(proof.includes("assert.deepEqual(await snapshot(1), beforePostFault"), "Missing POST unchanged-state assertion");
    assert.ok(proof.includes("assert.deepEqual(await snapshot(1), beforePatchFault"), "Missing PATCH unchanged-state assertion");
    return;
  }

  // Existing historical GET credit is preserved, not promoted. The new exact
  // route source and dedicated disposable-PG16 proof are independently pinned
  // for renewed human review. The old positive/victim receipt remains intact.
  if (isNewOrChanged && method.status === "COVERED" &&
      key === "src/app/api/organizations/[id]/payroll-approvers/route.ts GET") {
    const routeFile = "src/app/api/organizations/[id]/payroll-approvers/route.ts";
    const reviewed = method.reviewedUncertified;
    const oldRouteSha = "50924a54ce2442bbc9fbd5adb5f4495d99e5d2ab";
    const currentRouteSha = "ffb27f3797ecaba1fec8198cab04c0f691382743";
    assert.equal(currentBlob, currentRouteSha,
      "Payroll approver picker changed: renew exact-source tenant/privacy review");
    assert.equal(baseline.api[routeFile], oldRouteSha,
      "Original payroll approver source baseline changed");
    assert.deepEqual(reviewed, {
      kind: "payroll-approvers-active-grant-hardened-source-zero-new-credit",
      oldRouteBlobSha: oldRouteSha,
      routeBlobSha: currentRouteSha,
      runnerFile: "scripts/qa/tenant-payroll-approvers-http.mjs",
      runnerBlobSha: "bcdcefe33271811364d0b3878abdfc3a3c282346",
      contractFile: "tests/tenant-payroll-approvers-contract.test.mjs",
      contractBlobSha: "9dc730442d42d8b48025b9619b0b6b8ea9687c35",
      workflowFile: ".github/workflows/tenant-payroll-approvers-http.yml",
      workflowBlobSha: "f8577a357888bd3483840e3c59dbe9ffae082459",
      syntheticPg16Run: "40849212540",
      coverageCredits: 0,
      independentSecurityReview: "PENDING",
      productionTouched: false,
    }, "Payroll approver hardening must retain exact uncredited review evidence");
    for (const [path, sha] of [
      [reviewed.runnerFile, reviewed.runnerBlobSha],
      [reviewed.contractFile, reviewed.contractBlobSha],
      [reviewed.workflowFile, reviewed.workflowBlobSha],
    ]) {
      assert.equal(gitBlobSha(readFileSync(path)), sha,
        "Payroll approver fixture/contract/workflow changed: renew security review " + path);
    }
    assert.equal(method.testedBy.file, "scripts/qa/tenant-high-risk-01-http.mjs",
      "Historical owned/victim HTTP proof must remain traceable");
    assert.equal(method.testedBy.ownPositiveLine, 275);
    assert.equal(method.testedBy.foreignDenialLine, 279);
    const source = readFileSync(routeFile, "utf8");
    for (const guard of [
      'Number.isSafeInteger(organizationId)',
      'getAccess(user.id, organizationId)',
      'eq(userOrganizations.organizationId, organizationId)',
      'eq(userOrganizations.active, true)',
      'eq(users.active, true)',
      'inArray(userOrganizations.role, [...PAYROLL_CHECKER_ROLES])',
      'ne(userOrganizations.userId, user.id)',
      'eq(userOrganizations.orgUnitId, candidateUnitId)',
      '"Cache-Control": "private, no-store"',
    ]) {
      assert.ok(source.includes(guard),
        "Payroll approver route missing reviewed pre-projection access guard: " + guard);
    }
    const scoped = source.indexOf("const access = await getAccess(user.id, organizationId)");
    const names = source.indexOf("const rows = await db");
    assert.ok(scoped > 0 && names > scoped,
      "Payroll approver org/unit access must resolve before reading name and email");
    const runner = readFileSync(reviewed.runnerFile, "utf8");
    for (const proofStep of [
      'seedEmployer("ATTA"',
      'seedEmployer("ATTB"',
      'seedEmployer("VICTIM"',
      'revokedAndDisabledAccountsExcluded: true',
      'crossEmployerDenials: 4',
      'allBusinessAndAuditRowsUnchanged: true',
      'methodCredits: 0, independentAcceptance: false',
    ]) {
      assert.ok(runner.includes(proofStep),
        "The synthetic payroll approver tenant negative proof is no longer pinned: " + proofStep);
    }
    return;
  }

  // Finance-path tenant boundary hardening: 4 GAP methods receive NO credit.
  // The real localhost test covers exact IDs and safe read/denial paths, but
  // intentionally never submits a payroll, pays an employee or signs a pilot.
  const payrollPathReview = {
    "src/app/api/payroll-runs/[id]/submit-review/route.ts": {
      original: "89a93602a5496447bcd902598288cc8543c45276",
      current: "98abed695eee9462a233f3da78b794e60f40c581", methods: ["POST"],
    },
    "src/app/api/payroll-runs/[id]/pilot-signoff/route.ts": {
      original: "da4bf15b3541e27fe770c1e68ec568f6e3fa91ac",
      current: "18390e65b137a0e73d5c5c78e3368dbd18a26af4", methods: ["POST"],
    },
    "src/app/api/payroll-runs/[id]/xendit-payout/route.ts": {
      original: "745d24f56eac8dca56012728ad6674f3d160de53",
      current: "c100c146ce1373c1526bae90dd77667d6ed6aaad", methods: ["GET", "POST"],
    },
  };
  const payrollPath = key.slice(0, key.lastIndexOf(" "));
  const payrollReviewed = payrollPathReview[payrollPath];
  // submit-review leaves this zero-credit exception only by the money-lifecycle credit, which the COVERED branch verifies exactly.
  const moneyLifecycleCredit = method.status === "COVERED" && method.testedBy?.file === "scripts/qa/tenant-money-lifecycle-http.mjs" &&
    payrollPath === "src/app/api/payroll-runs/[id]/submit-review/route.ts";
  // pilot-signoff POST and xendit-payout GET leave the zero-credit hold only by the dedicated payroll-run-actions credit, which the
  // generic evidence branch and the dedicated test at the end of this file verify exactly. Their siblings (xendit-payout POST) stay held.
  const payrollRunActionsCredit = method.status === "COVERED" && method.testedBy?.file === "scripts/qa/tenant-payroll-run-actions-http.mjs" &&
    ((payrollPath === "src/app/api/payroll-runs/[id]/pilot-signoff/route.ts" && method.name === "POST") ||
     (payrollPath === "src/app/api/payroll-runs/[id]/xendit-payout/route.ts" && method.name === "GET"));
  if (isNewOrChanged && payrollReviewed && payrollReviewed.methods.includes(method.name) && !moneyLifecycleCredit && !payrollRunActionsCredit) {
    assert.equal(currentBlob, payrollReviewed.current,
      "Financial route source changed: re-review zero-credit method and live external-money guards");
    assert.equal(method.status, "GAP", "Refused or disabled money actions are never proof of valid own writes");
    assert.equal(method.testedBy, null, "Only independent successful own HTTP may earn a method credit");
    const review = method.reviewedUncertified;
    assert.deepEqual(review, {
      kind: "payroll-runs-seven-path-negative-only-zero-credit",
      originalRouteBlobSha: payrollReviewed.original,
      routeBlobSha: payrollReviewed.current,
      proofFile: "scripts/qa/tenant-batches/payroll-runs-path-http.mjs",
      proofBlobSha: "0f82c4e2af1a4f30363e0953ead21ea21475283a",
      contractFile: "tests/tenant-payroll-runs-path-boundaries.test.mjs",
      contractBlobSha: "30dbd3e97304728b0d70f38aaa8ec9443d2e8d59",
      workflowFile: ".github/workflows/tenant-payroll-run-path-boundaries.yml",
      workflowBlobSha: "899f6dac19cf5e3d6b47ca8242cb93d86738508d",
      coverageCredits: 0,
      exactHeadPg16Http: "PENDING",
      independentSecurityReview: "PENDING",
      productionCertified: false,
    }, "The only allowed uncredited payroll path exception is exact-source scoped evidence");
    for (const [file, sha] of [
      [review.proofFile, review.proofBlobSha],
      [review.contractFile, review.contractBlobSha],
      [review.workflowFile, review.workflowBlobSha],
    ]) {
      assert.equal(gitBlobSha(readFileSync(file)), sha,
        "Financial security fixture changed: review and re-pin " + file);
    }
    return;
  }

  if (isNewOrChanged && method.status === "GAP" &&
      key === "src/app/api/payroll-runs/[id]/payout-reconciliation/route.ts POST") {
    // Sole SHA-pinned exclusion: a provider-disabled 501 is access-control
    // evidence, never proof of a completed real payment or a safe retry.
    // Changes to the payout route invalidate this review and re-block CI.
    const proof = method.reviewedUncertified;
    assert.equal(currentBlob, "8a08081eb1ede1f24809d496804c9874ab1b46a7",
      "New payout POST source requires renewed separate owner/provider review");
    const routeSource = readFileSync("src/app/api/payroll-runs/[id]/payout-reconciliation/route.ts", "utf8");
    const postAt = routeSource.indexOf("export async function POST(");
    const postSource = routeSource.slice(postAt);
    assert.ok(postAt > 0 && postSource.includes("await requireRunEmployer({"),
      "Reconciliation must verify persisted legal-employer grant before provider handling");
    assert.ok(postSource.indexOf("await requireRunEmployer({") < postSource.indexOf("if (!process.env.PAYMONGO_SECRET_KEY)"),
      "Legal-employer denial must occur before disabled-provider 501");
    assert.equal(proof?.routeBlobSha, currentBlob);
    assert.equal(proof?.file, "scripts/qa/tenant-second-pass-http.mjs");
    const own = evidenceLine(proof.file, proof.ownPositiveLine, key + " owned provider-disabled");
    const foreign = evidenceLine(proof.file, proof.foreignDenialLine, key + " real victim denial");
    const unchanged = evidenceLine(proof.file, proof.unchangedDbLine, key + " unchanged victim");
    const lines = readableLines(proof.file);
    const ownSpan = lines.slice(proof.ownPositiveLine - 1, proof.ownPositiveLine + 3).join("\n");
    const foreignSpan = lines.slice(proof.foreignDenialLine - 1, proof.foreignDenialLine + 3).join("\n");
    assert.ok(own.includes('const ownDisabledPayoutPost = expectStatus') &&
      own.includes('run.id + "/payout-reconciliation"') &&
      ownSpan.includes('method: "POST"') && ownSpan.includes('}), 501,'),
      "Owned payout operation must actually reach the provider-disabled 501 after authentication");
    assert.ok(foreign.includes('f.victimRun.id + "/payout-reconciliation"') &&
      foreignSpan.includes('method: "POST"') && foreignSpan.includes('}), 403,'),
      "Real victim payroll reconciliation POST must be explicitly denied");
    assert.match(unchanged, /assert\.deepEqual\(victimAfter, victimBefore/,
      "Denied payout POST must leave actual victim payroll unchanged");
    assert.equal(method.testedBy, null, "Payout POST remains uncertified, never COVERED");
    return;
  }
  if (isNewOrChanged && method.status === "GAP" &&
      key === "src/app/api/readiness/workspace/route.ts GET") {
    // A 503 own read is NOT a successful readiness read. The sole approved
    // exception is a SHA-pinned deny-by-default endpoint and executable,
    // independent foreign-denial proof; the method stays GAP.
    const proof = method.reviewedUncertified;
    assert.equal(currentBlob, "10121c3378f2e4ee983ab9b9551498a6f8dccdfd",
      "Changes to the readiness route must renew containment review");
    assert.equal(proof?.routeBlobSha, currentBlob);
    assert.equal(proof?.file, "scripts/qa/workspace-readiness-http.mjs");
    assert.equal(proof?.ownStatus, 503);
    assert.equal(proof?.foreignStatus, 403);
    const own = evidenceLine(proof.file, proof.ownPositiveLine, key + " own 503");
    const foreign = evidenceLine(proof.file, proof.foreignDenialLine, key + " foreign 403");
    const lines = readableLines(proof.file);
    const ownSpan = lines.slice(proof.ownPositiveLine - 1, proof.ownPositiveLine + 3).join("\n");
    assert.match(own, /const ownReadinessUnavailable = expectStatus\(await request\(/);
    assert.match(ownSpan, /\), 503,/);
    assert.match(foreign, /expectStatus\(await request\(/);
    assert.match(foreign, /\), 403,/);
    assert.match(lines.join("\n"), /TENANT_SECOND_PASS_MODE/);
    assert.match(readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8"),
      /verifyWorkspaceReadinessIsolation\(f, \{ request, expectStatus \}\)/);
    assert.match(readFileSync("src/app/api/readiness/workspace/route.ts", "utf8"),
      /return tenantReadinessUnavailable\(organizationId\)/);
    assert.equal(method.testedBy, null, "No successful owned readiness read: keep GAP");
    return;
  }
  // GET-only labor-costing hardening must not silently certify the untouched
  // POST action. The new whole-route SHA is pinned, and the POST handler's
  // exact original Git blob is verified through a byte-preserving digest.
  // Any future modification to either one reopens mandatory review.
  if (isNewOrChanged && method.status === "GAP" &&
      key === "src/app/api/workforce/labor-costing/route.ts POST") {
    const record = manifest.allApiRouteFiles["src/app/api/workforce/labor-costing/route.ts"];
    const reviewed = method.reviewedUncertified;
    assert.equal(currentBlob, "4b98d27a02ccd6fbfb76ad08cb501410a8fd67bd",
      "Labor costing changed again; exact-source method review is required");
    assert.equal(record.gitBlobSha, currentBlob);
    assert.equal(reviewed?.kind, "unchanged-POST-in-GET-only-security-fix");
    assert.equal(reviewed?.originalRouteBlobSha, "e5e2c007ca41da3c6e2fc1217600f83640f48975");
    assert.equal(reviewed?.routeBlobSha, currentBlob);
    const routeSource = readFileSync("src/app/api/workforce/labor-costing/route.ts", "utf8");
    const postStart = "export async function POST(request: Request) {";
    assert.equal(routeSource.indexOf(postStart), routeSource.lastIndexOf(postStart),
      "The POST handler must not be duplicated");
    assert.ok(routeSource.includes(postStart), "Original POST method must remain intact");
    const post = routeSource.slice(routeSource.indexOf(postStart));
    const postBlobSha = gitBlobSha(Buffer.from(post));
    assert.equal(postBlobSha, "91bcb6ee054c538f72d65630cc89deb641cfa7f5",
      "POST source no longer matches the original unreviewed handler; new positive/negative proof required");
    assert.equal(reviewed.unchangedPostBlobSha, postBlobSha);
    assert.equal(method.testedBy, null, "Untested POST stays GAP with zero new credits");
    const readMethod = record.methods.find((item) => item.name === "GET");
    assert.equal(readMethod?.status, "COVERED",
      "The independently evidenced GET must retain its own real HTTP source");
    assert.equal(readMethod?.testedBy?.file, "scripts/qa/tenant-table-http.mjs");
    assert.match(routeSource.slice(0, routeSource.indexOf(postStart)), /scopeLaborCostingRead\(\{/,
      "GET finance projection must remain separate from the unmodified POST handler");
    return;
  }

  // HCM capability POST has four distinct actions. A one-line date-regex fix
  // makes only set_employee_skill/declared executable with positive and
  // foreign-denial HTTP evidence. It is NOT blanket proof of the other POST
  // actions, especially verified/revoked transitions. Require the exact
  // reviewed source blob AND a byte-for-byte reconstruction of the original
  // route after undoing that one regex change. Any other change re-blocks CI.
  if (isNewOrChanged && method.status === "GAP" &&
      key === "src/app/api/hcm/capabilities/route.ts POST") {
    const reviewed = method.reviewedUncertified;
    const originalBlob = "5e8e1d0ac7fd7592a9da34091933ae9f0b6910fd";
    const scopedBlob = "675118ce830de4525797288b9b3581f294c35c46";
    assert.equal(currentBlob, scopedBlob, "HCM capability source changed; require renewed method review");
    assert.equal(reviewed?.kind, "iso-date-regex-only-action-limited-employee-skill-proof");
    assert.equal(reviewed?.originalRouteBlobSha, originalBlob);
    assert.equal(reviewed?.routeBlobSha, scopedBlob);
    assert.equal(reviewed?.action, "set_employee_skill");
    assert.equal(reviewed?.status, "declared");
    assert.equal(reviewed?.remainingPostActions, "GAP");
    assert.equal(method.testedBy, null, "Partial action evidence is NOT full POST coverage");
    const route = readFileSync("src/app/api/hcm/capabilities/route.ts", "utf8");
    const fixed = "const ISO_DATE = /^\\d{4}-\\d{2}-\\d{2}$/;";
    const original = "const ISO_DATE = /^\\\\d{4}-\\\\d{2}-\\\\d{2}$/;";
    assert.equal(route.split(fixed).length, 2, "Exactly one fixed ISO_DATE validator required");
    assert.equal(gitBlobSha(Buffer.from(route.replace(fixed, original))), originalBlob,
      "No additional code change or unreviewed POST/GET action may ride with the regex fix");
    assert.match(route, /eq\(employees\.organizationId, organizationId\)/);
    assert.match(route, /eq\(hcmSkills\.organizationId, organizationId\)/);
    assert.match(route, /assertScope\(access, employee\.orgUnitId\)/);
    const get = manifest.allApiRouteFiles["src/app/api/hcm/capabilities/route.ts"].methods
      .find((entry) => entry.name === "GET");
    assert.equal(get?.status, "COVERED", "Previously evidenced GET remains separately covered");
    assert.equal(get?.testedBy?.file, "scripts/qa/tenant-table-http.mjs");
    const evidenceFile = "scripts/qa/tenant-hcm-employee-skills-http.mjs";
    assert.equal(reviewed?.file, evidenceFile);
    const evidenceLines = readableLines(evidenceFile);
    const evidenceSource = evidenceLines.join("\n");
    const proofCases = [
      [reviewed.ownPositiveLine, /const ownResponse = standaloneExpectStatus\(await standaloneRequest\(endpoint/, /\), 200,/],
      [reviewed.foreignDenialLine, /const foreign = standaloneExpectStatus\(await standaloneRequest\(endpoint/, /\), 403,/],
      [reviewed.forgedDenialLine, /const forged = standaloneExpectStatus\(await standaloneRequest\(endpoint/, /\), 404,/],
    ];
    for (const [line, call, status] of proofCases) {
      const hit = evidenceLine(evidenceFile, line, key);
      assert.match(hit, call, "Must use actual authenticated HTTP, not fabricated result");
      const span = evidenceLines.slice(line - 1, line + 3).join("\n");
      assert.match(span, /method: "POST"/);
      assert.match(span, status);
    }
    assert.match(evidenceLine(evidenceFile, reviewed.unchangedDbLine, key),
      /assert\.deepEqual\(plain\(await row\.state\(victim\.org\.id\)\), victimBefore/);
    assert.match(evidenceSource, /for \(const own of \[attackerA, attackerB\]\)/);
    assert.match(evidenceSource, /await seedTableRow\(row, employers\)/);
    assert.match(evidenceSource, /victimSnapshot\(victim\.org\.id\)/);
    assert.match(evidenceSource, /requireDisposableHcmSkills\(\)/);
    const contract = readFileSync("scripts/qa/tenant-hcm-employee-skills-contract.mjs", "utf8");
    assert.match(contract, /action: "set_employee_skill"/);
    assert.match(contract, /status: "declared"/);
    assert.match(contract, /assert\.equal\(row\.verified_at, null/);
    const workflow = readFileSync(".github/workflows/tenant-hcm-employee-skills.yml", "utf8");
    assert.match(workflow, /image: postgres:16/);
    assert.match(workflow, /node --import tsx scripts\/qa\/tenant-hcm-employee-skills-http\.mjs/);
    assert.ok(!workflow.includes("TENANT_TABLE_FAMILY:"),
      "Action-only proof must not duplicate the shared POST method row");
    assert.equal(reviewed?.testFile, "tests/tenant-hcm-employee-skills.test.mjs");
    const negativeTests = readFileSync(reviewed.testFile, "utf8");
    assert.match(negativeTests, /reject no-op, wrong worker\/skill\/tenant/);
    assert.match(negativeTests, /audit must identify the actual session actor/);
    return;
  }
  // This is an exact-source, action-limited exception, NOT a new POST
  // tenant-isolation credit. #1511 changes three developer security mutations
  // solely to commit their audit receipts atomically. The unchanged test-webhook
  // action and whole-route signed-in cross-tenant HTTP proof remain GAP.
  if (isNewOrChanged && method.status === "GAP" &&
      key === "src/app/api/developer/route.ts POST") {
    const reviewed = method.reviewedUncertified;
    const routePath = "src/app/api/developer/route.ts";
    const route = readFileSync(routePath, "utf8");
    const routeSha = "f8ecdf3fc0063e296ded7184010237e37373cbd0";
    const originalSha = "d703c535b5f15a57af6069b3248d08853e9fe234";
    assert.equal(currentBlob, routeSha,
      "Developer POST changed again: require fresh route, audit and security review");
    assert.equal(reviewed?.kind, "developer-security-atomic-audit-only");
    assert.equal(reviewed?.limiterFile, "src/lib/developer-rate-limit.ts");
    assert.equal(reviewed?.limiterBlobSha, gitBlobSha(readFileSync(reviewed.limiterFile)),
      "Developer security limiter changed: require renewed source and abuse-control review");
    assert.equal(reviewed?.limiterTestFile, "tests/developer-rate-limit-gate.test.ts");
    assert.equal(reviewed?.limiterTestBlobSha, gitBlobSha(readFileSync(reviewed.limiterTestFile)),
      "Developer limiter tests changed: require renewed negative-control review");
    assert.match(route, /developerMutationRateLimitResponse\(mutationLimit\)/);
    assert.match(route, /if \(limiterDenied\) return limiterDenied;/);
    const limiter = readFileSync(reviewed.limiterFile, "utf8");
    assert.match(limiter, /result\.mode !== "distributed-postgres"/);

    assert.equal(reviewed?.originalRouteBlobSha, originalSha);
    assert.equal(reviewed?.routeBlobSha, routeSha);
    assert.equal(reviewed?.helperFile, "src/lib/developer-security-mutations.ts");
    assert.equal(reviewed?.helperBlobSha,
      gitBlobSha(readFileSync(reviewed.helperFile)),
      "Atomic audit helper changed: re-review the real PostgreSQL rollback proof");
    assert.equal(reviewed?.dbTestFile, "tests/developer-security-atomic-audit-db.test.ts");
    assert.equal(reviewed?.dbTestBlobSha,
      gitBlobSha(readFileSync(reviewed.dbTestFile)),
      "Atomic audit DB proof changed: require fresh test review");
    assert.equal(reviewed?.evidenceKind, "fictional-pg16-db-only-not-http");
    assert.deepEqual(reviewed?.boundedActions, ["create-key", "revoke-key", "create-webhook"]);
    assert.deepEqual(reviewed?.remainingUnprovedActions, ["test-webhook"]);
    assert.equal(reviewed?.coverageCredits, 0);
    assert.equal(method.testedBy, null, "Developer POST is NOT tenant-isolation COVERED");

    // The previously reviewed GET and POST authorization controls must still
    // exist; the exact whole-route SHA above pins all source bytes.
    for (const guard of [
      /export async function GET\(request: Request\)/,
      /export async function POST\(request: Request\)/,
      /enforceSameOriginMutation\(request\)/,
      /getSessionUser\(\)/,
      /publicDemoMutationDenied\(user\.email/,
      /assertOrganizationRole\(/,
      /getAccess\(user\.id, organizationId\)/,
      /access\?\.companyWide/,
      /requireSensitiveActionMfa\(user\)/,
      /rateLimitDistributed\(/,
      /normalizeScopes\(body\.scopes\)/,
      /validateWebhookTarget\(rawUrl\)/,
      /dispatchWebhook\(/,
    ]) assert.match(route, guard, "Developer security guard removed");
    const helper = readFileSync(reviewed.helperFile, "utf8");
    for (const name of [
      "createDeveloperApiKeyWithAudit",
      "revokeDeveloperApiKeyWithAudit",
      "createDeveloperWebhookWithAudit",
    ]) {
      assert.ok(route.includes(name + "({"), name + ": POST action must invoke atomic helper");
      assert.ok(helper.includes("export async function " + name + "("),
        name + ": matching reviewed helper required");
    }
    assert.equal((helper.match(/return db\.transaction\(async \(tx\) => \{/g) ?? []).length, 3,
      "Each security mutation must run in its own PostgreSQL transaction");
    assert.equal((helper.match(/tx\.insert\(auditEvents\)\.values\(\{/g) ?? []).length, 3,
      "Each security mutation must persist an in-transaction audit");
    assert.match(helper, /eq\(apiKeys\.id, input\.keyId\), eq\(apiKeys\.organizationId, input\.organizationId\)/,
      "Revocation must remain tenant-scoped");
    const testSource = readFileSync(reviewed.dbTestFile, "utf8");
    for (const name of [
      "createDeveloperApiKeyWithAudit",
      "revokeDeveloperApiKeyWithAudit",
      "createDeveloperWebhookWithAudit",
    ]) assert.match(testSource, new RegExp("assert\\.rejects\\(" + name + "\\("),
      name + ": force an audit failure after attempted mutation");
    assert.match(testSource, /organizationId: beta\.id, keyId: key\.id/,
      "Foreign-tenant revoke negative control is required");
    assert.match(testSource, /!JSON\.stringify\(receipts\)\.includes\(webhookInput\.secret\)/,
      "A webhook secret must never appear in the audit receipt");
    return;
  }

  if (isNewOrChanged && method.status === "GAP" &&
      key === "src/app/api/self/profile/route.ts PATCH") {
    // PII-02 source hardening is not a tenant-isolation certification. The
    // previous route changed, so require exact current source, real PG16 HTTP
    // proof and its negative controls, while retaining zero method credits.
    // Any further edit must fail this exception and trigger a fresh review.
    const reviewed = method.reviewedUncertified;
    const routePath = "src/app/api/self/profile/route.ts";
    const source = readFileSync(routePath, "utf8");
    assert.equal(currentBlob, "41d26b23678e8822aff4701a611c429e97f659c3",
      "Changed employee self-profile handler needs renewed source and security review");
    assert.equal(reviewed?.kind, "pii02-self-profile-atomic-source-review-only");
    assert.equal(reviewed?.originalRouteBlobSha, "85b5bbf1aff9e1777fc523d067586f9870dc87a6");
    assert.equal(reviewed?.routeBlobSha, currentBlob);
    assert.equal(reviewed?.coverageCredits, 0);
    assert.equal(reviewed?.reviewPolicy, "SOLO_VERIFIED_DEV_RECOVERY");
    assert.equal(reviewed?.soleOwnerReviewer, "erwinmehehe");
    assert.equal(reviewed?.reviewStatus, "PENDING_EXACT_FINAL_HEAD");
    assert.equal(method.testedBy, null, "No method is promoted to COVERED");
    assert.equal(reviewed?.file, "scripts/qa/tenant-self-profile-atomic-http.mjs");
    assert.equal(reviewed?.fileBlobSha, gitBlobSha(readFileSync(reviewed.file)),
      "Any QA runner change invalidates this source-only exception");
    assert.equal(reviewed?.testFile, "tests/tenant-self-profile-contract.test.mjs");
    assert.equal(reviewed?.testBlobSha, gitBlobSha(readFileSync(reviewed.testFile)),
      "Any negative-control test change requires review");
    assert.equal(reviewed?.historicalFileBlobSha, "2bae931424036014f92211a50c4211824a61d7b1");
    assert.equal(reviewed?.historicalTestBlobSha, "bda6d239383e0736302c1970cbc0aa78433ef470");
    assert.equal(reviewed?.contractFile, "scripts/qa/tenant-self-profile-contract.mjs");
    assert.equal(reviewed?.contractBlobSha, gitBlobSha(readFileSync(reviewed.contractFile)),
      "New payroll-entry/CSP invariant contract requires renewed review");
    assert.equal(reviewed?.workflowFile, ".github/workflows/tenant-self-profile-http.yml");
    assert.equal(reviewed?.workflowBlobSha, gitBlobSha(readFileSync(reviewed.workflowFile)),
      "New disposable-PG16 workflow must stay byte-pinned");
    const profileProof = readFileSync(reviewed.file, "utf8");
    for (const token of [
      "payrollEntriesByEmployer", "innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))",
      "assert.deepEqual(await snapshot(first.org.id), beforeAuditVeto",
      "profileAuditRollbackProven: true",
    ]) assert.ok(profileProof.includes(token), "PII-02 changed real-HTTP proof lost: " + token);
    assert.ok(readFileSync(reviewed.contractFile, "utf8").includes("payrollEntries"),
      "Profile contact updates must preserve actual payroll entries");
    for (const flag of ["NEXT_CSP_ENABLED=false", "WORKER_ENABLED=false",
      "CENTRAL_SCHEDULER_ENABLED=false", "XENDIT_BILLING_ENABLED=false"]) {
      assert.ok(readFileSync(reviewed.workflowFile, "utf8").includes(flag),
        "Disposable PII-02 workflow lost a disabled safety flag: " + flag);
    }

    const checks = [
      [reviewed.ownPositiveLine, /const actual = await checked\(ENDPOINT, \{/],
      [reviewed.forgedSelectorLine, /const forged = await checked\(ENDPOINT/],
      [reviewed.workerMismatchLine, /const mismatch = await checked\(ENDPOINT, \{/],
      [reviewed.foreignDenialLine, /const revoked = await checked\(ENDPOINT/],
      [reviewed.auditVetoLine, /const auditVeto = await checked\(ENDPOINT, \{/],
      [reviewed.auditRollbackLine, /assert\.deepEqual\(await snapshot\(first\.org\.id\), beforeAuditVeto/],
      [reviewed.unchangedVictimLine, /await unchangedVictim\("membership revoked/],
    ];
    const evidence = readableLines(reviewed.file);
    for (const [line, expected] of checks) {
      assert.match(evidenceLine(reviewed.file, line, key), expected);
    }
    for (const [line, status] of [
      [reviewed.ownPositiveLine, 200],
      [reviewed.workerMismatchLine, 403],
      [reviewed.foreignDenialLine, 403],
      [reviewed.auditVetoLine, 500],
    ]) {
      assert.match(evidence.slice(line - 1, line + 6).join("\n"),
        new RegExp(", " + status + ","),
        "Genuine localhost HTTP proof must assert the exact expected status");
    }
    assert.match(evidence.join("\n"), /requireDisposableSelfProfile\(\)/);
    assert.match(evidence.join("\n"), /for \(const own of attackers\)/);
    assert.match(evidence.join("\n"), /profileAuditRollbackProven: true/);
    assert.match(source, /db\.transaction\(async \(tx\) =>/);
    assert.match(source, /\.for\("update"\)\.limit\(1\)/);
    assert.match(source, /\.for\("share"\)\.limit\(1\)/);
    assert.match(source, /eq\(employees\.organizationId, boundEmployee\.organizationId\)/);
    assert.match(source, /await tx\.insert\(auditEvents\)\.values\(\{/);
    assert.ok(source.indexOf("tx.update(employees)") < source.indexOf("tx.insert(auditEvents)"),
      "Contact edit and audit receipt must stay in one transaction");
    const workflow = readFileSync(".github/workflows/tenant-self-profile-http.yml", "utf8");
    assert.match(workflow, /image: postgres:16/);
    assert.match(workflow, /node --import tsx scripts\/qa\/tenant-self-profile-atomic-http\.mjs/);
    return;
  }
  // #1521 changes POST employee creation only to require an explicit NWPC
  // wage-region value and return INVALID_WAGE_REGION / 422 before any write.
  // The reconstructed pre-change route must match its original Git blob byte
  // for byte. The original GET and PATCH handlers remain untouched; no new
  // tenant-isolation method credit is earned for POST or PATCH by this review.
  if (isNewOrChanged && method.status === "GAP" &&
      ["src/app/api/employees/route.ts POST",
       "src/app/api/employees/route.ts PATCH"].includes(key)) {
    const path = "src/app/api/employees/route.ts";
    const routeSha = "55714fa2eb6bc4efa4ba6b01c91864e417ef99a3";
    const originalSha = "5032fb958c435f3332af408ca6c3217e764cbb7e";
    const reviewed = method.reviewedUncertified;
    assert.equal(currentBlob, routeSha,
      "Employee route changed: repeat wage validation and tenant gate review");
    assert.equal(manifest.allApiRouteFiles[path].gitBlobSha, routeSha);
    assert.equal(reviewed?.kind, "employee-explicit-wage-region-validation-only");
    assert.equal(reviewed?.routeBlobSha, routeSha);
    assert.equal(reviewed?.originalRouteBlobSha, originalSha);
    assert.equal(reviewed?.onlyChangedMethod, "POST");
    assert.equal(reviewed?.validationStatus, 422);
    assert.equal(reviewed?.validationErrorCode, "INVALID_WAGE_REGION");
    assert.equal(reviewed?.reconstructedOriginalRouteSource, true);
    assert.equal(reviewed?.coverageCredits, 0);
    assert.equal(reviewed?.testFile, "tests/wage-orders.test.ts");
    assert.equal(reviewed?.browserProofFile, "scripts/hris-journey-synthetic-browser.mjs");
    assert.equal(method.testedBy, null, "No standalone cross-tenant method proof: remain GAP");

    const route = readFileSync(path, "utf8");
    const undoExactlyOnce = (source, changed, prior) => {
      assert.equal(source.split(changed).length, 2,
        "Only one reviewed wage region source change may exist");
      return source.replace(changed, prior);
    };
    let restored = undoExactlyOnce(route,
      'import { WAGE_ORDERS, requireExplicitWageRegion } from "@/lib/wage-orders";',
      'import { WAGE_ORDERS, wageOrderFor } from "@/lib/wage-orders";');
    restored = undoExactlyOnce(restored,
      "// Require an explicit NWPC region on new records, never a silent NCR default.",
      "// Use a canonical NWPC region on new records: an unsupported value would\n" +
        "  // otherwise surface as an opaque error during the employee's first payroll.");
    restored = undoExactlyOnce(restored,
      "wageRegion = requireExplicitWageRegion(body.region);",
      'wageRegion = wageOrderFor(String(body.region ?? "NCR")).region;');
    assert.equal(gitBlobSha(Buffer.from(restored)), originalSha,
      "Only the three reviewed validator/import/comment edits may be present");

    const getStart = "export async function GET(request: Request) {";
    const postStart = "export async function POST(request: Request) {";
    const patchStart = "export async function PATCH(request: Request) {";
    for (const methodSource of [getStart, postStart, patchStart]) {
      assert.ok(route.includes(methodSource) &&
        route.indexOf(methodSource) === route.lastIndexOf(methodSource),
        "Employee route's original separate method must not be duplicated");
    }
    assert.equal(route.slice(route.indexOf(getStart), route.indexOf(postStart)),
      restored.slice(restored.indexOf(getStart), restored.indexOf(postStart)),
      "Existing GET proof cannot be inherited if GET handler changed");
    assert.equal(route.slice(route.indexOf(patchStart)),
      restored.slice(restored.indexOf(patchStart)),
      "Untested employee PATCH must remain byte-for-byte unchanged");

    assert.match(route, /wageRegion = requireExplicitWageRegion\(body\.region\)/);
    assert.doesNotMatch(route, /body\.region \?\? "NCR"/,
      "A missing employee region must not silently become NCR");
    assert.match(route, /code: "INVALID_WAGE_REGION"/);
    assert.match(route, /supportedRegions: WAGE_ORDERS\.map/);
    assert.match(route, /status: 422/);
    assert.match(route, /region: wageRegion/);
    assert.match(route, /assertOrganizationRole\(/);
    assert.match(route, /getAccess\(user\.id, organizationId\)/);

    const ui = readFileSync("src/components/new-hire-modal.tsx", "utf8");
    assert.match(ui, /region: ""/);
    assert.match(ui, /<label>Wage region/);
    assert.match(ui, /<select required value=\{form\.region\}/);
    assert.match(ui, /<option value="" disabled>Choose wage region<\/option>/);
    const sourceTest = readFileSync(reviewed.testFile, "utf8");
    assert.match(sourceTest, /requireExplicitWageRegion\(invalid\)/);
    assert.match(sourceTest, /source\.includes\('wageRegion = requireExplicitWageRegion\(body\.region\);'\)/);
    const realBrowser = readFileSync(reviewed.browserProofFile, "utf8");
    assert.match(realBrowser, /hire\.getByLabel\("Wage region"\)\.selectOption\("NCR"\)/,
      "The real-hire browser acceptance must explicitly pick a wage region");
    assert.match(realBrowser, /created\.employee\.region, "NCR"/);
    const get = manifest.allApiRouteFiles[path].methods.find(item => item.name === "GET");
    const post = manifest.allApiRouteFiles[path].methods.find(item => item.name === "POST");
    const patch = manifest.allApiRouteFiles[path].methods.find(item => item.name === "PATCH");
    assert.equal(get?.status, "COVERED",
      "Preserve prior real-tenant GET evidence");
    assert.equal(get?.testedBy?.file, "scripts/qa/tenant-second-pass-http.mjs");
    assert.equal(post?.status, "GAP");
    assert.equal(post?.testedBy, null);
    assert.equal(patch?.status, "GAP");
    assert.equal(patch?.testedBy, null);
    return;
  }

  // STA-01 filing-outcome PATCH: a dedicated real PG16/HTTP suite exercises
  // only fictional REJECTED outcomes. Moving the conditional update and audit
  // into one DB transaction is security hardening, NOT an accepted-outcome
  // positive and not an eligible whole-method COVERED promotion.
  if (isNewOrChanged && method.status === "GAP" &&
      key === "src/app/api/compliance/filing-validations/[id]/route.ts PATCH") {
    const reviewed = method.reviewedUncertified;
    const original = "91ad31b9bd663a855c033932f446c604c4ce6a41";
    const current = "09f642a67035dc9ce22fa502d80518ba18641b0f";
    assert.equal(currentBlob, current, "Filing PATCH changed: require renewed exact-source review");
    assert.equal(reviewed?.kind, "sta01-filing-outcome-audit-atomicity-only-no-full-PATCH-credit");
    assert.equal(reviewed.originalRouteBlobSha, original);
    assert.equal(reviewed.routeBlobSha, current);
    assert.equal(reviewed.helperFile, "src/lib/filing-evidence-store.ts");
    assert.equal(reviewed.proofFile, "scripts/qa/tenant-table-rows/write/compliance-filing.mjs");
    assert.equal(reviewed.testFile, "tests/tenant-compliance-filing-contract.test.mjs");
    // The original STA-01 rejected-only source is historical. This separate
    // draft adds a fictional ACCEPTED-path candidate without coverage credit.
    // Pin both generations independently; don't transfer the older receipt.
    const currentCandidatePins = {
      "scripts/qa/tenant-table-rows/write/compliance-filing.mjs":
        "c7c7bf0a1b6b8b4eb4eade869ec8184beefe4fba",
      "tests/tenant-compliance-filing-contract.test.mjs":
        "d4e635d1a0f433ec0399c96097313b93667ce554",
    };
    assert.equal(reviewed.proofBlobSha,
      "6bb8bf721e73b47b2b79e26b27ec36f1c22aae34",
      "Retain prior rejected-only proof as historical evidence");
    assert.equal(reviewed.testBlobSha,
      "9befe55be39ec7fb783958561da4182edc060ae4",
      "Retain prior rejected-only contract as historical evidence");
    for (const [file, historicalSha] of [
      [reviewed.helperFile, reviewed.helperBlobSha],
      [reviewed.proofFile, reviewed.proofBlobSha],
      [reviewed.testFile, reviewed.testBlobSha],
    ]) {
      assert.match(historicalSha, /^[a-f0-9]{40}$/);
      const expected = currentCandidatePins[file] ?? historicalSha;
      assert.equal(gitBlobSha(readFileSync(file)), expected,
        "Filing current candidate/helper modified without re-review: " + file);
    }
    const candidate = readFileSync(reviewed.proofFile, "utf8");
    const sourceRule = readFileSync("scripts/qa/tenant-compliance-filing-contract.mjs", "utf8");
    assert.match(sourceRule, /periodEnd: "2025-07-31"/,
      "SSS accepted-path source must end at the final month cutoff");
    assert.match(candidate, /generateGovernmentDraft\(ctx\.seeded\.runId, "sss-r3"\)/,
      "Do not use a made-up hash to bypass the real source-integrity check");
    assert.match(candidate, /fileSha256: sourceHash/,
      "Filing must bind to the SHA-256 of the regenerated source bytes");
    for (const token of [
      "for (let pad = 0; pad < 6; pad++)",
      "Number.isSafeInteger(filing.id) && filing.id > 6",
      "const acceptedHttp = expectStatus(await request(",
      'persistedAccepted.status, "accepted"',
      'acceptedAudit.action, "SSS R-3 filing accepted"',
      "acceptedOwnDecisionPG16: true",
      "acceptedVictimDbAndAuditUnchanged: true",
      "acceptedAuditInsertRollbackProven: true",
      "const [vetoRun] = await db.insert(payrollRuns).values({",
      'const vetoWorksheet = await generateGovernmentDraft(vetoRun.id, "sss-r3")',
      "assert.notEqual(vetoHash, sourceHash",
      "fileSha256: vetoHash",
      'accepted filing outcome must roll back on a failed audit insert',
      "assert.deepEqual(removedRun.map(row => row.id), [vetoRun.id])",
    ]) assert.ok(candidate.includes(token),
      "Filing accepted-path candidate missing required fictional PG16 control: " + token);
    assert.equal(reviewed.reconciliationReview?.fullMethodCoverageCredits, 0);
    assert.equal(reviewed.acceptedOutcomePositiveProven, false);
    assert.equal(reviewed.atomicAuditRollbackRequired, true);
    assert.equal(reviewed.fullMethodCoverageCredits, 0);
    assert.equal(reviewed.noProviderOrAgencySubmission, true);
    assert.equal(method.testedBy, null, "Rejected-only proof must stay GAP");
    assert.match(method.reason, /still GAP|Still GAP/);
    const route = readFileSync("src/app/api/compliance/filing-validations/[id]/route.ts", "utf8");
    const store = readFileSync(reviewed.helperFile, "utf8");
    const proof = readFileSync(reviewed.proofFile, "utf8");
    for (const guard of [
      /enforceSameOriginMutation\(request\)/,
      /getSessionUser\(\)/,
      /assertOrganizationRole\(/,
      /requireSensitiveActionMfa\(user\)/,
      /getFilingValidation\(organizationId, id\)/,
      /resolveMultiEntityContext\(/,
      /assertEntityResource\(scope.context, existing.legalEntityId\)/,
      /assertOrganizationUnitAccess\(/,
      /record = await db\.transaction\(async \(tx\) => \{/,
      /await tx\.insert\(auditEvents\)\.values\(\{/,
    ]) assert.match(route, guard, "Filing PATCH must retain tenant gate + atomic audit");
    assert.match(store, /await \(transaction \?\? db\)\s*\.update\(governmentFilingValidations\)/);
    assert.match(proof, /atomicAuditInsertRollbackProven: true/);
    assert.match(proof, /acceptedAuditInsertRollbackProven: true/);
    assert.equal((proof.match(/\$ci_filing_audit\$/g) ?? []).length, 2);
    return;
  }

  // WRK-02: the allocation handler now scopes persisted updates and manager
  // decisions. Its own/foreign HTTP proof passed, but two partial-action
  // methods must remain GAP, not inherit the unrelated GET credit. Admit
  // only this reviewed route/blob and exact protected PG16 source receipt.
  if (isNewOrChanged && method.status === "GAP" &&
      ["src/app/api/workforce-planning/allocations/route.ts POST",
        "src/app/api/workforce-planning/allocations/route.ts PATCH"].includes(key)) {
    const routePath = "src/app/api/workforce-planning/allocations/route.ts";
    const entry = manifest.allApiRouteFiles[routePath];
    const reviewed = method.reviewedUncertified;
    const post = key.endsWith(" POST");
    const routeSha = "a7fe9733d2c1bfc3b6cab171eb7ba302fa5b77c9";
    assert.equal(currentBlob, routeSha,
      "WRK-02 route changed again; obtain a new independent tenant review");
    assert.equal(entry.gitBlobSha, currentBlob);
    assert.deepEqual(entry.methods.map(row => [row.name, row.status]),
      [["GET", "COVERED"], ["POST", "GAP"], ["PATCH", "GAP"]],
      "No partial WRK-02 method may be credited from action-level proof");
    assert.equal(entry.methods[0].testedBy?.file, "scripts/qa/tenant-table-http.mjs",
      "Previously covered GET must retain its separate exact proof");
    assert.equal(method.testedBy, null, "WRK-02 POST/PATCH still require complete method proof");
    assert.equal(reviewed?.kind, "wrk02-partial-allocation-and-manager-decision-tenant-hardening");
    assert.equal(reviewed?.originalRouteBlobSha, "f8477326b6a64f45e554f70d9b297b5f20f9bf84");
    assert.equal(reviewed?.routeBlobSha, routeSha);
    assert.equal(reviewed?.file, "scripts/qa/tenant-wfp-allocations-http.mjs");
    assert.equal(reviewed?.proofBlobSha, "4891fb6b2bc7b4ed180f7dc6650015d974e1aa20");
    assert.equal(reviewed?.testFile, "tests/tenant-wfp-allocations-contract.test.mjs");
    assert.equal(reviewed?.testBlobSha, "98f08f01b55695499146fb8f804cdac8123e2426");
    assert.equal(reviewed?.workflowFile, ".github/workflows/tenant-wfp-allocations-http.yml");
    assert.equal(reviewed?.workflowBlobSha, "3872153dc4233ed10f074ccf90d22a8a2cd6ad16");
    assert.equal(reviewed?.reviewedHead, "3b548203726254c18f4ad4fb201a609c96f5e25a");
    assert.equal(reviewed?.passedJob,
      "https://github.com/erwinmehehe/payrollph/actions/runs/40684903960/job/122804642868");
    assert.equal(reviewed?.newCredits, 0, "Source-only controls cannot create an inventory credit");
    const linePins = post
      ? [301, 314, 260, 264, 291, 136]
      : [353, 370, 334, 338, 346, 136];
    assert.deepEqual([
      reviewed.ownPositiveLine, reviewed.secondaryOwnPositiveLine,
      reviewed.foreignDenialLine, reviewed.secondaryForeignDenialLine,
      reviewed.unchangedDbLine, reviewed.higherIdVictimLine,
    ], linePins, "WRK-02 partial proof line pins changed");
    assert.deepEqual(reviewed.actions,
      post ? ["allocation_create", "manager_draft_create"] : ["submit", "accept", "reject"]);
    assert.deepEqual(reviewed.remainingGaps,
      post ? ["existing_allocation_update", "budget_race_and_version_conflict"]
        : ["all_decision_race_and_flag_combinations"]);
    const route = readFileSync(routePath, "utf8");
    const script = readFileSync(reviewed.file, "utf8");
    const scriptLines = script.split("\n");
    const contract = readFileSync(reviewed.testFile, "utf8");
    const workflow = readFileSync(reviewed.workflowFile, "utf8");
    assert.equal(gitBlobSha(Buffer.from(route)), routeSha);
    assert.equal(gitBlobSha(Buffer.from(script)), reviewed.proofBlobSha,
      "Changing the WRK-02 HTTP proof requires a fresh passing receipt");
    assert.equal(gitBlobSha(Buffer.from(contract)), reviewed.testBlobSha,
      "Changing the WRK-02 contract requires a renewed source review");
    assert.equal(gitBlobSha(Buffer.from(workflow)), reviewed.workflowBlobSha,
      "Changes to the disposable PG16 workflow require fresh review");
    assert.match(workflow, /image: postgres:16/);
    assert.match(workflow, /node --import tsx scripts\/qa\/tenant-wfp-allocations-http\.mjs/);
    assert.ok(script.indexOf("requireDisposablePlanningEnv();") <
      script.indexOf('import("../../src/db/index.ts")'),
      "Fail-closed PG16-only preflight must precede database imports");
    assert.match(script, /const \[a, b, victim\] = employers;/);
    assert.match(script, /for \(const attacker of \[a, b\]\)/);
    assert.match(evidenceLine(reviewed.file, 136, key + " higher-ID victim"),
      /assert\.ok\(victim\[key\] > attacker\[key\]/);
    assert.match(script, /const post = \(actor, payload, nonadmin = false\) =>/);
    assert.match(script, /http\.standaloneRequest\(PATH, \{ method: "POST"/);
    assert.match(script, /const patch = \(actor, submissionId, action,/);
    assert.match(script, /method: "PATCH"/);
    assert.match(script, /assert\.equal\(response\.status, status,/,
      "Negative-control HTTP status checks must be executable");
    assert.match(script, /assert\.equal\(audit\.organizationId, actor\.orgId\)/);
    assert.match(script, /for \(const actor of \[a, b\]\)/);
    assert.match(script, /productionCertified: false, wholeMethodAccepted: false, newCredits: 0/);
    assert.match(contract, /assertNoStateChange/);
    assert.match(contract, /newCredits: 0/);
    const at = number => evidenceLine(reviewed.file, number, key);
    if (post) {
      assert.match(at(301), /const createAllocation = await post\(actor, allocationBody\(actor\)\)/);
      assert.match(at(314), /const createDraft = await post\(actor, submissionBody\(actor, allocationId\)\)/);
      assert.match(at(260), /deny\(await post\(actor, allocationBody\(actor, victim\.orgId,/);
      assert.match(at(264), /deny\(await post\(actor, submissionBody\(actor,/);
      assert.match(scriptLines.slice(259, 267).join("\n"),
        /victim\.planId, victim\.newUnitId\)\), 403,/);
      assert.match(scriptLines.slice(263, 268).join("\n"),
        /victim\.existingAllocationId, victim\.orgId\)\), 403,/);
      assert.match(at(291), /assertNoStateChange\(expected\.get\(e\.orgId\), await snapshot\(e\.orgId\)/);
      assert.match(script, /assertOwnAllocationCreated\(/);
      assert.match(script, /assertOwnManagerDraftCreated\(/);
      assert.match(script, /victim\.existingAllocationId\)\), 404,/);
      assert.match(route, /eq\(workforcePlanAllocations\.organizationId, organizationId\)/);
      assert.match(route, /eq\(workforcePlanManagerSubmissions\.organizationId, organizationId\)/);
    } else {
      assert.match(at(353), /const submitted = await patch\(actor, actor\.draftId, "submit"\)/);
      assert.match(at(370), /const decision = await patch\(actor, actor\.draftId, action, \{ checker: true \}\)/);
      assert.match(at(334), /deny\(await patch\(actor, victim\.draftId, action, \{ orgId: actor\.orgId \}\)/);
      assert.match(at(338), /deny\(await patch\(actor, victim\.draftId, "accept",/);
      assert.match(scriptLines.slice(333, 341).join("\n"),
        /403, actor\.label \+ " foreign manager PATCH " \+ action/);
      assert.match(scriptLines.slice(337, 341).join("\n"),
        /403, actor\.label \+ " foreign independent-checker PATCH"/);
      assert.match(at(346), /assertNoStateChange\(expected\.get\(e\.orgId\), await snapshot\(e\.orgId\)/);
      assert.match(script, /for \(const action of \["submit", "accept", "reject"\]\)/);
      assert.match(script, /assertDecisionTransition\(beforeSubmit, afterSubmit/);
      assert.match(script, /assertDecisionTransition\(beforeDecide, afterDecide/);
      assert.match(script, /deny\(await patch\(actor, actor\.draftId, "accept"\), 409/);
      assert.match(script, /foreignPatches: 8, nonadminPatches: 2, makerDecisionDenials: 3/);
      assert.match(script, /ownSubmissions: 3, ownDecisions: 3/);
      assert.match(route, /eq\(workforcePlanManagerSubmissions\.organizationId, submission\.organizationId\)/);
      assert.match(route, /eq\(workforcePlanManagerSubmissions\.allocationId, submission\.allocationId\)/);
      assert.match(route, /\.for\("update"\)\.limit\(1\)/);
      const patchSrc = route.slice(route.indexOf("export async function PATCH"));
      assert.ok(patchSrc.indexOf('denyOptInEnterpriseAdvancedPlan(submission.organizationId, "planning")') <
        patchSrc.indexOf('if (action === "submit")'),
        "All decision actions must execute the same advanced-planning access gate");
    }
    return; // Exact SHA-pinned WRK-02 partial method review; both stay GAP.
  }

if (isNewOrChanged && method.status === "GAP" && key === "src/app/api/webhooks/xendit/subscriptions/route.ts POST") {
    const routeFile = "src/app/api/webhooks/xendit/subscriptions/route.ts";
    const expected = {
      "kind": "xendit-subscriptions-audit-atomicity-PG16-review-only",
      "originalRouteBlobSha": "43e28a950a048d54c4890ce23341d447b9f4a515",
      "routeBlobSha": "e41f93868e6b2540cfffed632e03e0354d4fb294",
      "proofFile": "scripts/qa/tenant-webhook-xendit-subscriptions-http.mjs",
      "proofBlobSha": "0e2c4f389c54ec256fc77964735c2ec8073092f4",
      "contractFile": "tests/tenant-webhook-xendit-subscriptions.test.mjs",
      "contractBlobSha": "0093d702487844fc0f5351ca225831ebbd63a6f1",
      "gateFile": "scripts/qa/tenant-webhook-xendit-subscriptions-contract.mjs",
      "gateBlobSha": "de031df58ad736fdee747762d6a5df0e59bc22db",
      "workflowFile": ".github/workflows/tenant-webhook-xendit-subscriptions-http.yml",
      "workflowBlobSha": "034bd3e771d8d142fa9e872cb6d4ff682d371942",
      "priorPassingPg16RunId": 41746883429,
      "priorPassingPg16JobId": 126302023847,
      "priorPassingHeadSha": "d9ddca539a95af21780a19d222d9ae26ad47ab19",
      "coverageCredits": 0,
      "exactHeadPg16Http": "PENDING",
      "independentSecurityReview": "PENDING",
      "productionCertified": false,
      "providerActivated": false
    };
    assert.equal(currentBlob, expected.routeBlobSha,
      "Xendit audit-atomic source changed: independent review and new PG16 proof required");
    assert.equal(method.status, "GAP", "Xendit callback has no accepted tenant-method credit");
    assert.equal(method.testedBy, null, "Uncredited rollback evidence is not method acceptance");
    assert.deepEqual(method.reviewedUncertified, expected,
      "Only the exact Xendit audit rollback fix can remain in pending review");
    for (const [path, sha] of [
      [expected.proofFile, expected.proofBlobSha],
      [expected.contractFile, expected.contractBlobSha],
      [expected.gateFile, expected.gateBlobSha],
      [expected.workflowFile, expected.workflowBlobSha],
    ]) assert.equal(gitBlobSha(readFileSync(path)), sha,
      "Xendit rollback source/contract/workflow drift requires new review: " + path);
    const route = readFileSync(routeFile, "utf8");
    const transaction = route.indexOf("const result = await db.transaction(async (tx) => {");
    const audit = route.indexOf("await recordAuditEvent({", transaction);
    const auditInTx = route.indexOf("}, tx);", audit);
    const response = route.lastIndexOf("return Response.json({ received: true, ...result });");
    assert.ok(transaction >= 0 && audit > transaction && auditInTx > audit &&
      response > auditInTx, "Audit must be awaited inside the billing transaction");
    for (const outcome of ["paid", "past_due", "inactive"]) {
      assert.ok(route.includes('return auditedOutcome("' + outcome + '");'),
        "All successful billing outcomes must audit before transaction commit: " + outcome);
    }
    const runner = readFileSync(expected.proofFile, "utf8");
    for (const token of [
      "CI_ONLY_XENDIT_SUBSCRIPTION_AUDIT_REJECTED",
      "assert.equal(rejected.status, 500",
      "counts.auditAtomicRollbacks++",
      "counts.auditRetryRecovered++",
      "await unchangedExcept(before);",
      "send(auditFailureEvent)",
      "for (let i = 0; i < 6; i++)",
      "const employers = [a, b, ...fillers, victim]",
      "assertFictionalHighIdVictim(a, b, victim, fillers)",
      "assertEmployerSnapshotIsolation(before, after, allowed)",
      "assertExpectedOwnedBillingDelta(before, after, \"VICTIM\", paidDelta())",
      "forged victim-selector replay",
    ]) assert.ok(runner.includes(token), "Missing disposable PG16 rollback proof: " + token);
    assert.ok(readFileSync(expected.workflowFile, "utf8").includes("image: postgres:16"),
      "Source proof must run with real disposable PostgreSQL 16");
    return; // No acceptance, coverage credit or production permission.
  }

  // PayMongo transfer callback: permit only the reviewed removal of the run-existence oracle, while the method stays GAP
  // until the dedicated signed-callback proof is credited under proofPolicy.providerCallback.
  if (isNewOrChanged && method.status === "GAP" &&
      key === "src/app/api/webhooks/paymongo/transfers/route.ts POST") {
    const review = method.reviewedUncertified;
    const originalBlob = "68c6b8f2b7ba8f70417cc461e78270f6b2b9a17d";
    const hardenedBlob = "b7606ef203779ec194e3a3c3b4d0664e77e3ac31";
    assert.equal(currentBlob, hardenedBlob, "PayMongo callback route changed again: fresh source review required");
    assert.equal(review?.kind, "paymongo-transfer-webhook-no-run-oracle-hardening-only-zero-credit");
    assert.equal(review.originalRouteBlobSha, originalBlob);
    assert.equal(review.routeBlobSha, hardenedBlob);
    assert.equal(review.fullMethodCoverageCredits, 0);
    assert.equal(review.ownForeignTenantProof, false);
    assert.equal(review.goLiveApproval, false);
    assert.equal(method.testedBy, null, "PayMongo callback POST remains GAP until its separate method proof is credited");
    assert.match(method.reason, /GAP/);
    const source = readFileSync("src/app/api/webhooks/paymongo/transfers/route.ts", "utf8");
    const hardened = [
      "  // Validate before touching the run so the response never depends on whether the run exists.",
      "  if (!event.eventId || event.eventId.length > 180) {",
      "    return Response.json({ error: \"Invalid provider event ID.\" }, { status: 400 });",
      "  }",
      "",
      "  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, event.runId)).limit(1);",
      "  if (!run) {",
      "    // Same response as a run that exists but does not hold this transfer: a signed",
      "    // caller must not be able to tell a nonexistent run from another tenant's run.",
      "    return Response.json({ ok: true, ignored: true, reason: \"unmatched-payroll-transfer\" });",
      "  }",
      "",
    ].join(String.fromCharCode(10));
    const former = [
      "  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, event.runId)).limit(1);",
      "  if (!run) {",
      "    return Response.json({ ok: true, ignored: true, reason: \"unknown-payroll-run\" });",
      "  }",
      "",
      "  if (!event.eventId || event.eventId.length > 180) {",
      "    return Response.json({ error: \"Invalid provider event ID.\" }, { status: 400 });",
      "  }",
      "",
    ].join(String.fromCharCode(10));
    assert.equal(source.split(hardened).length - 1, 1, "the reviewed oracle removal must occur exactly once");
    assert.equal(gitBlobSha(Buffer.from(source.replace(hardened, former))), originalBlob,
      "PayMongo PR may change ONLY the reviewed run-lookup ordering and response");
    return;
  }

  // Signup is a public tenant-CREATION method, not an already authenticated
  // own/foreign employer method. Permit only the four reviewed anti-abuse
  // source substitutions, while keeping the entire POST method GAP.
  if (isNewOrChanged && method.status === "GAP" &&
      key === "src/app/api/signup/route.ts POST") {
    const review = method.reviewedUncertified;
    const originalBlob = "e2461cd23756b2b1c078f76c7c751d646e7e4f0f";
    const hardenedBlob = "97d6f05372bf7b88dd46c10fa46b2e50c4b76ccc";
    assert.equal(currentBlob, hardenedBlob, "Signup route changed again: fresh source review required");
    assert.equal(review?.kind, "signup-antiabuse-hardening-only-no-tenant-credit");
    assert.equal(review.originalRouteBlobSha, originalBlob);
    assert.equal(review.routeBlobSha, hardenedBlob);
    assert.equal(review.fullMethodCoverageCredits, 0);
    assert.equal(review.ownForeignTenantProof, false);
    assert.equal(review.goLiveApproval, false);
    assert.deepEqual(review.coveredRateLimitKeys,
      ["signup:ip", "signup-domain", "signup-email"]);
    assert.equal(review.distributedMode, "distributed-postgres");
    assert.equal(review.fallbackResponseStatus, 503);
    assert.equal(review.authoritativeThrottleStatus, 429);
    assert.equal(method.testedBy, null, "Signup POST remains GAP until separate method proof");
    assert.match(method.reason, /GAP/);

    const source = readFileSync("src/app/api/signup/route.ts", "utf8");
    // Reconstruct the exact pre-fix Git blob: no signup transaction,
    // billing, invite, origin, proof, or account-activation change can hitchhike.
    const reviewedChanges = [
      ['import { signupMode, signupRateLimitResponse } from "@/lib/saas-launch-config";',
        'import { signupMode } from "@/lib/saas-launch-config";'],
      ['  const ipRateGate = signupRateLimitResponse(limited);\n  if (ipRateGate) return ipRateGate;',
        '  if (!limited.allowed) return Response.json({ error: "Too many registration attempts. Please try later." }, { status: 429 });'],
      ['    const domainRateGate = signupRateLimitResponse(byDomain, "Too many registration requests. Please try later.");\n    if (domainRateGate) return domainRateGate;',
        '    if (!byDomain.allowed) return Response.json({ error: "Too many registration requests. Please try later." }, { status: 429 });'],
      ['  const emailRateGate = signupRateLimitResponse(byEmail, "Too many registration requests. Please try later.");\n  if (emailRateGate) return emailRateGate;',
        '  if (!byEmail.allowed) return Response.json({ error: "Too many registration requests. Please try later." }, { status: 429 });'],
    ];
    let original = source;
    for (const [hardened, former] of reviewedChanges) {
      assert.equal(original.split(hardened).length - 1, 1,
        "Every exact signup limiter substitution must occur once");
      original = original.replace(hardened, former);
    }
    assert.equal(gitBlobSha(Buffer.from(original)), originalBlob,
      "Signup PR may change ONLY the reviewed rate-limit call sites");
    assert.equal((source.match(/signupRateLimitResponse\(/g) ?? []).length, 3,
      "Every public account-creation quota must use the fail-closed response");
    assert.equal((source.match(/rateLimitDistributed\(/g) ?? []).length, 3);

    const config = readFileSync("src/lib/saas-launch-config.ts", "utf8");
    const pricing = readFileSync("src/lib/saas-pricing.ts", "utf8");
    const pilotTests = readFileSync("tests/private-pilot-invite.test.ts", "utf8");
    const pricingTests = readFileSync("tests/saas-subscriptions.test.ts", "utf8");
    for (const [content, sha, label] of [
      [config, review.launchConfigBlobSha, "Shared limiter mode guard"],
      [pricing, review.pricingBlobSha, "Seat-count type validator"],
      [pilotTests, review.pilotTestBlobSha, "Limiter-fallback regression test"],
      [pricingTests, review.subscriptionTestBlobSha, "Seat-count regression test"],
    ]) {
      assert.equal(gitBlobSha(Buffer.from(content)), sha,
        label + " changed without another reviewed source and test cycle");
    }
    assert.match(config, /rate\.mode !== "distributed-postgres"/);
    assert.ok(config.includes('status: 503, headers: { "Cache-Control": "no-store" }'));
    assert.ok(config.includes('status: 429, headers: { "Cache-Control": "no-store" }'));
    assert.ok(pricing.includes('!/^\\d+$/.test(value)'),
      "Reject nondecimal/JSON-coerced values as employee seat counts");
    assert.match(pilotTests, /registration refuses per-process rate-limit fallback at all three gates/);
    assert.match(pricingTests, /seat counts accept only real numbers or decimal digit strings/);
    return;
  }

  // A changed employee-owned action-item handler has passing disposable PG16
  // HTTP evidence but NO independent security acceptance. Preserve the GAP
  // rather than silently promoting a successful synthetic run to COVERED.
  // This exact route, QA source, workflow and every required behavior are
  // pinned; any drift re-blocks this exception for renewed review.
  if (isNewOrChanged && method.status === "COVERED" && [
    "src/app/api/benefits/route.ts PUT",
    "src/app/api/self/performance/action-items/route.ts PATCH",
    "src/app/api/workforce-planning/demand-handoff/route.ts POST",
  ].includes(key)) {
    assert.equal(verifyPost1523Credits(manifest), 3);
    return; // Exact identities and immutable PG16 source/workflow hashes.
  }
  if (isNewOrChanged && method.status === "GAP" &&
      key === "src/app/api/self/performance/action-items/route.ts PATCH") {
    const reviewed = method.reviewedUncertified;
    const proofFile = "scripts/qa/tenant-self-action-items-http.mjs";
    const proofWorkflow = ".github/workflows/tenant-self-action-items-http.yml";
    assert.equal(currentBlob, "87da381fee787a65e1ae59c927a33bda5c9f0de4",
      "Employee action-item route changed: independent tenant review required");
    assert.deepEqual(reviewed, {
      kind: "exact-head-PG16-HTTP-tenant-PATCH-unreviewed",
      routeBlobSha: currentBlob,
      file: proofFile,
      proofBlobSha: "6d09b6f8a561b5c629e6a92afd8fff668b001d32",
      workflow: proofWorkflow,
      workflowBlobSha: "0f7d35a798604c14ccbb099b1cd5874dddf3fc43",
      ownPositiveLine: 186,
      foreignDenialLine: 201,
      forgedSelectorLine: 209,
      peerDenialLine: 215,
      unchangedDbLine: 203,
      concurrentLine: 258,
      revokedMembershipLine: 274,
      auditRollbackLine: 302,
      provisionalPassedHead: "349833c6a8366f48e13e6fda42e6d817556e7b48",
      provisionalPassedRun: "https://github.com/erwinmehehe/payrollph/actions/runs/40703159052",
      creditedMethods: 0,
      independentlyAccepted: false,
      productionTested: false,
    }, "Only one fully source-pinned unreviewed exception is allowed");
    assert.equal(method.testedBy, null, "Unapproved synthetic HTTP is not a coverage credit");
    assert.match(method.reason, /GAP.*independent security review/i,
      "Explain why real HTTP evidence is not yet accepted");
    assert.equal(gitBlobSha(readFileSync(proofFile)), reviewed.proofBlobSha);
    assert.equal(gitBlobSha(readFileSync(proofWorkflow)), reviewed.workflowBlobSha);

    const exact = [
      [reviewed.ownPositiveLine, /const victimOwn = expectStatus\(await patch\(victim\.self\.cookie,/],
      [reviewed.foreignDenialLine, /victimId, "completed"\), 404, "foreign higher-ID action item"/],
      [reviewed.forgedSelectorLine, /404, "forged victim organization and employee"/],
      [reviewed.peerDenialLine, /"same-employer peer employee denied"/],
      [reviewed.unchangedDbLine, /assert\.deepEqual\(await snapshot\(victim\.org\.id\), victimBaseline\)/],
      [reviewed.concurrentLine, /const simultaneous = await Promise\.all\(\[/],
      [reviewed.revokedMembershipLine, /"revoked membership blocks the employee"/],
      [reviewed.auditRollbackLine, /assert\.deepEqual\(after, before, "audit insertion error rolls back status and event"\)/],
    ];
    for (const [line, expected] of exact) {
      assert.match(evidenceLine(proofFile, line, key), expected,
        "The cited real HTTP proof anchor changed");
    }
    const workflow = readFileSync(proofWorkflow, "utf8");
    assert.match(workflow, /image: postgres:16/);
    assert.ok(workflow.includes("node --import tsx " + proofFile));
    assert.ok(workflow.includes("node scripts/qa/apply-isolated-baseline.mjs"));
    assert.match(workflow, /127\.0\.0\.1:3000/);
    const route = readFileSync("src/app/api/self/performance/action-items/route.ts", "utf8");
    assert.match(route, /await db\.transaction\(async \(tx\) => \{/);
    assert.match(route, /eq\(userOrganizations\.active, true\)/);
    assert.match(route, /eq\(performanceOneOnOneActionItems\.organizationId, context\.employee\.organizationId\)/);
    assert.match(route, /eq\(performanceOneOnOneActionItems\.employeeId, context\.employee\.id\)/);
    assert.match(route, /eq\(performanceOneOnOneActionItems\.ownerEmployeeId, context\.employee\.id\)/);
    assert.match(route, /await tx\.insert\(performanceOneOnOneActionItemEvents\)/);
    assert.match(route, /await tx\.insert\(auditEvents\)/);
    return;
  }


  // #1552: single-use account email verification was hardened to lock the
  // authentic account, worker and active worker grant before a tenant-scoped
  // employee email UPDATE. The dedicated disposable PG16 test has passed, but
  // it provides only one legitimate linked-worker positive plus two attacker
  // denials. Do NOT promote this source-only change to full method coverage.
  // Every reviewed source/fixture/workflow is SHA-pinned and drift fails closed.
  if (isNewOrChanged && method.status === "GAP" &&
      key === "src/app/api/account/email/verify/route.ts POST") {
    const reviewed = method.reviewedUncertified;
    const routePath = "src/app/api/account/email/verify/route.ts";
    const newSha = "575f814a30ebce5112c228c6e3c73ac882b8fa97";
    assert.equal(currentBlob, newSha,
      "Account email verification changed: renew independent tenant and privacy review");
    assert.deepEqual(reviewed, {
      kind: "account-email-verify-linked-ESS-worker-PG16-source-only",
      oldRouteBlobSha: "45617099f90ae486824f3de34cd769c34b229596",
      routeBlobSha: newSha,
      helperFile: "src/lib/account.ts",
      helperBlobSha: "e9fd7448970b49fa10d97c67478a71ceb0b91c75",
      regressionFile: "tests/account-email-tenant-boundary.test.ts",
      regressionBlobSha: "cd4557251c8df461a6aeee28cc9ea16d206844bc",
      proofFile: "scripts/qa/tenant-account-email-verify-http.mjs",
      proofBlobSha: "c1844e47f0ce8e27fa5181f2b8ad9e446a6b3e33",
      contractFile: "tests/tenant-account-email-verify-contract.test.mjs",
      contractBlobSha: "737784e29bbbf6ff896050df3c6bfd14c74898e4",
      workflowFile: ".github/workflows/tenant-account-email-verify-http.yml",
      workflowBlobSha: "f02faaa4bd82f6e22589731adf74330cc7c048a7",
      disposableGuardFile: "scripts/qa/tenant-identity-account-proof.mjs",
      disposableGuardBlobSha: "d6119b38a8cc55b56e18971b42ab2de38baa6a15",
      previousSyntheticHead: "08d058d7d691f2ed4bc1148433b3ff0cb58b6843",
      previousSyntheticRun: "https://github.com/erwinmehehe/payrollph/actions/runs/40800025745/job/123205629239",
      sourceOnly: true,
      creditedMethods: 0,
      independentSecurityReview: "PENDING",
      productionTested: false,
    }, "Only this exact uncredited email verification source review is permitted");
    assert.equal(method.testedBy, null, "Not a completed tenant method proof");
    assert.match(method.reason, /^Still GAP: #1552/);
    assert.equal(method.line, 14);
    for (const [path, sha] of [
      [reviewed.helperFile, reviewed.helperBlobSha],
      [reviewed.regressionFile, reviewed.regressionBlobSha],
      [reviewed.proofFile, reviewed.proofBlobSha],
      [reviewed.contractFile, reviewed.contractBlobSha],
      [reviewed.workflowFile, reviewed.workflowBlobSha],
      [reviewed.disposableGuardFile, reviewed.disposableGuardBlobSha],
    ]) assert.equal(gitBlobSha(readFileSync(path)), sha,
      "Account email proof/source changed without new security review: " + path);

    const source = readFileSync(routePath, "utf8");
    assert.equal(gitBlobSha(Buffer.from(source)), newSha);
    const tokenLock = source.indexOf("const [liveToken] = await tx.select(");
    const accountLock = source.indexOf("const [currentAccount] = await tx.select(");
    const workerLock = source.indexOf("const [linkedEmployee] = await tx.select(");
    const memberLock = source.indexOf("const [membership] = await tx.select(");
    const tenantGate = source.indexOf("if (!canSyncLinkedEmployeeEmail({");
    const employeeWrite = source.indexOf("const [updatedEmployee] = await tx.update(employees)");
    const accountWrite = source.indexOf("const [updatedAccount] = await tx.update(users)");
    assert.ok(0 < tokenLock && tokenLock < accountLock && accountLock < workerLock &&
      workerLock < memberLock && memberLock < tenantGate &&
      tenantGate < employeeWrite && employeeWrite < accountWrite,
      "Identity/tenant checks must precede worker and account updates");
    for (const guard of [
      "eq(emailChangeTokens.tokenHash, sha256(token))",
      "isNull(emailChangeTokens.usedAt)",
      "gt(emailChangeTokens.expiresAt, new Date())",
      "if (!currentAccount?.active)",
      "eq(employees.id, currentAccount.employeeId)",
      "eq(userOrganizations.userId, currentAccount.id)",
      "eq(userOrganizations.organizationId, linkedEmployee.organizationId)",
      "eq(userOrganizations.active, true)",
      ')).for("share").limit(1)',
      "eq(employees.organizationId, linkedEmployee.organizationId)",
      "if (!updatedEmployee)",
      "if (!updatedAccount)",
      "await tx.update(emailChangeTokens)",
    ]) assert.ok(source.includes(guard), "Linked-employee tenant guard missing: " + guard);
    assert.doesNotMatch(source, /where\(eq\(employees\.id, account\.employeeId\)\)/);

    const proof = readFileSync(reviewed.proofFile, "utf8");
    const workflow = readFileSync(reviewed.workflowFile, "utf8");
    const contract = readFileSync(reviewed.contractFile, "utf8");
    assert.ok(proof.indexOf("requireDisposableIdentityAccount();") > 0 &&
      proof.indexOf("requireDisposableIdentityAccount();") <
      proof.indexOf('import("../../src/db/index.ts")'),
      "PG16-only preflight must run before any app/database imports");
    assert.match(proof, /const attackerA = await makeEss\("attacker-a", a, v\.worker\.id, a\.worker\.id\)/);
    assert.match(proof, /const attackerB = await makeEss\("attacker-b", b, v\.worker\.id, b\.worker\.id\)/);
    assert.match(proof, /const accepted = await verify\(ownToken, 200,/);
    assert.match(proof, /const response = await verify\(token, 409,/);
    assert.match(proof, /assert\.deepEqual\(await snapshot\(\), before,/);
    assert.match(proof, /await verify\(revokedToken, 409,/);
    assert.match(proof, /await verify\(mismatchedToken, 409,/);
    assert.match(proof, /for\(const \[attacker,name\] of \[\[attackerA,"atta"\],\[attackerB,"attb"\]\]\)/,
      "Both independently authenticated token holders must exercise their own replay");
    assert.match(proof, /await verify\(ownedToken,400,name\+" spent own token replay"\)/);
    assert.match(proof, /assert\.deepEqual\(await snapshot\(\),afterVerified,"own consumed-token replay writes nothing"\)/);
    assert.match(proof, /credits: 0, independentReviewPending: true/);
    assert.match(workflow, /image: postgres:16/);
    assert.match(workflow, /node --test tests\/tenant-account-email-verify-contract\.test\.mjs/);
    assert.match(workflow, /node --import tsx scripts\/qa\/tenant-account-email-verify-http\.mjs/);
    assert.match(contract, /requireDisposableIdentityAccount\(good\)/);
    return;
  }

  // Source-only worker/employer grant hardening for a private receipt path.
  // It is not a real two-attacker/victim PG16 proof and must not promote either
  // method. The exact route, helper and both contract tests are pinned below;
  // any drift requires independent source + security review again.
  if (isNewOrChanged && method.status === "GAP" &&
      (key === "src/app/api/expenses/receipts/route.ts GET" ||
       key === "src/app/api/expenses/receipts/route.ts POST")) {
    const review = method.reviewedUncertified;
    const routePath = "src/app/api/expenses/receipts/route.ts";
    const routeBlob = "2aac7f024cfbd99a1fe8c938c0984d740346ffbd";
    assert.equal(currentBlob, routeBlob,
      "Private Spend receipt route changed: renewed tenant security review required");
    assert.deepEqual(review, {
      kind: "private-spend-receipt-worker-grant-source-only-zero-credit",
      oldRouteBlobSha: "bc7b1a09d2c8d0e55859dc212627f6b5bca5cf50",
      routeBlobSha: routeBlob,
      helperFile: "src/lib/spend-receipt-tenant.ts",
      helperBlobSha: "059881e91b629860a1aaa722a133f53e057edda7",
      unitTestFile: "tests/spend-receipt-tenant-grant.test.ts",
      unitTestBlobSha: "8cd86095ab4404eed572668e1823825c93bab716",
      readBoundaryFile: "src/lib/spend-receipt-read-boundary.ts",
      readBoundaryBlobSha: "b968f1c5d90755e8efc9b7d58d747157a7091c40",
      readBoundaryTestFile: "tests/tenant-expense-receipt-lookup-boundary.test.ts",
      readBoundaryTestBlobSha: "8406383620f49ec8f3db1bf46ddf6edadef84fb0",
      contractTestFile: "tests/tenant-spend-receipt-grant-source.test.mjs",
      contractTestBlobSha: "f30da77f6ab705e508c28b924092647902c73d3c",
      coverageCredits: 0,
      realHttpPg16Proven: false,
      independentSecurityReview: "PENDING",
      productionTouched: false,
    }, "Only the pinned receipt grant source-only change is reviewed as uncredited");
    for (const [file, blob] of [
      [review.helperFile, review.helperBlobSha],
      [review.unitTestFile, review.unitTestBlobSha],
      [review.readBoundaryFile, review.readBoundaryBlobSha],
      [review.readBoundaryTestFile, review.readBoundaryTestBlobSha],
      [review.contractTestFile, review.contractTestBlobSha],
    ]) {
      assert.equal(gitBlobSha(readFileSync(file)), blob,
        "Private receipt review dependency changed without fresh security review: " + file);
    }
    assert.equal(method.testedBy, null, "Private receipt GAP may not borrow a source test credit");
    assert.match(method.reason, /Still GAP.*real HTTP.*independent security review/i);
    const source = readFileSync(routePath, "utf8");
    assert.match(source, /return await activeReceiptGrant\(user, claim\) \? null : notFound\(\)/);
    assert.match(source, /eq\(employees\.organizationId, claim\.organizationId\)/);
    assert.match(source, /eq\(userOrganizations\.active, true\)/);
    assert.match(source, /eq\(userOrganizations\.organizationId, claim\.organizationId\)/);
    assert.match(source, /for\("share"\)\.limit\(1\)/);
    assert.match(source, /if \(!liveClaim \|\| !await lockedReceiptGrant\(tx, user, claim\)\)/);
    assert.match(source, /if \(!await lockedReceiptGrant\(tx, user, freshCore\)\)/);
    assert.match(source, /freshCore\.employeeId !== claim\.employeeId/);
    const afterPrivateRead = source.indexOf("const readDenied = await authorize(user, freshCore);");
    const bytesReturn = source.indexOf("return new Response(new Uint8Array(bytes)");
    const stagingGuard = source.indexOf("if (!liveClaim || !await lockedReceiptGrant(tx, user, claim))");
    const intent = source.indexOf("const [intent] = await tx.insert(documents)");
    const finalGuard = source.indexOf("if (!await lockedReceiptGrant(tx, user, freshCore))");
    const finalAttachment = source.indexOf("tx.update(expenseClaimEvidence)");
    const postReadClaim = source.indexOf("const freshCore = await findMemberReceiptClaim(user, id);");
    const postReadBinding = source.indexOf("receiptReadBindingUnchanged(claim, freshClaim)");
    const storageRead = source.indexOf("bytes = await readVerifiedSpendReceipt(");
    const auditRead = source.indexOf("action: \"Expense receipt viewed\"");
    assert.ok(storageRead >= 0 && postReadClaim > storageRead &&
      postReadBinding > postReadClaim && afterPrivateRead > postReadBinding &&
      auditRead > afterPrivateRead && bytesReturn > auditRead,
      "Private receipt read must refresh claim, verify identity/SHA and recheck current grant before auditing or returning bytes");
    assert.ok(stagingGuard > 0 && stagingGuard < intent &&
      finalGuard > intent && finalGuard < finalAttachment,
      "Private receipt SQL writes must recheck locked worker grants on both sides of storage IO");
    return;
  }

  // #1543: bounded public-applicant contact validation is NOT positive
  // three-employer POST evidence and does NOT authorize public careers launch.
  // Both GET and POST share a new route blob, though GET's actual handler is
  // unchanged. A new change to the reviewed route/validator/tests fails closed.
  if (isNewOrChanged && method.status === "PUBLIC-BY-DESIGN" &&
      (key === "src/app/api/careers/route.ts GET" ||
       key === "src/app/api/careers/route.ts POST")) {
    const review = method.reviewedUncertified;
    const routeFile = "src/app/api/careers/route.ts";
    const oldSource = "31a02823459f237d182235e2887fe4a7049fe48d";
    const newSource = "271603f38d44a7be8f16045591e2d22374803187";
    assert.equal(currentBlob, newSource, "Careers route changed: renew privacy and tenant review");
    assert.equal(review?.kind, "careers-contact-validation-source-only-zero-tenant-credit");
    assert.equal(review.oldRouteBlobSha, oldSource);
    assert.equal(review.routeBlobSha, newSource);
    assert.equal(review.unchangedGetBodyBlobSha, "27fef370974a235848f93758c70fed754c63fafe");
    assert.equal(review.helperFile, "src/lib/careers-intake-body.ts");
    assert.equal(review.helperBlobSha, "66ac8cec8ff17b16ff0069e9db77dbae4c077bca");
    assert.equal(review.regressionFile, "tests/careers-split.test.ts");
    assert.equal(review.regressionBlobSha, "cb11df7a4c88be0052de16826417e39506bf12be");
    for (const [path, sha] of [
      [review.helperFile, review.helperBlobSha],
      [review.regressionFile, review.regressionBlobSha],
    ]) {
      assert.equal(gitBlobSha(readFileSync(path)), sha,
        "Careers source/regression changed without independent review: " + path);
    }
    assert.equal(review.noPublicApplicantActivation, true);
    assert.equal(review.fullTenantMethodCoverageProven, false);
    assert.equal(review.coverageCredits, 0);
    assert.equal(review.independentPrivacyAndSecurityReview, "PENDING");
    assert.equal(method.testedBy, null, "No borrowed public applicant HTTP coverage");
    assert.equal(method.publicBoundary?.approvedOn, "2026-11-09");
    assert.equal(method.publicBoundary?.fourPartMethodCredit, false);
    assert.equal(method.testedBy, null);
    const route = readFileSync(routeFile, "utf8");
    const getAt = route.indexOf("export async function GET(request: Request) {");
    const postCommentAt = route.indexOf("/** Anonymous applicant intake:", getAt);
    assert.ok(getAt >= 0 && postCommentAt > getAt, "Public GET source boundaries changed");
    assert.equal(gitBlobSha(Buffer.from(route.slice(getAt, postCommentAt))),
      review.unchangedGetBodyBlobSha, "Public careers GET must stay byte-for-byte unchanged");
    if (method.name === "GET") {
      assert.equal(method.line, 26);
      for (const guard of [
        "const hold = workflowEntityHold(); if (hold) return hold;",
        "const notice = careersNoticeConfig();",
        "if (!await careersSchemaReady()) return notReady();",
        ".where(publishedCareersPredicate(organizationId)).limit(60);",
        'headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }',
      ]) assert.ok(route.slice(getAt, postCommentAt).includes(guard),
        "Public GET employer-bound listing guard changed: " + guard);
    } else {
      assert.equal(method.name, "POST");
      assert.equal(method.line, 51);
      const helper = readFileSync(review.helperFile, "utf8");
      const tests = readFileSync(review.regressionFile, "utf8");
      for (const guard of [
        "export function careersContactFields(",
        "phone.length > 32 || notes.length > 1000",
        'typeof body.phone !== "string"',
        'typeof body.notes !== "string"',
        "return { phone, notes };",
      ]) assert.ok(helper.includes(guard), "Applicant validator changed: " + guard);
      assert.ok(helper.includes("/\\u0000/.test(notes)"),
        "Embedded NUL in applicant message must be rejected");
      assert.match(tests, /public careers contact data is accepted intact or rejected, never truncated/);
      assert.match(tests, /careersContactFields\(invalid\), null/);
      assert.doesNotMatch(route, /\.slice\(0,\s*(?:32|1000)\)/);
      for (const guard of [
        "const hold = workflowEntityHold(); if (hold) return hold;",
        "const notice = careersNoticeConfig();",
        "const denied = enforceSameOriginMutation(request);",
        "const body = await readCareersApplicationBody(request);",
        "const contact = careersContactFields(body);",
        "if (!contact) return Response.json({",
        'status: 422, headers: { "Cache-Control": "no-store" }',
        "const consent = requireApplicantConsent({",
        "const proofDenied = await enforceIntakeProof(body, email);",
        "publishedCareersPredicate(organizationId), eq(jobRequisitions.id, requisitionId)",
        "await db.transaction(async tx => {",
        "eq(jobRequisitions.organizationId, organizationId), eq(jobRequisitions.id, requisitionId)",
        "eq(positions.organizationId, organizationId), eq(positions.status, \"open\")",
        "eq(jobApplicants.organizationId, organizationId), eq(jobApplicants.requisitionId, requisitionId)",
        "phone: contact.phone || null,",
        "notes: contact.notes || null,",
        "await tx.insert(applicantPrivacyEvidence).values({",
        "await tx.insert(auditEvents).values({",
        'status: 202, headers: { "Cache-Control": "no-store" }',
      ]) assert.ok(route.includes(guard),
        "Public applicant consent, tenant or source-integrity guard changed: " + guard);
      const validated = route.indexOf("const contact = careersContactFields(body);");
      const rateLimit = route.indexOf('const rate = await rateLimitDistributed("careers-application:');
      const proof = route.indexOf("const proofDenied = await enforceIntakeProof(body, email);");
      const writes = route.indexOf("await db.transaction(async tx => {");
      assert.ok(validated > 0 && validated < rateLimit && rateLimit < proof && proof < writes,
        "Optional applicant contact rejection must occur before rate, proof and writes");
    }
    return;
  }

  // Narrow, uncredited tenant bootstrap correction. Ordinary tenants may
  // not insert globally shared benefit-plan templates. The GET/POST/DELETE
  // handlers were byte-identical to main; their independent HTTP receipts
  // remain intact. Exact-source drift reopens the PUT gap for review.
  if (isNewOrChanged && method.status === "GAP" &&
      key === "src/app/api/benefits/route.ts PUT") {
    const review = method.reviewedUncertified;
    const routePath = "src/app/api/benefits/route.ts";
    const routeBlob = "f6a7f4803a8b0a72e6fbeb55c9cbead29c34c764";
    assert.equal(currentBlob, routeBlob, "Benefit catalogue PUT changed: re-review tenant isolation");
    assert.deepEqual(review, {
      kind: "benefit-catalog-tenant-bootstrap-PUT-zero-credit",
      oldRouteBlobSha: "679de68b5e7aac870a534eee8dd2376c18db2873",
      routeBlobSha: routeBlob,
      unchangedSiblingHandlersBlobSha: "0b7ff73dd8aa2532d1c333b7b43991286e86d202",
      helperFile: "src/lib/benefit-catalog-tenant.ts",
      helperBlobSha: "d490d7b283642355bdd11aa33c2502e50e9b8913",
      contractFile: "scripts/qa/tenant-benefit-catalog-put-contract.mjs",
      contractBlobSha: "475d2592b20c696492ac55a8b5face9e2e2b5d98",
      runnerFile: "scripts/qa/tenant-benefit-catalog-put-http.mjs",
      runnerBlobSha: "633f6c75c531ab9d22ce33ea0ccf8e49be41e18b",
      unitTestFile: "tests/benefit-catalog-tenant.test.ts",
      unitTestBlobSha: "bc4f16666cc55392ffe75e42a34d2fe4921a238a",
      contractTestFile: "tests/tenant-benefit-catalog-put-contract.test.mjs",
      contractTestBlobSha: "97d21883705cb36c2e6d78c3dd6210f09387132f",
      workflowFile: ".github/workflows/tenant-benefit-catalog-put.yml",
      workflowBlobSha: "8f4fbc9df427dbb2b352b7bb292284ee2753ce47",
      coverageCredits: 0,
      realHttpPg16Accepted: false,
      independentSecurityReview: "PENDING",
      productionTouched: false,
    }, "Unreviewed PUT may only use the exactly pinned zero-credit exception");
    for (const [file, blob] of [
      [review.helperFile, review.helperBlobSha],
      [review.contractFile, review.contractBlobSha],
      [review.runnerFile, review.runnerBlobSha],
      [review.unitTestFile, review.unitTestBlobSha],
      [review.contractTestFile, review.contractTestBlobSha],
      [review.workflowFile, review.workflowBlobSha],
    ]) {
      assert.equal(gitBlobSha(readFileSync(file)), blob,
        "Benefit catalogue tenant proof dependency changed: " + file);
    }
    const route = readFileSync(routePath, "utf8");
    const first = route.indexOf("export async function GET(");
    const next = route.indexOf("/** Seed defaults for the signed-in employer");
    assert.ok(first > 0 && next > first,
      "Previously covered GET/POST/DELETE method boundaries must not change");
    const unchanged = route.slice(first, next);
    for (const verb of ["GET", "POST", "DELETE"]) {
      assert.match(unchanged, new RegExp("export async function " + verb + "\\("));
    }
    assert.equal(gitBlobSha(Buffer.from(unchanged)), review.unchangedSiblingHandlersBlobSha,
      "Previously covered benefit methods must remain byte-identical to main");
    const put = route.slice(next);
    for (const guard of [
      "parseCatalogEmployerId(",
      "assertOrganizationRole(",
      "if (!access?.companyWide)",
      "await db.transaction(async tx => {",
      "eq(userOrganizations.organizationId, organizationId)",
      "eq(userOrganizations.active, true)",
      "inArray(userOrganizations.role, [...ORG_ADMIN_ROLES])",
      "isNull(userOrganizations.orgUnitId)",
      '.for("share").limit(1)',
      "pg_advisory_xact_lock(4459,",
      "isNull(benefitPlans.organizationId)",
      "eq(benefitPlans.organizationId, organizationId)",
      "defaultEmployerBenefitPlans(organizationId)",
      "await tx.insert(benefitPlans).values(defaults)",
      "await tx.insert(auditEvents).values({",
    ]) assert.ok(put.includes(guard), "Benefit PUT tenant source guard changed: " + guard);
    assert.doesNotMatch(put, /organizationId:\s*null/,
      "tenant admin cannot write shared global benefit plans");
    assert.equal(method.testedBy, null, "Source-only benefit PUT must remain GAP");
    assert.match(method.reason, /Still GAP.*PG16.*independent review/i);
    const siblingMethods = manifest.allApiRouteFiles[routePath].methods;
    for (const verb of ["GET", "POST", "DELETE"]) {
      const reviewedSibling = siblingMethods.find(x => x.name === verb);
      assert.equal(reviewedSibling?.status, "COVERED");
      assert.ok(reviewedSibling?.testedBy?.file === "scripts/qa/tenant-benefit-enrollments-http.mjs");
    }
    return;
  }

  // Unit-scoped invitation hardening fixes a source-identified privilege gap.
  // GET keeps existing employer-level PG16 proof. POST's real signed-in PG16
  // candidate passed on the prior PR head; exact new-head proof/owner acceptance
  // remains pending, so this proof is pinned and still grants ZERO credits.
  if (isNewOrChanged && method.status === "GAP" &&
      key === "src/app/api/invitations/route.ts POST") {
    const reviewed = method.reviewedUncertified;
    assert.equal(currentBlob, "59bdded07a33d7c4dbc394a84135ce99f9f04042",
      "Invitation route changed: renew unit-scope security review");
    assert.deepEqual(reviewed, {
      kind: "unit-scoped-invitation-authorization-hardening-unreviewed",
      originalRouteBlobSha: "ed6e94cef183e77d0c727aef54f898eef30eb3cc",
      routeBlobSha: currentBlob,
      helperFile: "src/lib/invitation-tenant-scope.ts",
      helperBlobSha: "9d3ae70a3aef79e0f3c7ee40a4a6083786a32d68",
      testFile: "tests/invitation-tenant-scope.test.ts",
      testBlobSha: "c8ac8f624e970acd228334de436747603122e737",
      coverageCredits: 0,
      realHttpPostAcceptance: "PRIOR_HEAD_PASSED_RECHECK_PENDING",
      proofFile: "scripts/qa/tenant-invitations-post-boundary.mjs",
      proofBlobSha: "4bf5a91c547aa8faf39a1411991e30f893508154",
      contractFile: "tests/tenant-invitations-post-boundary.test.mjs",
      contractBlobSha: "f01af351f75a3a7cd24d5f685ecd2f684cdecf91",
      workflowFile: ".github/workflows/tenant-invitations-post-boundary.yml",
      workflowBlobSha: "07367c81d79903935882f35726fb508c73c0ec5a",
      previousDedicatedPg16Run: "41607526530",
      previousDedicatedHead: "16c82c8ef475cb732ba8f66b65eaf41345a23376",
      reviewPolicy: "SOLO_VERIFIED_DEV_RECOVERY",
      reviewStatus: "PENDING_EXACT_FINAL_HEAD",
    });
    assert.equal(gitBlobSha(readFileSync(reviewed.helperFile)), reviewed.helperBlobSha);
    assert.equal(gitBlobSha(readFileSync(reviewed.testFile)), reviewed.testBlobSha);
    for (const [sourceFile, blobSha] of [
      [reviewed.proofFile, reviewed.proofBlobSha],
      [reviewed.contractFile, reviewed.contractBlobSha],
      [reviewed.workflowFile, reviewed.workflowBlobSha],
    ]) assert.equal(gitBlobSha(readFileSync(sourceFile)), blobSha,
      "Invite POST proof was modified without updating the exact-source receipt: " + sourceFile);
    assert.equal(method.testedBy, null, "Unreviewed invitation POST must remain GAP");
    const route = readFileSync("src/app/api/invitations/route.ts", "utf8");
    const get = route.slice(route.indexOf("export async function GET("),
      route.indexOf("export async function POST("));
    const post = route.slice(route.indexOf("export async function POST("));
    assert.match(get, /invitationVisibleUnit\(access\)/);
    assert.match(get, /eq\(invitations\.orgUnitId, visibleUnit\)/);
    assert.match(get, /eq\(userOrganizations\.orgUnitId, visibleUnit\)/);
    assert.match(post, /canCreateScopedInvitation\(access, role, orgUnitId\)/);
    assert.ok(post.indexOf("canCreateScopedInvitation(") < post.indexOf("createInvitation({"));
    assert.ok(post.indexOf("canCreateScopedInvitation(") < post.indexOf("queueMessage({"));
    const getMethod = manifest.allApiRouteFiles["src/app/api/invitations/route.ts"].methods
      .find(item => item.name === "GET");
    assert.equal(getMethod?.status, "COVERED",
      "Keep prior employer-level GET proof separately credited");
    assert.equal(getMethod?.testedBy?.file, "scripts/qa/tenant-table-http.mjs");
    return;
  }

  // Salary preview's old company-wide People grant did not imply a
  // legal-employer grant. Hold POST as GAP despite source hardening and
  // candidate fictional PG16 HTTP checks; no independent sign-off yet.
  if (isNewOrChanged && method.status === "GAP" &&
      key === "src/app/api/hcm/salary-corrections/preview/route.ts POST") {
    const reviewed = method.reviewedUncertified;
    assert.equal(currentBlob, "8abc2b8059a403b81bf24c78108445651be4690a",
      "Salary-preview route changed again: repeat entity-grant review");
    assert.deepEqual(reviewed, {
      kind: "hcm-salary-preview-legal-employer-grant-hardening-pending-review",
      oldRouteBlobSha: "17539b569af050bb1568d17e783661ae19302561",
      routeBlobSha: currentBlob,
      testFile: "tests/hcm-salary-correction-entity-tenant.test.ts",
      testBlobSha: "243d84d7eaab43d950b70fc9d89c56f23cc21dbe",
      proxyFile: "src/proxy.ts",
      proxyBlobSha: "8ed6591c4846cad3251bc1ee2444ceb3461b170a",
      hcmHoldFile: "src/lib/multi-entity-hcm-hold.ts",
      hcmHoldBlobSha: "3b05a6ca3cf157513d37a55ccb3bf2f8002579cc",
      contractFile: "tests/tenant-hcm-salary-correction-preview-contract.test.mjs",
      contractBlobSha: "68e68dc9dff3a6bc51801c525a7d241b7abb3ab5",
      proofFile: "scripts/qa/tenant-hcm-salary-correction-preview-http.mjs",
      proofBlobSha: "225f39f63b8365447b23eba22271fc97adad9362",
      workflowFile: ".github/workflows/tenant-hcm-salary-correction-preview.yml",
      workflowBlobSha: "7cbb0a6a0389a4eb0f22cce61c34ed90939c5a97",
      coverageCredits: 0,
      testedBy: null,
      exactHeadHttpResult: "PENDING",
      reviewPolicy: "SOLO_VERIFIED_DEV_RECOVERY",
      soleOwnerReviewer: "erwinmehehe",
      reviewStatus: "PENDING_EXACT_FINAL_HEAD",
    });
    for (const [file, sha] of [
      [reviewed.testFile, reviewed.testBlobSha],
      [reviewed.proxyFile, reviewed.proxyBlobSha],
      [reviewed.hcmHoldFile, reviewed.hcmHoldBlobSha],
      [reviewed.contractFile, reviewed.contractBlobSha],
      [reviewed.proofFile, reviewed.proofBlobSha],
      [reviewed.workflowFile, reviewed.workflowBlobSha],
    ]) assert.equal(gitBlobSha(readFileSync(file)), sha,
      "New salary preview proof/source change requires renewed security review");
    assert.equal(method.testedBy, null, "Salary preview POST remains GAP");
    const currentProof = readFileSync(reviewed.proofFile, "utf8");
    for (const token of [
      "NEXT_CSP_ENABLED: \"false\"",
      "WORKER_ENABLED: \"false\"",
      "CENTRAL_SCHEDULER_ENABLED: \"false\"",
      ".innerJoin(s.payrollRuns, eq(s.payrollEntries.payrollRunId, s.payrollRuns.id))",
      "assert.deepEqual(await snapshots(), before",
      "forged higher-ID victim legal employer and employee",
      "assert.equal(denied, 18)",
    ]) assert.ok(currentProof.includes(token),
      "Salary-preview refreshed proof lost protected real-HTTP case: " + token);
    const currentWorkflow = readFileSync(reviewed.workflowFile, "utf8");
    for (const flag of ["WORKER_ENABLED=false", "CENTRAL_SCHEDULER_ENABLED=false",
      "NEXT_CSP_ENABLED=false", "XENDIT_BILLING_ENABLED=false"]) {
      assert.ok(currentWorkflow.includes(flag),
        "Salary-preview disposable CI safety flag missing: " + flag);
    }

    // The global inventory test recomputes live totals from every current route.
    // A focused uncredited GAP must not pin a historic repository-wide count.
    assert.equal(reviewed.coverageCredits, 0);
    const route = readFileSync("src/app/api/hcm/salary-corrections/preview/route.ts", "utf8");
    const permission = route.indexOf("assertOrganizationRole(");
    const selected = route.indexOf("const entityScope = await resolveMultiEntityContext({");
    const worker = route.indexOf("const [employee] = await db.select({");
    const resource = route.indexOf("const employeeEntityDenied = assertEntityResource(");
    const profile = route.indexOf("const [profile] = await db.select({");
    assert.ok(permission >= 0 && permission < selected && selected < worker &&
      worker < resource && resource < profile,
      "Entity grant/actual employee entity required before payroll source reads");
    assert.match(route, /requested: body\.legalEntityId/);
    assert.match(route, /if \(!entityScope\.ok\) return entityScope\.response/);
    assert.match(route, /assertEntityResource\(entityScope\.context, legalEntityId\)/);
    assert.match(route, /assertEntityResource\(entityScope\.context, employee\.legalEntityId\)/);
    assert.doesNotMatch(route, /\bdb\.(?:insert|update|delete|transaction)\(/);
    return;
  }

  if (method.status === "COVERED" && key === "src/app/api/workforce-planning/baselines/route.ts POST") {
    // WRK-02 Batch 2 receipt (dedicated guard at the end of this file); the zero-credit hold is gone with the credit.
    assert.equal(method.testedBy?.file, "scripts/qa/tenant-wrk02-batch2-http.mjs");
    assert.equal(method.reviewedUncertified, undefined);
    return;
  }

  // #1597: uncredited WFM baseline POST fix. A guessed foreign scenario ID
  // must never disclose approval, plan linkage or scope before live membership.
  // The read-only GET handler remains byte-identical to the credited version;
  // changed POST needs fresh real-HTTP own/victim proof and human review.
  if (isNewOrChanged && method.status === "GAP" &&
      key === "src/app/api/workforce-planning/baselines/route.ts POST") {
    const review = method.reviewedUncertified;
    const routePath = "src/app/api/workforce-planning/baselines/route.ts";
    const oldSha = "cf6173d80aa2211cfcf5c0f00c89bfc95610ceba";
    const newSha = "21a1b50f86b3882fc11910e45bcd81e403662012";
    assert.equal(currentBlob, newSha,
      "WFM scenario publishing route changed: independent tenant security re-review required");
    assert.deepEqual(review, {
      kind: "wfm-baselines-foreign-scenario-404-source-only-zero-credit",
      oldRouteBlobSha: oldSha,
      routeBlobSha: newSha,
      unchangedGetPrefixBlobSha: "4ea38d661f5ec8419b5f2e0a1f0fad97d213d9b5",
      contractFile: "tests/workforce-plan-baseline.test.ts",
      contractBlobSha: "ef8ff7a8430e02456959e80df46cee2bf0a8f804",
      coverageCredits: 0,
      exactHeadPostHttpProof: "NOT_RUN",
      independentSecurityReview: "PENDING",
      productionCertified: false,
    }, "WFM baseline POST has no new credit, production approval or accepted HTTP proof");
    assert.equal(method.testedBy, null, "Source-only POST fix must remain GAP");
    assert.match(method.reason, /Still GAP:.*HTTP\/PG16.*Independent tenant-security review/);
    const route = readFileSync(routePath, "utf8");
    const getAt = route.indexOf("export async function GET(request: Request) {");
    const postAt = route.indexOf("export async function POST(request: Request) {");
    assert.ok(getAt >= 0 && postAt > getAt, "GET and POST handlers must remain distinct");
    assert.equal(gitBlobSha(Buffer.from(route.slice(0, postAt))), review.unchangedGetPrefixBlobSha,
      "Previously credited GET imports, helpers and handler must remain exactly unchanged");
    const getMethod = manifest.allApiRouteFiles[routePath].methods
      .find((entry) => entry.name === "GET");
    assert.equal(getMethod?.status, "COVERED", "Original GET proof not downgraded or duplicated");
    assert.equal(getMethod?.testedBy?.file, "scripts/qa/tenant-table-http.mjs");
    assert.equal(gitBlobSha(readFileSync(review.contractFile)), review.contractBlobSha,
      "The source-order contract changed: repeat the zero-credit authorization review");
    const post = route.slice(postAt);
    const gates = [
      "if (!Number.isSafeInteger(scenarioId) || scenarioId <= 0)",
      "const [scenario] = await db.select().from(workforcePlanningScenarios)",
      'if (!scenario) return Response.json({ error: "Staffing scenario not found." }, { status: 404 });',
      "const access = await getAccess(user.id, scenario.organizationId);",
      "if (!access || access.organizationId !== scenario.organizationId)",
      "const denied = await assertOrganizationRole(",
      "if (denied) return denied;",
      "if (!access.companyWide)",
      'if (scenario.status !== "approved")',
      "if (!scenario.planId)",
      "if (scenario.scopeOrgUnitId != null || scenario.worksiteId != null)",
      'const advancedDenied = await denyOptInEnterpriseAdvancedPlan(scenario.organizationId, "planning");',
      "const [[plan], positionRows, assignmentRows] = await Promise.all([",
    ];
    let previous = -1;
    for (const gate of gates) {
      const at = post.indexOf(gate);
      assert.ok(at > previous, "A required authorization/source gate is missing or out of order: " + gate);
      previous = at;
    }
    const generic404 = 'Response.json({ error: "Staffing scenario not found." }, { status: 404 })';
    assert.equal(post.split(generic404).length - 1, 2,
      "Unknown and foreign scenario IDs must share identical generic 404 response bodies");
    const statusAt = post.indexOf('if (scenario.status !== "approved")');
    assert.doesNotMatch(post.slice(0, statusAt),
      /scenario\.(?:status|planId|scopeOrgUnitId|worksiteId|name|snapshot)\b/,
      "No business-state disclosure or plan access before membership and People admin approval");
    assert.match(post, /eq\(workforcePlans\.organizationId, scenario\.organizationId\)/);
    assert.match(post, /eq\(workforcePlanBaselines\.organizationId, scenario\.organizationId\)/);
    return;
  }

  // WRK-02 source-only hardening. These changed route blobs add stricter
  // final SQL predicates, but have NO new own/victim PG16 HTTP proof.
  const wrk02Boundaries = {
    "src/app/api/workforce-planning/scenarios/route.ts": { previous: "ac05e54cc1aa6b2eb36283086fc3ca1a1717b2e7", current: "2b1ab188bf9a58d5235e94e00617ecbfd4f2e6a0", prefix: "90ab7ddfb9cbceb32101b687cc9ecdc64581c8e9", methods: ["GET","POST","PATCH"] },
    "src/app/api/workforce-planning/position-executions/route.ts": { previous: "0c7ddf8ba2db323aea03c152612eced44c31aea2", current: "142797be0cfa4f64849b20958869c12147ccf792", prefix: "e18416e827678a1e62a1e891201df027ba20c48e", methods: ["GET","POST","PATCH"] },
    "src/app/api/workforce-planning/transfer/route.ts": { previous: "4aa8c0c402f62a45bc5dd46dd6558b21d1bad153", current: "fc17024c47d013b28213abe89c7784254e3b2bc1", prefix: null, methods: ["POST"] },
  };
  const wrk02Path = key.slice(0, key.lastIndexOf(" "));
  const wrk02 = wrk02Boundaries[wrk02Path];
  if (isNewOrChanged && wrk02) {
    assert.equal(currentBlob, wrk02.current,
      "WRK-02 write boundary changed again: require independent source/security review");
    assert.ok(wrk02.methods.includes(method.name), "Unexpected WRK-02 method");
    const code = readFileSync(wrk02Path, "utf8");
    if (wrk02.prefix) {
      const start = code.indexOf("export async function POST(request: Request) {");
      assert.ok(start > 0, "Original GET must precede mutations");
      assert.equal(gitBlobSha(Buffer.from(code.slice(0, start))), wrk02.prefix,
        "Previously covered WRK-02 GET imports/helpers/handler changed");
    }
    if (method.name === "GET") {
      assert.equal(method.status, "COVERED", "The historical GET proof must not be downgraded");
      assert.equal(method.testedBy?.file, "scripts/qa/tenant-table-http.mjs");
      return;
    }
    if (wrk02Path.endsWith("/position-executions/route.ts")) {
      // WRK-02 Batch 2 receipt (dedicated guard at the end of this file) credits POST and PATCH.
      assert.equal(method.status, "COVERED");
      assert.equal(method.testedBy?.file, "scripts/qa/tenant-wrk02-batch2-http.mjs");
      assert.equal(method.reviewedUncertified, undefined, "a credited method no longer carries the zero-credit hold");
      return;
    }
    if ((wrk02Path.endsWith("/transfer/route.ts") && method.name === "POST") || (wrk02Path.endsWith("/scenarios/route.ts") && method.name === "PATCH")) {
      // Real two-attacker PG16 HTTP proof now exists for these two through the write table; nothing else here is credited.
      assert.equal(method.status, "COVERED");
      assert.equal(method.testedBy?.rowFile, "scripts/qa/tenant-table-rows/write/workforce-planning.mjs");
      assert.equal(method.reviewedUncertified, undefined, "a credited method no longer carries the zero-credit hold");
      return;
    }
    if(wrk02Path.endsWith('/scenarios/route.ts') && method.name==='POST') {
      assert.equal(verifyRecoveryCredits(manifest),3);
      return; // Separate, sealed fresh PG16 receipt, never source-only credit.
    }
    assert.equal(method.status, "GAP", "Source-only WRK-02 changes earn zero new method credits");
    assert.equal(method.testedBy, null);
    assert.deepEqual(method.reviewedUncertified, {
      kind: "wrk02-planning-write-boundaries-source-only-zero-credit",
      originalRouteBlobSha: wrk02.previous,
      routeBlobSha: wrk02.current,
      contractFile: "tests/tenant-wrk02-planning-write-boundaries.test.mjs",
      contractBlobSha: "74ce1283675c0dd8284a785ec5e95435d8abbc61",
      originalGetPrefixSha: wrk02.prefix,
      coverageCredits: 0,
      exactHeadPg16Http: "NOT_RUN",
      independentSecurityReview: "PENDING",
      productionCertified: false,
    });
    assert.equal(gitBlobSha(readFileSync("tests/tenant-wrk02-planning-write-boundaries.test.mjs")),
      "74ce1283675c0dd8284a785ec5e95435d8abbc61", "WRK-02 source contract changed without renewed review");
    return;
  }

  // Source-reviewed labor inspection remediation atomicity, NOT a POST
  // isolation credit. Keep the separately executed historical GET untouched.
  // Exact source and limited assign/acknowledge/close scope are pinned so
  // later edits require a new security review, rather than a broad GAP waiver.
  if (isNewOrChanged && key === "src/app/api/compliance/labor-inspection/route.ts POST") {
    const path = "src/app/api/compliance/labor-inspection/route.ts";
    const actualRoute = "94cc58cb4de0d8e79b7bd7881413b71e6f1fddb5";
    assert.equal(currentBlob, actualRoute, "Labor inspection POST changed: renew tenant review");
    const entry = manifest.allApiRouteFiles[path];
    assert.equal(entry.gitBlobSha, currentBlob);
    assert.equal(method.status, "COVERED", "Full assign/acknowledge/close PG16 proof must remain credited");
    assert.equal(method.reviewedUncertified, undefined, "No zero-credit review metadata after credit");
    assert.equal(method.testedBy?.file, "scripts/qa/tenant-labor-inspection-post-http.mjs");
    assert.equal(method.testedBy?.workflowRunId, 41392987376);
    assert.equal(method.testedBy?.routeBlobSha, actualRoute);
    assert.deepEqual(method.testedBy?.methodActions, ["assign", "acknowledge", "close"]);
    assert.equal(entry.methods.find(row => row.name === "GET")?.testedBy?.file,
      "scripts/qa/tenant-table-http.mjs", "Preserve the independently evidenced GET");
    assert.equal(gitBlobSha(readFileSync("tests/tenant-labor-inspection-remediation-post-boundary.test.mjs")),
      "1243f28d4fd6aba36cb5512ba622159c7982c138", "Atomicity source guard must not be lost");
    const route = readFileSync(path, "utf8");
    const postAt = route.indexOf("export async function POST(request: Request)");
    assert.ok(postAt > route.indexOf("export async function GET(request: Request)"));
    const post = route.slice(postAt);
    const assignAt = post.indexOf('if (action === "assign" || action === "acknowledge")');
    const closeAt = post.indexOf('if (action === "close")');
    assert.ok(assignAt >= 0 && closeAt > assignAt);
    for (const action of [post.slice(assignAt, closeAt), post.slice(closeAt)]) {
      assert.match(action, /await db\.transaction\(async \(tx\) =>/);
      assert.match(action, /await recordAuditEvent\(/);
      assert.match(action, /\}, tx\);/);
      assert.match(action, /eq\(laborInspectionRemediations\.organizationId, organizationId\)/);
      assert.match(action, /eq\(laborInspectionRemediations\.findingKey, findingKey\)/);
      assert.match(action, /eq\(laborInspectionRemediations\.status, existing\.status\)/);
    }
    const contract = readFileSync("tests/tenant-labor-inspection-remediation-post-boundary.test.mjs", "utf8");
    assert.match(contract, /transaction|atomic/i);
    return;
  }

  // Source-identified POST-only pilot-status oracle fix. Own disabled-pilot
  // 404 is preserved, but unauthorized foreign employers must receive 403
  // regardless of pilot state. No tenant-isolation method credit is granted.
  if (isNewOrChanged &&
      key === "src/app/api/workforce/demand-observations/issued/score/route.ts POST") {
    const path = "src/app/api/workforce/demand-observations/issued/score/route.ts";
    assert.equal(currentBlob, "5658c67c7758e78c68738f0e848edfcfc8bd17c3",
      "Issued final-score security edit requires renewed exact-source review");
    verifyIssuedDemandSoloRecovery(method, path, currentBlob);
    // The earlier POST pilot-order fix alone was not sufficient; this exact
    // method has since passed a genuine two-attacker PG16 HTTP four-part proof.
    const route = readFileSync(path, "utf8");
    assert.equal(gitBlobSha(Buffer.from(restoreIssuedDemandPostPilotOrder(route))),
      "91170340cd1bc1e43547e4d29d4b213bf45efe12",
      "Score route may change only the reviewed POST role/pilot ordering");
    const runner = readFileSync("scripts/qa/tenant-issued-demand-http.mjs", "utf8");
    const contract = readFileSync("tests/tenant-issued-demand-contract.test.mjs", "utf8");
    assert.match(runner, /non-member cannot inspect excluded employer pilot status/);
    assert.match(runner, /counts\.nonmemberExcludedEmployer403\+\+/);
    assert.match(contract,
      /both issued-demand writes authorize employer membership before inspecting pilot flags/);
    return;
  }

  // PATCH careers publication: recheck the persisted, active company-wide
  // HR grant inside the final SQL transaction. Source review only; a passing
  // mock or partial HTTP path does not prove full tenant isolation or add credit.
  if (isNewOrChanged && key === "src/app/api/careers/admin/route.ts PATCH") {
    const path = "src/app/api/careers/admin/route.ts";
    const current = "fc7920e19fc75389c5f5e7fe3cb4f90046028f00";
    assert.equal(currentBlob, current, "Careers final role guard changed: renewed review required");
    assert.equal(manifest.allApiRouteFiles[path].gitBlobSha, current);
    assert.equal(method.status, "GAP");
    assert.equal(method.testedBy, null);
    assert.deepEqual(method.reviewedUncertified, {
      kind: "careers-patch-final-live-role-lock-PG16-review-only",
      originalRouteBlobSha: "3227f2bd369ca86bc05b10750f3bdf8b35512955",
      routeBlobSha: current,
      proofFile: "scripts/qa/tenant-edg01-careers-publication-http.mjs",
      proofBlobSha: "9f799cc2344561ab8f4a47a2c0ddc162335f8096",
      contractFile: "tests/tenant-edg01-careers-publication-contract.test.mjs",
      contractBlobSha: "e5e0aa44ea5643ffb4a929cf20a5a840986b6e26",
      workflowFile: ".github/workflows/tenant-edg01-careers-publication-http.yml",
      workflowBlobSha: "b84ba8d8001b1475c741809340dcb795943a96f7",
      coverageCredits: 0,
      exactHeadPg16Http: "PENDING",
      independentSecurityReview: "PENDING",
      productionCertified: false,
    });
    for (const [file, expected] of [
      [method.reviewedUncertified.proofFile, method.reviewedUncertified.proofBlobSha],
      [method.reviewedUncertified.contractFile, method.reviewedUncertified.contractBlobSha],
      [method.reviewedUncertified.workflowFile, method.reviewedUncertified.workflowBlobSha],
    ]) assert.equal(gitBlobSha(readFileSync(file)), expected,
      "Careers test/PG16 evidence source changed; re-review required: " + file);
    const source = readFileSync(path, "utf8");
    const tx = source.indexOf("db.transaction(async tx =>");
    const grant = source.indexOf("const liveGrant = await tx.execute", tx);
    const update = source.indexOf("update job_requisitions as req", grant);
    assert.ok(tx > 0 && grant > tx && update > grant,
      "Active employer grant must be locked before publishing any requisition");
    const gate = source.slice(grant, update);
    for (const item of [
      "uo.user_id = ${user.id}",
      "uo.organization_id = ${organizationId}",
      "uo.active = true", "u.active = true", "uo.org_unit_id is null",
      "uo.role in ('owner', 'admin', 'hr')", "for share of uo, u",
      "if (!liveGrant.rows[0]) return null",
    ]) assert.ok(gate.includes(item), "Careers commit-time tenant role guard missing: " + item);
    assert.ok(source.includes("req.organization_id = ${organizationId}"),
      "Careers write must retain the employer-bound requisition predicate");
    return;
  }

  // WFM demand read-overlay batch: ONLY these two exact-source GET repairs.
  // These changes preserve the historical POST/PATCH handlers byte-for-byte,
  // preserve historical credits and verify the separately source-proven GET recovery.
  if (isNewOrChanged && (
    key.startsWith("src/app/api/workforce/demand-observations/issued/route.ts ") ||
    key.startsWith("src/app/api/workforce/demand-staffing/policies/route.ts ")
  )) {
    const issued = key.startsWith("src/app/api/workforce/demand-observations/issued/route.ts ");
    const routePath = key.slice(0, key.lastIndexOf(" "));
    const before = issued
      ? "d9e6ae99e687b691ca428e58c6c34ff077769a41"
      : "513975b118713becbf98caffa7d813a5b8c33c71";
    const after = issued
      ? "d552c6db5a54b346d8fb940edb5f0ceaaeff04a0"
      : "e0ea8e23ffad6ca72edd5ef8da4dbe3a332d041c";
    if (issued) {
      assert.equal(currentBlob, "549156b2e143c71bd33385fb1cc49a95cb120dfc",
        "Issued GET/POST route changed: renew POST-specific tenant review");
      assert.equal(gitBlobSha(Buffer.from(restoreIssuedDemandPostPilotOrder(
        readFileSync(routePath, "utf8")))), after,
        "Issuer source must differ from the reviewed GET-only route solely by POST auth order");
    } else {
      assert.equal(currentBlob, after, "WFM demand GET change requires renewed exact-source review");
    }
    assert.equal(baseline.api[routePath], before, "Original WFM demand baseline must remain stable");
    const expectedStatuses = issued
      ? { GET: "COVERED", POST: "COVERED" }
      : { GET: "COVERED", POST: "COVERED", PATCH: "COVERED" };
    assert.equal(method.status, expectedStatuses[method.name],
      "WFM permission fix cannot silently promote, downgrade or omit another method");
    if (issued && method.name === "POST") {
      verifyIssuedDemandSoloRecovery(method, routePath, currentBlob);
    } else if (!issued && method.name === "GET") {
      assert.equal(verifyStaffingPolicyGetCredit(manifest), 1);
    } else if (method.status === "GAP") {
      assert.equal(method.testedBy, null,
        "Unreviewed method cannot borrow a feature-OFF or static proof credit");
    } else {
      assert.equal(method.testedBy?.routeBlobSha, before,
        "Historical covered method evidence must keep its original source hash");
      assert.equal(method.testedBy?.file, issued
        ? "scripts/qa/tenant-demand-governance-recovery-http.mjs"
        : "scripts/qa/tenant-wrk01-staffing-writes-http.mjs",
        "Historical method credit cannot borrow the new GET-only proof");
    }

    const reviewed = method.reviewedUncertified;
    assert.deepEqual(reviewed, {
      kind: "wfm-demand-reads-workforce-permission-overlay-unaccepted",
      previousRouteBlobSha: before,
      routeBlobSha: after,
      onlyReadHandlerChanged: true,
      changedMethod: "GET",
      statusBefore: (issued && method.name === "POST") || (!issued && method.name === "GET") ? "GAP" : method.status,
      runnerFile: "scripts/qa/tenant-wfm-demand-read-overlay-http.mjs",
      runnerBlobSha: "595539e672a3dc121f709b44ce045f432d7d9d92",
      contractFile: "tests/tenant-wfm-demand-read-overlay.test.mjs",
      contractBlobSha: "d03d2814cc989a3743ac520827d45b6a2b43b396",
      workflowFile: ".github/workflows/tenant-wfm-demand-read-overlay-http.yml",
      workflowBlobSha: "a7b23d7680e9a36a35d1d736e7a8bd2b9d01ccfc",
      ownPositiveLine: 105,
      foreignDenialLine: 117,
      overlayDenialLine: 158,
      revokedDenialLine: 212,
      unchangedDbLine: 217,
      methodCredits: 0,
      independentlyAccepted: false,
      productionCertified: false,
    }, "WFM demand exemption is exact-source, exact-proof and zero-credit only");
    for (const [file, sha] of [
      [reviewed.runnerFile, reviewed.runnerBlobSha],
      [reviewed.contractFile, reviewed.contractBlobSha],
      [reviewed.workflowFile, reviewed.workflowBlobSha],
    ]) assert.equal(gitBlobSha(readFileSync(file)), sha,
      "WFM demand proof, contract or workflow changed without renewed security review: " + file);
    assert.match(evidenceLine(reviewed.runnerFile, reviewed.ownPositiveLine, key),
      /const own = await request\(endpoint\(row, actor\.org\.id/);
    assert.match(evidenceLine(reviewed.runnerFile, reviewed.foreignDenialLine, key),
      /const foreign = await request\(endpoint\(row, victim\.org\.id/);
    assert.match(evidenceLine(reviewed.runnerFile, reviewed.overlayDenialLine, key),
      /const denied = await request\(endpoint\(row, a\.org\.id/);
    assert.match(evidenceLine(reviewed.runnerFile, reviewed.revokedDenialLine, key),
      /const denied = await request\(endpoint\(row, b\.org\.id/);
    assert.match(evidenceLine(reviewed.runnerFile, reviewed.unchangedDbLine, key),
      /assertImmutableDemandSources\(beforeReads\.get\(victim\.org\.id\)/);
    const runner = readFileSync(reviewed.runnerFile, "utf8");
    for (const required of [
      "requireDisposableDemandRecovery();",
      "for (const actor of [a, b])",
      "assertBoundDemandRead(kind, own, c, persisted)",
      "assertDemandDenial(foreign, 403",
      "assertDemandDenial(stolenSite, 403",
      "permissions: [\"people.admin\"]",
      "assert.equal(stillSignedIn.status, 200",
      "methodCredits: 0, independentlyAccepted: false, productionCertified: false",
    ]) assert.ok(runner.includes(required), "WFM demand PG16 proof guard missing: " + required);
    assert.ok(runner.indexOf("requireDisposableDemandRecovery();") >
      runner.indexOf("export async function proveWorkforceDemandReadPermissionOverlay()") &&
      runner.indexOf("requireDisposableDemandRecovery();") <
        runner.indexOf('import("../../src/db/index.ts")'),
      "PG16 hard refusal must execute before importing any application database module");
    const workflow = readFileSync(reviewed.workflowFile, "utf8");
    assert.match(workflow, /image: postgres:16/);
    assert.match(workflow, /tenant-table-allowlist-bootstrap\.mjs/);
    assert.match(workflow, /node --import tsx scripts\/qa\/tenant-wfm-demand-read-overlay-http\.mjs/);
    assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);

    // Reconstruct the exact historical source from ONLY the reviewed import
    // and GET-body edits; the resulting whole-file SHA proves that historical
    // POST and PATCH handlers, imports and every other byte are unchanged.
    const code = readFileSync(routePath, "utf8");
    const oldImport = 'import { getAccess, PEOPLE_ADMIN_ROLES, WORKFORCE_MANAGER_ROLES } from "@/lib/access";';
    const newImport = 'import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES, WORKFORCE_MANAGER_ROLES } from "@/lib/access";';
    const oldGet = issued
      ? [
        '  if (!issuedDemandPilotAllowed(organizationId)) {',
        '    return Response.json({ error: "Issued workload forecasting is not enabled for this employer." }, { status: 404 });',
        '  }',
        '  const access = await getAccess(user.id, organizationId);',
        '  if (!access || !WORKFORCE_MANAGER_ROLES.some(role => role === access.role)) {',
        '    return Response.json({ error: "Workforce manager access is required." }, { status: 403 });',
        '  }',
      ].join("\n")
      : [
        '  if(!staffingPolicyPilotAllowed(organizationId,issuedDemandPilotAllowed(organizationId))){',
        '    return Response.json({error:"Demand staffing policies unavailable for employer."},{status:404,headers});',
        '  }',
        '  const access=await getAccess(user.id,organizationId);',
        '  if(!access||!WORKFORCE_MANAGER_ROLES.some(role=>role===access.role)||',
        '    (mode==="manage"&&(!access.companyWide||',
        '       !PEOPLE_ADMIN_ROLES.some(role=>role===access.role)))) {',
        '    return Response.json({error:"Workforce policy review requires scoped manager access."},{status:403,headers});',
        '  }',
      ].join("\n");
    const newGet = issued
      ? [
        '  // Authorize the active employer, session policy and deny-only custom',
        '  // workforce permission BEFORE disclosing any tenant pilot configuration.',
        '  const roleDenied = await assertOrganizationRole(',
        '    user.id, organizationId, WORKFORCE_MANAGER_ROLES,',
        '    "Workforce manager access is required.",',
        '  );',
        '  if (roleDenied) return roleDenied;',
        '  const access = await getAccess(user.id, organizationId);',
        '  if (!access) {',
        '    return Response.json({ error: "Workforce manager access is required." }, { status: 403 });',
        '  }',
        '  if (!issuedDemandPilotAllowed(organizationId)) {',
        '    return Response.json({ error: "Issued workload forecasting is not enabled for this employer." }, { status: 404 });',
        '  }',
      ].join("\n")
      : [
        '  // Deny a revoked session or a custom workforce permission restriction',
        '  // before inspecting tenant pilot flags, sites, roles or policy evidence.',
        '  const roleDenied=await assertOrganizationRole(',
        '    user.id,organizationId,WORKFORCE_MANAGER_ROLES,',
        '    "Workforce policy review requires scoped manager access.");',
        '  if(roleDenied)return roleDenied;',
        '  const access=await getAccess(user.id,organizationId);',
        '  if(!access||(mode==="manage"&&(!access.companyWide||',
        '       !PEOPLE_ADMIN_ROLES.some(role=>role===access.role)))) {',
        '    return Response.json({error:"Workforce policy review requires scoped manager access."},{status:403,headers});',
        '  }',
        '  if(!staffingPolicyPilotAllowed(organizationId,issuedDemandPilotAllowed(organizationId))){',
        '    return Response.json({error:"Demand staffing policies unavailable for employer."},{status:404,headers});',
        '  }',
      ].join("\n");
    assert.equal(code.split(newImport).length, 2, "Reviewed import change must be unique");
    assert.equal(code.split(newGet).length, 2, "Reviewed GET-body replacement must be unique");
    const sourceBeforePostHardening = issued ? restoreIssuedDemandPostPilotOrder(code) : code;
    const reconstructed = sourceBeforePostHardening.replace(newImport, oldImport)
      .replace(newGet, oldGet);
    assert.equal(gitBlobSha(Buffer.from(reconstructed)), before,
      "WFM read hardening must not change unreviewed POST/PATCH or any unrelated route code");
    const get = code.slice(code.indexOf("export async function GET("),
      code.indexOf("export async function POST("));
    const session = get.indexOf("getSessionUser()");
    const gate = get.indexOf("await assertOrganizationRole(");
    const access = get.indexOf("await getAccess(");
    const flag = get.indexOf(issued ? "issuedDemandPilotAllowed(organizationId)" :
      "staffingPolicyPilotAllowed(organizationId,issuedDemandPilotAllowed(organizationId))");
    const source = get.indexOf(issued ? "await fetchIssuedDemandForecasts(" :
      "await readStaffingPolicies(");
    assert.ok(session >= 0 && gate > session && access > gate &&
      flag > access && source > flag,
      "WFM private demand GET must check active tenant/session/deny overlay before pilot and SQL");
    return; // Source-reconstructed route; GET reconciled separately, historical zero-credit record retained.
  }

  // #641 salary-correction case route. Three historical company-level methods
  // were already COVERED, but this PR hardens their same-org legal-employer
  // boundaries. Pin EXACT changed sources and tests; preserve old tenant proof
  // WITHOUT claiming that the new legal-employer scenario passed signed-in HTTP.
  // An edit to any new guard or fixture fails closed pending renewed review.
  if (isNewOrChanged && key.startsWith(
    "src/app/api/hcm/salary-corrections/cases/route.ts "
  )) {
    const routeFile = "src/app/api/hcm/salary-corrections/cases/route.ts";
    const oldRouteSha = "26993c273d5482f602f420cd95cf9007616f6954";
    const hardenedRouteSha = "9293d95f76f1bb31caa2e3de6e6219be057d616a";
    // The 288-route original baseline predates the #641 cases endpoint.
    // Do NOT misrepresent its previous HEAD blob as baseline-audited proof.
    // Instead, pin the exact pre-hardening SHA in reviewedUncertified below
    // and verify the historical HTTP fixture plus every changed source blob.
    assert.equal(Object.hasOwn(baseline.api, routeFile), false,
      "#641 case route is post-baseline; it must not claim old inventory acceptance");
    assert.equal(currentBlob, hardenedRouteSha,
      "#641 changed case route requires renewed security/tenant evidence review");
    assert.ok(["GET", "POST", "PATCH"].includes(method.name),
      "Unexpected salary correction case mutation or read method");
    assert.equal(method.status, "COVERED",
      "Existing case route's historical company-level credits must not silently change");
    assert.equal(method.testedBy?.file,
      "scripts/qa/salary-correction-case-tenant-proof.mjs",
      "Historical two-company PG16 own/foreign proof must remain traceable");
    const review = method.reviewedUncertified;
    assert.deepEqual(review, {
      kind: "salary-correction-cases-multi-legal-employer-hardening-zero-new-credit",
      originalRouteBlobSha: oldRouteSha,
      routeBlobSha: hardenedRouteSha,
      methodName: method.name,
      historicalCoverageStatus: "COVERED",
      historicalProofFile: "scripts/qa/salary-correction-case-tenant-proof.mjs",
      historicalProofBlobSha: "b93d311a09d978b1f6e260fa3c94272fc1b6bb93",
      caseServiceFile: "src/lib/hcm-salary-correction-cases.ts",
      caseServiceBlobSha: "67f2c8878eae13de4b8a807123e8c495c601862a",
      scopeContractFile: "tests/hcm-salary-correction-entity-scope.test.mjs",
      scopeContractBlobSha: "411ff56012adaeebfa9d967a7d7659b2daf5ed28",
      selectorTestFile: "tests/hcm-salary-correction-selector-regression.test.ts",
      selectorTestBlobSha: "af0a52f5466ac8810684a16677789e3eb4cb4a9f",
      postgresTestFile: "tests/hcm-salary-correction-cases-postgres.test.ts",
      postgresTestBlobSha: "d0ea1d6c4e6dd9072d06ba067903d36a99ec96b9",
      workflowFile: ".github/workflows/salary-correction-cases-qa.yml",
      workflowBlobSha: "9790cca4f7650cad1a6eabb23546a14bb122cea8",
      newMethodCoverageCredits: 0,
      sameOrganizationTwoLegalEmployerHttp: "NOT_ACCEPTED",
      independentSecurityReview: "PENDING",
      productionCertified: false,
    }, "Legal-employer hardening stays a zero-credit, source-pinned review");
    for (const [file, sha] of [
      [review.historicalProofFile, review.historicalProofBlobSha],
      [review.caseServiceFile, review.caseServiceBlobSha],
      [review.scopeContractFile, review.scopeContractBlobSha],
      [review.selectorTestFile, review.selectorTestBlobSha],
      [review.postgresTestFile, review.postgresTestBlobSha],
      [review.workflowFile, review.workflowBlobSha],
    ]) {
      assert.equal(gitBlobSha(readFileSync(file)), sha,
        "Salary case evidence/source changed: renew #641 security review: " + file);
    }
    const route = readFileSync(routeFile, "utf8");
    const service = readFileSync(review.caseServiceFile, "utf8");
    const get = route.slice(route.indexOf("export async function GET("),
      route.indexOf("async function guardMutation("));
    const post = route.slice(route.indexOf("export async function POST("),
      route.indexOf("const MAKER_ACTIONS ="));
    const patch = route.slice(route.indexOf("export async function PATCH("));
    const role = get.indexOf("assertOrganizationRole(");
    const selection = get.indexOf("resolveMultiEntityContext({");
    const read = get.indexOf("await listCorrectionCases(");
    assert.ok(role >= 0 && role < selection && selection < read,
      "GET must authorize and select granted legal employer before fetching cases");
    assert.match(get, /userId: user\.id, organizationId, request,\s*\}/);
    assert.doesNotMatch(get, /requested:\s*new URL\(request\.url\)\.searchParams\.get/);
    assert.match(get, /entityScope\.context\.group \|\| entityScope\.context\.legalEntityId === null/);
    assert.match(get, /entityScope\.context\.enabled \? entityScope\.context\.legalEntityId : null/);
    assert.match(post, /requested: input\.legalEntityId/);
    assert.match(post, /assertEntityResource\(entityScope\.context, input\.legalEntityId\)/);
    assert.match(patch, /requested: body\.legalEntityId as string \| number \| null \| undefined/);
    const resolved = patch.indexOf("resolveMultiEntityContext({");
    const caseScope = patch.indexOf("const caseScope = and(");
    const caseRead = patch.indexOf(".where(caseScope)");
    const branch = patch.indexOf("switch (action)");
    assert.ok(resolved >= 0 && resolved < caseScope && caseScope < caseRead
      && caseRead < branch, "PATCH must scope the case ID before any action dispatch");
    assert.match(patch, /eq\(salaryCorrectionCases\.organizationId, organizationId\)/);
    assert.match(patch, /eq\(salaryCorrectionCases\.id, caseId\)/);
    assert.match(patch, /eq\(salaryCorrectionCases\.legalEntityId, entityScope\.context\.legalEntityId!\)/);
    assert.match(patch, /if \(!caseEmployer\) return Response\.json\(\{ error: "Correction case not found\." \}/);
    assert.match(service, /existing\.requestedByUserId === actor\.id/);
    assert.match(service, /existing\.legalEntityId === input\.legalEntityId/);
    assert.match(service, /existing\.evidenceReference === input\.evidenceReference/);
    assert.match(service, /existing\.reason === input\.reason/);
    assert.match(service, /correction\.requestedByUserId !== actor\.id\) fail\("NOT_CASE_MAKER"/);
    assert.match(service, /eq\(salaryCorrectionCases\.legalEntityId, legalEntityId\)/);
    assert.equal(review.newMethodCoverageCredits, 0);
    return; // Only this exact, source-pinned route and three historical methods.
  }

  // Narrow source-reviewed exception for global worker jobs. There is no
  // caller-selected employer on either endpoint, so an own/victim proof is not
  // a meaningful method credit. Require token-only auth and keep GAP until
  // a separate live worker-trigger security acceptance is independently reviewed.
  const globalWorkerRouteReviews = {
    "src/app/api/jobs/tick/route.ts POST": {
      previous: "dfde5451a937dd19ffcd75ac4d0632e3583b72c8",
      current: "338f520d2021e90b12f736ad941b2b8a5e2cf3a2",
      work: "await checkPayrollWorkerDispatchGate()",
    },
    "src/app/api/webhooks/drain/route.ts POST": {
      previous: "e6a40dcec48013e7f1a4c24a937d0cb8c6ca9cb2",
      current: "4ebd127ff97ea6b342cbfd9545a67eead3f58cda",
      work: "await drainWebhookRetries(25)",
    },
  };
  const globalWorkerReview = globalWorkerRouteReviews[key];
  if (isNewOrChanged && globalWorkerReview) {
    const routeFile = key.slice(0, key.lastIndexOf(" "));
    const helperFile = "src/lib/global-worker-authorization.ts";
    const testFile = "tests/global-worker-authorization.test.ts";
    const expectedReview = {
      kind: "global-worker-token-only-source-review-zero-method-credit",
      previousRouteBlobSha: globalWorkerReview.previous,
      routeBlobSha: globalWorkerReview.current,
      guardFile: helperFile,
      guardBlobSha: "8b71dbea21211e3c6963abfab1a1fa7fab4fe7fa",
      testFile,
      testBlobSha: "fecc827125a161e529fa6b1cc5d3b8f3cfefc7d6",
      coverageCredits: 0,
      exactHeadWorkerHttp: "NOT_RUN",
      independentSecurityReview: "PENDING",
      productionCertified: false,
    };
    assert.equal(method.name, "POST");
    assert.equal(method.status, "PRIVILEGED-OPERATIONS-TOKEN-ONLY", key + ": worker-only triggers must remain token-only, never COVERED");
    assert.equal(method.testedBy, null, key + ": source proof alone is never coverage");
    assert.match(method.reason, /worker[- ]token/i);
    assert.equal(currentBlob, globalWorkerReview.current,
      key + ": worker route changed; renew the exact-source review");
    assert.deepEqual(method.reviewedUncertified, expectedReview,
      key + ": global worker hardening must remain zero-credit until reviewed");
    assert.equal(gitBlobSha(readFileSync(helperFile)), expectedReview.guardBlobSha,
      "The shared worker-token guard changed, re-review token security");
    assert.equal(gitBlobSha(readFileSync(testFile)), expectedReview.testBlobSha,
      "The worker-token test changed, renew review evidence");
    const guard = readFileSync(helperFile, "utf8");
    for (const token of ['operationalSecret("worker")', "constantTimeSecretEqual",
      'request.headers.get("x-worker-token")', "status: 503", "status: 401"]) {
      assert.ok(guard.includes(token), "Missing token-only worker boundary: " + token);
    }
    const source = readFileSync(routeFile, "utf8");
    assert.ok(!source.includes("getSessionUser(") && !source.includes("enforceSameOriginMutation("),
      key + ": browser credentials must never trigger global cross-employer work");
    const authenticate = source.indexOf("const denied = requireGlobalWorkerToken(");
    const dispatch = source.indexOf(globalWorkerReview.work);
    assert.ok(authenticate >= 0 && dispatch > authenticate,
      key + ": worker authentication must precede dispatch");
    return;
  }

  // PATCH /api/payout-profiles: one source-pinned *provisional* method credit.
  // Retain the historical GET proof separately; never infer payout activation.
  // The passing PG16 workflow must match the exact route, proof and workflow
  // blobs, and the sole-owner acceptance still remains pending.
  if (isNewOrChanged && key === "src/app/api/payout-profiles/route.ts PATCH") {
    const routeFile = "src/app/api/payout-profiles/route.ts";
    const reviewed = method.testedBy;
    const expected = PAYOUT_PATCH_EVIDENCE;
    assert.equal(method.status, "COVERED", "only source-pinned passing PATCH may receive provisional credit");
    assert.equal(method.reviewedUncertified, undefined, "no lingering zero-credit status");
    assert.equal(verifyPayoutProfileCredit(manifest), 1);
    assert.equal(currentBlob, expected.routeBlobSha, "Payout route changed: repeat PG16 proof");
    assert.equal(baseline.api[routeFile], expected.originalRouteBlobSha,
      "Historical GET baseline must remain unchanged");
    for (const [file, sha] of [
      [reviewed.proofFile, reviewed.proofBlobSha],
      [reviewed.contractFile, reviewed.contractBlobSha],
      [reviewed.workflowFile, reviewed.workflowBlobSha],
    ]) assert.equal(gitBlobSha(readFileSync(file)), sha,
      "Payout write evidence changed; renew exact-source review: " + file);
    const source = readFileSync(routeFile, "utf8");
    const prefix = source.slice(0, source.indexOf("export async function PATCH"));
    assert.equal(prefix.length, 4945, "GET section changed from reviewed source");
    let fnv = 0xcbf29ce484222325n;
    for (const ch of prefix) fnv =
      ((fnv ^ BigInt(ch.charCodeAt(0))) * 0x100000001b3n) & 0xffffffffffffffffn;
    assert.equal(fnv.toString(16).padStart(16, "0"), expected.priorGetPrefixFnv64,
      "PATCH-only fix cannot alter GET employer-scoped read");
    const patch = source.slice(source.indexOf("export async function PATCH"));
    for (const token of [
      "requireCompanyAdmin(user.id, organizationId)",
      "requireSensitiveActionMfa(user)",
      "eq(legalEntities.organizationId, organizationId)",
      "setWhere: eq(payoutProfiles.organizationId, organizationId)",
      'if (!persisted) throw new Error("PAYOUT_PROFILE_SCOPE_CONFLICT")',
      'error.message === "PAYOUT_PROFILE_SCOPE_CONFLICT"',
      "const saved = await db.transaction(async (tx) => {",
      "await recordAuditEvent({", "}, tx);",
      'error: "Company payout profile could not be saved."',
    ]) assert.ok(patch.includes(token), "Missing atomic payout audit tenant guard: " + token);
    assert.ok(patch.indexOf("const saved = await db.transaction") <
      patch.indexOf("await recordAuditEvent({"),
      "Payout receipt must be committed or rolled back in the same transaction");
    assert.ok(!patch.includes("error instanceof Error ? error.message"),
      "SQL error details cannot leak to the tenant");
    const proof = readFileSync(reviewed.proofFile, "utf8");
    for (const marker of [
      '["GITHUB_ACTIONS", "true"]',
      '["SECURITY_SMOKE_URL", "http://127.0.0.1:3000"]',
      '["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/app_db"]',
      "for (const actor of [a, b])",
      "CREATE TRIGGER ci_reject_payout_profile_audit",
      "An upsert cannot adopt a foreign-tagged conflict row",
      "for (let n = 0; n < 6; n++)",
      "victimProfile.id > 6 && victimProfile.id > aProfile.id",
      "victimBefore.profiles.length === 1",
      "realVictimPayoutProfileIdAboveSix: true",
      "assert.deepEqual(await profileSnapshot(victim.org.id), foreignTaggedBefore",
      "assert.deepEqual(await profileSnapshot(a.org.id), originalProfiles",
      "assert.deepEqual(await profileSnapshot(victim.org.id), victimBefore.profiles",
      "methodCredits: 0, independentSecurityReview: \"PENDING\"",
    ]) assert.ok(proof.includes(marker), "Missing payout PATCH negative control: " + marker);
    const wf = readFileSync(reviewed.workflowFile, "utf8");
    assert.match(wf, /image: postgres:16/);
    assert.match(wf, /node --import tsx scripts\/qa\/tenant-payout-profiles-patch-http\.mjs/);
    return;
  }

  // WRK-02 Batch 3 root privacy hardening: a narrowly scoped, exact-source,
  // zero-credit candidate. Neither POST nor PATCH becomes COVERED. GET retains
  // only the historical source-pinned read proof. Any source or fixture drift
  // returns to the fail-closed generic inventory path until re-reviewed.
  if (isNewOrChanged && key.startsWith("src/app/api/workforce-planning/route.ts ")) {
    const routeFile = "src/app/api/workforce-planning/route.ts";
    const prior = "0535a1bb935bc61c777b33c1ea01f161a314e8d2";
    const current = "0b045a5fdbddbf07020a2d5ab4a961578d5c9cb1";
    assert.equal(currentBlob, current, "WRK-02 root route changed; redo tenant review");
    const expected = {
      "kind": "wrk02-batch3-root-privacy-assignment-race-zero-new-credit",
      "originalRouteBlobSha": "0535a1bb935bc61c777b33c1ea01f161a314e8d2",
      "routeBlobSha": "0b045a5fdbddbf07020a2d5ab4a961578d5c9cb1",
      "fixtureFile": "scripts/qa/tenant-table-rows/write/workforce-planning-root.mjs",
      "fixtureBlobSha": "5bcfbc175ef56fa5d9d0422d5d4b5aaae0048c1d",
      "contractFile": "tests/tenant-wrk02-batch3-root-contract.test.mjs",
      "contractBlobSha": "cc0ac61c96f0f170e01193a57f47c73f92c22939",
      "workflowFile": ".github/workflows/tenant-wrk02-batch3-root.yml",
      "workflowBlobSha": "b7debacbe672eb48712cd8b4898cae8418b599ac",
      "previousDedicatedPg16Run": "41203115190",
      "newMethodCredits": 0,
      "uncreditedMethods": [
        "POST",
        "PATCH"
      ],
      "exactHeadPg16": "PENDING",
      "productionCertified": false,
      "reviewPolicy": "SOLO_VERIFIED_DEV_RECOVERY",
      "soleOwnerReviewer": "erwinmehehe",
      "reviewStatus": "PENDING_EXACT_FINAL_HEAD"
    };
    assert.deepEqual(method.reviewedUncertified, expected,
      "WRK-02 method lacks its exact uncredited proof review");
    assert.ok(["GET", "POST", "PATCH"].includes(method.name));
    assert.equal(expected.originalRouteBlobSha, prior);
    if (method.name === "GET") {
      assert.equal(method.status, "COVERED", "Do not change historical root GET credit");
      assert.equal(method.testedBy?.file, "scripts/qa/tenant-table-http.mjs",
        "Keep the independently executed historical root GET proof");
    } else {
      assert.equal(method.status, "GAP", "No provisional root write credit");
      assert.equal(method.testedBy, null, "Security hardening is not method coverage");
    }
    for (const [file, sha] of [
      [expected.fixtureFile, expected.fixtureBlobSha],
      [expected.contractFile, expected.contractBlobSha],
      [expected.workflowFile, expected.workflowBlobSha],
    ]) {
      assert.equal(gitBlobSha(readFileSync(file)), sha,
        "WRK-02 fixture/contract/workflow changed; renew sole-owner source review: " + file);
    }
    const source = readFileSync(routeFile, "utf8");
    const patch = source.split("export async function PATCH(request: Request) {")[1] ?? "";
    const missing = patch.indexOf('if (!position) return Response.json({ error: "Position not found." }, { status: 404 });');
    const scoped = patch.indexOf("const membership = await getAccess(user.id, position.organizationId);");
    const masked = patch.indexOf('if (!membership) return Response.json({ error: "Position not found." }, { status: 404 });');
    const role = patch.indexOf("const denied = await assertOrganizationRole(user.id, position.organizationId");
    assert.ok(missing >= 0 && missing < scoped && scoped < masked && masked < role,
      "PATCH must conceal foreign and nonexistent positions before role checks");
    const fixture = readFileSync(expected.fixtureFile, "utf8");
    const contract = readFileSync(expected.contractFile, "utf8");
    const workflow = readFileSync(expected.workflowFile, "utf8");
    for (const token of [
      'TENANT_TABLE_FAMILY === "workforce-planning-root"',
      "isGovernedPositionAssignmentWorkspace(c.orgId)",
      "directAssignmentProofs = 1",
      "foreignPosition.text, missingPosition.text",
      "raceAudit.length, 1",
      "certifiedMethod: false",
    ]) assert.ok(fixture.includes(token), "WRK-02 synthetic proof lost: " + token);
    assert.match(contract, /simultaneous vacancy freezes cannot double-write/);
    assert.match(contract, /promotion remains source-pinned/);
    for (const token of [
      "real higher-ID foreign worker denied on valid own vacancy",
      "positionId: foreignWorkerVacancy.id",
      "employeeId: c.victimSeeded.assignmentWorkerId, effectiveFrom: todayPh",
      "forgedReferences: 5, blockedDirectAssignments: 1",
    ]) assert.ok(fixture.includes(token), "WRK-02 current proof lost: " + token);
    for (const flag of ["NEXT_CSP_ENABLED=false", "WORKER_ENABLED=false",
      "CENTRAL_SCHEDULER_ENABLED=false", "XENDIT_BILLING_ENABLED=false"]) {
      assert.ok(workflow.includes(flag), "WRK-02 CI safety flag missing: " + flag);
    }

    assert.match(workflow, /TENANT_TABLE_FAMILY: workforce-planning-root/);
    assert.match(workflow, /PAYMONGO_DISBURSEMENTS_ENABLED/);
    assert.match(workflow, /XENDIT_PAYOUTS_ENABLED/);
    return; // Only this exact three-method unaccepted source review.
  }

  if (isNewOrChanged && key === "src/app/api/earned-wage/route.ts POST") {
    const expected = {
      routeBlobSha: "e030259bb14719a806acbdad77c35135f63e1520",
      contractFile: "tests/tenant-earned-wage-post-audit-atomic.test.mjs",
      contractBlobSha: "3bf5d524f2d89dc9ac69cfb1ea3071ff0c74441c",
    };
    assert.equal(method.status, "COVERED", "Two-attacker POST, concurrency and SQL rollback passed at exact head");
    assert.equal(method.reviewedUncertified, undefined);
    assert.equal(method.testedBy?.workflowRunId, 41366324196);
    assert.equal(method.testedBy?.routeBlobSha, expected.routeBlobSha);
    assert.equal(currentBlob, expected.routeBlobSha);
    assert.equal(gitBlobSha(readFileSync(expected.contractFile)), expected.contractBlobSha);
    const post = readFileSync("src/app/api/earned-wage/route.ts", "utf8")
      .split("export async function POST")[1].split("export async function PATCH")[0];
    for (const token of [
      "const result = await db.transaction(async (tx) => {",
      "await tx.insert(earnedWageRequests)",
      "await recordAuditEvent({",
      "}, tx);",
    ]) assert.ok(post.includes(token), "Missing zero-credit EWA POST audit transaction: " + token);
    return;
  }


  // HCM SLA runs across employers by an explicitly configured cron token, not
  // a caller-selected employer. Source-only partial-index repair and a real
  // fictional PG16 HTTP candidate are NEVER a client-method coverage credit.
  if (isNewOrChanged &&
      key === "src/app/api/hcm/work-items/escalate/route.ts POST") {
    const routeFile = "src/app/api/hcm/work-items/escalate/route.ts";
    const review = method.reviewedUncertified;
    const expectedReview = {
      kind: "hcm-sla-worker-token-and-partial-index-PG16-uncredited",
      previousRouteBlobSha: "91d465334abe1391d5d96e587b39c365dd529c6c",
      routeBlobSha: "b432d1331dac5c3da0c6a8bbc2b4c7ebe95ceb9a",
      proofFile: "scripts/qa/tenant-hcm-sla-escalate-http.mjs",
      proofBlobSha: "823c27150d75d1bdd630ec914b7c0efc4565b7de",
      contractFile: "tests/tenant-hcm-sla-escalate-contract.test.mjs",
      contractBlobSha: "54b165b516e224dfca32ba63e6733c3fc7ccb8e5",
      unitTestFile: "tests/hcm-work-item-sla.test.ts",
      unitTestBlobSha: "b5699786808d477bb33f2b8cc0a7e908fdd3678b",
      workflowFile: ".github/workflows/tenant-hcm-sla-escalate-http.yml",
      workflowBlobSha: "0f8674171b69d9765113878250ce590e2af99175",
      fixtureFile: "scripts/qa/prepare-hcm-work-item-fixture.mjs",
      fixtureBlobSha: "3bc9f8046c38cf032ade0b076394be2f2e795c7b",
      credits: 0, exactHeadPg16Http: "PENDING",
      independentSecurityReview: "PENDING", productionCertified: false,
    };
    assert.equal(method.status, "GAP", "No global scheduler method coverage credit");
    assert.equal(method.testedBy, null, "Do not call a worker-token denial a tenant method proof");
    assert.match(method.reason, /worker-token.*zero method credits/i);
    assert.equal(currentBlob, expectedReview.routeBlobSha,
      "HCM SLA source changed: require renewed exact SHA and PG16 proof");
    assert.equal(baseline.api[routeFile], expectedReview.previousRouteBlobSha);
    assert.deepEqual(review, expectedReview, "No unreviewed scheduler exception expansion");
    for (const [file, sha] of [
      [review.proofFile, review.proofBlobSha],
      [review.contractFile, review.contractBlobSha],
      [review.unitTestFile, review.unitTestBlobSha],
      [review.workflowFile, review.workflowBlobSha],
      [review.fixtureFile, review.fixtureBlobSha],
    ]) assert.equal(gitBlobSha(readFileSync(file)), sha,
      "Worker evidence changed; renew exact-source review: " + file);
    const source = readFileSync(routeFile, "utf8");
    const beforeDb = source.indexOf("if (!authorized(request))");
    const connectDb = source.indexOf("const client = await pool.connect()");
    assert.ok(beforeDb > 0 && connectDb > beforeDb,
      "HCM cron authorization must precede all employer writes");
    assert.ok(!source.includes("getSessionUser("),
      "Tenant browser sessions are never global scheduler authorization");
    assert.match(source, /timingSafeEqual\(a, b\)/);
    assert.match(source, /WHERE uo\.organization_id=\$1 AND uo\.active=true/);
    assert.match(source, /ON CONFLICT \(dedupe_key\) WHERE dedupe_key IS NOT NULL DO NOTHING/);
    const schema = readFileSync("src/db/schema.ts", "utf8");
    assert.match(schema, /uniqueIndex\("outbox_dedupe_key_unique"\)/);
    const proof = readFileSync(review.proofFile, "utf8");
    for (const marker of [
      '["GITHUB_ACTIONS", "true"]',
      '["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/app_db"]',
      'authenticatedTenantCookieDenied: true',
      'assert.deepEqual(await snapshot("audit_events", org.orgId)',
      'assert.deepEqual(await snapshot("payroll_runs", org.orgId)',
      "methodCredits: 0, independentSecurityAcceptance: false",
    ]) assert.ok(proof.includes(marker), "Missing HCM worker negative control: " + marker);
    const workflow = readFileSync(review.workflowFile, "utf8");
    assert.match(workflow, /image: postgres:16/);
    assert.match(workflow, /node --import tsx scripts\/qa\/tenant-hcm-sla-escalate-http\.mjs/);
    return;
  }


  if (isNewOrChanged && ["src/app/api/year-end/route.ts GET",
      "src/app/api/year-end/route.ts POST"].includes(key)) {
    // Old #1730 proof is source-revoked by #1744. A distinct #1804 fictional
    // PG16 real-HTTP run now proves both current-source year-end methods.
    assert.equal(currentBlob, YEAR_END_SOURCE_PINS["src/app/api/year-end/route.ts"]);
    assert.equal(method.status, "COVERED");
    assert.equal(method.testedBy?.proofPullRequest, 1804);
    assert.equal(method.testedBy?.workflowRunId, 42254117862);
    assert.equal(method.testedBy?.independentSecurityReview, "PENDING");
    assert.equal(method.testedBy?.independentPayrollReview, "PENDING");
    assert.equal(method.testedBy?.productionCertified, false);
    assert.equal(method.reviewedUncertified, undefined);
    assert.equal(verifyYearEndCredits(manifest), 2);
    for (const [file, hash] of [
      ["tests/year-end-binding-transaction-contract.test.mjs",
        "9562442c4d9e7d820027630cead6d753c0fc3767"],
      ["src/lib/year-end.ts", "7194658c42b9ef33c84acd84ab356c28c6303883"],
      ["src/lib/payroll-engine.ts", "dc5719a2c34094b5449bf4ecacb198ab0d74a313"],
    ]) assert.equal(gitBlobSha(readFileSync(file)), hash,
      "Financial binding dependency changed; require new PG16 proof");
    const source = readFileSync("src/app/api/year-end/route.ts", "utf8");
    assert.match(source, /\.innerJoin\(employees, and\([\s\S]*?eq\(employees\.organizationId, organizationId\)/,
      "Cross-employer employee joins are forbidden");
    assert.equal(gitBlobSha(Buffer.from(source.split("export async function POST")[0])),
      "9f1b67735c5178d0e2172568243e25ff01b964cc");
    for (const token of ["onBoundToPayrollRun: async (tx, boundSummary) => {",
      "await enqueuePayrollRun(boundRun.id, undefined, tx);", "}, tx);"])
      assert.ok(source.includes(token), "Atomic bind guard missing: " + token);
    return;
  }

  if (isNewOrChanged && key === "src/app/api/leave/route.ts POST") {
    const expected = {
      kind: "leave-POST-revalidate-active-checker-source-only",
      priorRouteBlobSha: "1ecad0e01335770d683edeef091b5dd2ccc180c2", routeBlobSha: "97d492317460b0ff580bc045d8930f8232ed7031",
      contractFile: "tests/tenant-leave-post-active-checker.test.mjs", contractBlobSha: "42ac939ecd1a86e71584fda0aad05e15c3065a5e",
      credits: 0, actualPg16Http: "PENDING",
      independentSecurityReview: "PENDING", productionCertified: false,
    };
    assert.equal(method.status, "COVERED", "Whole method needs source-specific PG16 four-part POST proof");
    assert.equal(method.testedBy?.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY");
    assert.equal(method.testedBy?.workflowRunId, 41452144006);
    assert.equal(method.testedBy?.verifiedPrHeadSha, "49360001aa6ca2911f1e99617ba3ad34d82a6a67");
    assert.equal(method.testedBy?.ownerReviewer, "@erwinmehehe");
    assert.equal(method.testedBy?.ownerIsOnlyReviewer, true);
    assert.equal(method.testedBy?.routeBlobSha, currentBlob);
    assert.equal(method.testedBy?.proofBlobSha, "40c37e9966b5261ab1953d907a76843e339d90b8");
    assert.equal(method.testedBy?.workflowBlobSha, "b46cfbb441918cefd193580cf428f45f55606bb4");
    assert.equal(currentBlob, expected.routeBlobSha);
    assert.deepEqual(method.reviewedUncertified, expected);
    assert.equal(gitBlobSha(readFileSync(expected.contractFile)), expected.contractBlobSha);
    const post = readFileSync("src/app/api/leave/route.ts", "utf8").split("export async function POST")[1];
    for (const token of [
      "eq(userOrganizations.active, true)", "eq(users.active, true)",
      "inArray(userOrganizations.role, [...LEAVE_APPROVER_ROLES])",
      "const [liveApprover] = await tx.select(",
      "LEAVE_APPROVER_CHANGED",
    ]) assert.ok(post.includes(token), "Missing leave POST checker boundary: " + token);
    return;
  }


  if (isNewOrChanged && key === "src/app/api/documents/route.ts POST") {
    const expected = {
      kind: "documents-POST-legacy-audit-scope-source-only",
      priorRouteBlobSha: "259618c6355f61bde9fe8161d7f5017738753439", routeBlobSha: "cd8d559e9186ddae6c0f00e7af4bc4c4f5e37d38",
      contractFile: "tests/tenant-documents-post-legacy-atomic.test.mjs", contractBlobSha: "99ad5a76acbfc8e9588e1df4165db641c2647362",
      credits: 0, actualPg16Http: "PENDING",
      independentSecurityReview: "PENDING", productionCertified: false,
    };
    assert.equal(method.status, "GAP");
    assert.equal(method.testedBy, null);
    assert.equal(currentBlob, expected.routeBlobSha);
    assert.deepEqual(method.reviewedUncertified, expected);
    assert.equal(gitBlobSha(readFileSync(expected.contractFile)), expected.contractBlobSha);
    const legacy = readFileSync("src/app/api/documents/route.ts", "utf8")
      .split("export async function POST")[1].split("// Legacy database-backed document")[1];
    for (const token of [
      "const result = await db.transaction(async (tx) => {",
      "tx.insert(legacyDocumentInsertTable)",
      "tx.update(hcmEmployeeDocumentCompliance)",
      "eq(hcmEmployeeDocumentCompliance.organizationId, organizationId)",
      "eq(hcmEmployeeDocumentCompliance.employeeId, employeeId!)",
      "eq(hcmEmployeeDocumentCompliance.requirementId, requirement.id)",
      "await recordAuditEvent({", "}, tx);",
    ]) assert.ok(legacy.includes(token), "Missing documents POST atomic tenant guard: " + token);
    return;
  }


  if (isNewOrChanged && key === "src/app/api/migrations/route.ts POST") {
    const expected = {
      kind: "migrations-POST-historical-import-atomic-source-only",
      priorRouteBlobSha: "5484aba4bdc08351e05f5741f1e8c785919b53fb", routeBlobSha: "6f2aabfe906a2c38594ea8b20d17b27a90dafb95",
      contractFile: "tests/tenant-migrations-post-atomic-history.test.mjs", contractBlobSha: "5ce4fd9d5ff5d1cfac511efc790e3b0a1fa8957d",
      credits: 0, actualPg16Http: "PENDING",
      independentSecurityReview: "PENDING", productionCertified: false,
    };
    assert.equal(method.status, "GAP");
    assert.equal(method.testedBy, null);
    assert.equal(currentBlob, expected.routeBlobSha);
    assert.deepEqual(method.reviewedUncertified, expected);
    assert.equal(gitBlobSha(readFileSync(expected.contractFile)), expected.contractBlobSha);
    const post = readFileSync("src/app/api/migrations/route.ts", "utf8")
      .split("export async function POST")[1];
    for (const token of [
      "const batch = await db.transaction(async (tx) => {",
      "setWhere: eq(leaveBalances.organizationId, organizationId)",
      "eq(employeeLoans.organizationId, organizationId)",
      "await recordAuditEvent({",
      "}, tx);",
    ]) assert.ok(post.includes(token), "Missing migrations final write guard: " + token);
    assert.ok(post.indexOf("const denied = await assertOrganizationRole(") <
      post.indexOf("await ensureCoreCompatibilitySchema()"));
    return;
  }


  if (isNewOrChanged && key === "src/app/api/governed-handoffs/route.ts POST") {
    // A source fix must be independently pinned, even while GAP and uncredited.
    // This is an inventory integrity check, NOT an authorization shortcut.
    const expected = {
          "kind": "governed-handoffs-POST-atomic-audit-PG16-review-only",
          "priorRouteBlobSha": "fa7039cee62df7624e3124e75e6566294de32c68",
          "routeBlobSha": "258ec66f80e24e4d7ac484fb4be789573b1a9820",
          "contractFile": "tests/tenant-governed-handoff-post-error-boundary.test.mjs",
          "contractBlobSha": "8e839b7197203d3ea6b32281af78aaf0a5b3753b",
          "proofFile": "scripts/qa/tenant-workflow-leave-handoff-http.mjs",
          "proofBlobSha": "40c37e9966b5261ab1953d907a76843e339d90b8",
          "workflowFile": ".github/workflows/tenant-workflow-leave-handoff-pg16.yml",
          "workflowBlobSha": "b46cfbb441918cefd193580cf428f45f55606bb4",
          "sourceFixCommit": "2fc684a4cb8d2469ae2b7ced7ef04e740738e49d",
          "lastPassingHead": "ceba0eb16ab2c18add5ddfeac4b408e0be287e35",
          "lastPassingRun": 41446174317,
          "credits": 0,
          "actualPg16Http": "PENDING",
          "independentSecurityReview": "PENDING",
          "productionCertified": false
    };
    assert.equal(method.status, "COVERED", "Whole method needs source-specific PG16 four-part POST proof");
    assert.equal(method.testedBy?.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY");
    assert.equal(method.testedBy?.workflowRunId, 41452144006);
    assert.equal(method.testedBy?.verifiedPrHeadSha, "49360001aa6ca2911f1e99617ba3ad34d82a6a67");
    assert.equal(method.testedBy?.ownerReviewer, "@erwinmehehe");
    assert.equal(method.testedBy?.ownerIsOnlyReviewer, true);
    assert.equal(method.testedBy?.routeBlobSha, currentBlob);
    assert.equal(method.testedBy?.proofBlobSha, "40c37e9966b5261ab1953d907a76843e339d90b8");
    assert.equal(method.testedBy?.workflowBlobSha, "b46cfbb441918cefd193580cf428f45f55606bb4");
    assert.equal(expected.credits, 0);
    assert.equal(expected.actualPg16Http, "PENDING", "New final-head acceptance still required");
    assert.equal(expected.independentSecurityReview, "PENDING");
    assert.equal(currentBlob, expected.routeBlobSha);
    assert.deepEqual(method.reviewedUncertified, expected);
    for (const [file, sha] of [
      [expected.contractFile, expected.contractBlobSha],
      [expected.proofFile, expected.proofBlobSha],
      [expected.workflowFile, expected.workflowBlobSha],
    ]) assert.equal(gitBlobSha(readFileSync(file)), sha,
      "Governed handoff reviewed inputs changed without a renewed pin: " + file);
    const post = readFileSync("src/app/api/governed-handoffs/route.ts", "utf8")
      .split("export async function POST")[1];
    const chain = readFileSync("src/lib/approval-chains.ts", "utf8")
      .split("export async function createApprovalFromConfiguredChain")[1];
    assert.ok(post.includes('code: "GOVERNED_HANDOFF_UNAVAILABLE"'));
    assert.ok(post.includes('"Cache-Control": "private, no-store"'));
    assert.ok(!post.includes("error instanceof Error ? error.message"));
    assert.ok(!post.includes("await recordAuditEvent("),
      "Route cannot audit after the already-committed chain");
    assert.ok(post.includes("auditEvent: {"),
      "Route must supply a server-owned audit payload");
    assert.ok(chain.includes("await writeAuditedHandoff(instance.id)"));
    assert.ok(chain.includes("await writeAuditedHandoff(existing.id)"));
    assert.ok(chain.includes("}, tx);"),
      "Audit insertion must share the approval-chain transaction");
    return;
  }

  // Approval PATCH covers multiple payroll/HCM/WFM decision branches. This
  // refactor repeats employer scoping on final SQL updates; the existing
  // generic-task PG16 two-attacker proof is NOT a full method certification.
  if (isNewOrChanged && key === "src/app/api/approvals/[id]/route.ts PATCH") {
    const reviewed = method.reviewedUncertified;
    const expected = {
      kind: "approval-PATCH-final-SQL-employer-scope-PG16-uncredited",
      previousRouteBlobSha: "4dacb9acf4d49030f0bfe9c89700769d0dbb42a1",
      routeBlobSha: "024e0736da4097b2ee4b2e010c014bcd2e36d196",
      proofFile: "scripts/qa/tenant-approval-task-http.mjs",
      proofBlobSha: "849fcb15f0c2b9770269b372f81c6837d2422e07",
      existingContractFile: "tests/tenant-approval-task-contract.test.mjs",
      existingContractBlobSha: "1701a6b166f764213844fa1a91162400b9e1ca18",
      newContractFile: "tests/tenant-approval-task-tx-org-scope.test.mjs",
      newContractBlobSha: "47cfa33457203f4ff2b21baf0579eec21509d997",
      workflowFile: ".github/workflows/tenant-approval-task-http.yml",
      workflowBlobSha: "873a44778a3da811619e6eb6c5a0f0f67aed9c17",
      ownPositiveLine: 167, secondOwnPositiveLine: 175,
      foreignDenialLine: 128, unchangedVictimLine: 209,
      credits: 0, independentlyAccepted: false, productionCertified: false,
    };
    assert.equal(method.status, "GAP", "Approval PATCH remains uncertified");
    assert.equal(method.testedBy, null,
      "A generic task proof cannot certify payroll/leave/HCM source decision branches");
    assert.match(method.reason, /^Still GAP: #1665 PATCH/);
    assert.equal(currentBlob, expected.routeBlobSha,
      "Approval runtime source changed; renew exact-head tenant review");
    assert.equal(baseline.api["src/app/api/approvals/[id]/route.ts"],
      expected.previousRouteBlobSha);
    assert.deepEqual(reviewed, expected, "No unreviewed approval method credit");
    for (const [file, sha] of [
      [reviewed.proofFile, reviewed.proofBlobSha],
      [reviewed.existingContractFile, reviewed.existingContractBlobSha],
      [reviewed.newContractFile, reviewed.newContractBlobSha],
      [reviewed.workflowFile, reviewed.workflowBlobSha],
    ]) assert.equal(gitBlobSha(readFileSync(file)), sha,
      "Approval source/proof changed; renew independent test: " + file);
    const routeFile = key.slice(0, key.lastIndexOf(" "));
    const source = readFileSync(routeFile, "utf8");
    for (const [id, scope] of [
      ["payrollRuns.id, payrollRunId", "payrollRuns.organizationId, task.organizationId"],
      ["approvalTasks.id, taskId", "approvalTasks.organizationId, task.organizationId"],
      ["automationExecutions.waitingApprovalTaskId, taskId",
       "automationExecutions.organizationId, task.organizationId"],
      ["workforcePlanningScenarios.id, workforceScenarioApproval.scenarioId",
       "workforcePlanningScenarios.organizationId, task.organizationId"],
      ["workforcePlans.id, scenarioRow.planId",
       "workforcePlans.organizationId, task.organizationId"],
    ]) {
      assert.ok(source.includes("eq(" + id + ")") && source.includes("eq(" + scope + ")"),
        "Final approval SQL operation missing employer scope: " + id);
    }
    const proof = readableLines(reviewed.proofFile);
    assert.match(proof[reviewed.ownPositiveLine - 1], /const ownedA = await decision\(aTask, a\.cookie, "Declined"/);
    assert.match(proof[reviewed.secondOwnPositiveLine - 1],
      /const ownedB = await decision\(bTask, b\.cookie, "Approved"\)/);
    assert.match(proof[reviewed.foreignDenialLine - 1],
      /for \(const \[attacker, peer\] of \[\[a, b\], \[b, a\]\]\)/);
    assert.match(proof[reviewed.unchangedVictimLine - 1],
      /assertUnchanged\(baseline\.get\(victim\.org\.id\), await snapshot\(victim\.org\.id\)/);
    const workflow = readFileSync(reviewed.workflowFile, "utf8");
    assert.match(workflow, /image: postgres:16/);
    assert.match(workflow, /node --import tsx scripts\/qa\/tenant-approval-task-http\.mjs/);
    assert.match(workflow, /node --test tests\/tenant-approval-task-contract\.test\.mjs tests\/tenant-approval-task-tx-org-scope\.test\.mjs/);
    return;
  }

  // A newly promoted exact-final-head PG16 source pin: preserve the original
  // role/transaction structural guards, plus proof/contract/workflow hash checks.
  if (isNewOrChanged && key === "src/app/api/outbox/route.ts POST") {
    const review = method.testedBy;
    assert.equal(method.status, "COVERED");
    assert.equal(method.reviewedUncertified, undefined);
    assert.equal(currentBlob, "65144a65d42039fbb99f91110e1bc49d79679994", "Do not borrow proof if the source changes");
    assert.equal(review.routeBlobSha, currentBlob);
    assert.equal(review.file, "scripts/qa/tenant-edg02-outbox-http.mjs");
    assert.equal(review.proofBlobSha, "1b1d3a79989f6a1c9aaeba39969ceccc4ce24e92");
    assert.equal(review.workflowFile, ".github/workflows/tenant-edg02-outbox-http.yml");
    assert.equal(review.workflowBlobSha, "a7d6a8ba13726a92575912f8920321f25f999756");
    assert.equal(review.proofHeadSha, "72387977d98c05ad83a8b8affe6732a5de827423");
    assert.equal(review.workflowRunId, 41306939767);
    for (const [file, sha] of [
      [review.file, review.proofBlobSha],
      ["tests/tenant-edg02-outbox-contract.test.mjs", "2e5c879cadea6eca968469f06b730428f003af2b"],
      [review.workflowFile, review.workflowBlobSha],
    ]) assert.equal(gitBlobSha(readFileSync(file)), sha,
      "Credited fictional proof/contract/workflow changed without a new exact-head receipt: " + file);
    const write = readFileSync("src/app/api/outbox/route.ts", "utf8")
      .split("export async function POST(")[1];
    assert.ok(write, "Expected single-family API handler");
    const accessAt = write.indexOf("await getAccess(user.id, organizationId)");
    const messageAt = write.indexOf("await getOutboxMessage(messageId, organizationId)");
    assert.ok(accessAt > 0 && messageAt > accessAt);
    assert.match(write, /roleAllowed\(access\.role, PAYROLL_OPERATOR_ROLES\)/);
    assert.match(write, /if \(body\.mode === "retry-failed-payslips"\)/);
    return;
  }

  // A newly promoted exact-final-head PG16 source pin: preserve the original
  // role/transaction structural guards, plus proof/contract/workflow hash checks.
  if (isNewOrChanged && key === "src/app/api/treasury-controls/route.ts POST") {
    const review = method.testedBy;
    assert.equal(method.status, "COVERED");
    assert.equal(method.reviewedUncertified, undefined);
    assert.equal(currentBlob, "56583ab43e7dc39101bb17122b4e9bdcbbaad81a", "Do not borrow proof if the source changes");
    assert.equal(review.routeBlobSha, currentBlob);
    assert.equal(review.file, "scripts/qa/tenant-mny02-treasury-http.mjs");
    assert.equal(review.proofBlobSha, "06ccd8204c45e93edf9db34fc465e7685b39eb73");
    assert.equal(review.workflowFile, ".github/workflows/tenant-mny02-treasury-http.yml");
    assert.equal(review.workflowBlobSha, "790ff70cdbae22ef9709e7676b2ba99f1244fb4e");
    assert.equal(review.proofHeadSha, "b7ea3bf6ea693b1cbb001060c0d234b86046bd9c");
    assert.equal(review.workflowRunId, 41319237095);
    for (const [file, sha] of [
      [review.file, review.proofBlobSha],
      ["tests/tenant-mny02-treasury-contract.test.mjs", "8bb7f1c442623b6a0952ce28d204d5c8b14bdec0"],
      [review.workflowFile, review.workflowBlobSha],
    ]) assert.equal(gitBlobSha(readFileSync(file)), sha,
      "Credited fictional proof/contract/workflow changed without a new exact-head receipt: " + file);
    const write = readFileSync("src/app/api/treasury-controls/route.ts", "utf8")
      .split("export async function POST(")[1];
    assert.ok(write, "Expected single-family API handler");
    assert.match(write, /await db\.transaction\(async \(tx\) => \{/);
    assert.match(write, /await recordAuditEvent\([\s\S]*\}, tx\);\s*\}\);\s*\} catch \{/);
    assert.match(write, /Treasury controls could not be saved\./);
    return;
  }

  // This exact-source greedy GET receives SOLO_VERIFIED_DEV_RECOVERY four-part
  // coverage after a genuine nonempty owned worker and SQL-fault PG16 run.
  // The earlier zero-credit source review is kept as historical provenance;
  // every tested blob and the owner-only method receipt remain pinned.
  if (isNewOrChanged &&
      key === "src/app/api/workforce/greedy-roster/route.ts GET") {
    const reviewed = method.reviewedUncertified;
    const expected = {
      "kind": "greedy-roster-get-eligible-and-sql-fault-review-only-zero-credit",
      "routeBlobSha": "b04fb6d310bd878934d3a13b42b9caae1c1395bb",
      "proofFile": "scripts/qa/tenant-wrk01-greedy-roster-http.mjs",
      "proofBlobSha": "c7d3595859235be8d9f9de72b60d773361a4cd7b",
      "contractFile": "scripts/qa/tenant-wrk01-greedy-roster-contract.mjs",
      "contractBlobSha": "d20a0a90ece55fb5805829a05a1a64df69155d68",
      "contractTestFile": "tests/tenant-wrk01-greedy-roster-contract.test.mjs",
      "contractTestBlobSha": "2b1cd041d3e502887408a54ccd5e4696b75a8825",
      "workflowFile": ".github/workflows/tenant-wrk01-greedy-roster-http.yml",
      "workflowBlobSha": "ca1ab8248da33a2d1c81d2908a67b43570b9f6a8",
      "lastPassingPg16Run": "41456591968",
      "verifiedPrHeadSha": "9899ba2d08ce717bb3fd284c7d756da9dcc3dc43",
      "coverageCredits": 0,
      "independentSecurityReview": "PENDING",
      "productionCertified": false
    };
    assert.equal(currentBlob, expected.routeBlobSha,
      "Greedy roster source changed; renew exact source and tenant review");
    assert.equal(manifest.allApiRouteFiles[
      "src/app/api/workforce/greedy-roster/route.ts"].gitBlobSha, currentBlob);
    assert.equal(method.status, "COVERED", "Eligible-worker four-part exact-head PG16 GET is required");
    assert.equal(method.testedBy?.file, "scripts/qa/tenant-wrk01-greedy-roster-http.mjs");
    assert.equal(method.testedBy?.workflowRunId, 41447125405);
    assert.equal(method.testedBy?.verifiedPrHeadSha, "8245efd876c38f2b7ba02ece12ac515b8775d6ed");
    assert.equal(method.testedBy?.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY");
    assert.equal(method.testedBy?.ownerReviewer, "@erwinmehehe");
    assert.equal(method.testedBy?.ownerIsOnlyReviewer, true);
    assert.equal(method.testedBy?.independentlyAccepted, false);
    assert.equal(method.testedBy?.routeBlobSha, currentBlob);
    assert.equal(method.testedBy?.proofBlobSha, "c7d3595859235be8d9f9de72b60d773361a4cd7b");
    assert.equal(method.testedBy?.workflowBlobSha, "ca1ab8248da33a2d1c81d2908a67b43570b9f6a8");
    assert.deepEqual(reviewed, expected,
      "Zero-credit source review must not expand or claim security approval");
    for (const [file, sha] of [
      [reviewed.proofFile, reviewed.proofBlobSha],
      [reviewed.contractFile, reviewed.contractBlobSha],
      [reviewed.contractTestFile, reviewed.contractTestBlobSha],
      [reviewed.workflowFile, reviewed.workflowBlobSha],
    ]) assert.equal(gitBlobSha(readFileSync(file)), sha,
      "Greedy roster proof changed; rerun and re-review: " + file);
    const proof = readFileSync(reviewed.proofFile, "utf8");
    for (const anchor of [
      'seedEmployer("ATTA"', 'seedEmployer("ATTB"',
      'seedEmployer("VICTIM"', 'seedEmployer("ELIG"',
      "assertSuggestedGreedyRoster(positiveResponse",
      "const forgedEligible = await read(eligible",
      "source-bound eligible recommendation",
      "cross-unit and stolen-site positive-roster refusals",
      "staffing_requirements_wfm_qa_missing",
      "assertAllUnchanged",
    ]) assert.ok(proof.includes(anchor),
      "Genuine eligible/foreign/SQL fault proof missing: " + anchor);
    const source = readFileSync(
      "src/app/api/workforce/greedy-roster/route.ts", "utf8");
    assert.match(source, /assertOrganizationRole/);
    assert.match(source, /getAccess\(user\.id,organizationId\)/);
    assert.match(source, /error:"Verified staffing evidence could not be loaded\."/);
    assert.ok(!source.includes("error:error instanceof Error?error.message"),
      "No raw SQL/driver error may reach a tenant");
    const workflow = readFileSync(reviewed.workflowFile, "utf8");
    assert.match(workflow, /image: postgres:16/);
    assert.match(workflow, /node --import tsx scripts\/qa\/tenant-wrk01-greedy-roster-http\.mjs/);
    return;
  }

  // Anonymous public payroll quote intake, not a tenant-private API:
  // preserve a zero-credit GAP after a source-reconstructed attribution-only
  // change. This exception cannot be reused by a different route, method,
  // script, source hash or new privacy/security behavior.
  if (isNewOrChanged &&
      key === "src/app/api/payroll-outsourcing/quote/route.ts POST") {
    const routeFile = "src/app/api/payroll-outsourcing/quote/route.ts";
    const originalSha = "0950bcb93b5ab1848e1a58be643ef6696be71222";
    const reviewedSha = "1b4e5363ceeef9ebe30e2dd5657d21482fe1e8a6";
    const contractFile = "tests/marketing-outsourcing-attribution.test.ts";
    const contractSha = "d188e159ca475d793b4b18647da3fde110906e87";
    assert.equal(currentBlob, reviewedSha, "Source drift requires renewed public intake review");
    assert.equal(manifest.allApiRouteFiles[routeFile]?.gitBlobSha, reviewedSha);
    assert.equal(method.name, "POST");
    assert.equal(method.status, "PUBLIC-BY-DESIGN", "Owner-approved public intake classification is not tenant coverage");
    assert.equal(method.publicBoundary?.fourPartMethodCredit, false);
    assert.equal(method.testedBy, null, "No fictional own/victim method proof may be invented");
    assert.match(method.reason, /Owner-approved anonymous/);
    assert.deepEqual(method.reviewedUncertified, {
      kind: "public-outsourcing-attribution-source-only-zero-tenant-credit",
      originalRouteBlobSha: originalSha, routeBlobSha: reviewedSha,
      contractFile, contractBlobSha: contractSha, methodCredits: 0,
      reviewedPublicBoundary: "ANONYMOUS_MARKETING_INTAKE_NOT_TENANT_COVERAGE",
      independentSecurityReview: "PENDING", productionCertified: false,
    }, "Only the exact public intake attribution change may remain uncredited");
    assert.equal(gitBlobSha(readFileSync(contractFile)), contractSha,
      "Attribution/consent source contract changed without review");
    const currentSource = readFileSync(routeFile, "utf8");
    const reverted = currentSource
      .replace('import { sanitizeMarketingAttribution } from "@/lib/marketing-attribution";\n', "")
      .replace('  const attribution = { ...sanitizeMarketingAttribution(body.attribution), ...marketingConsentEvidence() };\n', "")
      .replace('      attribution,\n', '      attribution: marketingConsentEvidence(),\n');
    assert.equal(gitBlobSha(Buffer.from(reverted)), originalSha,
      "Only reviewed attribution sanitization and persistence may change the handler");
    const required = [
      "enforceSameOriginMutation(request)", "rateLimitDistributed(",
      "marketingHoneypotTripped(body)", "enforceIntakeProof(body, email)",
      "hasMarketingEnquiryConsent(body)", "...sanitizeMarketingAttribution(body.attribution)",
      "...marketingConsentEvidence()", 'sourcePath: "/payroll-outsourcing"',
      "attribution,", "recordMarketingLead({",
    ];
    for (const guard of required) assert.ok(currentSource.includes(guard),
      "Public intake lost reviewed consent, anti-abuse or sanitized attribution control: " + guard);
    return;
  }
  // Review-only hold for a changed managed-payroll approval POST. Do not
  // infer method coverage from source tests: two-employer PG16 success,
  // foreign/missing-ID equivalence and race rollback evidence are STILL DUE.
  // This narrowly pinned exception keeps the public inventory complete
  // without silently converting an unproven payroll write into COVERED.
  if (isNewOrChanged &&
      key === "src/app/api/managed-payroll/runs/[id]/approve/route.ts POST") {
    const routeFile = "src/app/api/managed-payroll/runs/[id]/approve/route.ts";
    const oldRouteSha = "a4e228c913470d3996429442ddf04ba4b729b453";
    const fixedRouteSha = "762ea23b45b7edd4070b4e546795ae13d7d2228f";
    assert.equal(currentBlob, fixedRouteSha,
      "Managed-payroll approval changed again; renewed isolation review required");
    assert.equal(manifest.allApiRouteFiles[routeFile]?.gitBlobSha, fixedRouteSha);
    assert.equal(method.status, "GAP",
      "No owned-success and genuine foreign-victim PG16 method proof was accepted");
    assert.equal(method.testedBy, null, "Source contracts alone earn ZERO method credit");
    assert.match(method.reason, /No valid own-object/);
    const review = method.reviewedUncertified;
    assert.deepEqual(review, {
      kind: "managed-payroll-client-approval-active-grant-and-locked-write-zero-credit",
      originalRouteBlobSha: oldRouteSha,
      routeBlobSha: fixedRouteSha,
      grantHelperFile: "src/lib/managed-payroll-client-approval.ts",
      grantHelperBlobSha: "c38fe96066762701eb9771be433f15063b516986",
      fingerprintHelperFile: "src/lib/managed-payroll.ts",
      fingerprintHelperBlobSha: "830124977fdbbb15428f18b3ab5c5c3bb40fbc87",
      contractFile: "tests/managed-payroll-client-approval-scope.test.ts",
      contractBlobSha: "e847f93a55946e5429d7b3baf9455613f0655bb6",
      reviewFile: "docs/qa/tenant-managed-payroll-client-approval-boundary.md",
      reviewBlobSha: "987aec4d1dc055072506221c7408bc84c2a04b3d",
      previousReviewBlobSha: "c150635e0aa37a9619e44e3799b35156fc053a7c",
      methodCredits: 0,
      exactSourcePg16Http: "PENDING_TWO_EMPLOYER_OWN_FOREIGN_AND_TRANSACTION_RACE",
      independentSecurityReview: "PENDING",
      productionCertified: false,
    }, "Only this source-pinned uncredited boundary review is permitted");
    for (const [file, sha] of [
      [review.grantHelperFile, review.grantHelperBlobSha],
      [review.fingerprintHelperFile, review.fingerprintHelperBlobSha],
      [review.contractFile, review.contractBlobSha],
      [review.reviewFile, review.reviewBlobSha],
    ]) assert.equal(gitBlobSha(readFileSync(file)), sha,
      "Managed payroll contract, helpers or review changed: " + file);
    const code = readFileSync(routeFile, "utf8");
    const originalLookup = code.indexOf(".from(payrollRuns)");
    const scopedJoin = code.indexOf(".innerJoin(userOrganizations", originalLookup);
    const engagementRead = code.indexOf(".from(managedPayrollEngagements)", originalLookup);
    const scopedResult = code.indexOf("if (!scopedRun) return runNotFound()");
    assert.ok(originalLookup > 0 && scopedJoin > originalLookup &&
      engagementRead > scopedJoin && scopedResult > originalLookup,
      "Active employer membership must be joined before reading engagement or disclosing a run");
    for (const anchor of [
      'eq(userOrganizations.active, true)',
      'isNull(userOrganizations.orgUnitId)',
      'inArray(userOrganizations.role, ["owner", "admin"])',
      'eq(userOrganizations.userId, user.id)',
      'eq(userOrganizations.organizationId, payrollRuns.organizationId)',
      'eq(payrollRuns.id, runId)',
      'const privateHeaders = { "Cache-Control": "private, no-store" } as const;',
      'const runNotFound = () => Response.json({ error: "Payroll run not found." }, { status: 404, headers: privateHeaders });',
      'requireSensitiveActionMfa(user)',
      'return db.transaction(async (tx) =>',
      'FROM user_organizations',
      'FOR SHARE',
      'FROM managed_payroll_engagements',
      'FROM payroll_runs',
      'FOR UPDATE',
      'activeManagedPayrollClientApprover(user.id, run.organizationId, freshMembership, freshEngagement)',
      'eq(managedPayrollRunApprovals.engagementId, engagement.id)',
      'managedPayrollRunFingerprint(run.id, tx)',
      '}, tx)',
    ]) assert.ok(code.includes(anchor),
      "Managed-payroll approval lost tenant, transaction or private-response guard: " + anchor);
    const transaction = code.indexOf("return db.transaction(async (tx) =>");
    const lockedGrant = code.indexOf("activeManagedPayrollClientApprover(user.id, run.organizationId, freshMembership, freshEngagement)", transaction);
    const write = code.indexOf("tx.update(managedPayrollRunApprovals)", transaction);
    assert.ok(transaction >= 0 && lockedGrant > transaction && write > lockedGrant,
      "Transaction must re-authorize the approver before changing an approval");
    const doc = readFileSync(review.reviewFile, "utf8");
    assert.ok(doc.includes("NO PAYOUT ACTIVATION OR COVERAGE PROMOTION") &&
      doc.includes("two independently authenticated employers") &&
      doc.includes("atomic rollback") &&
      doc.includes("Concurrent checker-evidence revocation remains") &&
      doc.includes("42154187261"),
      "Zero-credit proof hold, disposable HTTP receipt and unproven checker race must remain visible");
    return;
  }


  // A subsequent exact-source GET privacy + POST audit-atomicity hardening
  // remains a GAP with zero new credits. Both isolated PG16 HTTP paths and
  // independent review must be completed before any coverage promotion.
  if (isNewOrChanged &&
      (key === "src/app/api/invitations/accept/route.ts GET" ||
       key === "src/app/api/invitations/accept/route.ts POST") &&
      currentBlob === "7387b8d7cd01c8fb43c155d406b4f8cbcd52f19e") {
    const routeFile = "src/app/api/invitations/accept/route.ts";
    assert.equal(manifest.allApiRouteFiles[routeFile].gitBlobSha, currentBlob);
    if (method.status === "COVERED") {
      assert.equal(verifyInvitationAcceptCredits(manifest), 2,
        "Both executed source-pinned invitation GET/POST receipts must verify");
      return true;
    }
    assert.equal(gitBlobSha(readFileSync("scripts/qa/tenant-invitation-header-source-compat.mjs")),
      "329c50621b5ce5dad4a356a4cac66414300f0d10",
      "Historic proof compatibility guard changed without renewed review");
    assert.equal(method.status, "GAP", "Invitation privacy and audit source review earns no method credit");
    assert.equal(method.testedBy, null, "Only independent executed method proof may earn coverage");
    assert.match(method.reason, /No valid own-object/);
    const review = method.reviewedUncertified;
    assert.deepEqual(review, {
      kind: "invitation-accept-atomic-audit-and-preview-privacy-source-only-zero-credit",
      method: method.name,
      originalRouteBlobSha: "1ce20257f7f3efa9ca380712d4dd485397a06814",
      previousUnitFixOriginalRouteBlobSha: "d4b43c5e474a9e57e7b2d70317e372a43969a4c8",
      routeBlobSha: "7387b8d7cd01c8fb43c155d406b4f8cbcd52f19e",
      proofFile: "scripts/qa/tenant-invitations-accept-http.mjs",
      proofBlobSha: "275139790f149e6b435a189f779b915d62c0af8e",
      contractFile: "tests/tenant-invitations-accept-contract.test.mjs",
      contractBlobSha: "eb0c49c5cb641d3fcaebd888928f0e6e9e853580",
      workflowFile: ".github/workflows/tenant-invitations-accept-http.yml",
      workflowBlobSha: "2349218797c58ab17d9abebe938461f0cabc817a",
      previewProofFile: "scripts/qa/tenant-invitation-preview-get-http.mjs",
      previewProofBlobSha: "4186267e9a163d9b6f49b0ce7dd6330fb19c1848",
      previewContractFile: "tests/tenant-invitation-preview-get-contract.test.mjs",
      previewContractBlobSha: "db954694b11a5421d7bb69cbfeeb1d0711e69173",
      previewWorkflowFile: ".github/workflows/tenant-invitation-preview-get-http.yml",
      previewWorkflowBlobSha: "6d8e5e919ed91ca2eadc490c058405c1a1e5bf5e",
      methodCredits: 0, exactHeadPg16Http: "PENDING",
      independentSecurityReview: "PENDING", productionCertified: false,
    }, "Only the exact uncredited source review and immutable proof inputs are permitted");
    for (const [file, sha] of [
      [review.proofFile, review.proofBlobSha],
      [review.contractFile, review.contractBlobSha],
      [review.workflowFile, review.workflowBlobSha],
      [review.previewProofFile, review.previewProofBlobSha],
      [review.previewContractFile, review.previewContractBlobSha],
      [review.previewWorkflowFile, review.previewWorkflowBlobSha],
    ]) assert.equal(gitBlobSha(readFileSync(file)), sha,
      "Invitation acceptance/preview proof changed without source review: " + file);

    const source = readFileSync(routeFile, "utf8");
    assert.match(source, /"Cache-Control": "no-store, max-age=0"/);
    assert.match(source, /"Referrer-Policy": "no-referrer"/);
    const get = source.split("export async function GET(request: Request) {")[1]
      ?.split("export async function POST(request: Request) {")[0];
    assert.ok(get && get.includes("findUsableInvitation(token)"));
    assert.equal((get.match(/headers: invitationPreviewHeaders/g) ?? []).length, 2,
      "Successful and denied bearer-token previews must share safe response headers");
    const post = source.split("export async function POST(request: Request) {")[1];
    const txAt = post?.indexOf("db.transaction(async (tx) => {") ?? -1;
    const scoped = post?.indexOf("eq(orgUnits.organizationId, invitation.organizationId)", txAt) ?? -1;
    const claimed = post?.indexOf("tx.update(invitations)", scoped) ?? -1;
    const membership = post?.indexOf("tx.insert(userOrganizations)", claimed) ?? -1;
    const audited = post?.indexOf("await recordAuditEvent(", membership) ?? -1;
    const finish = post?.indexOf("return { userId: created.id };", audited) ?? -1;
    assert.ok(txAt >= 0 && scoped > txAt && claimed > scoped &&
      membership > claimed && audited > membership && finish > audited,
      "Unit scope, single-use claim, membership and audit must share one transaction");
    assert.match(post.slice(audited, finish), /}, tx\);/,
      "Acceptance audit must use the same transactional writer");
    assert.equal((post.match(/await recordAuditEvent\(/g) ?? []).length, 1,
      "No detached post-commit audit is permitted");
    return;
  }

  // One source-scoped invitation-acceptance hardening, deliberately zero credit.
  // A previously issued/legacy invitation may carry a foreign or inactive unit.
  // The added pre-claim check refuses it atomically without granting coverage
  // merely because an isolated fixture passes.
  if (isNewOrChanged &&
      (key === "src/app/api/invitations/accept/route.ts GET" ||
       key === "src/app/api/invitations/accept/route.ts POST")) {
    const routeFile = "src/app/api/invitations/accept/route.ts";
    const previous = "d4b43c5e474a9e57e7b2d70317e372a43969a4c8";
    const repaired = "1ce20257f7f3efa9ca380712d4dd485397a06814";
    assert.equal(currentBlob, repaired, "Invite acceptance source drift requires renewed tenant review");
    assert.equal(manifest.allApiRouteFiles[routeFile].gitBlobSha, repaired);
    assert.equal(method.status, "GAP", "No exact-head acceptance evidence is credited");
    assert.equal(method.testedBy, null, "Source review is not a complete method receipt");
    assert.deepEqual(method.reviewedUncertified, {
      kind: "invitation-accept-active-unit-source-boundary-zero-credit",
      method: method.name,
      originalRouteBlobSha: previous, routeBlobSha: repaired,
      proofFile: "scripts/qa/tenant-invitations-accept-http.mjs",
      proofBlobSha: "08df4e136510665fa4d332e4aa736d4a57d806e9",
      contractFile: "tests/tenant-invitations-accept-contract.test.mjs",
      contractBlobSha: "14c880c73049cec6e8edd791e6795ca2187f286f",
      workflowFile: ".github/workflows/tenant-invitations-accept-http.yml",
      workflowBlobSha: "2349218797c58ab17d9abebe938461f0cabc817a",
      methodCredits: 0, exactHeadPg16Http: "PENDING",
      independentSecurityReview: "PENDING", productionCertified: false,
    }, "This specific changed identity route must remain source-pinned and uncredited");
    const review = method.reviewedUncertified;
    for (const [file, sha] of [
      [review.proofFile, review.proofBlobSha],
      [review.contractFile, review.contractBlobSha],
      [review.workflowFile, review.workflowBlobSha],
    ]) assert.equal(gitBlobSha(readFileSync(file)), sha,
      "Invite acceptance proof/contract/workflow changed and must be reviewed: " + file);

    const source = readFileSync(routeFile, "utf8");
    const withUnitImport = 'import { invitations, orgUnits, userOrganizations, users } from "@/db/schema";';
    const originalImport = 'import { invitations, userOrganizations, users } from "@/db/schema";';
    const begin = source.indexOf("      // The invitation is the only authority for the new membership.");
    const end = source.indexOf("      // Claim the single-use invitation inside the same transaction as account", begin);
    const transaction = source.indexOf("db.transaction(async (tx) => {");
    const claim = source.indexOf("tx.update(invitations)", transaction);
    assert.ok(source.includes(withUnitImport) && transaction >= 0 &&
      begin > transaction && end > begin && claim > end,
      "Validating the stored org unit must precede the single-use claim in the same transaction");
    const unitCheck = source.slice(begin, end);
    for (const guard of [
      "if (invitation.orgUnitId !== null)",
      "tx.select({ id: orgUnits.id }).from(orgUnits)",
      "eq(orgUnits.id, invitation.orgUnitId)",
      "eq(orgUnits.organizationId, invitation.organizationId)",
      "eq(orgUnits.active, true)",
      "if (!scopedUnit) return null",
    ]) assert.ok(unitCheck.includes(guard), "Missing scope and active-unit check: " + guard);
    const originalSource = (source.slice(0, begin) + source.slice(end))
      .replace(withUnitImport, originalImport);
    assert.equal(gitBlobSha(Buffer.from(originalSource)), previous,
      "Only the recorded transaction-scoped tenant unit fix may change the route");
    return;
  }

  // Exact-source re-inventory of the ID-only DELETE repair. This does NOT
  // award any *new* coverage; MNY-02 was already provisionally recorded.
  if (isNewOrChanged && key === "src/app/api/de-minimis/route.ts DELETE") {
    const routeFile = "src/app/api/de-minimis/route.ts";
    assert.equal(currentBlob, "e1a3b7cf09ecf1e86f52bc7a642aae2524092a88", "De minimis DELETE source changed; repeat independent review");
    assert.equal(method.status, "COVERED", "Preserve existing provisional MNY-02 receipt, not an added credit");
    const review = method.reviewedUncertified;
    assert.deepEqual(review, {
      "kind": "de-minimis-delete-active-membership-id-boundary-PG16-review-only",
      "originalRouteBlobSha": "afcb1039472fabb166c239c6153b2508e1ea5f57",
      "routeBlobSha": "e1a3b7cf09ecf1e86f52bc7a642aae2524092a88",
      "proofFile": "scripts/qa/tenant-de-minimis-delete-http.mjs",
      "proofBlobSha": "6fdca8169c355e49a32a986dad8a2b123d853f53",
      "contractFile": "tests/tenant-de-minimis-delete-boundary.test.mjs",
      "contractBlobSha": "224ed59a03530680f33ca06788ef4fecf75c75aa",
      "workflowFile": ".github/workflows/tenant-de-minimis-delete-http.yml",
      "workflowBlobSha": "87a8e138d72b77ceedd8b1501a1d91bd923d5615",
      "coverageCredits": 0,
      "exactHeadPg16Http": "PENDING",
      "independentSecurityReview": "PENDING",
      "productionCertified": false
    },
      "New DELETE boundary proof must remain exact-source and uncredited");
    for (const [file, sha] of [
      [review.proofFile, review.proofBlobSha],
      [review.contractFile, review.contractBlobSha],
      [review.workflowFile, review.workflowBlobSha],
    ]) assert.equal(gitBlobSha(readFileSync(file)), sha,
      "De minimis boundary proof/contract/workflow changed: " + file);
    const source = readFileSync(routeFile, "utf8");
    const lookup = source.slice(source.indexOf("async function findActiveMemberGrant("),
      source.indexOf("export async function GET("));
    const deletion = source.slice(source.indexOf("export async function DELETE("));
    for (const token of [
      "innerJoin(userOrganizations, and(",
      "eq(userOrganizations.userId, userId)",
      "eq(userOrganizations.organizationId, deMinimisGrants.organizationId)",
      "eq(userOrganizations.active, true)",
      "eq(deMinimisGrants.id, grantId)",
    ]) assert.ok(lookup.includes(token), "DELETE membership-scoped lookup missing: " + token);
    assert.ok(deletion.indexOf("findActiveMemberGrant(user.id, id)") >= 0 &&
      deletion.indexOf("findActiveMemberGrant(user.id, id)") < deletion.indexOf("assertOrganizationRole("),
      "Validate active grant membership before role-sensitive record exposure");
    for (const token of [
      "Number.isSafeInteger(id)", "eq(deMinimisGrants.id, id)",
      "eq(deMinimisGrants.organizationId, grant.organizationId)",
      'return Response.json({ error: "Grant not found." }, { status: 404 })',
    ]) assert.ok(deletion.includes(token), "Missing scoped update or 404 guard: " + token);
    const priorProof = readFileSync("scripts/qa/tenant-mny02-expenses-benefits-http.mjs", "utf8");
    assert.ok(priorProof.includes('404, "Real victim-only de minimis grant DELETE hidden as not found"'),
      "MNY-02 must expect a non-disclosing 404 for a foreign DELETE");
  }

  if (isNewOrChanged) {
    assert.notEqual(method.status, "GAP",
      key + ": new/changed route must have real cross-tenant proof or a documented public-by-design review");
  }
}

test("whole API manifest inventories exactly every route, exported method, and original blob", () => {
  assert.equal(manifest.baseCommit, BASE);
  assert.equal(baseline.baseCommit, BASE);
  const files = routeFiles();
  const declared = Object.keys(manifest.allApiRouteFiles).sort();
  assert.deepEqual(declared, files,
    "new/removed route files require an explicit method-level isolation manifest review");
  assert.equal(Object.keys(baseline.api).length, 288,
    "original baseline scope is pinned to the audited 288-route snapshot");

  let count = 0;
  let covered = 0;
  let publicByDesign = 0;
  let tokenOnly = 0;
  let gaps = 0;
  for (const path of files) {
    const sourceBytes = readFileSync(path);
    const currentBlob = gitBlobSha(sourceBytes);
    const record = manifest.allApiRouteFiles[path];
    assert.equal(record.gitBlobSha, currentBlob,
      path + ": route changed without re-inventory; update manifest SHA, handlers and proof");
    const currentMethods = methodsIn(sourceBytes.toString("utf8"));
    const declaredMethods = record.methods.map((method) => method.name).sort();
    assert.ok(currentMethods.length > 0, path + ": unsupported/unparsed method exports require review");
    assert.deepEqual(declaredMethods, currentMethods,
      path + ": new or changed exported HTTP method must be inventoried");
    const changed = !baseline.api[path] || baseline.api[path] !== currentBlob;
    for (const method of record.methods) {
      reviewedStatus(method, path + " " + method.name, changed, currentBlob);
      covered += method.status === "COVERED" ? 1 : 0;
      publicByDesign += method.status === "PUBLIC-BY-DESIGN" ? 1 : 0;
      tokenOnly += method.status === "PRIVILEGED-OPERATIONS-TOKEN-ONLY" ? 1 : 0;
      gaps += method.status === "GAP" ? 1 : 0;
      count++;
    }
  }
  assert.equal(files.length, manifest.metrics.routeFiles);
  assert.equal(count, manifest.metrics.methods);
  assert.equal(covered, manifest.metrics.coveredAfter);
  assert.equal(publicByDesign, manifest.metrics.publicByDesign);
  assert.equal(tokenOnly, manifest.metrics.privilegedOperationsTokenOnly);
  assert.equal(gaps, manifest.metrics.gap);
  assert.equal(covered + publicByDesign + tokenOnly + gaps, count);
  assert.equal(manifest.acceptanceStatus.startsWith("NOT ACCEPTED"), true,
    "existing uncovered methods must not be described as accepted");
});

test("manager direct-report GET and page require real two-attacker own/foreign HTTP, not unit membership inference", () => {
  const file = "scripts/qa/hcm-manager-direct-reports-http.mjs";
  const proofLines = readableLines(file);
  const source = proofLines.join("\n");
  const runner = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
  const api = manifest.allApiRouteFiles["src/app/api/hcm/manager-direct-reports/route.ts"];
  const page = manifest.scopedPages.find((row) => row.path ===
    "src/app/hcm/manager-direct-reports/page.tsx");
  assert.equal(api.route, "hcm/manager-direct-reports");
  assert.deepEqual(api.methods.map((method) => method.name), ["GET"]);
  assert.equal(api.methods[0].status, "COVERED");
  assert.equal(page?.status, "COVERED");
  assert.equal(api.methods[0].testedBy?.file, file);
  assert.equal(page.testedBy?.file, file);
  assert.match(proofLines[api.methods[0].testedBy.ownPositiveLine - 1],
    /const ownApi = await requestOn\(API \+ "\?organizationId=" \+ own\.id, cookie\)/);
  assert.match(proofLines[api.methods[0].testedBy.foreignDenialLine - 1],
    /const foreignApi = await requestOn\(API \+ "\?organizationId=" \+ victim\.id, cookie\)/);
  assert.match(proofLines[page.testedBy.ownPositiveLine - 1],
    /const ownPage = await requestOn\(PAGE \+ "\?organizationId=" \+ own\.id, cookie\)/);
  assert.match(proofLines[page.testedBy.foreignDenialLine - 1],
    /const foreignPage = await requestOn\(PAGE \+ "\?organizationId=" \+ victim\.id, cookie\)/);
  assert.match(source, /for \(const idx of \[1, 2\]\)/);
  assert.match(source, /makeSession\(manager\.id, \{ privileged: true \}\)/);
  assert.match(source, /HCM_MANAGER_TEAM_ENABLED: "true"/);
  assert.match(source, /HCM_MANAGER_TEAM_ORG_IDS: f\.orgs\.map/);
  assert.match(source, /directWorkers\[2\]\.id > directWorkers\[0\]\.id/);
  assert.match(source, /assert\.equal\(data\.items\.length, 1/);
  assert.match(source, /assert\.equal\(data\.items\[0\]\.employeeNo, ownWorker\.employeeNo\)/);
  assert.match(source, /assert\.equal\(ownApi\.status, 200/);
  assert.match(source, /assert\.equal\(foreignApi\.status, 403/);
  assert.match(source, /assert\.equal\(ownPage\.status, 200/);
  assert.match(source, /assert\.equal\(foreignPage\.status, 404/);
  assert.match(source, /assert\.equal\(offApi\.status, 404/);
  assert.match(source, /assert\.equal\(blocked\.status, 403/);
  assert.match(source, /victimWorkersBefore, "Denied manager reads must not modify victim employees"/);
  assert.match(source, /victimPayrollBefore, "Denied manager reads must not modify victim payroll"/);
  assert.match(runner, /verifyHcmManagerDirectReports\(f, \{ makeSession \}\)/);
});

test("#1302 verifies actual own/foreign first-payroll and legal-employer HTTP without certifying provider payout", () => {
  const workflow = readFileSync(".github/workflows/draft-1302-tenant-read-proof.yml", "utf8");
  const harness = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
  const testSource = readFileSync("scripts/qa/pr-1302-tenant-proof.mjs", "utf8");
  assert.match(workflow, /FIRST_PAYROLL_INLINE_ENABLED: "true"/);
  assert.match(workflow, /TENANT_1302_FIRST_PAYROLL_PROOF: isolated-ci-only/);
  assert.match(harness, /if \(process\.env\.TENANT_1302_FIRST_PAYROLL_PROOF === "isolated-ci-only"\)/);
  assert.match(harness, /verifyFirstPayrollTenantRead\(f, \{ request, expectStatus \}\)/);
  assert.match(harness, /verifyLegalEmployerTenantMutations\(f, \{ request, expectStatus \}\)/);
  assert.match(testSource, /assert\.deepEqual\(victimProgressAfter, victimProgressBefore/);
  assert.match(testSource, /assert\.deepEqual\(victimLegalAfter, victimLegalBefore/);
  for (const [route, methods] of [
    ["first-payroll/preview", ["GET"]],
    ["first-payroll/progress", ["GET", "PATCH"]],
    ["legal-entities", ["POST", "PATCH"]],
  ]) {
    const record = manifest.allApiRouteFiles["src/app/api/" + route + "/route.ts"];
    for (const name of methods) {
      const method = record.methods.find((item) => item.name === name);
      assert.equal(method?.status, "COVERED");
      assert.equal(method.testedBy?.file, "scripts/qa/pr-1302-tenant-proof.mjs");
      const own = evidenceLine(method.testedBy.file, method.testedBy.ownPositiveLine, route + " own");
      const denied = evidenceLine(method.testedBy.file, method.testedBy.foreignDenialLine, route + " foreign");
      assert.ok(own.includes("expectStatus(await request(") && own.includes("/api/" + route),
        route + " " + name + ": positive must target a real owned route");
      assert.ok(denied.includes("expectStatus(await request(") && denied.includes("/api/" + route),
        route + " " + name + ": denial must target the same route");
      const lines = testSource.split("\n");
      const ownStatus = name === "POST" ? 201 : 200;
      const ownSpan = lines.slice(method.testedBy.ownPositiveLine - 1, method.testedBy.ownPositiveLine + 5).join("\n");
      const deniedSpan = lines.slice(method.testedBy.foreignDenialLine - 1, method.testedBy.foreignDenialLine + 5).join("\n");
      assert.ok(ownSpan.includes("), " + ownStatus + ",") &&
        deniedSpan.includes("), 403,"), route + " " + name + ": must assert successful own and forbidden foreign status");
      if (name === "POST" || name === "PATCH") {
        assert.ok(ownSpan.includes('method: "' + name + '"') &&
          deniedSpan.includes('method: "' + name + '"'), "Mutation proof must use the claimed method");
        const unchanged = evidenceLine(method.testedBy.file, method.testedBy.unchangedDbLine, route + " unchanged");
        assert.match(unchanged, /assert\.deepEqual\(victim(?:Progress|Legal)After, victim(?:Progress|Legal)Before/);
      }
    }
  }
  const payout = manifest.allApiRouteFiles["src/app/api/payroll-runs/[id]/payout-reconciliation/route.ts"]
    .methods.find((item) => item.name === "POST");
  // The earlier provider-disabled 501 hold is superseded, not weakened: that 501 evidence is not used. The method may be COVERED only by
  // the loopback-synthetic PG16 receipt pinned by the dedicated test at the end of this file; it never certifies a real payout.
  assert.equal(payout?.status, "COVERED");
  assert.equal(payout.testedBy?.file, "scripts/qa/paymongo-export-isolation-local.mjs");
  assert.equal(payout.testedBy.providerMode, "loopback-synthetic-paymongo");
  assert.equal(payout.testedBy.moneyMovedByLinaw, false);
  assert.equal(payout.reviewedUncertified, undefined);
  // PII-01 must contribute only two distinct, source-pinned identifier review methods.
  // Its method evidence is independently checked in tenant-pii01-identifiers-source.test.mjs
  // and executed over real isolated PostgreSQL/HTTP; it cannot borrow BIR proof credit.
  const piiReview = manifest.allApiRouteFiles["src/app/api/employee-identifier-requests/route.ts"]?.methods;
  assert.deepEqual(piiReview?.map(method => [method.name, method.status, method.testedBy?.file]), [
    ["GET", "COVERED", "scripts/qa/tenant-pii01-identifier-review-http.mjs"],
    ["POST", "COVERED", "scripts/qa/tenant-pii01-identifier-review-http.mjs"],
  ], "Only the separate GET and POST identifier review proofs add provisional method credits");
  assertLiveTenantCounts(assert, manifest);
});

test("group reports use three genuine tenant readers and refuse foreign legal employer attribution", () => {
  const path = "src/app/api/multi-entity/reports/route.ts";
  const method = manifest.allApiRouteFiles[path].methods.find(item => item.name === "GET");
  assert.equal(method?.status, "COVERED");
  assert.equal(method.testedBy?.file, "scripts/qa/multi-entity-group-report-http.mjs");
  const proof = method.testedBy;
  assert.match(evidenceLine(proof.file, proof.ownPositiveLine, "group own GET"),
    /const ownReport = await request\(caller, on, "\/api\/multi-entity\/reports/);
  assert.match(evidenceLine(proof.file, proof.foreignDenialLine, "group foreign GET"),
    /assert\.equal\(deniedVictim\.status, 403/);
  assert.match(readFileSync(proof.file, "utf8"),
    /const deniedVictim = await request\(caller, on, "\/api\/multi-entity\/reports/);
  const harness = readFileSync(proof.file, "utf8");
  assert.match(harness, /"entity-attacker-b@example\.test"/);
  assert.match(harness, /"entity-attacker-c@example\.test"/);
  assert.match(harness, /bVictims\.rows\.length >= 5/);
  assert.match(harness, /assert\.equal\(ownReport\.status, 200/);
  assert.match(harness, /assert\.equal\(deniedVictim\.status, 403/);
  assert.match(harness, /assert\.equal\(refused\.status, 409/);
  assert.match(harness, /assert\.equal\(refusedReleasedRun\.status, 409/);
  assert.match(harness, /assert\.equal\(afterReleasedTest\.status, 200/);
  assert.match(harness, /assert\.deepEqual\(intact\.rows, untouchedVictim\.rows/);
  const route = readFileSync(path, "utf8");
  assert.match(route, /groupReportHasUnattributedRows/);
  assert.match(route, /ENTITY_ATTRIBUTION_REQUIRED/);
  const runner = readFileSync("scripts/multi-entity-synthetic-browser.mjs", "utf8");
  assert.match(runner, /verifyMultiEntityReportTenantIsolation\(/);
  assert.match(runner, /\.\/qa\/multi-entity-group-report-http\.mjs/);
  const workflow = readFileSync(".github/workflows/multi-entity-browser-qa.yml", "utf8");
  assert.match(workflow, /MULTI_ENTITY_ENABLED: "true"/);
  assert.match(workflow, /node scripts\/multi-entity-synthetic-browser\.mjs/);
  // These source pins never replace executed CI and independent security review.
});

test("#641 correction cases prove own success, victim denial and unchanged victim rows over real HTTP", () => {
  const workflow = readFileSync(".github/workflows/salary-correction-cases-qa.yml", "utf8");
  const harness = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
  const file = "scripts/qa/salary-correction-case-tenant-proof.mjs";
  const lines = readFileSync(file, "utf8").split("\n");
  assert.match(workflow, /HCM_SALARY_CORRECTION_CASES_ENABLED: "true"/);
  assert.match(workflow, /TENANT_641_SALARY_CORRECTION_CASE_PROOF: isolated-ci-only/);
  assert.match(workflow, /PAYROLL_UNDERPAYMENT_POSTING_ENABLED: "false"/);
  assert.match(harness, /if \(process\.env\.TENANT_641_SALARY_CORRECTION_CASE_PROOF === "isolated-ci-only"\) await/);
  assert.match(harness, /verifySalaryCorrectionCaseTenantIsolation\(f, \{ request, expectStatus \}\)/);
  assert.match(lines.join("\n"), /process\.env\.TENANT_SECOND_PASS_MODE, "isolated-ci-only"/);
  assert.match(lines.join("\n"), /for \(const idx of \[1, 2\]\)/);
  const record = manifest.allApiRouteFiles["src/app/api/hcm/salary-corrections/cases/route.ts"];
  for (const [name, ownStatus] of [["GET", 200], ["POST", 201], ["PATCH", 200]]) {
    const method = record.methods.find((item) => item.name === name);
    assert.equal(method?.status, "COVERED");
    assert.equal(method.testedBy?.file, file);
    const ownSpan = lines.slice(method.testedBy.ownPositiveLine - 1, method.testedBy.ownPositiveLine + 2).join("\n");
    const deniedSpan = lines.slice(method.testedBy.foreignDenialLine - 1, method.testedBy.foreignDenialLine + 3).join("\n");
    assert.ok(ownSpan.includes("expectStatus(await request(\"/api/hcm/salary-corrections/cases") && ownSpan.includes("), " + ownStatus + ","),
      name + ": positive must be a successful request to the claimed route");
    assert.ok(deniedSpan.includes("expectStatus(await request(\"/api/hcm/salary-corrections/cases") && deniedSpan.includes("victim.id") &&
      deniedSpan.includes("), 403,"), name + ": denial must name the real victim employer and assert 403");
    if (name !== "GET") {
      assert.ok(ownSpan.includes('method: "' + name + '"') && deniedSpan.includes('method: "' + name + '"'),
        "Mutation proof must use the claimed method");
      assert.match(lines[method.testedBy.unchangedDbLine - 1], /assert\.deepEqual\(victimCasesAfter, victimCasesBefore/);
    }
  }
  assert.match(lines.join("\n"), /assert\.deepEqual\(victimCaseRunsAfter, victimCaseRunsBefore/);
  assert.match(lines.join("\n"), /assert\.deepEqual\(victimAuditAfter, victimAuditBefore/);
});

test("DL-02 proofs distinguish cross-tenant denials from employee membership revocation", () => {
  const workflow = readFileSync(".github/workflows/tenant-dl02-qa.yml", "utf8");
  const harness = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
  const file = "scripts/qa/tenant-dl02-http.mjs";
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  assert.match(workflow, /TENANT_DL02_PROOF: isolated-ci-only/);
  assert.match(workflow, /MULTI_ENTITY_ENABLED: "false"/);
  assert.match(harness, /if \(process\.env\.TENANT_DL02_PROOF === "isolated-ci-only"\) await \(await import\("\.\/tenant-dl02-http\.mjs"\)\)\.verifyDl02TenantIsolation\(f, \{ request, expectStatus, makeSession \}\)/);
  assert.match(source, /process\.env\.TENANT_SECOND_PASS_MODE, "isolated-ci-only"/);
  assert.match(source, /for \(const idx of \[1, 2\]\)/);
  assert.match(source, /Victim-only DL02 ID must really exist and exceed 6 and both attacker object IDs/);
  assert.match(source, /assert\.deepEqual\(victimAfter, victimBefore/);
  // Do not revert to VICTIM-first fixtures: the real seeded victim target IDs
  // must exceed BOTH attacker-owned IDs, not merely a fixed sequence floor.
  const attackerSeed = source.indexOf('for (const label of ["ATTA", "ATTB"])');
  const actualOwnPost = source.indexOf("const ownSavedPost = expectStatus");
  const victimSeed = source.indexOf('const victim = await seedEmployer("VICTIM"');
  assert.ok(attackerSeed >= 0 && attackerSeed < actualOwnPost && actualOwnPost < victimSeed,
    "Both attacker employers and real own saved-report POSTs must precede the victim");
  assert.match(source, /attackerIds\.every\(\(ownId\) => Number\.isSafeInteger\(ownId\) && victimId > ownId\)/);
  assert.match(source, /persisted, \{ id: victimId, organizationId: victim\.org\.id \}/);
  for (const type of ["decisions", "terms", "employees", "payrollRuns",
    "payrollEntries", "performanceCycles", "performanceReviews"]) {
    assert.ok(source.includes(type + ": await db.select"),
      "Victim snapshot must include persisted " + type + " state");
  }
  assert.match(source, /const ownPeople = await db\.select/);
  assert.match(source, /assert\.notEqual\(ownHeadcount, victimHeadcount/);
  assert.match(source, /HCM report output must match real seeded own-employer employees/);
  assert.match(source, /Report builder must return all actual own employees in ID order/);
  assert.match(source, /performanceCycle\.id/);
  assert.match(source, /performanceReview\.id/);
  assert.match(source, /Export evidence identity hash must match actual content/);
  assert.match(source, /The download SHA256 response header must match real exported evidence/);
  // Revoked-membership denials must follow a real own success with the same session.
  assert.ok(source.indexOf("const ownPhotoGet = expectStatus") < source.indexOf("set({ active: false })") &&
    source.indexOf("set({ active: false })") < source.indexOf("Former employee photo GET denied"));
  const revokedOnly = new Set([
    "src/app/api/self/contribution-evidence/route.ts GET",
    "src/app/api/self/photo/route.ts GET",
    "src/app/api/self/photo/route.ts HEAD",
    "src/app/api/self/photo/route.ts DELETE",
  ]);
  let revokedCount = 0;
  let count = 0;
  for (const [path, record] of Object.entries(manifest.allApiRouteFiles)) {
    for (const method of record.methods) {
      if (method.testedBy?.file !== file) continue;
      count += 1;
      const key = path + " " + method.name;
      assert.equal(method.status, "COVERED", key);
      const own = lines[method.testedBy.ownPositiveLine - 1] ?? "";
      const ownSpan = lines.slice(method.testedBy.ownPositiveLine - 1, method.testedBy.ownPositiveLine + 3).join("\n");
      const deniedSpan = lines.slice(method.testedBy.foreignDenialLine - 1, method.testedBy.foreignDenialLine + 3).join("\n");
      assert.match(own, /const own[A-Za-z]+ = expectStatus\(await request\("\/api\//, key + ": own positive must be a real request");
      assert.ok(own.includes("/api/" + record.route.split("/[")[0]), key + ": own positive must target the claimed route");
      assert.match(ownSpan, /\), 20[01],/, key + ": own positive must assert success");
      assert.match(lines[method.testedBy.foreignDenialLine - 1], /expectStatus\(await request\("\/api\//, key + ": denial must be a real request");
      assert.ok(/\), 40[34],/.test(deniedSpan), key + ": denial must assert exact 403 or 404");
      assert.ok(/victim\.|Former employee/.test(deniedSpan), key + ": denial must name a real victim object or revoked membership");
      if (revokedOnly.has(key)) {
        revokedCount++;
        assert.equal(method.testedBy.denialKind, "same-session-revoked-membership",
          key + ": label same-session revocation instead of claiming a forged victim ID");
        assert.match(method.reason, /same signed-in session receives 403 after that employee's active employer membership is revoked/,
          key + ": the reason must describe the real route-specific denial");
        assert.match(deniedSpan, /Former employee/,
          key + ": the negative HTTP request must be the revoked employee's own session");
      } else {
        assert.equal(method.testedBy.denialKind, undefined,
          key + ": ordinary foreign-employer/object proof must not be labeled session revocation");
        const ordering = method.testedBy.victimIdOrderingLine;
        assert.ok(Number.isSafeInteger(ordering), key + ": missing real victim-versus-attacker ordering line");
        assert.match(lines[ordering - 1],
          /Victim-only DL02 ID must really exist and exceed 6 and both attacker object IDs/,
          key + ": victim ID ordering must compare both actual attackers");
      }
      if (new Set(["hcm-report-builder GET", "reports/builder GET"]).has(record.route + " " + method.name)) {
        assert.equal(method.testedBy.positiveKind, "authorized-tenant-gated-field-catalog",
          key + ": do not mislabel GET field metadata as owned rows");
        assert.match(lines[method.testedBy.catalogAssertionLine - 1], /headcount/,
          key + ": require nonempty authorized field catalog assertion");
      }
      if (new Set(["hcm-report-builder POST", "reports/builder POST"]).has(record.route + " " + method.name)) {
        assert.equal(method.testedBy.positiveKind, "owned-nonempty-employee-report",
          key + ": require real seeded own-employee data");
        assert.match(lines[method.testedBy.contentAssertionLine - 1],
          /HCM report output must match real seeded own-employer employees|Report builder must return all actual own employees in ID order/,
          key + ": positive report must check real owned content, not merely column names");
      }
      if (record.route === "performance/evidence" && method.name === "GET") {
        assert.equal(method.testedBy.positiveKind, "scoped-json-download-verified-hashes",
          key + ": performance download must validate real own JSON and hashes");
        assert.match(lines[method.testedBy.contentAssertionLine - 1],
          /Export evidence identity hash must match actual content/,
          key + ": verify actual downloaded evidence identity hash");
      }
      if (["POST", "PATCH", "PUT", "DELETE", "HEAD"].includes(method.name)) {
        assert.ok(ownSpan.includes('method: "' + method.name + '"') && deniedSpan.includes('method: "' + method.name + '"'),
          key + ": proof must use the claimed method");
      }
      if (["POST", "PATCH", "PUT", "DELETE"].includes(method.name)) {
        assert.match(lines[method.testedBy.unchangedDbLine - 1], /assert\.deepEqual\(victimAfter, victimBefore/);
      }
    }
  }
  assert.equal(revokedCount, 4, "Four self-service methods prove same-session membership revocation");
  assert.equal(count, 19, "Nineteen DL-02 part-1 methods are credited; the rest stay GAP");
});

test("new dashboard, employee-directory and payroll-list coverage cites executable own/foreign HTTP proof", () => {
  // Tests are actually run in disposable PG16 by Security HTTP Smoke; this
  // inventory assertion stops a future manifest edit from substituting an
  // anonymous probe or a line that does not exercise the claimed route.
  for (const [route, ownToken, denialToken] of [
    ["dashboard", "const ownDashboard = expectStatus", "expectStatus(await request"],
    ["employees", "const ownDirectory = expectStatus", "expectStatus(await request"],
    ["payroll-runs", "const ownRunList = expectStatus", "expectStatus(await request"],
  ]) {
    const key = "src/app/api/" + route + "/route.ts";
    const method = manifest.allApiRouteFiles[key]?.methods.find((item) => item.name === "GET");
    assert.equal(method?.status, "COVERED", key + ": proof must remain classified");
    const proof = method.testedBy;
    assert.equal(proof?.file, "scripts/qa/tenant-second-pass-http.mjs", key + ": not a real HTTP harness");
    const positive = evidenceLine(proof.file, proof.ownPositiveLine, key + " own-positive");
    const negative = evidenceLine(proof.file, proof.foreignDenialLine, key + " foreign-denial");
    assert.ok(positive.includes(ownToken) && positive.includes('"/api/' + route + '?') &&
      positive.includes(", 200,"), key + ": missing own-tenant HTTP 200 control");
    assert.ok(negative.includes(denialToken) && negative.includes('"/api/' + route + '?') &&
      negative.includes("victim.id") && negative.includes(", 403,"),
      key + ": missing actual victim-tenant denied HTTP request");
  }
  const source = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
  assert.match(source, /f\.victimRun\.id \+ "&include=entries".*\{ cookie: attackerCookie \}\), 403/,
    "The payroll run read must also deny a direct victim-only register ID");
});

test("reconciled main hashes retain documented GAPs without inventing authorization proof", () => {
  // Main updated HR Inbox metadata and Payroll Register response metadata after
  // the original inventory. Those pre-existing changes require re-inventory,
  // not new COVERED claims or broad exemptions from the source fingerprint.
  for (const route of ["attendance/offline-claims", "web-bundy/review"]) {
    const path = "src/app/api/" + route + "/route.ts";
    assert.equal(manifest.allApiRouteFiles[path].gitBlobSha, baseline.api[path],
      path + ": the reviewed main source and active inventory SHA must match");
  }
  const hr = manifest.allApiRouteFiles["src/app/api/hr-cases/route.ts"];
  assert.ok(hr.methods.every((method) => method.status === "COVERED" && method.testedBy),
    "HR methods require the new executed HTTP controls, not hash refresh alone");
  const payroll = manifest.allApiRouteFiles["src/app/api/payroll-runs/route.ts"];
  assert.equal(payroll.methods.find((method) => method.name === "POST")?.status, "COVERED",
    "Payroll draft creation requires executed own/foreign HTTP and unchanged-victim proof");
  assert.equal(payroll.methods.find((method) => method.name === "GET")?.status, "COVERED",
    "Retain the real three-employer HTTP GET proof, subject to current-head CI");
  const bundy = manifest.allApiRouteFiles["src/app/api/web-bundy/review/route.ts"];
  assert.equal(bundy.methods.length, 2);
  for (const method of bundy.methods) verifyClockCredit(method.name + " web-bundy/review", method);
  const offline = manifest.allApiRouteFiles["src/app/api/attendance/offline-claims/route.ts"];
  const offlineRead = offline.methods.find((method) => method.name === "GET");
  assert.equal(offlineRead?.status, "COVERED", "Offline read requires the executed employer-scoped proof");
  assert.equal(offlineRead?.testedBy?.rowFile, "scripts/qa/tenant-table-rows/read/offline-claims.mjs");
  for (const verb of ["POST", "PATCH"]) {
    const method = offline.methods.find(item => item.name === verb);
    assert.equal(method?.status, "COVERED", verb + " requires its own executed SQL/HTTP proof");
    assert.equal(method?.testedBy?.file, "scripts/qa/tenant-offline-claims-http.mjs");
    assert.equal(method?.testedBy?.prNumber, 1494);
    for (const field of ["ownPositiveLine", "foreignDenialLine", "unchangedDbLine", "forgedSelectorLine"]) {
      assert.ok(method?.testedBy?.[field] > 0, verb + " needs " + field);
    }
  }
});

test("extended three-employer reads and asset writes have checkable method-specific proof", () => {
  const source = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8").split("\n");
  for (const [route, method, ownStatus, expectedToken] of [
    ["assets", "GET", 200, "ownAssetsResult"],
    ["assets", "POST", 201, "ownCreatedAsset"],
    ["assets", "PATCH", 200, "ownPatchedAsset"],
    ["assets", "DELETE", 200, "ownDeletedAsset"],
    ["approval-chains", "GET", 200, "ownApprovalsResult"],
    ["leave/balances", "GET", 200, "ownLeaveResult"],
    ["compliance/calendar", "GET", 200, "ownComplianceResult"],
    ["documents", "GET", 200, "ownDocumentsResult"],
  ]) {
    const key = "src/app/api/" + route + "/route.ts";
    const entry = manifest.allApiRouteFiles[key].methods.find((item) => item.name === method);
    assert.equal(entry?.status, "COVERED", key + " " + method + ": requires positive/negative evidence");
    const proof = entry.testedBy;
    assert.equal(proof?.file, "scripts/qa/tenant-second-pass-http.mjs",
      key + " " + method + ": fixture must be real disposable-PostgreSQL HTTP");
    const ownLine = evidenceLine(proof.file, proof.ownPositiveLine, key + " " + method + " own-positive");
    const foreignLine = evidenceLine(proof.file, proof.foreignDenialLine, key + " " + method + " victim denial");
    const ownSpan = source.slice(proof.ownPositiveLine - 1, proof.ownPositiveLine + 6).join("\n");
    const foreignSpan = source.slice(proof.foreignDenialLine - 1, proof.foreignDenialLine + 5).join("\n");
    assert.ok(ownLine.includes("const " + expectedToken + " = expectStatus") &&
      ownLine.includes('"/api/' + route) &&
      ownSpan.includes("cookie: attackerCookie") &&
      ownSpan.includes("), " + ownStatus + ","),
      key + " " + method + ": own-side request needs real successful scoped data");
    assert.ok(foreignLine.includes('expectStatus(await request("/api/' + route) &&
      foreignSpan.includes("cookie: attackerCookie") &&
      foreignSpan.includes("), 403,") &&
      (foreignSpan.includes("victim.id") || foreignSpan.includes("f.syntheticAssets[7].id")),
      key + " " + method + ": denial must name a real victim organization/object");
    if (method !== "GET") {
      assert.equal(method === "POST" || method === "PATCH" || method === "DELETE", true);
      const invariant = evidenceLine(proof.file, proof.unchangedDbLine, key + " " + method + " unchanged victim data");
      assert.ok(invariant.includes("assert.deepEqual(victimAssetsAfter, victimAssetsBefore"),
        key + " " + method + ": cross-tenant asset write must leave victim DB unchanged");
    }
  }
});


test("new sensitive download, legal-employer, leave mutation, and ESS proofs are real", () => {
  // The HTTP suite executes with actual seeded PostgreSQL rows and two
  // independent attackers. These assertions disallow a future manifest edit
  // from citing only an invalid ID, unrelated route, or anonymous 401.
  const source = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8").split("\n");
  const cases = [
    { route: "documents/[id]", method: "GET", own: "ownDocumentDownload",
      prefix: "/api/documents/", success: 200, deny: 404 },
    { route: "legal-entities", method: "GET", own: "ownLegalEntities",
      prefix: "/api/legal-entities", success: 200, deny: 403 },
    { route: "leave/balances", method: "POST", own: "ownLeavePolicy",
      prefix: "/api/leave/balances", success: 201, deny: 403 },
    { route: "self/payslips/[id]", method: "GET", own: "ownPayslipPdf",
      prefix: "/api/self/payslips/", success: 200, deny: 404 },
    { route: "self/payslips", method: "GET", own: "ownSelfService",
      prefix: "/api/self/payslips", success: 200, deny: null },
  ];
  for (const spec of cases) {
    const path = "src/app/api/" + spec.route + "/route.ts";
    const method = manifest.allApiRouteFiles[path]?.methods.find((m) => m.name === spec.method);
    assert.equal(method?.status, "COVERED", path + " " + spec.method + " must retain own/victim proof");
    const proof = method.testedBy;
    assert.equal(proof?.file, "scripts/qa/tenant-second-pass-http.mjs");
    const own = evidenceLine(proof.file, proof.ownPositiveLine, path + " own");
    const negative = evidenceLine(proof.file, proof.foreignDenialLine, path + " foreign");
    const ownSpan = source.slice(proof.ownPositiveLine - 1, proof.ownPositiveLine + 7).join("\n");
    const denySpan = source.slice(proof.foreignDenialLine - 1, proof.foreignDenialLine + 5).join("\n");
    assert.ok(own.includes("const " + spec.own + " = expectStatus") &&
      own.includes(spec.prefix) && ownSpan.includes("), " + spec.success + ","),
      path + ": positive proof requires the exact route and successful method");
    if (spec.deny !== null) {
      assert.ok(negative.includes("expectStatus(await request(") &&
        negative.includes(spec.prefix) && denySpan.includes("), " + spec.deny + ","),
        path + ": denial must use the exact route and status");
    } else {
      assert.ok(negative.includes("ownOnly(ownSelfService.json?.payslips") &&
        denySpan.includes("victimEntry.id") && denySpan.includes("coworkerEntry.id"),
        "Self-service list requires non-empty own entry and exclusion of victim and coworker");
      assert.match(ownSpan, /victim\.id/,
        "Self-service scope must ignore a forged client-supplied victim organizationId");
    }
    if (spec.method === "POST") {
      const invariant = evidenceLine(proof.file, proof.unchangedDbLine, "leave policy invariant");
      assert.match(invariant, /assert\.deepEqual\(victimLeavePoliciesAfter, victimLeavePoliciesBefore/,
        "Mutating proof requires actual unchanged victim PostgreSQL rows");
    }
  }
  const script = source.join("\n");
  assert.match(script, /for \(const idx of \[1, 2\]\)/,
    "Both independent attacker sessions must exercise these methods");
  assert.match(script, /"SYNTHETIC-COWORKER-PRIVATE-"/,
    "Same-employer employee-level isolation requires a separately seeded coworker document");
  assert.match(script, /employeeCookie[\s\S]*coworkerEntry\.id/,
    "Employee role must deny same-employer coworker payslip");
  assert.match(script, /"payroll register"/,
    "Employee role must not open privileged payroll registers");
  assert.match(script, /await verifySensitiveTenantDownloadsAndRoles\(f\)/,
    "Standalone uncalled helper is not executable evidence");
});


test("self-service PDF cannot outlive former-employer membership", () => {
  // Integrity checks only: the real-HTTP and unchanged-DB proof runs through
  // the existing three-employer Security HTTP Smoke CI, not mocked checks.
  const route = "src/app/api/self/payslips/[id]/route.ts";
  const method = manifest.allApiRouteFiles[route].methods.find((m) => m.name === "GET");
  assert.equal(method?.status, "COVERED");
  const source = readFileSync(route, "utf8");
  const guardCall = "const membershipDenied = await assertMembership(session.id, employee.organizationId);";
  assert.match(source, /import \{ assertMembership \} from "@\/lib\/access";/);
  const guardAt = source.indexOf(guardCall);
  assert.ok(guardAt > source.indexOf("if (!employee) return Response.json"),
    "Guard must use the actual employee's employer");
  assert.ok(guardAt < source.indexOf("db.select().from(organizations)") &&
    guardAt < source.indexOf("renderPayslipPdf("),
    "Active employer grant must be checked before loading identity or returning PDF bytes");
  assert.ok(source.slice(guardAt, guardAt + 240).includes("if (membershipDenied) return membershipDenied;"));
  assert.equal(source.split("\n")[method.testedBy.currentMembershipGuardLine - 1].trim(), guardCall);
  assert.equal(method.testedBy.file, "scripts/qa/tenant-second-pass-http.mjs");
  const own = evidenceLine(method.testedBy.file, method.testedBy.ownPositiveLine,
    "Audit own Released PDF");
  assert.ok(own.includes("const ownPayslipPdf = expectStatus") && own.includes("/api/self/payslips/"),
    "Audit employee must actually receive own employer's PDF");
  const mainOwn = evidenceLine(method.testedBy.file, method.testedBy.staleMembershipOwnPositiveLine,
    "Canonical merged #1283 own PDF");
  assert.ok(mainOwn.includes('const ownedPdf = expectStatus(await request("/api/self/payslips/" + ownEntry.id'),
    "Use canonical merged #1283 own-payroll positive, not a placeholder");
  const scriptLines = readFileSync(method.testedBy.file, "utf8").split("\n");
  const ownSpan = scriptLines.slice(method.testedBy.staleMembershipOwnPositiveLine - 1,
    method.testedBy.staleMembershipOwnPositiveLine + 6).join("\n");
  assert.ok(ownSpan.includes("cookie: employeeCookie") &&
    ownSpan.includes("}), 200,") && ownSpan.includes("%PDF-"),
    "Canonical positive control must contain real PDF bytes with exact 200");
  const live = evidenceLine(method.testedBy.file, method.testedBy.staleSessionOwnPositiveLine,
    "Same still-signed-in employee account after employer change");
  assert.ok(live.includes('const stillSignedIn = expectStatus(await request("/api/account"'),
    "The same session must authenticate after old employer membership revocation");
  const negative = evidenceLine(method.testedBy.file, method.testedBy.staleMembershipForeignDenialLine,
    "Former-employer PDF denial");
  assert.ok(negative.includes('const revokedPdf = expectStatus(await request("/api/self/payslips/" + ownEntry.id'),
    "Revoked-member negative control must target the exact previously readable PDF");
  const negSpan = scriptLines.slice(method.testedBy.staleMembershipForeignDenialLine - 1,
    method.testedBy.staleMembershipForeignDenialLine + 4).join("\n");
  assert.ok(negSpan.includes("cookie: employeeCookie") && negSpan.includes("}), 403,"),
    "Denial must be exact 403; anonymous 401 and made-up 404 do not qualify");
  const invariant = evidenceLine(method.testedBy.file,
    method.testedBy.staleMembershipUnchangedDbLine, "Unchanged old payroll after denial");
  assert.match(invariant, /assert\.deepEqual\(afterDeniedPdf, beforeDeniedPdf/,
    "Denied PDF must leave the old employer payroll row unchanged");
  const script = scriptLines.join("\n");
  assert.match(script, /assert\.equal\(revoked\?\.active, false,/,
    "Actually revoke original employer membership in disposable PostgreSQL");
  assert.match(script, /assert\.equal\(stillMember\?\.active, true,/,
    "Keep new employer membership active so a logged-out 401 cannot false-pass");
  assert.match(script, /assert\.equal\(stillSignedIn\.json\?\.profile\?\.id, essUser\.id,/,
    "Post-revocation 200 must belong to the same employee account");
  assert.ok(script.indexOf("const ownedPdf = expectStatus") <
      script.indexOf("await db.update(userOrganizations).set({ active: false })") &&
      script.indexOf("await db.update(userOrganizations).set({ active: false })") <
      script.indexOf("const revokedPdf = expectStatus"),
    "The real own PDF must precede actual revocation, then be denied");
  assert.match(script, /await verifyRevokedEmployerPayslipAccess\(f\)/,
    "Canonical merged #1283 regression must run, not merely be defined");
  assert.match(script, /await verifySensitiveTenantDownloadsAndRoles\(f\)/,
    "Additional audit method-level proofs must continue running");
});

test("all credited proof links point to the claimed route and every recertified write has controls", () => {
  const source = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8").split("\n");
  for (const [path, entry] of Object.entries(manifest.allApiRouteFiles)) {
    const routeFragments = ("/api/" + entry.route).split(/\[[^\]]+\]/).filter(Boolean);
    for (const method of entry.methods) {
      if (method.status !== "COVERED") continue;
      if(spendManagedTargets.includes(method.name+" "+manifest.allApiRouteFiles[path].route)){ assert.equal(verifySpendManaged(manifest),3); continue; }
      const proof = method.testedBy;
      if (SECURITY_TARGETS.some(t=>t.path===path&&t.method===method.name)) {assert.equal(verifySecurityCredits(manifest),3);continue;}
      if (RECOVERY_TARGETS.some(t => t.path === path && t.method === method.name)) {
        assert.equal(verifyRecoveryCredits(manifest), 3);
        continue;
      }
      if (["src/app/api/billing/subscription/start/route.ts",
           "src/app/api/billing/subscription/cancel/route.ts"].includes(path) && method.name === "POST") {
        assert.equal(verifyBillingSubscriptionCredits(manifest), 2,
          "Both billing POST methods need exact owned/foreign/unchanged receipts");
        continue;
      }
      // Scope-locked to the separately sealed, source-pinned request-initiation proof.
      // Do not broaden the general evidence-source allowlist.
      if (path === "src/app/api/account/email/route.ts" && method.name === "POST") {
        assert.equal(verifyAccountEmailRequestCredit(manifest), 1);
        continue;
      }
      if (path === "src/app/api/account/email/verify/route.ts" && method.name === "POST") {
        assert.equal(verifyEmailCredit(manifest, JSON.parse(readFileSync("scripts/qa/tenant-email-verification-credit-receipt.json", "utf8"))), 1);
        continue;
      }
      if (path === "src/app/api/migrations/route.ts" && method.name === "POST") {
        assert.equal(verifyMigrationPostCredit(manifest), 1);
        continue;
      }
      if (path === "src/app/api/enterprise/route.ts" && method.name === "POST") {
        assert.equal(verifyEnterprisePostCredit(manifest), 1);
        continue;
      }
      if (path === "src/app/api/workforce-planning/route.ts" && ["POST","PATCH"].includes(method.name)) {
        assert.equal(verifyRootCredits(manifest),2);
        continue; // Exact receipt and row/own/foreign/unchanged anchors are validated together.
      }
      if (proof?.file === "scripts/qa/tenant-clock-http.mjs") {
        verifyClockCredit(method.name + " " + entry.route, method);
        const workflow = readFileSync(".github/workflows/tenant-clock-lifecycle.yml", "utf8");
        assert.match(workflow, /image: postgres:16/);
        assert.match(workflow, /env -u NODE_ENV node --import tsx scripts\/qa\/tenant-clock-http.mjs/);
        continue; // Five exact source-bound methods, never the older one-action receipt.
      }
      if (proof?.file === "scripts/qa/tenant-onboarding-http.mjs") {
        verifyOnboardingCredit(method.name + " " + entry.route, method);
        const workflow = readFileSync(".github/workflows/tenant-onboarding-http.yml", "utf8");
        assert.match(workflow, /profile: \[legacy, preview\]/);
        assert.match(workflow, /image: postgres:16/);
        assert.match(workflow, /env -u NODE_ENV node --import tsx scripts\/qa\/tenant-onboarding-http.mjs/);
        continue; // Exactly four executed, source-bound methods; not a generic allowlist.
      }
      if (proof?.verifiedMainCommit === "5a3c209dffb2198e8944d0781025c42b117024b0") {
        assert.equal(verifyPost1523Credits(manifest), 3);
        continue; // Exactly three independently source-pinned methods.
      }
      if (proof?.verifiedMainCommit === "a7dc1f5184f59f3c5ac348e37b4ca88810f10651") {
        assert.equal(verifyPromotionCredits(manifest), 16);
        continue;
      }
      if (proof?.verifiedMainCommit === "dd890dd65f14a3a508ef5df7227fd84655c21fcd") {
        // Exactly six reviewed routes and source/receipt blobs are pinned by
        // the dedicated validator; this is not an arbitrary new source bypass.
        assert.equal(verifyFollowOnCredits(manifest), 6);
        continue;
      }
      if (proof?.verifiedMainCommit === "fe3ad8901bfa714d59639d9f59a13cf133eeab36") {
        // Three exact proof-owned methods on unchanged merged source blobs.
        // The #1524 self-profile route is a source-reviewed GAP; no stale credit.
        assert.equal(verifyMoreCredits(manifest), 3);
        continue;
      }
      if (proof?.file === "scripts/qa/tenant-hmo-http.mjs") {
        // A passing candidate suite is not a blanket exception to the
        // evidence-source allowlist. Admit only this exact HMO POST method,
        // its four action branches and the already executed PG16 HTTP receipt.
        assert.equal(path, "src/app/api/benefits/hmo/route.ts",
          "HMO proof cannot certify any other tenant endpoint");
        assert.equal(method.name, "POST",
          "Existing HMO GET is independently credited by the table proof");
        assert.equal(entry.methods.find(row => row.name === "GET")?.testedBy?.file,
          "scripts/qa/tenant-table-http.mjs");
        assert.deepEqual(proof.postActions,
          ["create_plan", "add_dependent", "update_dependent", "update_enrollment"]);
        const actionPins = {
          create_plan: [121, 201, /const createdPlan = expectStatus\(await request\(PATH/],
          add_dependent: [128, 201, /const createdDependent = expectStatus\(await request\(PATH/],
          update_dependent: [138, 200, /const updatedDependent = expectStatus\(await request\(PATH/],
          update_enrollment: [145, 200, /const updatedEnrollment = expectStatus\(await request\(PATH/],
        };
        assert.deepEqual(proof.postActionOwnLines,
          Object.fromEntries(Object.entries(actionPins).map(([action, [line]]) => [action, line])));
        assert.deepEqual(proof.ownStatusByAction,
          Object.fromEntries(Object.entries(actionPins).map(([action, [, status]]) => [action, status])));
        assert.deepEqual([
          proof.line, proof.ownPositiveLine, proof.foreignDenialLine,
          proof.forgedSelectorLine, proof.unchangedDbLine,
          proof.victimIdOrderingLine, proof.foreignStatus,
        ], [121, 121, 171, 174, 80, 66, 403],
        "HMO POST own/foreign/forged/unchanged-DB evidence pins changed");
        assert.equal(proof.reviewedHead, "b85715c76be9bf2c9f0ab0f08741853c8983d7d9");
        assert.equal(proof.passedJob,
          "https://github.com/erwinmehehe/payrollph/actions/runs/40675730756/job/122773670031");
        assert.equal(proof.ciResultKind, "HMO_GET_POST_HTTP_CANDIDATE");
        assert.equal(proof.routeBlobSha, "99e3fa0e48f6a8dde88b9505f49524898cdf957a");
        assert.equal(proof.proofBlobSha, "45cc7499ec33cc44d6ec7b826c075262411ed657");
        assert.equal(proof.runnerBlobSha, "3765c1923e137f68b75fd545348868672f3f2f5d");
        const callerReceipt = verifyDocumentCallerReproof(proof.callerReproof);
        const suite = readFileSync(proof.file, "utf8");
        const suiteLines = suite.split("\n");
        const runnerFile = "scripts/qa/tenant-document-caller-reproof-http.mjs";
        const runner = readFileSync(runnerFile, "utf8");
        assert.equal(gitBlobSha(Buffer.from(suite)), proof.proofBlobSha,
          "Changes to HMO HTTP scenarios require a new executed proof");
        assert.equal(gitBlobSha(readFileSync(path)), proof.routeBlobSha,
          "Changes to the HMO route require renewed authorization review");
        assert.equal(gitBlobSha(Buffer.from(runner)), callerReceipt.pins[runnerFile],
          "The replacement caller must match its freshly executed receipt");
        assert.match(runner,
          /await hmo\.verifyHmoIsolation\(f,\{request,expectStatus,makeSession\}\)/);
        for (const [action, [line, status, requestPattern]] of Object.entries(actionPins)) {
          assert.match(evidenceLine(proof.file, line, "HMO POST " + action), requestPattern);
          assert.match(suiteLines.slice(line - 1, line + 6).join("\n"),
            new RegExp("\\b" + status + ', "HMO POST ' + action + " "),
            action + ": actual own HTTP response status must be checked");
        }
        assert.match(evidenceLine(proof.file, 171, "HMO foreign POST"),
          /await denied\(PATH, \{ method: "POST", cookie, body \}, 403/);
        assert.match(evidenceLine(proof.file, 174, "HMO foreign object"),
          /await denied\(PATH, \{ method: "POST", cookie, body \}, 404/);
        assert.match(evidenceLine(proof.file, 80, "HMO unchanged victim"),
          /assert\.deepEqual\(await snapshot\(victim\.id\), before/);
        assert.match(evidenceLine(proof.file, 66, "HMO high victim IDs"),
          /target\[field\]\.id > 6 && owned\.every/);
        assert.match(suite, /for \(const idx of \[1, 2\]\)/);
        assert.match(suite, /for \(const body of actionBodies\(victim, target,/);
        assert.match(suite, /for \(const body of actionBodies\(org, target,.*\.slice\(1\)/);
        assert.match(suite, /process\.env\.TENANT_SECOND_PASS_MODE, "isolated-ci-only"/);
        assert.match(suite, /process\.env\.CI, "true"/);
        assert.match(suite, /actualProviderTraffic: false, inventoryCreditsAdded: 0/);
        assert.match(method.reason, /independent security review/i);
        const workflow = readFileSync(".github/workflows/security-http-smoke.yml", "utf8");
        assert.match(workflow, /image: postgres:16/);
        assert.match(workflow, /run: npx tsx scripts\/qa\/tenant-second-pass-http\.mjs/);
        continue; // Only the exact HMO POST source is admitted; no sibling credits.
      }
      if (proof?.file === "scripts/qa/tenant-self-development-http.mjs") {
        assert.equal(verifySelfDevelopmentCredits(manifest), 3);
        continue;
      }
      if (["scripts/qa/tenant-benefit-enrollments-http.mjs", "scripts/qa/tenant-worksites-http.mjs"].includes(proof?.file)) {
        assert.equal(verifyMergedProofCredits(manifest), 4);
        continue;
      }
      if (proof?.file === "scripts/qa/underpayment-posting-http.mjs") {
        assert.equal(path, "src/app/api/payroll-underpayments/route.ts");
        const spec = { POST: [136, 149], PATCH: [166, 155] }[method.name];
        assert.ok(spec, "Only the two executed underpayment writes receive new credit");
        assert.deepEqual([proof.ownPositiveLine, proof.foreignDenialLine], spec);
        const lines = readableLines(proof.file);
        assert.ok(lines[spec[0] - 1].includes(method.name === "POST" ? "status(await request" : "const winner = replies.find"));
        assert.match(lines[spec[1] - 1], /await deny\(v,/);
        assert.ok(lines[spec[1] - 1].includes("v.org.id"), "Foreign proof must select the actual victim employer");
        assert.match(lines[proof.unchangedDbLine - 1], /assert\.deepEqual\(await snapshot\(v\), before/);
        const integration = lines.join("\n");
        assert.match(integration, /await journey\(v, a\); await journey\(v, b\)/);
        assert.match(integration, /v\.claim\.id > Math\.max\(a\.claim\.id, b\.claim\.id, 6\)/);
        assert.match(integration, /\[200, 409\]/);
        const workflow = readFileSync(".github/workflows/underpayment-posting.yml", "utf8");
        assert.match(workflow, /posting: \['false', 'true'\]/);
        assert.match(workflow, /MONEY_PROOF_TRANSPORT: http/);
        assert.match(workflow, /npx tsx scripts\/qa\/underpayment-posting-http\.mjs/);
        continue;
      }
      if (proof?.file === "scripts/qa/tenant-money-lifecycle-http.mjs") {
        // Bookkeeping for eight separately executed PG16/HTTP cases; this
        // source guard never substitutes for the required workflow receipt.
        const specs = {
          "GET holidays": [190, 192], "POST holidays": [177, 193],
          "PATCH holidays": [196, 194], "DELETE holidays": [199, 195],
          "GET payroll-earnings": [134, 136], "POST payroll-earnings": [179, 137],
          "PATCH payroll-earnings": [140, 139], "POST payroll-runs/[id]/process": [263, 259],
          // Credited by scripts/qa/tenant-payroll-review-release-credit.mjs from an exact-head receipt of both matrix legs.
          "POST payroll-runs/[id]/submit-review": [277, 259], "POST payroll-runs/[id]/release": [292, 259],
        };
        const spec = specs[method.name + " " + entry.route];
        assert.ok(spec, path + ": unrelated methods cannot borrow money-path proof");
        assert.deepEqual([proof.line, proof.ownPositiveLine, proof.foreignDenialLine,
          proof.forgedSelectorLine, proof.unchangedDbLine], [spec[0], spec[0], spec[1], spec[1], 126]);
        const integration = readFileSync(proof.file, "utf8");
        const lines = integration.split("\n");
        const own = lines.slice(spec[0] - 1, spec[0] + 2).join("\n");
        const foreign = lines[spec[1] - 1];
        assert.match(own, /status\(await request\(/);
        assert.match(foreign, /await deny\(v, a\.maker/);
        assert.match(foreign, /403,/);
        assert.match(foreign, /v\.(?:org|earning|holiday|run)\./);
        const loopedRun = /^payroll-runs\/\[id\]\/(process|submit-review|release)$/.exec(entry.route);
        if (loopedRun) {
          assert.ok(own.includes("/" + loopedRun[1] + "`"), path + ": own success must call this exact route");
          assert.match(integration, /for \(const suffix of \["process", "submit-review", "release"\]\)/);
          assert.ok(foreign.includes("/api/payroll-runs/${v.run.id}/${suffix}`"), path + ": the victim denial loop must target the real victim run");
          if (loopedRun[1] !== "process") verifyPayrollReviewReleaseCredit(method, path, proof, integration);
        } else {
          assert.ok(own.includes("/api/" + entry.route) && foreign.includes("/api/" + entry.route));
        }
        if (method.name !== "GET") {
          assert.ok(own.includes('"' + method.name + '"') && foreign.includes('"' + method.name + '"'));
        }
        assert.match(lines[125], /assert\.deepEqual\(await snapshot\(v\), before/);
        assert.match(integration, /for \(const attacker of \[a, b\]\)/);
        assert.match(integration, /victim earning\/correction IDs exceed both attacker IDs and 6/);
        const workflow = readFileSync(".github/workflows/tenant-money-lifecycle.yml", "utf8");
        assert.match(workflow, /exact-links: \['false', 'true'\]/);
        assert.match(workflow, /MONEY_PROOF_TRANSPORT: http/);
        assert.match(workflow, /npx tsx scripts\/qa\/tenant-money-lifecycle-http\.mjs/);
        assert.match(integration, /assert\.notEqual\(process\.env\.GITHUB_ACTIONS, "true"/);
        continue;
      }
      // Only statutory remittance action GET+POST may use the new independently
      // gated multi-entity ON/OFF PostgreSQL-16 real-HTTP proof source.
      if (proof?.file === "scripts/qa/remittance-action-entity-http.mjs") {
        assert.equal(path, "src/app/api/compliance/remittance-actions/route.ts",
          "No unrelated route may reuse the remittance-action evidence");
        const pins = method.name === "GET" ? [138, 210] :
          method.name === "POST" ? [186, 213] : null;
        assert.ok(pins, "Only GET and POST are included in this batch");
        assert.deepEqual([proof.line, proof.ownPositiveLine, proof.foreignDenialLine,
          proof.unchangedDbLine], [pins[0], pins[0], pins[1], 237],
          "Exact own/victim proof pointers require independent re-review on movement");
        const script = readFileSync(proof.file, "utf8");
        const lines = script.split("\n");
        const span = n => lines.slice(n - 1, n + 5).join("\n");
        const own = span(pins[0]), foreign = span(pins[1]);
        assert.match(own, /expectStatus\(await request\("\/api\/compliance\/remittance-actions/);
        assert.match(foreign, /expectStatus\(await request\("\/api\/compliance\/remittance-actions/);
        assert.match(own, /\), 200,/);
        assert.match(foreign, /\), 403,/);
        if (method.name === "POST") {
          assert.match(own, /method: "POST"/);
          assert.match(foreign, /method: "POST"/);
        }
        assert.match(lines[236], /assert\.deepEqual\(await snapshot\(victim\.id\), before,/);
        assert.match(script, /for \(const attacker of \[attackerA, attackerB\]\)/);
        assert.match(script, /realVictim\.id > Math\.max\(6, ownTask\.id\)/);
        assert.match(script, /queueStatutoryComplianceEscalations/);
        assert.match(script, /process\.env\.GITHUB_ACTIONS/);
        assert.match(script, /process\.env\.REMITTANCE_ACTION_PROOF_MODE/);
        assert.match(script, /process\.env\.PAYMONGO_DISBURSEMENTS_ENABLED/);
        const wf = readFileSync(".github/workflows/remittance-action-tenant-isolation.yml", "utf8");
        assert.match(wf, /multi_entity: \['false', 'true'\]/);
        assert.match(wf, /image: postgres:16/);
        assert.match(wf, /npx tsx scripts\/qa\/remittance-action-entity-http\.mjs/);
        continue;
      }
      // MNY-02 provisional contractor/EWT proofs: six fixed method signatures,
      // real two-attacker HTTP positive/negative checks and a victim SQL invariant.
      // Never allow arbitrary routes to claim this specialized proof source.
      if (proof?.file === "scripts/qa/tenant-mny02-contractors-http.mjs") {
        const specs = {
          "GET contractors": [138, 143, 146, 200],
          "POST contractors": [54, 152, 152, 201],
          "PATCH contractors": [167, 160, 167, 200],
          "DELETE contractors": [186, 180, 186, 200],
          "GET contractors/payments": [194, 201, 205, 200],
          "POST contractors/payments": [73, 220, 227, 201],
        };
        const key = method.name + " " + entry.route;
        const spec = specs[key];
        assert.ok(spec, path + ": unrelated route cannot borrow MNY-02 contractor evidence");
        assert.ok([
          "src/app/api/contractors/route.ts",
          "src/app/api/contractors/payments/route.ts",
        ].includes(path), "Only the two reviewed contractor API routes are in scope");
        assert.deepEqual(
          [proof.line, proof.ownPositiveLine, proof.foreignDenialLine,
            proof.forgedSelectorLine, proof.unchangedDbLine],
          [spec[0], spec[0], spec[1], spec[2], 271],
          key + ": pinned method-specific evidence changed without review",
        );
        const script = readFileSync(proof.file, "utf8");
        const proofLines = script.split("\n");
        const runner = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
        assert.match(runner, /verifyMny02ContractorTenantIsolation\(f, \{ request, expectStatus \}\)/);
        assert.match(script, /assert\.equal\(process\.env\.CI, "true"\)/);
        assert.match(script, /assert\.equal\(process\.env\.TENANT_SECOND_PASS_MODE, "isolated-ci-only"\)/);
        assert.match(script, /assert\.equal\(pg\.pathname, "\/app_db"\)/);
        assert.match(script, /for \(const idx of \[1, 2\]\)/);
        assert.match(script, /victimContract\.id > 6 && victimPayment\.id > 6/);
        assert.match(script, /const blockedJson = expectStatus\(await request\(/);
        assert.match(script, /const blockedCsv = expectStatus\(await request\(/);
        assert.match(proofLines[proof.unchangedDbLine - 1],
          /assert\.deepEqual\(await victimSnapshot\(victim\.id\), originalVictim/);
        const ownedStart = proofLines[spec[0] - 1];
        const deniedStart = proofLines[spec[1] - 1];
        assert.match(ownedStart, /expectStatus\(await request\(/, key + ": own proof must call HTTP");
        assert.match(deniedStart, /expectStatus\(await request\(/, key + ": denial proof must call HTTP");
        const span = n => proofLines.slice(n - 1, n + 9).join("\n");
        const endpoint = "/api/" + entry.route;
        assert.ok(span(spec[0]).includes(endpoint) && span(spec[1]).includes(endpoint),
          key + ": both own and foreign calls must hit the same method route");
        assert.ok(new RegExp("\\),\\s*" + spec[3] + ",").test(span(spec[0])),
          key + ": positive must assert real owned HTTP success");
        assert.match(span(spec[1]), /\)\s*,\s*403\s*,/,
          key + ": foreign request must explicitly deny actual victim employer");
        if (method.name !== "GET") {
          assert.ok(span(spec[0]).includes('method: "' + method.name + '"') &&
            span(spec[1]).includes('method: "' + method.name + '"'),
            key + ": mutation proof must execute its actual HTTP method");
        }
        assert.match(script, /noVictimResponse\(foreign/, "Foreign response must be checked for leaked identity");
        continue;
      }
      // PII-01: only HR identifier review GET and rejection POST may claim
      // this distinct real HTTP / disposable PostgreSQL source.
      if (proof?.file === "scripts/qa/tenant-pii01-identifier-review-http.mjs") {
        assert.equal(path, "src/app/api/employee-identifier-requests/route.ts");
        const specs = {
          GET: [140, 151, 157],
          POST: [167, 176, 181],
        };
        const spec = specs[method.name];
        assert.ok(spec, "Only GET and POST review methods may use PII-01 evidence");
        assert.deepEqual([
          proof.line, proof.ownPositiveLine, proof.foreignDenialLine,
          proof.forgedSelectorLine, proof.victimExistsLine,
          proof.victimIdOrderingLine, proof.unchangedDbLine,
        ], [spec[0], spec[0], spec[1], spec[2], 123, 117, 196]);
        const evidence = readFileSync(proof.file, "utf8");
        const lines = evidence.split("\n");
        assert.match(lines[spec[0] - 1] ?? "", /expectStatus\(await request\(/);
        assert.match(lines[spec[1] - 1] ?? "", /expectStatus\(await request\(/);
        assert.match(lines[spec[2] - 1] ?? "", /expectStatus\(await request\(/);
        assert.match(lines.slice(spec[0] - 1, spec[0] + 4).join("\n"), /\)\s*,\s*200\s*,/);
        assert.match(lines.slice(spec[1] - 1, spec[1] + 4).join("\n"), /\)\s*,\s*403\s*,/);
        assert.match(evidence, /for \(const a of own\)/);
        assert.match(evidence, /victimRequest\.id > Math\.max\(6/);
        assert.match(evidence, /assert\.deepEqual\(await victimSnapshot\(victim\.id\), baseline/);
        assert.match(source.join("\n"), /verifyPiiIdentifierReviewIsolation\(f, \{ request, expectStatus \}\)/);
        if (method.name === "POST") {
          assert.match(lines.slice(spec[2] - 1, spec[2] + 4).join("\n"), /\)\s*,\s*404\s*,/);
          assert.match(lines.slice(spec[0] - 1, spec[0] + 4).join("\n"), /method: "POST"/);
        }
        continue;
      }
      // BIR 2316: only these three independently executed HTTPS/PG16 document
      // methods may use helper-built paths instead of literal "/api" URLs at
      // each source line. Preserve the generic route-fragment guard for ALL
      // other proof suites and require actual owned responses, not just 403.
      if (proof?.file === "scripts/qa/tenant-bir2316-http.mjs") {
        const specs = {
          "GET separation/[id]/2316": ["ownDraft", "foreignDraft", 259, 284],
          "GET year-end/2316-certificate": ["ownSource", "foreignSource", 266, 286],
          "POST year-end/2316-certificate": ["ownPdf", "foreignPdf", 273, 288],
        };
        const key = method.name + " " + entry.route;
        const expected = specs[key];
        assert.ok(expected, key + ": BIR proof cannot authorize unrelated routes");
        assert.ok([
          "src/app/api/separation/[id]/2316/route.ts",
          "src/app/api/year-end/2316-certificate/route.ts",
        ].includes(path), key + ": only reviewed 2316 document endpoints qualify");
        assert.deepEqual([
          proof.line, proof.ownPositiveLine, proof.foreignDenialLine,
          proof.unchangedDbLine ?? null,
        ], [expected[2], expected[2], expected[3],
          method.name === "POST" ? 356 : null],
        key + ": method-specific HTTP line pins changed without review");
        const integration = readFileSync(proof.file, "utf8");
        const lines = integration.split("\n");
        const own = evidenceLine(proof.file, proof.ownPositiveLine, key + " own");
        const foreign = evidenceLine(proof.file, proof.foreignDenialLine, key + " victim");
        assert.ok(own.includes("const " + expected[0] + " = expectStatus(await request("),
          key + ": real authenticated own HTTP request required");
        assert.ok(foreign.includes("const " + expected[1] + " = expectStatus(await request("),
          key + ": real victim-only HTTP denial required");
        const span = n => lines.slice(n - 1, n + 9).join("\n");
        assert.match(span(proof.ownPositiveLine), /\)\s*,\s*200\s*,/,
          key + ": owned 2316 text/source/PDF must succeed, not return empty denial");
        assert.match(span(proof.foreignDenialLine), /\)\s*,\s*403\s*,/,
          key + ": real high-ID foreign victim must be rejected");
        assert.match(integration, /function sourcePath\(row\)/);
        assert.match(integration, /"\/api\/year-end\/2316-certificate\?organizationId="/);
        assert.match(integration, /function draftPath\(row\)/);
        assert.match(integration, /"\/api\/separation\/" \+ row\.id \+ "\/2316"/);
        assert.match(integration, /for \(const idx of \[0, 1\]\)/);
        assert.match(integration, /rows\[4\]\.id > 6 && rows\[4\]\.id > rows\[0\]\.id && rows\[4\]\.id > rows\[1\]\.id/);
        assert.match(integration, /const draftFillers = \[0, 1, 0\]/);
        assert.match(integration, /values\(\[\.\.\.draftFillers, \.\.\.separationValues\]\)/);
        assert.match(integration, /const victimBefore = await snapshotVictim/);
        assert.match(integration, /assert\.deepEqual\(victimAfter, victimBefore/);
        assert.match(integration, /Revoked historical employer grant denies existing signed-in/);
        assert.match(integration, /Transferred employee retains original frozen employer/);
        assert.match(integration, /PAYMONGO_DISBURSEMENTS_ENABLED, "false"/);
        assert.match(integration, /XENDIT_PAYOUTS_ENABLED, "false"/);
        const workflow = readFileSync(".github/workflows/multi-entity-browser-qa.yml", "utf8");
        assert.match(workflow, /run: npx tsx scripts\/qa\/tenant-bir2316-http\.mjs/,
          key + ": evidence must execute in isolated multi-entity HTTPS/PG16 CI");
        assert.match(workflow, /MULTI_ENTITY_QA_MODE: synthetic-postgres-only/);
        assert.match(workflow, /DATABASE_URL: postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/app_db/);
        if (method.name === "POST") {
          assert.match(span(proof.ownPositiveLine), /method: "POST"/,
            "Must generate real unsigned PDF, not a GET labeled as POST");
          assert.match(span(proof.foreignDenialLine), /method: "POST"/,
            "Foreign victim must be denied on actual POST");
          const invariant = evidenceLine(proof.file, proof.unchangedDbLine, key + " victim snapshot");
          assert.match(invariant, /assert\.deepEqual\(victimAfter, victimBefore/,
            key + ": foreign/forged PDF request cannot mutate victim SQL/audit");
          assert.match(integration, /"[%]PDF"|=== "%PDF"/,
            "Owned POST must validate returned PDF bytes");
        }
        continue;
      }
      // MNY-02 expense/benefit credits are limited to these six API methods.
      // Exact source pins and statuses are mandatory; a source-only check
      // cannot substitute for the disposable three-employer PG16 HTTP run.
      if (proof?.file === "scripts/qa/tenant-mny02-expenses-benefits-http.mjs") {
        const specs = {
          "GET expenses": [147, 153, 158, 200],
          "POST expenses": [57, 162, 169, 201],
          "PATCH expenses": [181, 192, 181, 200],
          "GET de-minimis": [199, 205, undefined, 200],
          "POST de-minimis": [73, 209, 216, 201],
          "DELETE de-minimis": [230, 224, 230, 200],
        };
        const key = method.name + " " + entry.route;
        const spec = specs[key];
        assert.ok(spec && [
          "src/app/api/expenses/route.ts",
          "src/app/api/de-minimis/route.ts",
        ].includes(path), path + ": unrelated method cannot borrow expense/benefit evidence");
        const [own, foreign, forged, ownStatus] = spec;
        assert.deepEqual(
          [proof.line, proof.ownPositiveLine, proof.foreignDenialLine,
            proof.forgedSelectorLine, proof.unchangedDbLine,
            proof.victimExistsLine, proof.victimIdOrderingLine],
          [own, own, foreign, forged, 242, 141, 133],
          key + ": source pins must match the reviewed method-specific proof",
        );
        const suite = readFileSync(proof.file, "utf8");
        const lines = suite.split("\n");
        const span = number => lines.slice(number - 1, number + 9).join("\n");
        const endpoint = "/api/" + entry.route;
        assert.match(lines[own - 1], /expectStatus\(await request\(/,
          key + ": owned positive must be a real HTTP request");
        assert.match(lines[foreign - 1], /expectStatus\(await request\(/,
          key + ": victim denial must be a real HTTP request");
        assert.ok(span(own).includes(endpoint) && span(foreign).includes(endpoint),
          key + ": positive and negative must reach the claimed API route");
        assert.match(span(own), new RegExp("\\)\\s*,\\s*" + ownStatus + "\\s*,"),
          key + ": a real successful owned response is required");
        assert.match(span(foreign), new RegExp("\\)\\s*,\\s*" + (key === "DELETE de-minimis" ? "404" : "403") + "\\s*,"),
          key + ": foreign employer must receive the method-specific denial");
        if (method.name !== "GET") {
          assert.ok(span(own).includes('method: "' + method.name + '"') &&
            span(foreign).includes('method: "' + method.name + '"'),
            key + ": both requests must exercise the same mutation method");
        }
        if (forged !== undefined) {
          const forgedSpan = span(forged);
          const forgedVictimSelector = {
            "GET expenses": '"&employeeId=" + victimEmployee.id',
            "POST expenses": "employeeId: victimEmployee.id",
            "PATCH expenses": "organizationId: victim.id",
            "POST de-minimis": "employeeId: victimEmployee.id",
            "DELETE de-minimis": '"&organizationId=" + victim.id',
          }[key];
          assert.ok(forgedVictimSelector && forgedSpan.includes(forgedVictimSelector),
            key + ": forged request must use the reviewed real victim selector");
          if (key === "POST expenses" || key === "POST de-minimis") {
            assert.match(lines[forged - 1], /expectStatus\(await request\(/,
              key + ": forged employee must be a separate HTTP request");
            assert.match(span(forged), /\)\s*,\s*404\s*,/,
              key + ": forged victim worker must fail with 404");
          }
        }
        assert.match(lines[132], /assert\.ok\(victimExpense\.id > 6 && victimGrant\.id > 6/,
          key + ": persisted victim IDs must be high real IDs");
        assert.match(lines[140], /assert\.equal\(savedVictimExpense\.organizationId, victim\.id\)/,
          key + ": victim-owned expense must exist in PostgreSQL");
        assert.match(lines[141], /assert\.equal\(savedVictimGrant\.organizationId, victim\.id\)/,
          key + ": victim-owned benefit must exist in PostgreSQL");
        assert.match(lines[241], /assert\.deepEqual\(await victimSnapshot\(victim\.id\), baseline/,
          key + ": victim finance/audit/payroll rows must remain unchanged");
        assert.match(suite, /for \(const idx of \[1, 2\]\)/,
          key + ": two independent authenticated attacker employers required");
        assert.match(suite, /makeIndependentChecker\(org, makeSession\)/,
          key + ": expense decisions require an independent checker");
        assert.match(suite, /noVictimLeak\(foreign/,
          key + ": foreign response must not expose victim-only information");
        assert.match(suite, /process\.env\.CI, "true"/);
        assert.match(suite, /process\.env\.TENANT_SECOND_PASS_MODE, "isolated-ci-only"/);
        assert.match(suite, /pg\.pathname, "\/app_db"/);
        assert.match(suite, /spendPayrollEnabled\(\), false/,
          "Only legacy Spend flag-OFF is credited by this suite");
        assert.match(source.join("\n"),
          /verifyMny02ExpensesBenefitsIsolation\(f, \{ request, expectStatus, makeSession \}\)/,
          key + ": the guarded production-mode real HTTP runner must invoke the suite");
        continue;
      }
      // New method credits must be bound to an explicitly reviewed endpoint,
      // real two-attacker HTTP runner, exact request/status lines, and a
      // persisted victim-before/after assertion for mutating methods. Do not
      // generalize this exemption to arbitrary new test files or methods.
      const newTenantProofTargets = {
        "scripts/qa/compliance-read-sweep-http.mjs": new Set([
          "src/app/api/bir/annual-employer/module-evidence/route.ts",
          "src/app/api/compliance/dole-13th-month/route.ts",
          "src/app/api/compliance/government-loan-remittances/route.ts",
          "src/app/api/compliance/statutory-remittances/payment-evidence/route.ts",
        ]),
        "scripts/qa/hcm-probation-sweep-http.mjs": new Set([
          "src/app/api/hcm/probation-reviews/route.ts",
        ]),
      };
      if (Object.hasOwn(newTenantProofTargets, proof?.file)) {
        assert.ok(newTenantProofTargets[proof.file].has(path),
          path + ": new proof source is restricted to its reviewed API routes");
        const integration = readFileSync(proof.file, "utf8");
        const runner = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
        const entrypoint = proof.file.includes("compliance-read")
          ? "verifyComplianceReadSweep" : "verifyHcmProbationSweep";
        assert.ok(runner.includes(entrypoint + "(f, { request, expectStatus })"),
          path + ": new real-HTTP suite must execute inside the disposable guarded runner");
        assert.match(integration, /process\.env\.CI\s*!==\s*"true"/);
        assert.match(integration, /process\.env\.TENANT_SECOND_PASS_MODE/);
        assert.match(integration, /for\s*\(\s*const idx of \[1,\s*2\]\s*\)/,
          path + ": two independent real-employer attacker principals required");
        const proofLines = integration.split("\n");
        function completeRequest(lineNumber, expectedLabel) {
          assert.ok(Number.isInteger(lineNumber) && lineNumber > 0 &&
            lineNumber <= proofLines.length, path + ": invalid " + expectedLabel + " location");
          const at = lineNumber - 1;
          const searchStart = Math.max(0, at - 12);
          const candidates = proofLines.slice(searchStart, at + 1);
          const offset = candidates.findLastIndex((line) =>
            /expectStatus\s*\(\s*await request(?:Multipart)?\s*\(/.test(line));
          assert.ok(offset >= 0, path + ": missing actual " + expectedLabel + " HTTP call");
          const requestStart = searchStart + offset;
          const statusEnd = proofLines.findIndex((line, i) =>
            i >= requestStart && i <= requestStart + 15 &&
            /(?:\)\s*,\s*|^\s*)\d{3}\s*,/.test(line));
          assert.ok(statusEnd >= requestStart,
            path + ": " + expectedLabel + " must assert a real HTTP status");
          if (expectedLabel === "foreign-denial") {
            assert.equal(statusEnd, at,
              path + ": foreign-denial pointer must be the exact status assertion");
          } else {
            assert.equal(requestStart, at,
              path + ": own-positive pointer must be the exact request start");
          }
          return {
            start: proofLines[requestStart],
            throughStatus: proofLines.slice(requestStart, statusEnd + 1).join("\n"),
          };
        }
        const own = completeRequest(proof.ownPositiveLine, "own-positive");
        const foreign = completeRequest(proof.foreignDenialLine, "foreign-denial");
        assert.match(own.start, /expectStatus\s*\(\s*await request(?:Multipart)?\s*\(/);
        assert.match(proofLines[proof.ownPositiveLine - 1], /expectStatus\s*\(\s*await request(?:Multipart)?\s*\(/,
          path + ": ownPositiveLine must be the request itself, never a nearby assertion");
        assert.match(proofLines[proof.foreignDenialLine - 1], /(?:\)\s*,\s*|^\s*)403\s*,/,
          path + ": foreignDenialLine must assert an actual forbidden response");
        const isMultipart = path ===
          "src/app/api/compliance/statutory-remittances/payment-evidence/route.ts" &&
          method.name === "POST";
        const endpoint = "/api/" + entry.route;
        if (isMultipart) {
          assert.match(own.throughStatus, /requestMultipart\s*\(\s*cookie/);
          assert.match(foreign.throughStatus, /requestMultipart\s*\(\s*cookie/);
          assert.ok(integration.includes('new URL("' + endpoint + '"') &&
            integration.includes('method: "POST"'),
            path + ": multipart request must really POST to the tested route");
        } else {
          assert.ok(own.throughStatus.includes(endpoint) &&
            foreign.throughStatus.includes(endpoint),
            path + ": both signed-in proof calls must target the claimed endpoint");
          if (method.name !== "GET") {
            assert.ok(own.throughStatus.includes('method: "' + method.name + '"') &&
              foreign.throughStatus.includes('method: "' + method.name + '"'),
              path + ": positive and foreign denial must exercise the claimed method");
          }
        }
        const ownStatus = path === "src/app/api/hcm/probation-reviews/route.ts" &&
          method.name === "POST" || isMultipart ? 201 : 200;
        const assertedOwnStatus = own.throughStatus.match(/(?:\)\s*,\s*|^\s*)(\d{3})\s*,/m);
        assert.equal(Number(assertedOwnStatus?.[1]), ownStatus,
          path + ": valid own-employer HTTP success is mandatory");
        assert.match(own.throughStatus, /own\.id/,
          path + ": positive request must select an actual own employer");
        assert.match(foreign.throughStatus, /victim\.id/,
          path + ": foreign denial must target real victim employer");
        if (method.name !== "GET") {
          const invariant = evidenceLine(proof.file, proof.unchangedDbLine,
            path + " victim persistence invariant");
          assert.match(invariant, /assert\.deepEqual\(\s*(?:victim|officialVictim|storedVictim)/,
            path + ": an unchanged victim database snapshot is mandatory for writes");
        }
        continue;
      }
      // DL-02 self/photo POST and web-bundy evidence GET: only these two methods may claim these
      // row files, with every proof input byte-identical to the passing dispatch run. POST
      // web-bundy/evidence proves one of four punch actions and stays GAP.
      if (["scripts/qa/tenant-dl02-rows/self-photo.mjs", "scripts/qa/tenant-dl02-rows/web-bundy.mjs"].includes(proof?.file)) {
        const specs = {
          "scripts/qa/tenant-dl02-rows/self-photo.mjs": {
            path: "src/app/api/self/photo/route.ts", name: "POST",
            pins: [22, 22, 57, 39, 61, 32], status: [200, 403, 200],
            patterns: [/ctx\.exact\(await form\(ctx, e\), 200,/, /const denied = ctx\.exact\(await form\(ctx, e, \{/, /const forged = ctx\.exact\(await form\(ctx, e, \{/],
            proofBlob: "e76bbe4dd82f4f5514b1518dcc438b84e2261739", routeBlob: "9451f4e37d3b0088ed08106dce5e5bd0e748e64e",
          },
          "scripts/qa/tenant-dl02-rows/web-bundy.mjs": {
            path: "src/app/api/web-bundy/evidence/route.ts", name: "GET",
            pins: [58, 58, 78, 68, 95, 51], status: [200, 403, 200],
            patterns: [/const get = ctx\.exact\(await ctx\.request\("\/api\/web-bundy\/evidence\?organizationId=" \+ e\.org\.id/, /const getForeign = ctx\.exact\(await ctx\.request\(/, /const getForged = ctx\.exact\(await ctx\.request\(/],
            proofBlob: "2b482e1e247b8c79b48a52f565af6cd5cb917953", routeBlob: "7e3e91268e820923c98dcc2f730f7779825cf926",
          },
        };
        const spec = specs[proof.file];
        assert.equal(path, spec.path, "No unrelated route may reuse the DL-02 evidence");
        assert.equal(method.name, spec.name, "Only the reviewed method may claim this proof");
        assert.deepEqual([proof.line, proof.ownPositiveLine, proof.foreignDenialLine,
          proof.forgedSelectorLine, proof.unchangedDbLine, proof.victimIdOrderingLine], [
          spec.pins[0], spec.pins[1], spec.pins[2], spec.pins[3], spec.pins[4], spec.pins[5]],
        proof.file + ": DL-02 evidence pins changed without review");
        assert.equal(proof.victimUnchangedFile, "scripts/qa/tenant-dl02-closure-http.mjs");
        assert.equal(proof.victimUnchangedAt, 196);
        assert.equal(proof.reviewedHead, "5a3c209dffb2198e8944d0781025c42b117024b0");
        assert.equal(proof.workflowRunId, 40859482784);
        assert.equal(proof.passedJob,
          "https://github.com/erwinmehehe/payrollph/actions/runs/40859482784/job/123398767736");
        const rows = readFileSync(proof.file, "utf8");
        const runnerFile = readFileSync(proof.victimUnchangedFile, "utf8");
        const bootstrap = readFileSync("scripts/qa/tenant-dl02-closure-bootstrap.mjs", "utf8");
        const workflow = readFileSync(".github/workflows/tenant-dl02-closure.yml", "utf8");
        assert.equal(gitBlobSha(readFileSync(path)), spec.routeBlob, path + ": route changed; renewed review required");
        assert.equal(proof.routeBlobSha, spec.routeBlob);
        assert.equal(gitBlobSha(Buffer.from(rows)), spec.proofBlob, proof.file + ": scenarios changed; new DL-02 run required");
        assert.equal(proof.proofBlobSha, spec.proofBlob);
        assert.equal(gitBlobSha(Buffer.from(runnerFile)), proof.runnerBlobSha);
        assert.equal(gitBlobSha(Buffer.from(bootstrap)), proof.bootstrapBlobSha);
        assert.equal(gitBlobSha(Buffer.from(workflow)), proof.workflowBlobSha);
        const lines = rows.split("\n");
        const span = (line, length = 6) => lines.slice(line - 1, line - 1 + length).join("\n");
        assert.match(span(spec.pins[1]), spec.patterns[0]);
        assert.match(span(spec.pins[2], 6), spec.patterns[1]);
        assert.match(span(spec.pins[3], 6), spec.patterns[2]);
        assert.match(span(spec.pins[1], 6), new RegExp("\\b" + spec.status[0] + ","));
        assert.match(span(spec.pins[2], 6), new RegExp("\\b" + spec.status[1] + ","));
        assert.match(runnerFile.split("\n")[195], /assert\.deepEqual\(await victimSnapshot\(victim\), victimBefore/);
        assert.match(runnerFile, /for \(const family of \[punch, demand, photo\]\)/);
        assert.match(rows, /for \(const e of ctx\.attackers\)/);
        assert.match(workflow, /image: postgres:16/);
        assert.match(method.reason, /NOT an exact-head pass/);
        assert.equal(proof.productionCertified, false);
        assert.match(proof.independentReview, /^PENDING/);
        if (spec.name === "POST") {
          assert.match(rows, /Revoked linked employee photo POST denied/);
          assert.match(method.testedBy.scope, /revoked-membership evidence, not a victim-selector denial/);
        } else {
          assert.match(readFileSync("src/lib/workforce-punch-evidence.ts", "utf8"),
            /PUNCH_ACTIONS = \["clock_in", "break_start", "break_end", "clock_out"\]/);
          const bundy = entry.methods.find(candidate => candidate.name === "POST");
          assert.equal(bundy.status, "COVERED", "Separate new receipt must execute all four punch actions");
          assert.notEqual(bundy.testedBy?.file, proof.file, "Old one-action DL-02 evidence cannot credit POST");
          verifyClockCredit("POST web-bundy/evidence", bundy);
        }
        continue;
      }
      // DL-02 demand import POST: only this method may claim the whole-batch DL-02 proof,
      // and only while every proof input stays byte-identical to the passing dispatch run.
      if (proof?.file === "scripts/qa/tenant-dl02-rows/demand-import.mjs") {
        assert.equal(path, "src/app/api/workforce/demand-observations/import/route.ts",
          "No unrelated route may reuse the DL-02 demand-import evidence");
        assert.equal(method.name, "POST");
        assert.deepEqual([proof.line, proof.ownPositiveLine, proof.foreignDenialLine,
          proof.forgedSelectorLine, proof.unchangedDbLine, proof.victimIdOrderingLine,
          proof.victimUnchangedAt],
        [39, 39, 73, 84, 90, 64, 196], "demand-import evidence pins changed without review");
        assert.equal(proof.victimUnchangedFile, "scripts/qa/tenant-dl02-closure-http.mjs");
        assert.equal(proof.reviewedHead, "5a3c209dffb2198e8944d0781025c42b117024b0");
        assert.equal(proof.workflowRunId, 40859482784);
        assert.equal(proof.passedJob,
          "https://github.com/erwinmehehe/payrollph/actions/runs/40859482784/job/123398767736");
        assert.equal(proof.postgresMajor, 16);
        const rows = readFileSync(proof.file, "utf8");
        const runnerFile = readFileSync(proof.victimUnchangedFile, "utf8");
        const bootstrap = readFileSync("scripts/qa/tenant-dl02-closure-bootstrap.mjs", "utf8");
        const workflow = readFileSync(".github/workflows/tenant-dl02-closure.yml", "utf8");
        assert.equal(gitBlobSha(readFileSync(path)), proof.routeBlobSha,
          "Changes to the demand-import route require renewed authorization review");
        assert.equal(gitBlobSha(Buffer.from(rows)), proof.proofBlobSha,
          "Changes to the demand-import scenarios require a new executed DL-02 run");
        assert.equal(gitBlobSha(Buffer.from(runnerFile)), proof.runnerBlobSha,
          "Changes to the DL-02 runner require a new executed run");
        assert.equal(gitBlobSha(Buffer.from(bootstrap)), proof.bootstrapBlobSha,
          "Changes to the DL-02 bootstrap require a new executed run");
        assert.equal(gitBlobSha(Buffer.from(workflow)), proof.workflowBlobSha,
          "Changes to the DL-02 workflow require a new executed run");
        const lines = rows.split("\n");
        const span = (line, length = 5) => lines.slice(line - 1, line - 1 + length).join("\n");
        assert.match(span(39), /const result = ctx\.exact\(await ctx\.request\(\s*\n\s*"\/api\/workforce\/demand-observations\/import"[\s\S]*?201,/);
        assert.match(span(73, 7), /const foreign = ctx\.exact\(await ctx\.request\([\s\S]*?victim\.org\.id[\s\S]*?403,/);
        assert.match(span(84, 6), /const forged = ctx\.exact\(await ctx\.request\([\s\S]*?worksiteId: ctx\.victim\.site\.id[\s\S]*?403,/);
        assert.match(span(90, 2), /assert\.deepEqual\(await saved\(ctx, e\.demand\.batchId\), e\.demand\.row/);
        assert.match(span(64, 2), /ctx\.victim\.demand\.batchId > 6/);
        assert.match(runnerFile.split("\n")[195], /assert\.deepEqual\(await victimSnapshot\(victim\), victimBefore/);
        assert.match(runnerFile, /for \(const family of \[punch, demand, photo\]\)/);
        assert.match(rows, /for \(const e of ctx\.attackers\)/);
        assert.match(workflow, /image: postgres:16/);
        assert.match(workflow, /tenant-dl02-closure-http\.mjs/);
        assert.match(method.reason, /NOT an exact-head pass/);
        assert.equal(proof.productionCertified, false);
        assert.match(proof.independentReview, /^PENDING/);
        continue; // The other three DL-02 methods keep their own status; no sibling credit.
      }
      // Roster batches POST: only this method may claim the all-action proof file. Every anchor, blob pin,
      // action and the PENDING review flag is checked by the dedicated roster-batches test below.
      if (proof?.file === "scripts/qa/tenant-batches/roster-batches-actions-http.mjs") {
        assert.equal(path, "src/app/api/workforce/roster-batches/route.ts",
          "No unrelated route may reuse the roster all-action evidence");
        assert.equal(method.name, "POST");
        assert.equal(proof.independentSecurityReview, "PENDING");
        assert.equal(proof.productionTested, false);
        assert.equal(proof.verifiedPrHeadSha, "fdfd1059ede7521662c7c5bc9217eaba885a348d");
        assert.equal(proof.workflowRunId, 40915010977);
        assert.equal(proof.workflowJobId, 123592788790);
        continue;
      }
      // Worksites POST: only this method may claim the ten-action proof file. Anchors, blob pins and the action list
      // are checked by the dedicated worksites test at the end of this file.
      // hcm/effective-changes POST: dedicated harness receipt; pins are checked by the dedicated test at the end of this file.
      if (proof?.file === "scripts/qa/tenant-hcm-effective-change-post-http.mjs") {
        assert.equal(path + " " + method.name, "src/app/api/hcm/effective-changes/route.ts POST", "No unrelated method may reuse the effective-change evidence");
        assert.equal(proof.independentSecurityReview, "PENDING");
        assert.equal(proof.productionTested, false);
        assert.equal(proof.verifiedPrHeadSha, "3a3296210692d2b80f92fd8b4cbd3fc67e4aecd4");
        assert.equal(proof.workflowRunId, 42029419930);
        assert.equal(proof.workflowJobId, 127251740192);
        continue;
      }
      // account/password POST: dedicated two-attacker harness receipt; pins are checked by the dedicated test at the end of this file.
      if (proof?.file === "scripts/qa/tenant-account-password-http.mjs") {
        assert.equal(path + " " + method.name, "src/app/api/account/password/route.ts POST", "No unrelated method may reuse the account password evidence");
        assert.equal(proof.independentSecurityReview, "PENDING");
        assert.equal(proof.productionTested, false);
        assert.equal(proof.verifiedPrHeadSha, "374fe6d506ad36715db5f54181c22c6dc1e83982");
        assert.equal(proof.workflowRunId, 42183409095);
        assert.equal(proof.workflowJobId, 127778007531);
        continue;
      }
      // auth/logout POST: dedicated two-attacker harness receipt; pins are checked by the dedicated test at the end of this file.
      if (proof?.file === "scripts/qa/tenant-auth-logout-http.mjs") {
        assert.equal(path + " " + method.name, "src/app/api/auth/logout/route.ts POST", "No unrelated method may reuse the auth logout evidence");
        assert.equal(proof.independentSecurityReview, "PENDING");
        assert.equal(proof.productionTested, false);
        assert.equal(proof.verifiedPrHeadSha, "af5cfba882c2461594f5c30b5e44aecfa4f660d4");
        assert.equal(proof.workflowRunId, 42432472070);
        assert.equal(proof.workflowJobId, 128584165166);
        continue;
      }
      // POST and PATCH multi-entity/transfers: dedicated two-attacker receipt (#1853, no provider, no money); pins are checked by the dedicated test at the end of this file.
      if (proof?.file === "scripts/qa/tenant-transfers-http.mjs") {
        assert.equal(path, "src/app/api/multi-entity/transfers/route.ts", "No unrelated route may reuse the transfers evidence");
        assert.ok(["POST", "PATCH"].includes(method.name));
        assert.equal(proof.independentSecurityReview, "PENDING");
        assert.equal(proof.independentlyAccepted, false);
        assert.equal(proof.productionTested, false);
        assert.equal(proof.externalProviderCalled, false);
        assert.equal(proof.moneyMovedByLinaw, false);
        assert.equal(proof.proofPullRequest, 1853);
        assert.equal(proof.mergedProofCommit, "073e23f019c00fc6638e2c2854a22a7fda4281b0");
        assert.equal(proof.verifiedPrHeadSha, "538c70b05588d1aae223e32d11230cb5a715afdf");
        assert.equal(proof.workflowRunId, 42480658953);
        assert.equal(proof.workflowJobId, 128731654457);
        continue;
      }
      // loyverse / square-sandbox GET and POST: dedicated POS-demand receipt (test-only exact-host provider preload); pins are checked by the dedicated test at the end of this file.
      if (proof?.file === "scripts/qa/tenant-pos-demand-http.mjs") {
        assert.ok(["src/app/api/workforce/demand-observations/loyverse/route.ts", "src/app/api/workforce/demand-observations/square-sandbox/route.ts"].includes(path),
          "No unrelated route may reuse the POS-demand evidence");
        assert.ok(["GET", "POST"].includes(method.name));
        assert.equal(proof.independentSecurityReview, "PENDING");
        assert.equal(proof.productionTested, false);
        assert.equal(proof.externalProviderCalled, false);
        assert.equal(proof.providerMode, "test-only-exact-host-preload");
        assert.equal(proof.proofPullRequest, 1806);
        assert.equal(proof.mergedProofCommit, "6e0bf18bb6c3f81847f9a0b40163c77eff3850f0");
        assert.equal(proof.verifiedPrHeadSha, "d2e610e63c0bdc3463587b8a3eec0bd3cd4dd9b1");
        assert.equal(proof.workflowRunId, 42241996122);
        assert.equal(proof.workflowJobId, 127974379036);
        continue;
      }
      // loyverse / square-sandbox GET and POST: dedicated POS-demand receipt (test-only exact-host provider preload); pins are checked by the dedicated test at the end of this file.
      if (proof?.file === "scripts/qa/tenant-pos-demand-http.mjs") {
        assert.ok(["src/app/api/workforce/demand-observations/loyverse/route.ts", "src/app/api/workforce/demand-observations/square-sandbox/route.ts"].includes(path),
          "No unrelated route may reuse the POS-demand evidence");
        assert.ok(["GET", "POST"].includes(method.name));
        assert.equal(proof.independentSecurityReview, "PENDING");
        assert.equal(proof.productionTested, false);
        assert.equal(proof.externalProviderCalled, false);
        assert.equal(proof.providerMode, "test-only-exact-host-preload");
        assert.equal(proof.proofPullRequest, 1806);
        assert.equal(proof.mergedProofCommit, "6e0bf18bb6c3f81847f9a0b40163c77eff3850f0");
        assert.equal(proof.verifiedPrHeadSha, "d2e610e63c0bdc3463587b8a3eec0bd3cd4dd9b1");
        assert.equal(proof.workflowRunId, 42241996122);
        assert.equal(proof.workflowJobId, 127974379036);
        continue;
      }
      // pilot-signoff POST and xendit-payout GET: dedicated payroll-run-actions receipt; pins are checked by the dedicated test at the end of this file.
      if (proof?.file === "scripts/qa/tenant-payroll-run-actions-http.mjs") {
        assert.ok(["src/app/api/payroll-runs/[id]/pilot-signoff/route.ts POST", "src/app/api/payroll-runs/[id]/xendit-payout/route.ts GET"]
          .includes(path + " " + method.name), "No unrelated method may reuse the payroll-run-actions evidence");
        assert.equal(proof.independentSecurityReview, "PENDING");
        assert.equal(proof.productionTested, false);
        assert.equal(proof.moneyMovedByLinaw, false);
        assert.equal(proof.providerCalled, false);
        assert.equal(proof.proofPullRequest, 1803);
        assert.equal(proof.mergedProofCommit, "79da483eebf674ab44d3838adc36daa2df3201c8");
        assert.equal(proof.verifiedPrHeadSha, "02cfd9445d7fe67a8a63b156c037005d531f832a");
        assert.equal(proof.workflowRunId, 42253150229);
        assert.equal(proof.workflowJobId, 128013254082);
        continue;
      }
      // payout-reconciliation POST: loopback-synthetic PayMongo receipt; pins are checked by the dedicated test at the end of this file.
      if (proof?.file === "scripts/qa/paymongo-export-isolation-local.mjs") {
        assert.equal(path + " " + method.name, "src/app/api/payroll-runs/[id]/payout-reconciliation/route.ts POST", "No unrelated method may reuse the PayMongo isolation evidence");
        assert.equal(proof.independentSecurityReview, "PENDING");
        assert.equal(proof.productionTested, false);
        assert.equal(proof.moneyMovedByLinaw, false);
        assert.equal(proof.providerMode, "loopback-synthetic-paymongo");
        assert.equal(proof.verifiedMainHeadSha, "9c9f0ad789ad83d4c7df526155550f61b0db9c20");
        assert.equal(proof.workflowRunId, 42229558806);
        assert.equal(proof.workflowJobId, 127931638957);
        continue;
      }
      if (proof?.file === "scripts/qa/tenant-worksites-actions-http.mjs") {
        assert.equal(path, "src/app/api/workforce/worksites/route.ts", "No unrelated route may reuse the worksites all-action evidence");
        assert.equal(method.name, "POST");
        assert.equal(proof.independentSecurityReview, "PENDING");
        assert.equal(proof.productionTested, false);
        assert.equal(proof.verifiedPrHeadSha, "da9782c1685578f601d69c5dcdfd97283e7c1ec1");
        assert.equal(proof.workflowRunId, 41067962478);
        assert.equal(proof.workflowJobId, 124104301803);
        continue;
      }
      // WRK-02 Batch 2: only these three methods may claim the batch proof file; anchors and pins are checked by the dedicated test at the end of this file.
      if (proof?.file === "scripts/qa/tenant-wrk02-batch2-http.mjs") {
        assert.ok(["src/app/api/workforce-planning/baselines/route.ts POST", "src/app/api/workforce-planning/position-executions/route.ts POST",
          "src/app/api/workforce-planning/position-executions/route.ts PATCH"].includes(path + " " + method.name), "No unrelated method may reuse the Batch 2 evidence");
        assert.equal(proof.independentSecurityReview, "PENDING");
        assert.equal(proof.productionTested, false);
        assert.equal(proof.verifiedPrHeadSha, "ea5c5008706f8e374eb0c8ddf1a46608e0e7969d");
        assert.equal(proof.workflowRunId, 41161613307);
        assert.equal(proof.workflowJobId, 124420445717);
        continue;
      }
      // WRK-02 allocations: only POST and PATCH may claim the allocations receipt; anchors and pins are checked by the dedicated test at the end of this file.
      if (proof?.file === "scripts/qa/tenant-wfp-allocations-http.mjs") {
        assert.equal(path, "src/app/api/workforce-planning/allocations/route.ts", "No unrelated route may reuse the allocations evidence");
        assert.ok(["POST", "PATCH"].includes(method.name));
        assert.equal(proof.independentSecurityReview, "PENDING");
        assert.equal(proof.productionTested, false);
        assert.equal(proof.verifiedPrHeadSha, "a79c53844b6b4eff58e2b63ed86aec9dc8103273");
        assert.equal(proof.workflowRunId, 41272751903);
        assert.equal(proof.workflowJobId, 124748701503);
        continue;
      }
      // webhooks/xendit-payout POST: provider-callback receipt; anchors and pins are checked by the dedicated test at the end of this file.
      if (proof?.file === "scripts/qa/tenant-webhook-xendit-payout-http.mjs") {
        assert.equal(path + " " + method.name, "src/app/api/webhooks/xendit-payout/route.ts POST", "No unrelated method may reuse the xendit payout webhook evidence");
        assert.equal(proof.independentSecurityReview, "PENDING");
        assert.equal(proof.productionTested, false);
        assert.equal(proof.verifiedPrHeadSha, "2e7e23edeec362ff90203b1cc0e243aa3db8bf4a");
        assert.equal(proof.workflowRunId, 41367679707);
        assert.equal(proof.workflowJobId, 125031218758);
        continue;
      }
      // webhooks/paymongo/transfers POST: provider-callback receipt; anchors and pins are checked by the dedicated test at the end of this file.
      if (proof?.file === "scripts/qa/tenant-webhook-paymongo-transfer-http.mjs") {
        assert.equal(path + " " + method.name, "src/app/api/webhooks/paymongo/transfers/route.ts POST", "No unrelated method may reuse the PayMongo transfer webhook evidence");
        assert.equal(proof.independentSecurityReview, "PENDING");
        assert.equal(proof.productionTested, false);
        assert.equal(proof.verifiedPrHeadSha, "c510fc14ef1188e65aafe929aa287898c07db4b9");
        assert.equal(proof.workflowRunId, 41402106010);
        assert.equal(proof.workflowJobId, 125135951277);
        continue;
      }
      // webhooks/resend POST: provider-callback receipt; anchors and pins are checked by the dedicated test at the end of this file.
      if (proof?.file === "scripts/qa/tenant-webhook-resend-http.mjs") {
        assert.equal(path + " " + method.name, "src/app/api/webhooks/resend/route.ts POST", "No unrelated method may reuse the Resend webhook evidence");
        assert.equal(proof.independentSecurityReview, "PENDING");
        assert.equal(proof.productionTested, false);
        assert.equal(proof.verifiedPrHeadSha, "5e1aeba102cc66486c251d8f6d50432fcb4a4cdc");
        assert.equal(proof.workflowRunId, 41829420219);
        assert.equal(proof.workflowJobId, 126572429402);
        continue;
      }
      // webhooks/xendit/subscriptions POST: provider-callback receipt; pins are checked by the dedicated test at the end of this file.
      if (proof?.file === "scripts/qa/tenant-webhook-xendit-subscriptions-http.mjs") {
        assert.equal(path + " " + method.name, "src/app/api/webhooks/xendit/subscriptions/route.ts POST", "No unrelated method may reuse the Xendit subscriptions evidence");
        assert.equal(proof.independentSecurityReview, "PENDING");
        assert.equal(proof.productionTested, false);
        assert.equal(proof.verifiedPrHeadSha, "c7fda44131306a1ce9ebb26500a308cc1a32b36f");
        assert.equal(proof.workflowRunId, 41979854009);
        assert.equal(proof.workflowJobId, 127087199194);
        continue;
      }
      if (proof?.file === "scripts/qa/tenant-dl01-vault-http.mjs") {
        const spec = method.name === "GET" && path === "src/app/api/employee-vault/route.ts"
          ? { own: 128, foreign: 132, forged: 138, ownStatus: 200, forgedStatus: 200 }
          : method.name === "DELETE" && path === "src/app/api/employee-vault/[id]/route.ts"
            ? { own: 154, foreign: 145, forged: 166, ownStatus: 204, forgedStatus: 204 }
            : null;
        assert.ok(spec, path + ": no unrelated API may borrow provisional vault evidence");
        const suite = readFileSync(proof.file, "utf8").split("\n");
        const span = l => suite.slice(l - 1, l + 4).join("\n");
        assert.equal(proof.line, spec.own);
        assert.equal(proof.ownPositiveLine, spec.own);
        assert.equal(proof.foreignDenialLine, spec.foreign);
        assert.equal(proof.forgedSelectorLine, spec.forged);
        assert.equal(proof.unchangedDbLine, 179);
        assert.equal(proof.victimExistsLine, 110);
        assert.equal(proof.victimIdOrderingLine, 104);
        assert.match(span(spec.own), /expectStatus\(await request\(/);
        assert.ok(span(spec.own).includes("), " + spec.ownStatus + ","));
        assert.match(span(spec.foreign), /expectStatus\(await request\(/);
        assert.match(span(spec.foreign), method.name === "DELETE" ? /\), 404,/ : /\), 403,/);
        assert.match(span(spec.forged), /expectStatus\(await request\(/);
        assert.ok(span(spec.forged).includes("), " + spec.forgedStatus + ","));
        assert.match(suite[109], /persistedVictimDoc\?\.organizationId, victimOrg\.id/);
        assert.match(span(104), /victimDoc\.id > created\[2\]\[1\]\.id/);
        assert.match(suite[178], /assert\.deepEqual\(await victimSnapshot\(victimOrg\.id\), before/);
        assert.match(source.join("\n"), /verifyDl01Vault\(f, \{ request, expectStatus \}\)/);
        assert.match(source.join("\n"), /TENANT_DL01_VAULT_PROOF === "isolated-ci-only"/);
        assert.match(suite.join("\n"), /TENANT_SECOND_PASS_MODE, "isolated-ci-only"/);
        assert.match(suite.join("\n"), /for \(const idx of \[1, 2\]\)/);
        assert.match(suite.join("\n"), /vault-removed:/);
        const smoke = readFileSync(".github/workflows/security-http-smoke.yml", "utf8");
        assert.match(smoke, /TENANT_DL01_VAULT_PROOF: isolated-ci-only/);
        assert.match(smoke, /EMPLOYEE_DOCUMENT_VAULT_ENABLED: "true"/);
        continue;
      }
      if (proof?.file === "scripts/qa/multi-entity-group-report-http.mjs") {
        // #1341's HTTPS Playwright proof uses request(caller, on, route) and
        // assert.equal(status, code), not the older expectStatus HTTP adapter.
        // Only this exact read method may use that distinct evidence source.
        assert.equal(path, "src/app/api/multi-entity/reports/route.ts",
          "No unrelated API may borrow the group-report browser proof");
        assert.equal(method.name, "GET", "A read proof cannot certify a mutation");
        assert.deepEqual([proof.line, proof.ownPositiveLine, proof.foreignDenialLine],
          [28, 41, 48], "Exact reviewed evidence positions must not drift");
        const suite = readFileSync(proof.file, "utf8");
        assert.match(evidenceLine(proof.file, proof.line, path + " high-ID victim fixture"),
          /const bVictims = await database\.query\(/);
        assert.match(evidenceLine(proof.file, proof.ownPositiveLine, path + " own 200"),
          /const ownReport = await request\(caller, on, "\/api\/multi-entity\/reports\?organizationId=" \+ actor\.ownId\)/);
        assert.match(evidenceLine(proof.file, proof.foreignDenialLine, path + " foreign 403"),
          /assert\.equal\(deniedVictim\.status, 403,/);
        assert.match(suite, /assert\.equal\(process\.env\.CI, "true"\)/);
        assert.match(suite, /assert\.equal\(process\.env\.MULTI_ENTITY_QA_MODE, "synthetic-postgres-only"\)/);
        // #1332's enforced composite FKs must not be removed for a green test.
        // The synthetic historical-row injector must remain disposable/transaction-local.
        assert.match(suite, /assert\.equal\(process\.env\.GITHUB_ACTIONS, "true"\)/);
        assert.match(suite, /postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/app_db/);
        assert.match(suite, /current_database\(\) AS database_name/);
        assert.match(suite, /SELECT contype FROM pg_constraint/);
        assert.match(suite, /employees_tenant_employer_fk/);
        assert.match(suite, /payroll_runs_tenant_employer_fk/);
        assert.match(suite, /assert\.rejects\(/);
        assert.match(suite, /error\?\.code === "23503"/);
        assert.match(suite, /SET LOCAL session_replication_role = replica/);
        assert.match(suite, /await database\.query\("ROLLBACK"\)/);
        assert.match(suite, /assert\.equal\(after\.trigger_mode, "origin"/);
        assert.match(suite, /bVictims\.rows\.length >= 5/);
        assert.match(suite, /"entity-attacker-b@example\.test"/);
        assert.match(suite, /"entity-attacker-c@example\.test"/);
        assert.match(suite, /assert\.equal\(ownReport\.status, 200,/);
        assert.match(suite, /assert\.equal\(deniedOther\.status, 403,/);
        assert.match(suite, /assert\.equal\(refused\.status, 409,/);
        assert.match(suite, /assert\.equal\(refusedReleasedRun\.status, 409,/);
        assert.match(suite, /assert\.deepEqual\(intact\.rows, untouchedVictim\.rows,/);
        assert.match(suite, /assert\.equal\(restored\.status, 200,/);
        assert.match(suite, /assert\.equal\(afterReleasedTest\.status, 200\);/);
        const browser = readFileSync("scripts/multi-entity-synthetic-browser.mjs", "utf8");
        assert.match(browser, /import \{ verifyMultiEntityReportTenantIsolation \} from "\.\/qa\/multi-entity-group-report-http\.mjs"/);
        assert.match(browser, /await verifyMultiEntityReportTenantIsolation\(\{/);
        const workflow = readFileSync(".github/workflows/multi-entity-browser-qa.yml", "utf8");
        assert.match(workflow, /node scripts\/multi-entity-synthetic-browser\.mjs/);
        continue;
      }
      if (proof?.file === "scripts/qa/payout-destination-entity-http.mjs") {
        // PR #1367: this NEW evidence source is not a general-purpose bypass.
        // Only the exact two changed payout endpoints may cite this dedicated
        // production-mode authenticated HTTPS / synthetic PostgreSQL 16 suite.
        const pins = {
          "GET payout-destination-changes": {
            route: "src/app/api/payout-destination-changes/route.ts",
            fields: [12, 208, 216, 218, 229, 193],
          },
          "PATCH payout-destination-changes/[id]": {
            route: "src/app/api/payout-destination-changes/[id]/route.ts",
            fields: [12, 234, 222, 226, 229, 193],
          },
        }[method.name + " " + entry.route];
        assert.ok(pins && pins.route === path,
          path + " " + method.name + ": payout evidence may not certify an unrelated method");
        assert.deepEqual([proof.line, proof.ownPositiveLine, proof.foreignDenialLine,
          proof.forgedSelectorLine, proof.unchangedDbLine, proof.victimIdOrderingLine],
        pins.fields, "Reviewed payout evidence line pins may not drift");
        const suite = readFileSync(proof.file, "utf8");
        const lines = suite.split("\n");
        assert.match(lines[11], /export const PAYOUT_ENTITY_METHODS/);
        assert.match(lines[192], /check\(aAlpha\.evidence\.id > 6 && aAlpha\.evidence\.id > bRows\.at\(-1\)\.evidence\.id/);
        assert.match(lines[207], /const getB = ownRequests\(await request\(b, ON, ownB\)/);
        assert.match(lines[208], /const getC = ownRequests\(await request\(c, ON, ownC\)/);
        assert.match(lines[215], /await deniedAndUnchanged\(actor, ON, victimList, "GET", undefined, 403, victimA/);
        assert.match(lines[217], /await deniedAndUnchanged\(actor, ON, own \+ "&employeeId=" \+ aAlpha\.worker\.id/);
        assert.match(lines[221], /await deniedAndUnchanged\(actor, ON, patch\(aAlpha\.evidence\.id\)/);
        assert.match(lines[225], /await deniedAndUnchanged\(actor, ON, patch\(item\.evidence\.id\)/);
        assert.match(lines[228], /assert\.deepEqual\(await snapshot\(victimA\), victimBefore/);
        assert.match(lines[233], /const positivePatchB = expectStatus\(await request\(b, ON, patch\(bRows\[0\]\.evidence\.id\)/);
        assert.match(lines[236], /const positivePatchC = expectStatus\(await request\(c, ON, patch\(cRows\[0\]\.evidence\.id\)/);
        assert.match(lines.slice(233, 237).join("\n"), /"PATCH", decision\(attackerB, bEntity\)\), 200/);
        assert.match(lines.slice(236, 240).join("\n"), /"PATCH", decision\(attackerC, cEntity\)\), 200/);
        assert.match(lines.slice(221, 225).join("\n"), /"PATCH", decision\(orgId, entity\), 404/);
        assert.match(suite, /const victimBefore = await snapshot\(victimA\)/);
        assert.match(suite, /sql\.query\("SELECT to_jsonb\(a\) AS row FROM audit_events a/);
        assert.match(suite, /const b = await signedIn\(checkers\.b, ON\), c = await signedIn\(checkers\.c, ON\)/);
        assert.match(suite, /"\/api\/auth\/login"/);
        assert.match(suite, /session\?\.secure && session\.httpOnly/);
        assert.match(suite, /assert\.equal\(process\.env\.GITHUB_ACTIONS, "true"\)/);
        assert.match(suite, /assert\.equal\(process\.env\.CI, "true"\)/);
        assert.match(suite, /assert\.equal\(process\.env\.MULTI_ENTITY_ENABLED, "true"\)/);
        assert.match(suite, /postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/app_db/);
        assert.match(suite, /await deniedAndUnchanged\(pa, ON, patch\(legacy\.evidence\.id\)/);
        assert.match(suite, /await deniedAndUnchanged\(pb, ON, patch\(transferred\.evidence\.id\)/);
        assert.match(suite, /Revoked employer grant denies same signed-in session GET/);
        assert.match(suite, /Flag-OFF legacy read compatibility/);
        assert.match(suite, /realPayout: false, productionApproved: false/);
        const workflow = readFileSync(".github/workflows/multi-entity-browser-qa.yml", "utf8");
        assert.match(workflow, /MULTI_ENTITY_QA_MODE: synthetic-postgres-only/);
        assert.match(workflow, /image: postgres:16/);
        assert.match(workflow, /node scripts\/qa\/payout-destination-entity-http\.mjs/);
        continue;
      }
      if (proof?.file === "scripts/qa/hcm-manager-direct-reports-http.mjs") {
        // This module uses the fixed API constant and requestOn() instead of
        // inlining the URL in each request. Do not weaken the generic path
        // guard for other proof sources or let another route borrow this proof.
        assert.equal(path, "src/app/api/hcm/manager-direct-reports/route.ts");
        assert.equal(method.name, "GET");
        const lines = readableLines(proof.file);
        const source = lines.join("\n");
        const positive = evidenceLine(proof.file, proof.ownPositiveLine, path + " own");
        const negative = evidenceLine(proof.file, proof.foreignDenialLine, path + " victim");
        assert.match(source, /^const API = "\/api\/hcm\/manager-direct-reports";$/m);
        assert.match(positive, /const ownApi = await requestOn\(API \+ "\?organizationId=" \+ own\.id, cookie\)/);
        assert.match(negative, /const foreignApi = await requestOn\(API \+ "\?organizationId=" \+ victim\.id, cookie\)/);
        assert.match(source, /for \(const idx of \[1, 2\]\)/);
        assert.match(source, /assert\.equal\(ownApi\.status, 200/);
        assert.match(source, /assert\.equal\(foreignApi\.status, 403/);
        assert.match(source, /assert\.equal\(data\.items\.length, 1/);
        assert.match(source, /assert\.equal\(data\.items\[0\]\.employeeNo, ownWorker\.employeeNo\)/);
        assert.match(source, /victimWorkersBefore, "Denied manager reads must not modify victim employees"/);
        assert.match(source, /victimPayrollBefore, "Denied manager reads must not modify victim payroll"/);
        const runner = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
        assert.match(runner, /verifyHcmManagerDirectReports\(f, \{ makeSession \}\)/);
        continue;
      }
      // ESS contribution case GET/POST: same-session revoked former-employer
      // 403 is the negative proof for this employee-only route. An attacker
      // cannot choose the other employer with a query/body selector; do not
      // mistake that for an authenticated cross-tenant negative. Require the
      // actual positive/negative HTTP calls, persisted victim member and
      // unchanged PostgreSQL evidence on the isolated CI runner.
      if (proof?.file === "scripts/qa/tenant-ess-statutory-identity-http.mjs") {
        assert.equal(path, "src/app/api/self/contribution-issues/route.ts",
          "Only ESS contribution-case GET/POST may use this source");
        const pins = method.name === "GET"
          ? { own: 123, denied: 236, ownStatus: 200 }
          : method.name === "POST"
            ? { own: 96, denied: 244, ownStatus: 201 } : null;
        assert.ok(pins, "An unrelated method cannot borrow ESS contribution-case coverage");
        assert.deepEqual([
          proof.line, proof.ownPositiveLine, proof.foreignDenialLine,
          proof.unchangedDbLine, proof.victimIdOrderingLine,
          proof.denialKind, proof.ownStatus, proof.foreignStatus,
        ], [pins.own, pins.own, pins.denied, 252, 136,
          "same-session-revoked-membership", pins.ownStatus, 403],
        "ESS contribution proof line pins or denial classification changed without review");
        assert.match(method.reason, /PROVISIONAL/,
          "Unmerged CI evidence is not independently accepted");
        const src = readFileSync(proof.file, "utf8");
        const lines = src.split("\n");
        // Long synthetic POST bodies can place their explicit HTTP status
        // more than eight lines after the request start (e.g. foreign member
        // denial at lines 197-206). Keep the request and 404 in one proof span.
        const from = line => lines.slice(line - 1, line + 12).join("\n");
        const positive = evidenceLine(proof.file, pins.own, path + " own");
        const denied = evidenceLine(proof.file, pins.denied, path + " revoked");
        const ownSpan = from(pins.own);
        const deniedSpan = from(pins.denied);
        const endpoint = "/api/self/contribution-issues";
        assert.match(positive, /expectStatus\(await request\(/,
          "Positive evidence must start the actual HTTP request");
        assert.match(denied, /expectStatus\(await request\(/,
          "Negative evidence must start the actual HTTP request");
        assert.ok(ownSpan.includes(endpoint) && deniedSpan.includes(endpoint),
          "Both actual requests must target the credited ESS route");
        assert.ok(ownSpan.includes("), " + pins.ownStatus + ",") &&
          deniedSpan.includes("), 403,"),
        "Real own 200/201 and former-member 403 are mandatory");
        if (method.name === "POST") {
          assert.match(ownSpan, /method: "POST"/);
          assert.match(deniedSpan, /method: "POST"/);
          assert.deepEqual([proof.forgedForeignMemberDenialLine,
            proof.victimMemberHighIdLine], [197, 162]);
          assert.match(evidenceLine(proof.file, 197, path + " foreign member"),
            /const forbiddenMember = expectStatus\(await request\("\/api\/self\/contribution-issues"/);
          assert.match(from(197), /\), 404,/,
            "Genuine cross-employer remittance member must be denied by record scope");
          assert.match(evidenceLine(proof.file, 162, path + " victim high-ID member"),
            /victimMember\?\.id > 6 && victimMember\.organizationId === victim\.org\.id/);
        }
        assert.match(evidenceLine(proof.file, 136, path + " real victim ID"),
          /f\.victimEmployee\.id > 6/);
        assert.match(evidenceLine(proof.file, 252, path + " unchanged DB"),
          /assert\.deepEqual\(await snapshot\(victim\.org\.id\), victimBefore/);
        for (const table of ["cases", "events", "remittanceBatches", "remittanceMembers",
          "ids", "tasks", "audit", "outbox"]) {
          assert.ok(src.includes(table + ": await readTenantRows("),
            "Snapshot must cover victim " + table);
        }
        assert.match(src, /for \(const index of \[1, 2\]\)/);
        assert.match(src, /await readOwn\(http, attacker/);
        assert.match(src, /await db\.update\(userOrganizations\)\.set\(\{ active: false \}\)/);
        assert.match(src, /const session = expectStatus\(await request\("\/api\/auth\/me"/);
        assert.match(src, /assert\.equal\(session\.json\?\.user\?\.id, victim\.actor\.id\)/);
        assert.match(src, /assert\.equal\(active\.length, 1, "second employer grant must remain active"/);
        assert.match(src, /noLeak\(revokedContributionGet, sentinel\)/);
        assert.match(src, /noLeak\(caseDenied, sentinel\)/);
        assert.match(src, /process\.env\.TENANT_SECOND_PASS_MODE, "isolated-ci-only"/);
        assert.match(src, /process\.env\.CI, "true"/);
        assert.match(src, /pg\.hostname, "127\.0\.0\.1"/);
        assert.match(src, /pg\.pathname, "\/app_db"/);
        assert.match(src, /process\.env\.PII_ENCRYPTION_KEY/);
        assert.match(src, /!process\.env\.PAYMONGO_SECRET_KEY && !process\.env\.XENDIT_SECRET_KEY/);
        assert.match(src, /!process\.env\.POSTMARK_SERVER_TOKEN && !process\.env\.SMTP_URL/);
        const runner = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
        const workflow = readFileSync(".github/workflows/security-http-smoke.yml", "utf8");
        assert.match(runner, /verifyEssStatutoryIdentityIsolation\(f, \{ request, expectStatus, makeSession \}\)/,
          "This exact HTTP test must actually execute in the second-pass runner");
        assert.match(workflow, /run: npx tsx scripts\/qa\/tenant-second-pass-http\.mjs/);
        assert.match(workflow, /TENANT_SECOND_PASS_MODE: isolated-ci-only/);
        assert.match(workflow, /image: postgres:16/);
        continue;
      }
      // WRK-01 staffing-policy POST/PATCH: only these two methods on this route may
      // claim the dedicated fictional PG16 proof, and only while the route, proof,
      // contract and workflow stay byte-identical to the passing exact-head run.
      if (proof?.file === "scripts/qa/tenant-performance-core-http.mjs") {
        verifyPerformanceCoreCredit(method.name + " " + entry.route, method);
        const workflow = readFileSync(".github/workflows/tenant-table-proof.yml", "utf8");
        assert.ok(workflow.includes("env -u NODE_ENV npx tsx scripts/qa/tenant-performance-core-http.mjs"));
        assert.ok(workflow.includes("image: postgres:16"));
        continue;
      }
      if (proof?.file === "scripts/qa/tenant-wrk01-staffing-writes-http.mjs") {
        assert.equal(path, "src/app/api/workforce/demand-staffing/policies/route.ts",
          "No unrelated route may reuse the staffing-policy write evidence");
        const spec = {
          POST: {
            own: 251, second: 263, foreign: 297, forged: 299, ordering: 238,
            ownPattern: /e\.approve = await positive\(e, "POST", e\.approveBody, "draft",/,
            secondPattern: /e\.reject = await positive\(e, "POST", e\.rejectBody, "draft",/,
            foreignPattern: /await denied\("POST", foreign, actor\.cookie, 403,/,
            forgedPattern: /await denied\("POST", \{[\s\S]*?worksiteId: victim\.site\.id[\s\S]*?403,/,
            actions: ["create", "idempotent replay"],
          },
          PATCH: {
            own: 342, second: 367, foreign: 315, forged: 318, ordering: 269,
            ownPattern: /const approved = await positive\(e, "PATCH",/,
            secondPattern: /const rejected = await positive\(e, "PATCH",/,
            foreignPattern: /await denied\("PATCH", \{[\s\S]*?transition\(victim, victim\.approve\.row\.id, "submit"\)[\s\S]*?403,/,
            forgedPattern: /await denied\("PATCH", \{[\s\S]*?transition\(actor, victim\.approve\.row\.id, "submit"\)[\s\S]*?409,/,
            actions: ["submit", "approve", "reject"],
          },
        }[method.name];
        assert.ok(spec, path + ": only staffing-policy POST and PATCH are in this batch");
        assert.deepEqual([proof.line, proof.ownPositiveLine, proof.secondaryOwnPositiveLine,
          proof.foreignDenialLine, proof.forgedSelectorLine, proof.unchangedDbLine,
          proof.victimIdOrderingLine],
        [spec.own, spec.own, spec.second, spec.foreign, spec.forged, 79, spec.ordering],
        method.name + ": staffing-policy evidence pins changed without review");
        assert.deepEqual(proof.methodActions, spec.actions);
        assert.equal(proof.reviewedHead, "fc5219fa4147c11e0b3d76b35c82754a4d875f4e");
        assert.equal(proof.passedJob,
          "https://github.com/erwinmehehe/payrollph/actions/runs/40647378457/job/122679238079");
        assert.equal(proof.workflowRunId, 40647378457);
        assert.equal(proof.postgresMajor, 16);
        const script = readFileSync(proof.file, "utf8");
        const contract = readFileSync("scripts/qa/tenant-wrk01-staffing-writes-contract.mjs", "utf8");
        const workflowFile = ".github/workflows/tenant-wrk01-staffing-writes-http.yml";
        const workflow = readFileSync(workflowFile, "utf8");
        assert.equal(gitBlobSha(readFileSync(path)), proof.routeBlobSha,
          "Changes to the staffing-policy route require renewed authorization review");
        assert.equal(gitBlobSha(Buffer.from(script)), proof.proofBlobSha,
          "Changes to the staffing-policy HTTP scenarios require a new executed proof");
        assert.equal(gitBlobSha(Buffer.from(contract)), proof.contractBlobSha,
          "Changes to the staffing-policy contract require a new executed proof");
        assert.equal(gitBlobSha(Buffer.from(workflow)), proof.workflowBlobSha,
          "Changes to the staffing-policy workflow require a new executed proof");
        const lines = script.split("\n");
        const span = (line, length = 6) => lines.slice(line - 1, line - 1 + length).join("\n");
        assert.match(span(spec.own), spec.ownPattern);
        assert.match(span(spec.second), spec.secondPattern);
        assert.match(span(spec.foreign), spec.foreignPattern);
        assert.match(span(spec.forged), spec.forgedPattern);
        assert.match(lines[78], /await unchangedEverywhere\(before, context\);/);
        assert.match(span(spec.ordering, 3), /victim\.(?:site|job|worker)\.id > a\.|victim\.approve\.row\.id > a\.reject\.row\.id/);
        if (method.name === "PATCH") {
          assert.match(span(337, 3), /await positive\(e, "PATCH",\s*\n?\s*transition\(e, e\.approve\.row\.id, "submit"\)/);
        }
        assert.match(script, /for \(const actor of \[a, b\]\)/);
        assert.match(script, /for \(const e of \[a, b, victim\]\)/);
        assert.match(script, /assertImmutableStaffingSql\(allBefore\.get\(other\.org\.id\)/);
        assert.match(script, /requireDisposableStaffingWrites\(\)/);
        assert.match(contract, /assert\.equal\(env\.GITHUB_ACTIONS, "true"\)/);
        assert.match(workflow, /image: postgres:16/);
        assert.match(workflow, /node --import tsx scripts\/qa\/tenant-wrk01-staffing-writes-http\.mjs/);
        const policyRoute = readFileSync(path, "utf8");
        assert.match(policyRoute, /export async function POST\(/);
        assert.match(policyRoute, /export async function PATCH\(/);
        assert.match(readFileSync("src/lib/workforce-demand-staffing-policy.ts", "utf8"),
          /!\["submit","approve","reject"\]\.includes\(input\.action as string\)/,
          "PATCH gained or lost an action; every action needs its own proof");
        assert.match(method.reason, /Independent security\/coverage-owner review/);
        assert.equal(proof.productionCertified, false);
        assert.match(proof.independentReview, /^PENDING/);
        continue; // GET (manage mode unproven) stays GAP; no sibling credit.
      }
      if (proof.file === "scripts/qa/tenant-issued-demand-http.mjs") {
        // Only these two exact source-pinned POST methods use the standalone PG16
        // write harness; their own, victim, forged, SQL and SHA pins are checked
        // by the dedicated method verifier rather than the generic GET locator.
        verifyIssuedDemandSoloRecovery(method, path, gitBlobSha(readFileSync(path)));
        continue;
      }
      if (proof?.evidenceLabel === "SOLO_VERIFIED_DEV_RECOVERY" &&
          ["leave","governed-handoffs"].includes(entry.route)) {
        assert.equal(path, "src/app/api/" + entry.route + "/route.ts");
        assert.equal(method.name, "POST");
        assert.equal(proof.file, "scripts/qa/tenant-workflow-leave-handoff-http.mjs");
        assert.equal(proof.workflowFile, ".github/workflows/tenant-workflow-leave-handoff-pg16.yml");
        assert.equal(proof.workflowRunId, 41452144006);
        assert.equal(proof.verifiedPrHeadSha, "49360001aa6ca2911f1e99617ba3ad34d82a6a67");
        assert.equal(proof.ownerReviewer, "@erwinmehehe");
        assert.equal(proof.ownerIsOnlyReviewer, true);
        assert.equal(proof.independentlyAccepted, false);
        assert.equal(proof.postgresMajor, 16);
        assert.equal(proof.productionCertified, false);
        assert.equal(gitBlobSha(readFileSync(path)), proof.routeBlobSha);
        assert.equal(gitBlobSha(readFileSync(proof.file)), proof.proofBlobSha);
        assert.equal(gitBlobSha(readFileSync(proof.workflowFile)), proof.workflowBlobSha);
        const expectLines = entry.route === "leave" ? [284,385,388,413] : [188,400,403,413];
        assert.deepEqual([proof.ownPositiveLine, proof.foreignDenialLine, proof.forgedSelectorLine, proof.unchangedDbLine], expectLines);
        for (const line of expectLines)
          assert.ok(evidenceLine(proof.file,line,entry.route + " four-part proof").length > 15);
        continue;
      }
      // Six specific POST proofs are independently guarded by the
      // "2026-11-02 exact-head promotion sweep" test below. Do not widen the
      // generic evidence-source allowlist or let an unrelated route borrow one.
      // These two WRK-01 source-specific methods retain exact PG16 receipts.
      const wfmTwo = {
        "scripts/qa/tenant-wfm-three-method-post-http.mjs": {
          route: "src/app/api/workforce/roster-rules/preview/route.ts", method: "POST",
          contract: "scripts/qa/tenant-wfm-three-method-contract.mjs", job: 124808879396,
          own: /const own = await post\(bodyFor\(employer, patch\), employer\.cookie\)/,
          foreign: /const response = await post\(body, attacker\.cookie\)/,
          forged: /stolen employee/, unchanged: /assertRosterPreviewImmutable\(/,
        },
      };
      const wfmSpec = wfmTwo[proof?.file];
      if (wfmSpec) {
        assert.equal(path, wfmSpec.route, "WFM proof cannot be borrowed by another API route");
        assert.equal(method.name, wfmSpec.method, "WFM proof must match the actual HTTP method");
        assert.equal(proof.verifiedPrHeadSha, "a5c70e563580c5ab9cb6d8db7610f3950148a27e");
        assert.equal(proof.workflowRunId, 41293308290);
        assert.equal(proof.workflowJobId, wfmSpec.job);
        assert.equal(proof.independentSecurityReview, "PENDING");
        assert.equal(proof.productionTested, false);
        assert.equal(proof.productionCertified, false);
        assert.equal(proof.routeBlobSha, gitBlobSha(readFileSync(path)),
          "WFM route drift requires a new exact-head real-HTTP proof");
        assert.equal(proof.proofBlobSha, gitBlobSha(readFileSync(proof.file)),
          "WFM HTTP proof changed since the passing job");
        assert.equal(proof.contractBlobSha, gitBlobSha(readFileSync(wfmSpec.contract)),
          "WFM response/tenant proof contract changed");
        const workflowFile = ".github/workflows/tenant-wfm-three-method-http.yml";
        assert.equal(proof.workflowFile, workflowFile);
        const workflow = readFileSync(workflowFile, "utf8");
        assert.equal(proof.workflowBlobSha, gitBlobSha(Buffer.from(workflow)),
          "Synthetic allowlist/flag profiles or CI job drifted");
        assert.match(workflow, /image: postgres:16/);
        for (const [field, pattern] of [
          ["ownPositiveLine", wfmSpec.own],
          ["foreignDenialLine", wfmSpec.foreign],
          ["forgedSelectorLine", wfmSpec.forged],
          ["unchangedDbLine", wfmSpec.unchanged],
        ]) assert.match(evidenceLine(proof.file, proof[field], path + " " + field), pattern);
        assert.ok(proof.victimIdOrderingLine > 0);
        assert.match(proof.evidence, /^https:\/\/github\.com\/erwinmehehe\/payrollph\/actions\/runs\/41293308290\/job\/124808879396$/);
        continue;
      }
      if (proof?.file === "scripts/qa/tenant-wrk01-greedy-roster-http.mjs") {
        assert.equal(path, "src/app/api/workforce/greedy-roster/route.ts");
        assert.equal(method.name, "GET");
        assert.equal(proof.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY");
        assert.equal(proof.ownerIsOnlyReviewer, true);
        assert.equal(proof.workflowRunId, 41447125405);
        assert.equal(proof.verifiedPrHeadSha, "8245efd876c38f2b7ba02ece12ac515b8775d6ed");
        assert.equal(proof.postgresMajor, 16);
        for (const [field, line, marker] of [
          ["ownPositiveLine", 427, "assertSuggestedGreedyRoster(positiveResponse"],
          ["foreignDenialLine", 289, "await denied(actor.label + \" foreign organization\""],
          ["forgedSelectorLine", 432, "const forgedEligible = await read(eligible"],
          ["unchangedDbLine", 429, "await assertAllUnchanged(positiveBaseline"],
          ["victimIdOrderingLine", 191, "victim[key].id > 6"],
        ]) {
          assert.equal(proof[field], line, "Repin actual line of four-part GET assertion");
          assert.ok(evidenceLine(proof.file, line, field).includes(marker));
        }
        assert.equal(proof.routeBlobSha, entry.gitBlobSha);
        assert.equal(gitBlobSha(readFileSync(path)), proof.routeBlobSha);
        assert.equal(gitBlobSha(readFileSync(proof.file)), proof.proofBlobSha);
        assert.equal(gitBlobSha(readFileSync(proof.workflowFile)), proof.workflowBlobSha);
        continue;
      }
      const promotedWrites = new Map([
        ["leave/conversion", ["scripts/qa/tenant-leave-conversion-post-http.mjs", 42153538138]],
        ["payroll/overpayment-preflight", ["scripts/qa/tenant-overpayment-preflight-post-http.mjs", 41264867045]],
        ["outbox", ["scripts/qa/tenant-edg02-outbox-http.mjs", 41306939767]],
        ["treasury-controls", ["scripts/qa/tenant-mny02-treasury-http.mjs", 41319237095]],
        ["compliance/labor-inspection", ["scripts/qa/tenant-labor-inspection-post-http.mjs", 41392987376]],
        ["earned-wage", ["scripts/qa/tenant-earned-wage-post-http.mjs", 41366324196]],
      ]);
      const promotion = promotedWrites.get(entry.route);
      if (promotion && method.name === "POST") {
        assert.equal(path, "src/app/api/" + entry.route + "/route.ts");
        assert.equal(proof.file, promotion[0], "Method may not borrow an unrelated POST proof");
        assert.equal(proof.workflowRunId, promotion[1], "Unreviewed proof run is not accepted");
        assert.equal(proof.postgresMajor, 16);
        assert.equal(proof.routeBlobSha, entry.gitBlobSha);
        assert.equal(gitBlobSha(readFileSync(path)), proof.routeBlobSha);
        assert.equal(gitBlobSha(readFileSync(proof.file)), proof.proofBlobSha,
          "Changed POST test requires a new executed localhost proof");
        assert.equal(gitBlobSha(readFileSync(proof.workflowFile)), proof.workflowBlobSha,
          "Changed POST workflow requires a new executed localhost proof");
        assert.equal(proof.independentSecurityReview, "PENDING");
        continue; // Only the six pinned sources; every other method uses strict standard guards.
      }
      // Four exact source-bound PG16 year-end/prior-evidence credits, no generic exemption.
      if (proof?.evidenceLabel === "SOLO_VERIFIED_DEV_RECOVERY" &&
          ["year-end", "year-end/prior-evidence"].includes(entry.route)) {
        const expectedProof = entry.route === "year-end"
          ? "scripts/qa/tenant-table-rows/write/year-end-annualization-post.mjs" : "scripts/qa/tenant-sta01-prior-evidence-http.mjs";
        const expectedRun = entry.route === "year-end" ? 41446394887 : 41446394999;
        const expectedWorkflow = entry.route === "year-end"
          ? ".github/workflows/tenant-year-end-post-candidate.yml" : ".github/workflows/tenant-sta01-prior-evidence-http.yml";
        assert.equal(proof.file, expectedProof);
        assert.equal(proof.workflowFile, expectedWorkflow);
        assert.equal(proof.workflowRunId, expectedRun);
        assert.equal(proof.verifiedPrHeadSha, "066c1d6b405365ff9ddacc229b8d0ce5cbc68aa5");
        assert.equal(proof.postgresMajor, 16);
        assert.equal(proof.ownerReviewer, "@erwinmehehe");
        assert.equal(proof.ownerIsOnlyReviewer, true);
        assert.equal(proof.independentlyAccepted, false);
        assert.equal(proof.productionCertified, false);
        assert.equal(path, "src/app/api/" + entry.route + "/route.ts");
        assert.ok(["GET", "POST"].includes(method.name));
        assert.equal(proof.routeBlobSha, entry.gitBlobSha);
        assert.equal(gitBlobSha(readFileSync(path)), proof.routeBlobSha);
        assert.equal(gitBlobSha(readFileSync(proof.file)), proof.proofBlobSha);
        assert.equal(gitBlobSha(readFileSync(proof.workflowFile)), proof.workflowBlobSha);
        const approved = [
          ["year-end GET", [168, 113, 118, 116]],
          ["year-end POST", [125, 140, 144, 148]],
          ["year-end/prior-evidence GET", [142, 176, 189, 203]],
          ["year-end/prior-evidence POST", [141, 179, 192, 203]],
        ];
        const [name, lines] = approved.find(([name]) => name === entry.route + " " + method.name) ?? [];
        assert.ok(name, "No unrelated method may borrow year-end proof");
        assert.deepEqual([proof.ownPositiveLine,proof.foreignDenialLine,proof.forgedSelectorLine,proof.unchangedDbLine],lines);
        for (const line of lines) assert.ok(evidenceLine(proof.file, line, entry.route + " real HTTP assertion").length > 15);
        continue;
      }
      if (proof?.evidenceLabel === "SOLO_VERIFIED_DEV_RECOVERY" &&
          ["compliance/contribution-issues", "compliance/payroll-month-close", "compliance/statutory-remittances"].includes(entry.route)) {
        const pinned = new Map([
          ["compliance/contribution-issues", ["scripts/qa/tenant-table-rows/write/compliance-contribution-post.mjs", 43, "dfcf1615be01bb151e13a5d74c080299575ce53a"]],
          ["compliance/payroll-month-close", ["scripts/qa/tenant-table-rows/write/compliance-payroll-month-close-post.mjs", 49, "21daf9c24d55f4fb01ce84c6f5aef822ce0f3193"]],
          ["compliance/statutory-remittances", ["scripts/qa/tenant-table-rows/write/compliance-statutory-remittances-post.mjs", 75, "f24a7349c902dae0bc41a3989c8a88df24aedb6f"]],
        ]);
        const [rowFile, rowLine, rowSha] = pinned.get(entry.route);
        assert.equal(path, "src/app/api/" + entry.route + "/route.ts");
        assert.equal(method.name, "POST");
        assert.equal(proof.file, "scripts/qa/tenant-write-table-http.mjs");
        assert.equal(proof.workflowFile, ".github/workflows/tenant-compliance-post-candidate.yml");
        assert.equal(proof.workflowRunId, 41446327305);
        assert.equal(proof.verifiedPrHeadSha, "d3cdcf020a559ae85c813d656620832dd0a46d4e");
        assert.equal(proof.ownerReviewer, "@erwinmehehe");
        assert.equal(proof.ownerIsOnlyReviewer, true);
        assert.equal(proof.independentlyAccepted, false);
        assert.equal(proof.productionCertified, false);
        assert.equal(proof.postgresMajor, 16);
        assert.equal(proof.routeBlobSha, entry.gitBlobSha);
        assert.equal(gitBlobSha(readFileSync(path)), proof.routeBlobSha);
        assert.equal(gitBlobSha(readFileSync(proof.file)), proof.proofBlobSha);
        assert.equal(gitBlobSha(readFileSync(proof.workflowFile)), proof.workflowBlobSha);
        assert.equal(proof.sourceRowFile, rowFile);
        assert.equal(proof.sourceRowLine, rowLine);
        assert.equal(proof.sourceRowBlobSha, rowSha);
        assert.equal(gitBlobSha(readFileSync(rowFile)), rowSha);
        assert.ok(evidenceLine(rowFile, rowLine, entry.route + " action").includes("POST " + entry.route));
        assert.deepEqual([proof.ownPositiveLine, proof.foreignDenialLine, proof.forgedSelectorLine, proof.unchangedDbLine], [112,125,129,149]);
        for (const field of ["sourceRowOwnPositiveLine","sourceRowForeignDenialLine","sourceRowForgedSelectorLine","sourceRowUnchangedDbLine"])
          assert.ok(evidenceLine(rowFile, proof[field], entry.route + " four-part " + field).length > 14);
        continue;
      }
      // Only the three distinct source-pinned #1762 PG16 HTTP method receipts
      // may gain the new provisional PII/EDG credit. This verifier checks
      // unchanged route, runner, contract and workflow Git blobs, actual own,
      // victim, forged-selector and unchanged-PG16 evidence line anchors.
      const recovered = FIVE_METHOD_EVIDENCE.find(e =>
        path === "src/app/api/" + e.route + "/route.ts" && method.name === e.method);
      if (recovered) {
        assert.equal(proof?.file, recovered.file,
          "Provisional method credit cannot borrow another proof runner");
        assert.equal(verifyFiveMethodCredits(manifest).methodsCredited, FIVE_METHOD_EVIDENCE.length,
          "All three exact-head source/contract/workflow receipts must pass");
        continue;
      }
      if (entry.route === "employees/[id]/mwe-classifications/[classificationId]" &&
          method.name === "PATCH") {
        // Exactly one provisional PII-02 proof. Do not accept other files or
        // reuse sibling GET/POST receipts; source changes require renewed CI.
        assert.equal(path,
          "src/app/api/employees/[id]/mwe-classifications/[classificationId]/route.ts");
        assert.equal(proof.file, "scripts/qa/tenant-mwe-decision-http.mjs");
        assert.equal(proof.contractFile, "scripts/qa/tenant-mwe-decision-contract.mjs");
        assert.equal(proof.workflowFile, ".github/workflows/tenant-mwe-decision-http.yml");
        assert.equal(proof.libraryFile, "src/lib/mwe-classification.ts");
        assert.equal(proof.routeBlobSha,"b08702d9c56ae506d98be5a917119121a71bb50f");
        assert.equal(proof.libraryBlobSha,"ee82741f6405e59dff3e9eb48cfb9820b449c99a");
        assert.equal(proof.proofBlobSha,"ae1139b9f6396e7f02cee408c919d6acba1198d2");
        assert.equal(proof.contractBlobSha,"8db8b3d0399cf0183f425e151a4158d69e3db9a4");
        assert.equal(proof.workflowBlobSha,"584d159f2d2c250e182d0942188f293baebc2141");
        for (const [pinnedPath,pinnedSha] of [
          [path,proof.routeBlobSha], [proof.libraryFile,proof.libraryBlobSha],
          [proof.file,proof.proofBlobSha],[proof.contractFile,proof.contractBlobSha],
          [proof.workflowFile,proof.workflowBlobSha],
        ]) assert.equal(gitBlobSha(readFileSync(pinnedPath)),pinnedSha,
          "MWE method source/proof drift requires renewed exact-head PostgreSQL HTTP review");
        assert.deepEqual([
          proof.ownPositiveLine,proof.foreignDenialLine,proof.forgedSelectorLine,
          proof.unchangedDbLine,proof.victimIdOrderingLine,
        ], [92,99,107,129,78]);
        const proofLines = readableLines(proof.file);
        assert.match(proofLines[91], /const ownPositive = await decision/);
        assert.match(proofLines[98], /const foreignDenial = await decision/);
        assert.match(proofLines[106], /const forgedSelector = await decision/);
        assert.match(proofLines[128], /assert\.deepEqual\(await snapshot\(victim\.org\.id\)/);
        assert.match(proofLines[77], /victim\.records\[0\]\.id > Math\.max\(6,/);
        const suite = proofLines.join("\n");
        assert.match(suite, /for \(const attacker of attackers\)/);
        assert.match(suite, /requireDecisionPositive\(ownPositive/);
        assert.match(suite, /requireDecisionPositive\(ownReject/);
        assert.match(suite, /assert\.equal\(foreignDenial\.text, unknown\.text/);
        assert.match(suite, /const wrongEmployer = await decision/);
        assert.match(suite, /const revoked = await decision/);
        assert.match(suite, /const knownButForbidden = await decision/);
        assert.match(suite, /assert\.equal\(knownButForbidden\.text, missingForNonChecker\.text/);
        assert.match(suite, /assert\.equal\(wrongEmployer\.text, unknownSecond\.text/);
        assert.match(suite, /assert\.equal\(ungrantedEmployer\.text, unknownSelected\.text/);
        assert.equal(proof.postgresMajor,16);
        assert.deepEqual(proof.methodActions,["approve","reject"]);
        assert.equal(proof.attackerEmployers,2);
        assert.equal(proof.realVictim,true);
        assert.equal(proof.coverageCredits,1);
        assert.equal(proof.independentlyAccepted,false);
        assert.equal(proof.productionCertified,false);
        assert.equal(proof.providerCalls,0);
        continue;
      }
      if (entry.route === "payout-profiles" && method.name === "PATCH") {
        // This is a single source-pinned provisional development receipt,
        // never a new generic proof-source exemption or a security approval.
        assert.equal(path, "src/app/api/payout-profiles/route.ts");
        assert.equal(proof.file, PAYOUT_PATCH_EVIDENCE.file);
        assert.equal(verifyPayoutProfileCredit(manifest), 1,
          "Exact route, proof, workflow, source anchors, receipt and release holds required");
        continue;
      }
      // One separately source-pinned WFM GET credit. Keep the generic
      // evidence-file allowlist closed and do not borrow the write receipts.
      if (path === "src/app/api/workforce/demand-staffing/policies/route.ts" &&
          method.name === "GET") {
        assert.equal(proof.file, "scripts/qa/tenant-wfm-demand-read-overlay-http.mjs");
        assert.equal(verifyStaffingPolicyGetCredit(manifest), 1);
        continue;
      }
      if (path === "src/app/api/expenses/receipts/route.ts" && ["GET", "POST"].includes(method.name)) {
        assert.equal(verifyReceiptCredits(manifest), 2);
        continue;
      }
      if (path === "src/app/api/careers/admin/route.ts" && method.name === "PATCH") {
        assert.equal(verifyCareersPatchCredit(manifest), 1);
        continue;
      }
      if (path === "src/app/api/year-end/route.ts" &&
          ["GET", "POST"].includes(method.name)) {
        // Scope-locked exception: a separate source-pinned #1804 real-HTTP proof,
        // never an additional general proof-file allowlist entry.
        assert.equal(proof.file, "scripts/qa/tenant-table-rows/write/year-end-annualization-post.mjs");
        assert.equal(verifyYearEndCredits(manifest), 2);
        continue;
      }
      // Scope-locked invitation GET/POST retains two executed PG16 receipts.
      if (path === "src/app/api/invitations/accept/route.ts" &&
          ["GET", "POST"].includes(method.name)) {
        assert.equal(verifyInvitationAcceptCredits(manifest), 2,
          "Both separately executed invitation source/job receipts must verify");
        continue;
      }
      assert.ok(["scripts/qa/tenant-second-pass-http.mjs", "scripts/qa/payroll-approved-exit-http.mjs",
        "scripts/qa/payroll-read-sweep-http.mjs", "scripts/qa/bank-tenant-http.mjs",
        "scripts/qa/pr-1302-tenant-proof.mjs",
        "scripts/qa/salary-correction-case-tenant-proof.mjs",
        "scripts/qa/workforce-attendance-sweep-http.mjs",
        "scripts/qa/hcm-work-queue-http.mjs",
        "scripts/qa/tenant-manifest-driven-http.mjs", "scripts/qa/tenant-high-risk-01-http.mjs",
        "scripts/qa/tenant-dl01-import-history-http.mjs", "scripts/qa/tenant-dl01-filing-file-http.mjs",
        "scripts/qa/tenant-dl02-http.mjs", "scripts/qa/government-loan-read-http.mjs", "scripts/qa/dole-13th-month-http.mjs", "scripts/qa/tenant-dl01-batch2-http.mjs",
        "scripts/qa/tenant-table-http.mjs", "scripts/qa/tenant-write-table-http.mjs"].includes(proof?.file),
        path + " " + method.name + ": unsupported evidence source");
      if (["scripts/qa/tenant-dl01-import-history-http.mjs", "scripts/qa/tenant-dl01-filing-file-http.mjs"].includes(proof.file)) {
        const history = proof.file.endsWith("tenant-dl01-import-history-http.mjs");
        const route = history ? "employees/import" : "compliance/filing-validations/[id]/file";
        const key = "GET " + route;
        assert.equal(path, "src/app/api/" + route + "/route.ts", "No unrelated method may borrow DL-01 proof");
        assert.equal(method.name, "GET", "Read proof cannot certify a mutation");
        const declaration = history ? 'export const IMPORT_HISTORY_METHOD = "GET employees/import";' : 'export const FILING_FILE_METHOD = "GET compliance/filing-validations/[id]/file";';
        const suite = readFileSync(proof.file, "utf8");
        const lines = suite.split("\n");
        const pins = {
          line: declaration,
          ownPositiveLine: "const own = expectStatus(await request(",
          foreignDenialLine: "const foreign = expectStatus(await request(",
          forgedSelectorLine: history ? "const ignored = expectStatus(await request(" : "const forged = expectStatus(await request(",
          unchangedDbLine: "assert.deepEqual(after, before,",
          victimExistsLine: "assert.equal(persistedVictim?.organizationId, victimOrg.id)",
          victimIdOrderingLine: history ? "assert.ok(victim.id > 6 && victim.id > rows[8].id && victim.id > rows[9].id)" : "assert.ok(victim.record.id > 6 && victim.record.id > fixtures[7].record.id && victim.record.id > fixtures[8].record.id)",
        };
        for (const [field, fragment] of Object.entries(pins)) {
          assert.ok(evidenceLine(proof.file, proof[field], key + " " + field).trimStart().startsWith(fragment), key + " incorrect " + field);
        }
        const span = field => lines.slice(proof[field] - 1, proof[field] + 3).join("\n");
        assert.ok(span("ownPositiveLine").includes("), 200,"));
        assert.ok(span("foreignDenialLine").includes("), 403,"));
        assert.ok(proof.ownPositiveLine < proof.foreignDenialLine && proof.foreignDenialLine < proof.forgedSelectorLine);
        assert.ok(proof.forgedSelectorLine < proof.unchangedDbLine);
        assert.ok(suite.includes(history ? "assertOwnHistory(own, ownOrg.id, owned, victim)" : "assertOwnedFilingBytes(own, owned)"));
        assert.ok(suite.includes(history ? "assertOwnHistory(ignored, ownOrg.id, owned, victim)" : "assertOwnedFilingBytes(forged, owned)"));
        const snapshot = history ? "snapshotVictimImportHistory" : "snapshotVictimFilings";
        assert.ok(suite.includes("const before = await " + snapshot + "(victimOrg.id)"));
        assert.ok(suite.includes("const after = await " + snapshot + "(victimOrg.id)"));
        assert.ok(suite.includes('process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only"'));
        assert.ok(suite.includes('process.env.SECURITY_SMOKE_URL, "http://127.0.0.1:3000"'));
        assert.ok(suite.includes("for (const idx of [1, 2])"));
        assert.ok(suite.includes("assert.equal(receipts.length, 2)"));
        const hook = readFileSync("scripts/qa/tenant-static-template-http.mjs", "utf8");
        const fn = history ? "verifyTenantImportHistory" : "verifyTenantFilingFile";
        assert.ok(hook.includes("await " + fn + "(f, { request, expectStatus });"));
        assert.ok(source.join("\n").includes("verifyTenantIndependentImportTemplate(f, { request, expectStatus })"));
        continue;
      }
      if (proof.file === "scripts/qa/tenant-dl01-batch2-http.mjs") {
        // Newly credited DL-01 batch 2 claims require distinct same-method
        // live PG16/HTTP evidence, never a method name borrowed from a source
        // guard, 401/404-only negative or a previously covered employee export.
        const key = method.name + " " + entry.route;
        const spec = {
          "POST compliance/statutory-remittances/posting-import": ["ownPosting", "foreignPosting", "forgedPosting", "persistedVictimBatch", "victimBatch.id > batches[idx].id", 404],
          "GET compliance/contribution-issues/evidence": ["ownCase", "foreignCase", "forgedCase", "persistedVictimCase", "victimCase.id > cases[idx].id", 200],
          "GET compliance/labor-inspection/evidence-pack": ["ownInspection", "foreignInspection", "forgedInspection", "persistedVictimWorker", "victimExportWorker.id > f.ownedEmployees[0].id", 200],
          "GET bi-exports": ["ownBi", "foreignBi", "forgedBi", "persistedVictimBiRun", "victimBiRun.id > f.ownRuns[1].id", 400],
        }[key];
        assert.ok(spec, key + ": no unreviewed method may borrow batch-2 proofs");
        const [ownName, foreignName, forgedName, victimName, ordering, forgedStatus] = spec;
        const suite = readFileSync(proof.file, "utf8");
        const lines = suite.split("\n");
        const actual = field => evidenceLine(proof.file, proof[field], key + " " + field);
        const span = field => lines.slice(proof[field] - 1, proof[field] + 12).join("\n");
        assert.ok(actual("line").includes('"' + key + '"'), key + ": wrong adapter declaration");
        assert.ok(actual("ownPositiveLine").includes("const " + ownName + " = expectStatus(await request(") &&
          span("ownPositiveLine").includes("}), 200,"), key + ": real populated own response required");
        assert.ok(actual("foreignDenialLine").includes("const " + foreignName + " = expectStatus(await request(") &&
          span("foreignDenialLine").includes("}), 403,"), key + ": real victim tenant 403 required");
        assert.ok(actual("forgedSelectorLine").includes("const " + forgedName + " = expectStatus(await request(") &&
          span("forgedSelectorLine").includes("}), " + forgedStatus + ","), key + ": forged victim selector is unverified");
        assert.ok(actual("victimExistsLine").includes("assert.equal(" + victimName),
          key + ": real persisted victim row must be checked");
        assert.ok(actual("victimIdOrderingLine").trimStart().startsWith("assert.ok(") &&
          span("victimIdOrderingLine").includes(ordering),
          key + ": victim IDs must exceed real attacker-owned objects");
        assert.match(actual("unchangedDbLine"), /assert\.deepEqual\(after, before,/);
        assert.ok(proof.ownPositiveLine < proof.foreignDenialLine &&
          proof.foreignDenialLine < proof.forgedSelectorLine &&
          proof.forgedSelectorLine < proof.unchangedDbLine);
        assert.ok(suite.includes('assert.equal(process.env.CI, "true")') &&
          suite.includes('assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only")') &&
          suite.includes('assert.equal(app.href, "http://127.0.0.1:3000/")') &&
          suite.includes("for (const idx of [1, 2])") &&
          suite.includes("const before = await victimSnapshot(victimOrg.id)") &&
          suite.includes("const after = await victimSnapshot(victimOrg.id)") &&
          suite.includes('assert.equal(receipts.length, 2, "Both independent attackers must execute every real method")'), key + ": guarded real HTTP harness required");
        assert.ok(source.join("\n").includes('verifyDl01Batch2(f, { request, expectStatus })'),
          key + ": method-specific source must run inside existing protected HTTP runner");
        if (method.name === "POST") {
          assert.match(suite, /assert\.equal\(ownPosting\.json\?\.applied, true\)/);
          assert.match(suite, /assert\.equal\(artifact\?\.outcome, "applied"\)/);
          assert.match(suite, /assert\.equal\(Buffer\.from\(artifact\.fileDataBase64, "base64"\)\.toString\("utf8"\), csv\)/);
        }
        continue;
      }
      if (proof.file === "scripts/qa/tenant-manifest-driven-http.mjs") {
        // The manifest-driven runner uses shared request(urls.own/foreign) lines:
        // those lines do not repeat literal /api paths. Validate the *specific*
        // route adapter and its executable real-HTTP proof instead of relaxing
        // the generic guard for ordinary source-pinned method assertions.
        const key = method.name + " " + entry.route;
        assert.ok(new Set([
          "GET compliance/statutory-remittances/payment-evidence/[id]",
          "GET compliance/statutory-remittances/payment-evidence",
          "GET compliance/statutory-remittances/posting-evidence/[id]",
          "POST compliance/statutory-remittances/payment-evidence",
        ]).has(key), path + " " + method.name + ": unreviewed table-driven credit");
        const suite = readFileSync(proof.file, "utf8");
        const runner = source.join("\n");
        assert.match(runner,
          /await \(await import\("\.\/tenant-manifest-driven-http\.mjs"\)\)\.verifyManifestDrivenStatutoryBatch\(f, \{ request, expectStatus, makeSession \}\)/,
          key + ": proof must execute inside the isolated PostgreSQL HTTP harness");
        assert.match(suite, /process\.env\.TENANT_SECOND_PASS_MODE, "isolated-ci-only"/);
        if (key === "POST compliance/statutory-remittances/payment-evidence") {
          const owned = evidenceLine(proof.file, proof.ownPositiveLine, key + " owned upload");
          const denied = evidenceLine(proof.file, proof.foreignDenialLine, key + " foreign denial");
          const unchanged = evidenceLine(proof.file, proof.unchangedDbLine, key + " victim unchanged");
          assert.match(owned, /const ownUpload = expectStatus\(await request\("/);
          assert.match(denied, /const foreignUpload = expectStatus\(await request\("/);
          const proofLines = suite.split("\n");
          const ownSpan = proofLines.slice(proof.ownPositiveLine - 1, proof.ownPositiveLine + 3).join("\n");
          const deniedSpan = proofLines.slice(proof.foreignDenialLine - 1, proof.foreignDenialLine + 3).join("\n");
          assert.match(ownSpan, /method: "POST", cookie: privileged\.cookie, form: proofForm\(ownOrg\.id, ownedBatch\.id\)/);
          assert.match(ownSpan, /\}\), 201,/);
          assert.match(deniedSpan, /method: "POST", cookie: privileged\.cookie, form: proofForm\(victimOrg\.id, victimBatch\.id\)/);
          assert.match(deniedSpan, /\}\), 403,/);
          assert.match(unchanged, /assert\.deepEqual\(after, before,/);
          assert.match(suite, /const contenders = await Promise\.all\(\["race-a", "race-b", "race-c", "race-d"\]/);
          assert.match(suite, /assert\.equal\(activeAfterRace\.length, 1/);
          continue; // Explicit own/foreign mutation and unchanged-DB proof; no generic bypass.
        }
        const adapter = evidenceLine(proof.file, proof.line, key + " adapter");
        assert.ok(adapter.includes(JSON.stringify(key) + ": {"),
          key + ": pinned case does not match credited method");
        const start = suite.indexOf(adapter);
        const next = suite.indexOf("\n  },", start + adapter.length);
        const registryEnd = suite.indexOf("\n});\nexport const FIRST_ADAPTED_METHODS", start);
        assert.ok(registryEnd > start, key + ": registry boundary missing");
        const caseSource = suite.slice(start, next < 0 ? registryEnd : next);
        const urlPath = "/api/" + entry.route.replace(/\[[^\]]+\]/g, "");
        assert.equal(caseSource.split(urlPath).length - 1, 2,
          key + ": adapter must name actual own and victim HTTP paths");
        assert.match(caseSource, /denial: 403/,
          key + ": foreign employer denial must be exact 403");
        assert.match(evidenceLine(proof.file, proof.ownPositiveLine, key + " own"),
          /const own = expectStatus\(await request\(urls\.own, \{ cookie \}\), 200,/);
        assert.match(evidenceLine(proof.file, proof.foreignDenialLine, key + " victim"),
          /const foreign = expectStatus\(await request\(urls\.foreign, \{ cookie \}\), adapter\.denial,/);
        const forged = evidenceLine(proof.file, proof.forgedSelectorLine, key + " forged selector");
        const expectedForged = key.endsWith("/posting-evidence/[id]")
          ? "const forged = expectStatus(await request("
          : key.endsWith("/payment-evidence/[id]")
            ? "const crossId = expectStatus(await request("
            : "const filtered = expectStatus(await request(";
        assert.ok(forged.includes(expectedForged),
          key + ": real foreign identifier must be tested under own employer");
        assert.match(evidenceLine(proof.file, proof.unchangedDbLine, key + " victim unchanged"),
          /assert\.deepEqual\(after, before,/);
        assert.match(suite, /for \(const idx of \[1, 2\]\)/,
          key + ": both independent attacker sessions required");
        assert.match(suite, /const before = await snapshotVictim\(victimOrg\.id\)/);
        assert.match(suite, /const after = await snapshotVictim\(victimOrg\.id\)/);
        continue;
      }
      if (proof.file === "scripts/qa/salary-correction-case-tenant-proof.mjs") {
        assert.equal(path, "src/app/api/hcm/salary-corrections/cases/route.ts",
          path + ": only the #641 cases endpoint may cite this source");
      }
      if (proof.file === "scripts/qa/payroll-read-sweep-http.mjs") {
        const harness = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
        const integration = readFileSync(proof.file, "utf8");
        assert.match(harness, /await \(await import\("\.\/payroll-read-sweep-http\.mjs"\)\)\.verifyPayrollReadSweep\(f, \{ request, expectStatus \}\)/,
          path + ": added evidence suite must execute inside the guarded isolated HTTP harness");
        assert.match(integration, /assert\.deepEqual\(after, before/,
          path + ": denied requests must leave real victim data unchanged");
        assert.match(integration, /process\.env\.TENANT_SECOND_PASS_MODE/,
          path + ": isolated-only guard is mandatory");
      }
      if (proof.file === "scripts/qa/workforce-attendance-sweep-http.mjs") {
        const runner=readFileSync("scripts/qa/tenant-second-pass-http.mjs","utf8");
        const suite=readFileSync(proof.file,"utf8");
        assert.match(runner,/verifyWorkforceAttendanceSweep\(f,\{request,expectStatus\}\)/,
          "Attendance proof must execute from protected real-HTTP PostgreSQL16 harness");
        assert.match(suite,/process\.env\.TENANT_SECOND_PASS_MODE/);
        assert.match(suite,/assert\.deepEqual\(victimEventsAfter,victimEventsBefore/);
        assert.match(suite,/assert\.deepEqual\(victimPoliciesAfter,victimPoliciesBefore/);
        assert.match(suite,/assert\.deepEqual\(victimLocksAfter,victimLocksBefore/);
      }
      if (proof.file === "scripts/qa/hcm-work-queue-http.mjs") {
        assert.ok(["src/app/api/hcm/business-processes/inbox/route.ts",
          "src/app/api/hcm/lifecycle-notifications/route.ts"].includes(path),
          path + ": only the two HCM endpoints with real proof may cite this source");
        const runner = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
        const suite = readFileSync(proof.file, "utf8");
        assert.match(runner, /verifyHcmWorkQueueIsolation\(f, \{ request, expectStatus \}\)/);
        assert.match(suite, /process\.env\.TENANT_SECOND_PASS_MODE/);
        assert.match(suite, /assert\.deepEqual\(victimStepsAfter,victimStepsBefore/);
        assert.match(suite, /assert\.deepEqual\(victimTasksAfter,victimTasksBefore/);
        assert.equal(proof.ownStatus, 200);
        assert.equal(proof.foreignStatus, 403);
      }
      if (proof.file === "scripts/qa/government-loan-read-http.mjs") {
        assert.equal(path, "src/app/api/compliance/government-loan-remittances/route.ts",
          "Only the source-pinned government loan GET/POST methods may use this proof");
        const runner = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
        const suite = readFileSync(proof.file, "utf8");
        assert.match(runner, /verifyGovernmentLoanRemittanceIsolation\(f, \{ request, expectStatus \}\)/);
        assert.match(suite, /process\.env\.TENANT_SECOND_PASS_MODE/);
        assert.match(suite, /assert\.deepEqual\(afterBatches,beforeBatches/);
        assert.match(suite, /assert\.deepEqual\(afterMembers,beforeMembers/);
        assert.equal(proof.ownStatus, 200);
        assert.equal(proof.foreignStatus, 403);
      }
      if (proof.file === "scripts/qa/dole-13th-month-http.mjs") {
        assert.equal(path, "src/app/api/compliance/dole-13th-month/route.ts",
          "Only DOLE GET/POST may cite single-employer owned/foreign proof");
        assert.ok(["GET", "POST"].includes(method.name));
        const runner = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
        const suite = readFileSync(proof.file, "utf8");
        const lines = suite.split("\n");
        assert.match(runner, /verifyDoleReportTenantIsolation\(f, \{ request, expectStatus \}\)/,
          "DOLE must execute within protected disposable real-HTTP harness");
        assert.match(suite, /process\.env\.TENANT_SECOND_PASS_MODE/);
        assert.match(suite, /victimProfilesBefore\.length > 0 && victimSubmissionsBefore\.length > 0/,
          "Victim evidence must be genuinely seeded and non-empty");
        assert.match(lines[proof.ownPositiveLine - 1], /expectStatus\(await request\("\/api\/compliance\/dole-13th-month/);
        assert.match(lines[proof.foreignDenialLine - 1], /expectStatus\(await request\(/);
        const ownSpan = lines.slice(proof.ownPositiveLine - 1, proof.ownPositiveLine + 9).join("\n");
        const foreignSpan = lines.slice(proof.foreignDenialLine - 1, proof.foreignDenialLine + 10).join("\n");
        assert.match(ownSpan, /\), 200,/, "The owned GET/POST must actually succeed");
        assert.match(foreignSpan, /\), 403,/, "The actual victim GET/POST must deny");
        if (method.name === "POST")
          assert.match(lines[proof.unchangedDbLine - 1], /assert\.deepEqual\(victimProfilesAfter, victimProfilesBefore/);
        assert.match(suite, /assert\.deepEqual\(victimSubmissionsAfter, victimSubmissionsBefore/);
      }
      if (proof.file === "scripts/qa/bank-tenant-http.mjs") {
        assert.match(readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8"),
          /await \(await import\("\.\/bank-tenant-http\.mjs"\)\)\.verifyBankTenantIsolation\(f, \{ request, expectStatus, makeSession \}\)/,
          "Bank proof must execute in the guarded real HTTP/PG harness");
        assert.match(readFileSync(proof.file, "utf8"), /assert\.deepEqual\(after, before/,
          "Victim bank records and audit must remain unchanged");
      }
      if (proof.file === "scripts/qa/tenant-table-http.mjs") {
        // Table rows share generic request(item.own/foreign) lines. Credit only an exact,
        // organization-selector GET row with its own-data proof, run by the shared workflow
        // under a profile that really turns on every flag the row needs.
        const key = method.name + " " + entry.route;
        assert.equal(method.name, "GET", key + ": the table runner never certifies a mutation");

        const suite = readFileSync(proof.file, "utf8");
        const spec = tenantFamilyCatalog("read").find((entry) => entry.key === key);
        assert.ok(spec, key + ": method must be loaded from an exact family row");
        validateTenantPathBinding(key, spec.pathIds);
        if (entry.route.includes("[")) {
          assert.ok(spec.pathIds, key + ": path-id reads require explicit seeded cross-id binding");
          assert.deepEqual(proof.pathIds, spec.pathIds);
          assert.match(suite, /bindTenantReadRequests\(definition, own\.org\.id, victim\.org\.id, extra, ctx\)/);
        }
        assert.equal(proof.rowFile, spec.file, key + ": family source pin must match");
        assert.equal(proof.rowLine, spec.line, key + ": family row pin must match");
        assert.equal(proof.line, proof.ownPositiveLine, key + ": shared execution pin must match");
        assert.match(suite, /await loadTenantRows\("read",/);
        const rowLine = evidenceLine(spec.file, spec.line, key + " family row");
        assert.ok(rowLine.trimStart().startsWith("{ key: " + JSON.stringify(key) + ","), key + ": family row method mismatch");
        const row = spec.text;
        assert.match(row, /\bprove: /, key + ": a row without an own-data proof cannot be credited");
        assert.doesNotMatch(row, /\bstatus: \d{3}\b/, key + ": own employer must be an exact 200");
        const deny = /\bdeny: (\d{3})/.exec(row)?.[1] ?? "403";
        assert.ok(["403", "404"].includes(deny), key + ": victim employer must be denied 403 or 404, got " + deny);
        const profile = /\bprofile: "([a-z-]+)"/.exec(row)?.[1] ?? "default";
        assert.ok(TENANT_TABLE_PROFILES[profile], key + ": unknown profile " + profile);
        for (const flag of (/\bflags: \[([^\]]*)\]/.exec(row)?.[1] ?? "").match(/[A-Z0-9_]+/g) ?? []) {
          assert.equal(TENANT_TABLE_PROFILES[profile][flag], "true", key + ": profile " + profile + " must enable " + flag);
        }
        const workflow = readFileSync(".github/workflows/tenant-table-proof.yml", "utf8");
        assert.ok(new RegExp("profile: \\[[^\\]]*\\b" + profile + "\\b").test(workflow) &&
          workflow.includes("node scripts/qa/tenant-table-env.mjs \"${{ matrix.profile }}\" >> \"$GITHUB_ENV\"") &&
          workflow.includes("node scripts/qa/apply-isolated-baseline.mjs") &&
          workflow.includes("npx tsx scripts/qa/tenant-table-http.mjs"), key + ": the shared workflow must run this row's profile");
        assert.match(evidenceLine(proof.file, proof.ownPositiveLine, key + " own"),
          /const owned = expectStatus\(await request\(item\.own, \{ cookie: own\.cookie \}\), item\.status \?\? 200,/);
        assert.match(readableLines(proof.file)[proof.ownPositiveLine], /item\.prove\(owned, ctx\);/,
          key + ": the own-data proof must run on the owned response");
        assert.match(evidenceLine(proof.file, proof.foreignDenialLine, key + " victim"),
          /const foreign = expectStatus\(await request\(item\.foreign, \{ cookie: own\.cookie \}\), item\.deny \?\? 403,/);
        assert.match(evidenceLine(proof.file, proof.unchangedDbLine, key + " victim DB"),
          /assert\.deepEqual\(victimAfter, victimBefore,/);
        assert.ok(proof.ownPositiveLine < proof.foreignDenialLine && proof.foreignDenialLine < proof.unchangedDbLine);
        assert.ok(suite.includes("requireTenantTableDisposable();") && suite.includes("for (const idx of [1, 2])") &&
          suite.includes("assert.equal(passed.size, rows.length * 2,") &&
          suite.includes('assert.equal(typeof item.prove, "function"') &&
          suite.includes("await assert.rejects(async () => item.prove(firstAttackerResponses.get(item.key), ctx),") &&
          suite.includes("assert.equal(discriminatingProofs, rows.length,"), key + ": both attackers, disposable guard, proof enforcement and cross-employer discrimination required");
        continue;
      }
      if (proof.file === "scripts/qa/tenant-write-table-http.mjs") {
        // Write rows share generic urlFor("own"/"foreign") request lines. Credit only an exact mutating row whose
        // own write is read back from PostgreSQL (state + expect), whose victim request is denied with an exact
        // 403/404, and whose expectation must reject the other attacker's genuine data.
        const key = method.name + " " + entry.route;
        assert.ok(["POST", "PATCH", "PUT", "DELETE"].includes(method.name), key + ": the write table certifies mutations only");

        const suite = readFileSync(proof.file, "utf8");
        const spec = tenantFamilyCatalog("write").find((entry) => entry.key === key);
        assert.ok(spec, key + ": method must be loaded from an exact family row");
        validateTenantPathBinding(key, spec.pathIds);
        if (entry.route.includes("[")) {
          assert.ok(spec.pathIds, key + ": path-id writes require explicit seeded cross-id binding");
          assert.deepEqual(proof.pathIds, spec.pathIds);
          assert.match(suite, /bindTenantPath\(item, ctx, target\)/);
        }
        assert.equal(proof.rowFile, spec.file, key + ": family source pin must match");
        assert.equal(proof.rowLine, spec.line, key + ": family row pin must match");
        assert.equal(proof.line, proof.ownPositiveLine, key + ": shared execution pin must match");
        assert.match(suite, /await loadTenantRows\("write",/);
        const rowLine = evidenceLine(spec.file, spec.line, key + " family row");
        assert.ok(rowLine.trimStart().startsWith("{ key: " + JSON.stringify(key) + ","), key + ": family row method mismatch");
        const row = spec.text;
        assert.match(row, /\bstate: /, key + ": the own employer's rows must be read back from PostgreSQL");
        assert.match(row, /\bexpect: /, key + ": a row without an expectation of the own change cannot be credited");
        assert.ok((/\bownBody: /.test(row) && /\bforeignBody: /.test(row)) || (method.name === "DELETE" && /\bquery: /.test(row)),
          key + ": a row needs own and foreign requests");
        // The own status sits on the row's key line; a nested forged: { status } is a different request.
        const ownStatus = /\bstatus: (\d{3})/.exec(rowLine)?.[1] ?? "200";
        assert.ok(["200", "201", "202", "204"].includes(ownStatus), key + ": the own write must succeed, got " + ownStatus);
        const deny = /\bdeny: (\d{3})/.exec(row)?.[1] ?? "403";
        assert.ok(["403", "404"].includes(deny), key + ": victim employer must be denied 403 or 404, got " + deny);
        const profile = /\bprofile: "([a-z-]+)"/.exec(row)?.[1] ?? "default";
        assert.ok(TENANT_TABLE_PROFILES[profile], key + ": unknown profile " + profile);
        for (const flag of (/\bflags: \[([^\]]*)\]/.exec(row)?.[1] ?? "").match(/[A-Z0-9_]+/g) ?? []) {
          assert.equal(TENANT_TABLE_PROFILES[profile][flag], "true", key + ": profile " + profile + " must enable " + flag);
        }
        const workflow = readFileSync(".github/workflows/tenant-table-proof.yml", "utf8");
        assert.ok(new RegExp("profile: \\[[^\\]]*\\b" + profile + "\\b").test(workflow) &&
          workflow.includes("node scripts/qa/tenant-table-env.mjs \"${{ matrix.profile }}\" >> \"$GITHUB_ENV\"") &&
          workflow.includes("node scripts/qa/apply-isolated-baseline.mjs") &&
          workflow.includes("npx tsx scripts/qa/tenant-write-table-http.mjs"), key + ": the shared workflow must run the write table for this row's profile");
        assert.match(evidenceLine(proof.file, proof.ownPositiveLine, key + " own"),
          /const owned = expectStatus\(await request\(urlFor\("own"\), \{ method, cookie: own\.cookie, body: item\.ownBody\?\.\(ctx\) \}\), item\.status \?\? 200,/);
        assert.match(evidenceLine(proof.file, proof.foreignDenialLine, key + " victim"),
          /const foreign = expectStatus\(await request\(urlFor\("foreign"\), \{ method, cookie: own\.cookie, body: item\.foreignBody\?\.\(ctx\) \}\), item\.deny \?\? 403,/);
        assert.match(evidenceLine(proof.file, proof.unchangedDbLine, key + " victim DB"),
          /assert\.deepEqual\(victimAfter, victimBefore,/);
        assert.ok(proof.ownPositiveLine < proof.foreignDenialLine && proof.foreignDenialLine < proof.unchangedDbLine);
        assert.ok(suite.includes("requireTenantTableDisposable();") && suite.includes("for (const idx of [1, 2])") &&
          suite.includes("assert.notDeepEqual(ownAfter, ownBefore,") &&
          suite.includes("await item.expect(ownBefore, ownAfter, ctx, owned);") &&
          suite.includes("await assert.rejects(async () => item.expect(first.ownBefore, first.ownAfter, ctx, first.owned),") &&
          suite.includes("assert.equal(discriminatingProofs, rows.length,") &&
          suite.includes("assert.equal(passed.size, rows.length * 2,") &&
          suite.includes("the victim's target rows are unchanged"),
          key + ": both attackers, disposable guard, own-change read-back, cross-employer discrimination and unchanged victim rows required");
        continue;
      }
      if (proof.file === "scripts/qa/tenant-high-risk-01-http.mjs") {
        // Only an exact method-named, actually executed Batch 01 case may use
        // request(item.own) rather than an inline literal route in the proof.
        const evidence = readFileSync(proof.file, "utf8");
        const evidenceLines = evidence.split("\n");
        const spec = method.name + " " + entry.route;
        const signature = evidenceLine(proof.file, proof.line, spec + " exact method case");
        const harness = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
        if (method.name === "POST") {
          // A real payroll accounting-close mutation must not borrow the 16 GET
          // proofs. Check this exact separate, executed own-200 / victim-403
          // proof with a persisted own audit receipt and unchanged victim DB.
          assert.equal(path, "src/app/api/payroll-runs/[id]/close/route.ts");
          assert.equal(spec, "POST payroll-runs/[id]/close");
          assert.equal(proof.line, proof.ownPositiveLine);
          assert.match(harness, /verifyHighRiskBatchOne\(f, \{ request, expectStatus, makeSession \}\)/);
          assert.match(evidence, /await verifyPayrollClosePostIsolation\(f, \{ request, expectStatus, makeSession \}\)/);
          const helperIndex = evidence.indexOf("async function verifyPayrollClosePostIsolation(");
          assert.ok(helperIndex > 0, "Close POST must have a separately invoked proof helper");
          const helper = evidence.slice(helperIndex);
          const positive = evidenceLine(proof.file, proof.ownPositiveLine, spec + " real own 200");
          const foreign = evidenceLine(proof.file, proof.foreignDenialLine, spec + " real victim 403");
          const unchanged = evidenceLine(proof.file, proof.unchangedDbLine, spec + " immutable victim DB");
          const ownSpan = evidenceLines.slice(proof.ownPositiveLine - 1, proof.ownPositiveLine + 3).join("\n");
          const foreignSpan = evidenceLines.slice(proof.foreignDenialLine - 1, proof.foreignDenialLine + 7).join("\n");
          assert.match(positive, /const ownPost = expectStatus\(await request\(closeUrl, \{/);
          assert.match(ownSpan, /cookie, method: "POST"/);
          assert.match(ownSpan, /\}\), 200,/,
            "Own payroll close must actually succeed; 409/422 is not positive proof");
          assert.match(helper, /assert\.equal\(ownPost\.json\?\.closed, true\)/);
          assert.match(helper, /assert\.ok\(audit\.some\(event => event\.action === "Payroll close completed"/,
            "Owned HTTP 200 must leave a persisted payroll-close audit receipt");
          assert.match(foreign, /const foreignPost = expectStatus\(await request\("\/api\/payroll-runs\/" \+ f\.victimRun\.id \+ "\/close"/);
          assert.match(foreignSpan, /cookie, method: "POST"/);
          assert.match(foreignSpan, /organizationId: org\.id, legalEntityId: f\.entities\[idx\]\.id/,
            "Forged scope selectors must not authorize a foreign payroll close");
          assert.match(foreignSpan, /\}\), 403,/);
          assert.match(unchanged, /assert\.deepEqual\(victimAfter, victimBefore/);
          assert.match(helper, /const victimBefore = await takeVictimSnapshot\(victimId\)/);
          assert.match(helper, /const victimAfter = await takeVictimSnapshot\(victimId\)/);
          assert.match(helper, /f\.victimRun\.id > 6/);
          assert.match(helper, /for \(const idx of \[1, 2\]\)/);
          assert.match(helper, /makeSession\(owner\.id, \{ privileged: true \}\)/);
          assert.match(helper, /assert\.notEqual\(process\.env\.PAYMONGO_DISBURSEMENTS_ENABLED, "true"\)/);
          assert.match(helper, /assert\.notEqual\(process\.env\.XENDIT_PAYOUTS_ENABLED, "true"\)/);
          assert.match(helper, /assert\.ok\(!process\.env\.PAYMONGO_SECRET_KEY && !process\.env\.XENDIT_SECRET_KEY/);
          continue;
        }
        assert.equal(method.name, "GET", spec + ": this does not authorize other mutating methods");
        assert.ok(signature.includes('key: "' + spec + '"') ||
          signature.includes('await caseCheck("' + spec + '"'),
          spec + ": must link a distinct exact-route high-risk test case");
        assert.ok(harness.includes("verifyHighRiskBatchOne(f, { request, expectStatus, makeSession });") &&
          evidence.includes("for (const idx of [1, 2])") &&
          evidence.includes("assert.equal(passed.size, 36") &&
          evidence.includes("assert.deepEqual(victimAfter, victimBefore"),
          spec + ": both attacker sessions and unchanged victim PostgreSQL rows required");
        const positive = evidenceLine(proof.file, proof.ownPositiveLine, spec + " own 200");
        const denial = evidenceLine(proof.file, proof.foreignDenialLine, spec + " denied");
        const invariant = evidenceLine(proof.file, proof.unchangedDbLine, spec + " victim DB");
        assert.match(invariant, /assert\.deepEqual\(victimAfter, victimBefore/);
        if (spec === "GET self/documents") {
          assert.ok(positive.includes('request("/api/self/documents"') &&
            denial.includes("request(endpoint") && denial.includes("), 403,") &&
            evidence.includes("victim.id +") && evidence.includes("cookie: employeeCookie"),
            spec + ": forged selector and former-employer revocation require active employee session");
        } else if (spec === "GET self/payslips/[id]/explain") {
          assert.ok(positive.includes('request("/api/self/payslips/" + ownEntry.id') &&
            denial.includes('request("/api/self/payslips/" + victimEntry.id') &&
            evidence.includes("}), 404,") && evidence.includes("cookie: employeeCookie"),
            spec + ": actual own Released payslip 200 and victim pay entry 404 required");
        } else {
          const caseSpan = evidenceLines.slice(proof.line - 1, proof.line + 13).join("\n");
          assert.ok(caseSpan.includes('own: "/api/') &&
            caseSpan.includes('foreign: "/api/') &&
            (caseSpan.includes("victim.id") || caseSpan.includes("f.victimRun.id")),
            spec + ": missing method-specific own and victim actual route selectors");
          assert.ok(positive.includes("expectStatus(await request(item.own") &&
            denial.includes("expectStatus(await request(item.foreign") &&
            evidence.includes("), 403,"),
            spec + ": authenticated own 200 and victim 403 HTTP pair required");
        }
        continue;
      }
      const ownLine = evidenceLine(proof.file, proof.ownPositiveLine, path + " own-positive");
      const negativeLine = evidenceLine(proof.file, proof.foreignDenialLine, path + " foreign denial");
      assert.ok(routeFragments.every(fragment => ownLine.includes(fragment)) && /request\s*\(/.test(ownLine),
        path + " " + method.name + ": stale positive reference");
      assert.ok(/expectStatus|ownOnly|assert\.(?:ok|equal|deepEqual)/.test(negativeLine),
        path + " " + method.name + ": stale foreign-denial or DB proof");
      if (proof.unchangedDbLine) {
        const invariant = evidenceLine(proof.file, proof.unchangedDbLine, path + " invariant");
        assert.match(invariant, /assert\.(?:deepEqual|equal)/);
      }
    }
  }
  for (const [route, method, positiveVariable, success] of [
    ["account/sessions", "DELETE", "ownSessionDelete", 200],
    ["scim/v2/Users/[id]", "PATCH", "ownScimPatch", 200],
    ["scim/v2/Users/[id]", "DELETE", "ownScimDelete", 204],
    ["v1/employees/[id]", "PATCH", "ownV1Patch", 200],
    ["v1/employees/[id]", "DELETE", "ownV1Delete", 200],
  ]) {
    const key = "src/app/api/" + route + "/route.ts";
    const methodProof = manifest.allApiRouteFiles[key].methods.find((v) => v.name === method);
    assert.equal(methodProof?.status, "COVERED",
      key + " " + method + ": cross-tenant denial alone is insufficient");
    const proof = methodProof.testedBy;
    const positive = evidenceLine(proof.file, proof.ownPositiveLine, key + " own");
    const victim = evidenceLine(proof.file, proof.foreignDenialLine, key + " victim");
    const ownSpan = source.slice(proof.ownPositiveLine - 1, proof.ownPositiveLine + 6).join("\n");
    const victimSpan = source.slice(proof.foreignDenialLine - 1, proof.foreignDenialLine + 5).join("\n");
    assert.ok(positive.includes("const " + positiveVariable + " = expectStatus") &&
      positive.includes("/api/" + route.replaceAll("[id]", "")) &&
      ownSpan.includes("), " + success + ","),
      key + " " + method + ": missing same-method own success");
    assert.ok(victim.includes('expectStatus(await request("/api/' + route.replaceAll("[id]", "")) &&
      victimSpan.includes("), 404,") &&
      (victimSpan.includes("f.victimIdentity.id") ||
        victimSpan.includes("checkVictimId") ||
        victimSpan.includes("f.victimSessions.at(-1).id")),
      key + " " + method + ": real existing victim-only record must be denied");
    const unchanged = evidenceLine(proof.file, proof.unchangedDbLine, key + " unchanged");
    assert.match(unchanged, /assert\.(?:deepEqual|equal)\(victim/,
      key + " " + method + ": denied mutation must preserve victim data");
  }
});

test("page and server-action inventory cannot silently omit new or changed business-ID entrypoints", () => {
  const files = appFiles();
  const scoped = new Map(manifest.scopedPages.map((entry) => [entry.path, entry]));
  assert.equal(Object.keys(baseline.app).length, 92,
    "original app/module baseline scope is pinned to the audited 92-file snapshot");
  for (const [path, entry] of scoped) {
    assert.ok(files.includes(path), "scoped page entry must exist: " + path);
    assert.ok(entry.business && entry.business.length > 0 || entry.hasAction,
      "scoped page entry must cite business ID/source action evidence: " + path);
  }
  for (const path of files) {
    const content = readFileSync(path);
    const current = gitBlobSha(content);
    const original = baseline.app[path];
    const actual = content.toString("utf8");
    const scopedCandidate = /\b(?:organizationId|legalEntityId|employeeId|payrollRunId|runId|payslipId|documentId|fileId|caseId|positionId|orgUnitId|approvalId)\b/.test(actual)
      || /["']use server["']/.test(actual);
    const changed = !original || original !== current;
    if (scopedCandidate && scoped.has(path)) {
      const entry = scoped.get(path);
      if (!changed) assert.equal(entry.blob, current, path + ": pinned page SHA mismatch");
    }
    if (scopedCandidate && changed) {
      const entry = scoped.get(path);
      assert.ok(entry, path + ": new or changed scoped page/server action not in manifest");
      // #1876 People/HR pages: exact-source, feature-ON, disposable
      // PG16/HTTP *provisional* evidence. Preserve both page/action GAPs:
      // this GET-only proof does not certify interactive survey writes or
      // employer-wide People acceptance. No unpinned variant may pass.
      if (path === "src/app/app/engagement/page.tsx" ||
          path === "src/app/app/goals-reviews/page.tsx") {
        const isEngagement = path === "src/app/app/engagement/page.tsx";
        const originalPageBlobSha = isEngagement
          ? "caf09023985ba92210805555c8272b2f24df3f07"
          : "0792de4c8cbcb4efdf40ecfb986cb140561d5749";
        const pageBlobSha = isEngagement
          ? "8ddecfc89f1f8b23deeaefa410c00f36b072922e"
          : "4989da5727ea5a55d0565fec6eb0af71cbb6046c";
        assert.equal(entry.status, "GAP", "People page must remain an unaccepted GAP");
        assert.equal(entry.testedBy, undefined, "Unaccepted page proof cannot claim a method/page credit");
        assert.equal(baseline.app[path], originalPageBlobSha, "People page original SHA must remain pinned");
        assert.equal(current, pageBlobSha, "People page changed: renew independent PG16 proof");
        assert.equal(entry.blob, pageBlobSha, "Manifest must pin the reviewed People page source");
        const reviewed = entry.reviewedUncertified;
        assert.deepEqual(reviewed, {
          kind: "people-engagement-goals-SSR-GET-PG16-unaccepted",
          originalPageBlobSha, pageBlobSha,
          selectorFile: "src/lib/tenant-people-page-employer.ts",
          selectorBlobSha: "0f34a6276889c396c6287e0a830c02d7b05acdc9",
          proofFile: "scripts/qa/tenant-people-pages-http.mjs",
          proofBlobSha: "fad1f0ad45d41d158cee968e7b9de0188ed9030e",
          contractFile: "scripts/qa/tenant-people-pages-contract.mjs",
          contractBlobSha: "29bedeb0bfa584a184ea89a9e6ca51c099e2dcb4",
          contractTestFile: "tests/tenant-people-pages-contract.test.mjs",
          contractTestBlobSha: "49bad9e706940e096b755f553d98609b7f909dfa",
          selectorTestFile: "tests/tenant-people-page-employer.test.ts",
          selectorTestBlobSha: "c2183b9b046c968a752a7ad3e750ecd8d89fb18c",
          workflowFile: ".github/workflows/tenant-people-pages-qa.yml",
          workflowBlobSha: "78cf181743c1e612e22c6f2eec66f2f3ed1a2342",
          priorPassedHead: "6c5f7030af63af236b0cc176873ca3fe91afd9ea",
          priorPassedJob: "https://github.com/erwinmehehe/payrollph/actions/runs/42590838431/job/129071762836",
          credits: 0, independentlyAccepted: false, productionCertified: false,
        }, "Only the exact uncredited People/HR PG16 source evidence may be linked");
        assert.match(entry.reason, /^Still GAP: #1876 /);
        for (const [file, sha] of [
          [reviewed.selectorFile, reviewed.selectorBlobSha],
          [reviewed.proofFile, reviewed.proofBlobSha],
          [reviewed.contractFile, reviewed.contractBlobSha],
          [reviewed.contractTestFile, reviewed.contractTestBlobSha],
          [reviewed.selectorTestFile, reviewed.selectorTestBlobSha],
          [reviewed.workflowFile, reviewed.workflowBlobSha],
        ]) {
          assert.equal(gitBlobSha(readFileSync(file)), sha,
            "People proof changed without renewed review: " + file);
        }
        for (const field of ["ids", "business", "guards"]) {
          assert.ok(Array.isArray(entry[field]) && entry[field].length > 0);
          const sourceLines = actual.split("\n");
          for (const pin of entry[field]) {
            assert.ok(Number.isSafeInteger(pin.line) && pin.line > 0 &&
              sourceLines[pin.line - 1]?.includes(pin.token),
              path + " " + field + ": incorrect source line " + pin.line);
          }
        }
        const auth = actual.indexOf("getSessionUser()");
        const selector = actual.indexOf("canonicalPeoplePageOrganizationId(raw)");
        const membership = actual.indexOf("assertMembership(session.id, organizationId)");
        const access = actual.indexOf(isEngagement
          ? "getAccess(session.id, organizationId)" : "getAccess(user.id, organizationId)");
        const entity = actual.indexOf("singleLegalEntityForTenant(organizationId)");
        const render = actual.indexOf(isEngagement
          ? "<EngagementSurveyPage organizationId={organizationId}"
          : ".from(performanceCycles)");
        const admin = actual.indexOf(isEngagement
          ? "assertOrganizationRole(session.id, organizationId, PEOPLE_ADMIN_ROLES)"
          : "assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES)");
        assert.ok(auth > 0 && selector > auth && render > selector,
          "People authorization must precede client mount/SQL select");
        assert.ok(isEngagement
          ? membership > selector && access > membership && entity > access &&
            admin > entity && render > admin
          : admin > selector && access > admin && entity > access &&
            render > entity,
          "People page must authorize active employer, role and entity before data read");
        assert.match(actual, /raw === undefined/);
        if (isEngagement) {
          assert.match(actual, /!access\.companyWide/);
          assert.match(actual, /Number\.isSafeInteger\(session\.employeeId\)/);
        } else assert.match(actual, /eq\(performanceCycles\.organizationId, organizationId\)/);
        const proof = readFileSync(reviewed.proofFile, "utf8");
        assert.ok(proof.indexOf("requireDisposablePeoplePagesEnv();") > 0 &&
          proof.indexOf("requireDisposablePeoplePagesEnv();") <
          proof.indexOf('import("../../src/db/index.ts")'),
          "Local-only PG16 guard must execute before app/database imports");
        for (const marker of [
          'for (const label of ["ATTA", "ATTB", "VICTIM"])',
          "for (const actor of [a, b])",
          "assertOwnGoalsPage(await readLocal(goals(actor.org.id)",
          "assertOwnEngagementPage(await readLocal(engagement(actor.org.id)",
          "assertOwnSurveyApi(await readLocal(surveys(actor.org.id)",
          "assertDeniedPage(await readLocal(goals(other.org.id)",
          "assertDeniedPage(await readLocal(engagement(other.org.id)",
          "assertDeniedApi(await readLocal(surveys(other.org.id)",
          "assert.equal(ownPairs, 2)", "assert.equal(foreignPairs, 4)",
          "assert.equal(malformedDenials, 40)", "assert.equal(revoked.length, 1",
          'assert.equal((await readLocal("/api/account", a.cookie)).status, 200',
          "assert.deepEqual(await snapshot(other.org.id), before.get(other.org.id)",
          "pageCredits: 0, methodCredits: 0",
        ]) assert.ok(proof.includes(marker), "People proof missing mandatory control: " + marker);
        const contract = readFileSync(reviewed.contractFile, "utf8");
        assert.match(contract, /assert\.equal\(response\.status, 200/);
        assert.match(contract, /assert\.equal\(response\.status, 404/);
        assert.match(contract, /assert\.equal\(response\.status, 403/);
        assert.match(contract, /GITHUB_ACTIONS: "true"/);
        const workflow = readFileSync(reviewed.workflowFile, "utf8");
        assert.match(workflow, /image: postgres:16/);
        assert.match(workflow, /node --import tsx scripts\/qa\/tenant-people-pages-http\.mjs/);
        assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
        assert.equal(reviewed.credits, 0);
        continue; // Strict, source-pinned, zero-credit exception for exactly two pages.
      }

      // #1557 report builder PAGE: exact-source, GET-only, feature-ON
      // disposable PG16 evidence. A passing synthetic job does not certify
      // interactive reporting, private POST/CSV, or whole-page tenant coverage.
      // Every source pin and guard is checked, while the page stays GAP.
      if (path === "src/app/workspace/report-builder/page.tsx") {
        assert.equal(entry.status, "GAP", "No unreviewed report-page promotion");
        assert.equal(entry.testedBy, undefined, "Unreviewed synthetic GET is not a coverage credit");
        const reviewed = entry.reviewedUncertified;
        const oldSha = "68f7e1c72d5bd8b4187d6303b8f4ed02df2008a4";
        const pageSha = "4415282df5e859e004ae26662815d7b5f087657d";
        assert.equal(current, pageSha, "Report builder page changed; renew tenant review");
        assert.deepEqual(reviewed, {
          kind: "feature-on-report-builder-SSR-GET-PG16-unaccepted",
          originalPageBlobSha: oldSha,
          pageBlobSha: pageSha,
          helperFile: "src/lib/tenant-report-builder.ts",
          helperBlobSha: "5d315afc085baad9ce2fc14946a34a6d738a773b",
          proofFile: "scripts/qa/tenant-report-builder-page-http.mjs",
          proofBlobSha: "48cc244d97e6b376c06be018d6a06e06dbc5d1f9",
          contractFile: "scripts/qa/tenant-report-builder-page-contract.mjs",
          contractBlobSha: "7c8005b7d2b446d951d2727fd66b6575ea6c48ed",
          contractTestFile: "tests/tenant-report-builder-page-contract.test.mjs",
          contractTestBlobSha: "6d88df59ca8bfc058bbc86004a3447a236d1ac19",
          unitTestFile: "tests/tenant-report-builder.test.ts",
          unitTestBlobSha: "89bd1b2fd9469d3bc85ed5f56d0e718aa91871dc",
          workflowFile: ".github/workflows/tenant-report-builder-page-qa.yml",
          workflowBlobSha: "2dbb81d60581fda30f9e8e77d31079ccf7cc32f5",
          priorPassedHead: "fbeb54d07c394826c3bcf29cf34a7a69303b6eac",
          priorPassedJob: "https://github.com/erwinmehehe/payrollph/actions/runs/40804067228/job/123218683191",
          ownPageLine: 106, ownApiLine: 107, foreignPageLine: 112,
          foreignApiLine: 114, unitScopeLine: 138, revokedPageLine: 169,
          revokedApiLine: 171, unchangedDbLine: 131,
          credits: 0, independentlyAccepted: false, productionCertified: false,
        }, "Only the exact uncredited PG16 page review is allowed");
        assert.match(entry.reason, /^Still GAP: #1557/);
        assert.equal(entry.blob, pageSha);
        assert.equal(baseline.app[path], oldSha,
          "Unreviewed report page change cannot be an alternate baseline");
        for (const [file, sha] of [
          [reviewed.helperFile, reviewed.helperBlobSha],
          [reviewed.proofFile, reviewed.proofBlobSha],
          [reviewed.contractFile, reviewed.contractBlobSha],
          [reviewed.contractTestFile, reviewed.contractTestBlobSha],
          [reviewed.unitTestFile, reviewed.unitTestBlobSha],
          [reviewed.workflowFile, reviewed.workflowBlobSha],
        ]) {
          assert.equal(gitBlobSha(readFileSync(file)), sha,
            "Report page proof file changed without renewed review: " + file);
        }
        for (const field of ["ids", "business", "guards"]) {
          assert.ok(Array.isArray(entry[field]) && entry[field].length > 0);
          const sourceLines = actual.split("\n");
          for (const pin of entry[field]) {
            assert.ok(Number.isSafeInteger(pin.line) && pin.line > 0 &&
              sourceLines[pin.line - 1]?.includes(pin.token),
              path + " " + field + ": incorrect exact source line " + pin.line);
          }
        }
        const accessChecks = [
          "getSessionUser()",
          'criticalReleaseFlagEnabled("tenantReportBuilder")',
          "explicitReportBuilderEmployerId(params.organizationId)",
          "if (!organizationId) notFound();",
          "getAccess(user.id, organizationId)",
          "if (!access?.companyWide || !roleAllowed(access.role, PEOPLE_PAYROLL_ROLES)) notFound();",
          "assertOrganizationRole(user.id, organizationId, PEOPLE_PAYROLL_ROLES)",
          "if (denied) notFound();",
          "where(eq(organizations.id, organizationId)).limit(1)",
          "if (!employer) notFound();",
          "<TenantReportBuilder organizationId={organizationId} />",
        ];
        for (const check of accessChecks) {
          assert.ok(actual.includes(check), "Report page guard missing: " + check);
        }
        const auth = actual.indexOf("getSessionUser()");
        const flag = actual.indexOf('criticalReleaseFlagEnabled("tenantReportBuilder")');
        const selector = actual.indexOf("explicitReportBuilderEmployerId(params.organizationId)");
        const scope = actual.indexOf("getAccess(user.id, organizationId)");
        const permission = actual.indexOf("assertOrganizationRole(user.id, organizationId");
        const employer = actual.indexOf("where(eq(organizations.id, organizationId))");
        const render = actual.indexOf("<TenantReportBuilder organizationId={organizationId} />");
        assert.ok(0 < auth && auth < flag && flag < selector &&
          selector < scope && scope < permission && permission < employer &&
          employer < render,
          "Report controls must never mount before active employer scope checks");

        const proof = readFileSync(reviewed.proofFile, "utf8");
        const proofLines = proof.split("\n");
        assert.match(evidenceLine(reviewed.proofFile, reviewed.ownPageLine, path),
          /assertOwnReportPage\(await readLocal\(pagePath\(actor\.org\.id\), actor\.cookie\)/);
        assert.match(evidenceLine(reviewed.proofFile, reviewed.ownApiLine, path),
          /assertOwnReportCapabilities\(await readLocal\(apiPath\(actor\.org\.id\), actor\.cookie\)/);
        assert.match(evidenceLine(reviewed.proofFile, reviewed.foreignPageLine, path),
          /assertForeignReportPage\(await readLocal\(pagePath\(other\.org\.id\), actor\.cookie\)/);
        assert.match(evidenceLine(reviewed.proofFile, reviewed.foreignApiLine, path),
          /assertDeniedReportCapabilities\(/);
        assert.match(proofLines[reviewed.foreignApiLine] ?? "", /403,/);
        assert.match(evidenceLine(reviewed.proofFile, reviewed.unitScopeLine, path),
          /assertForeignReportPage\(await readLocal\(pagePath\(a\.org\.id\), scopedSession\.cookie\)/);
        assert.match(evidenceLine(reviewed.proofFile, reviewed.revokedPageLine, path),
          /assertForeignReportPage\(await readLocal\(pagePath\(a\.org\.id\), a\.cookie\)/);
        assert.match(evidenceLine(reviewed.proofFile, reviewed.revokedApiLine, path),
          /assertDeniedReportCapabilities\(await readLocal\(apiPath\(a\.org\.id\), a\.cookie\)/);
        assert.match(evidenceLine(reviewed.proofFile, reviewed.unchangedDbLine, path),
          /assertReadOnlyReportSnapshot\(before\.get\(employer\.org\.id\),/);
        assert.ok(proof.indexOf("requireDisposableReportPageEnv();") > 0 &&
          proof.indexOf("requireDisposableReportPageEnv();") <
          proof.indexOf('import("../../src/db/index.ts")'),
          "CI-only local PG16 guard must execute before importing the app DB");
        for (const text of [
          'seedEmployer("ATTA"', 'seedEmployer("ATTB"', 'seedEmployer("VICTIM"',
          "for (const actor of [a, b])", "assert.equal(ownSuccesses, 2)",
          "assert.equal(foreignDenials, 4)", "assert.equal(changed.length, 1",
          "assert.equal(stillSignedIn.status, 200", "assertReadOnlyReportSnapshot(",
          "pageCreditDelta: 0, methodCreditDelta: 0", "productionCertified: false",
        ]) assert.ok(proof.includes(text), "Synthetic PG16 negative control missing: " + text);
        const contract = readFileSync(reviewed.contractFile, "utf8");
        assert.match(contract, /assert\.equal\(response\.status, 200/);
        assert.match(contract, /assert\.equal\(response\.status, 404/);
        assert.match(contract, /assert\.deepEqual\(after, before/);
        assert.match(contract, /GITHUB_ACTIONS: "true"/);
        assert.match(contract, /DATABASE_URL: "postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/app_db"/);
        const workflow = readFileSync(reviewed.workflowFile, "utf8");
        assert.match(workflow, /image: postgres:16/);
        assert.match(workflow, /node --import tsx scripts\/qa\/tenant-report-builder-page-http\.mjs/);
        assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
        assert.equal(reviewed.credits, 0, "No page or API credit from feature-ON GET-only proof");
        continue; // Deliberate exact-source, zero-credit GAP exception, not blanket certification.
      }
      // #1631 billing setup PAGE: exact-source, real-HTTP PG16 synthetic
      // proof candidate. Like #1557, this remains a GAP until independent
      // review; changing the page may never silently become a coverage credit.
      if (path === "src/app/billing/setup/page.tsx") {
        assert.equal(entry.status, "GAP", "No unreviewed billing page promotion");
        assert.equal(entry.testedBy, undefined, "A proof candidate is not a coverage credit");
        const reviewed = entry.reviewedUncertified;
        const originalPageBlobSha = "ee1985ccdde71e9ee7c28b3d0dbe652fa0ea3381";
        const pageBlobSha = "c5830a95d2c13063c43a36629690010220d99d31";
        assert.equal(current, pageBlobSha, "Billing page changed; renew tenant review");
        assert.deepEqual(reviewed, {
          kind: "billing-setup-SSR-GET-PG16-unaccepted",
          originalPageBlobSha, pageBlobSha,
          proofFile: "scripts/qa/tenant-billing-setup-page-http.mjs",
          proofBlobSha: "d0047d905a95ef6c33d63065d3404db114b102f3",
          contractTestFile: "tests/tenant-billing-setup-boundary.test.mjs",
          contractTestBlobSha: "b31437f6707036393404cc8ddad824dee56fd58d",
          workflowFile: ".github/workflows/tenant-billing-setup-page-qa.yml",
          workflowBlobSha: "a2b3bbe665e27d973d491426d9109853958ff425",
          ownPageLine: 153, foreignPageLine: 161, revokedPageLine: 206,
          unchangedDbLine: 210,
          credits: 0, independentlyAccepted: false, productionCertified: false,
        }, "Only this exact uncredited PG16 billing page proof is allowed");
        assert.match(entry.reason, /^Still GAP: #1631/);
        assert.equal(entry.blob, pageBlobSha);
        assert.equal(baseline.app[path], originalPageBlobSha);
        for (const [file, sha] of [
          [reviewed.proofFile, reviewed.proofBlobSha],
          [reviewed.contractTestFile, reviewed.contractTestBlobSha],
          [reviewed.workflowFile, reviewed.workflowBlobSha],
        ]) {
          assert.equal(gitBlobSha(readFileSync(file)), sha,
            "Billing proof changed without renewed review: " + file);
        }
        for (const field of ["ids", "business", "guards"]) {
          assert.ok(Array.isArray(entry[field]) && entry[field].length > 0);
          const sourceLines = actual.split("\n");
          for (const pin of entry[field]) {
            assert.ok(Number.isSafeInteger(pin.line) && pin.line > 0 &&
              sourceLines[pin.line - 1]?.includes(pin.token),
              path + " " + field + ": incorrect exact source line " + pin.line);
          }
        }
        const session = actual.indexOf("await getSessionUser()");
        const selector = actual.indexOf("const selected = params.organizationId");
        const role = actual.indexOf("await assertOrganizationRole(");
        const scope = actual.indexOf("await getAccess(");
        const employer = actual.indexOf("await db.select(");
        const render = actual.indexOf("<SubscriptionManager");
        assert.ok(0 < session && session < selector && selector < role &&
          role < scope && scope < employer && employer < render,
          "Billing page must authenticate, select, authorize and scope before employer SSR read");
        for (const required of [
          'typeof selected === "string"', '/^[1-9]\\d*$/.test(selected)',
          "Number.isSafeInteger(Number(selected))",
          "primaryCompanyOrganizationId(user.id)",
          "BILLING_ADMIN_ROLES", "if (denied) notFound();",
          "if (!access?.companyWide) notFound();", "if (!org) notFound();",
          "companyName={org.name}", "dynamic = \"force-dynamic\"",
        ]) assert.ok(actual.includes(required),
          "Billing page tenant gate missing: " + required);

        const proof = readFileSync(reviewed.proofFile, "utf8");
        const proofLines = proof.split("\n");
        assert.match(evidenceLine(reviewed.proofFile, reviewed.ownPageLine, path),
          /assertOwnBillingPage\(await readLocal\(ownPath\(actor\.org\.id\), actor\.cookie\)/);
        assert.match(evidenceLine(reviewed.proofFile, reviewed.foreignPageLine, path),
          /assertDeniedBillingPage\(denied, subjects/);
        assert.match(proofLines[reviewed.foreignPageLine - 2] ?? "",
          /readLocal\(ownPath\(other\.org\.id\), actor\.cookie\)/);
        assert.match(evidenceLine(reviewed.proofFile, reviewed.revokedPageLine, path),
          /assertDeniedBillingPage\(await readLocal\(ownPath\(a\.org\.id\), a\.cookie\)/);
        assert.match(evidenceLine(reviewed.proofFile, reviewed.unchangedDbLine, path),
          /assert\.deepEqual\(await snapshot\(other\.org\.id\), before\.get\(other\.org\.id\)/);
        assert.ok(proof.indexOf("requireDisposableBillingPageEnv();") > 0 &&
          proof.indexOf("requireDisposableBillingPageEnv();") <
          proof.indexOf('import("../../src/db/index.ts")'),
          "Billing CI environment hard refusal must precede importing the app database");
        for (const required of [
          'seedEmployer("ATTA"', 'seedEmployer("ATTB"', 'seedEmployer("VICTIM"',
          "for (const actor of [a, b])", "assert.equal(ownSuccesses, 2)",
          "assert.equal(foreignDenials, 4)", "assert.equal(revoked.length, 1",
          "assert.equal(stillSignedIn.status, 200", "assert.deepEqual(",
          "pageCredits: 0, methodCredits: 0", "productionCertified: false",
        ]) assert.ok(proof.includes(required),
          "Billing PG16 negative control missing: " + required);
        const workflow = readFileSync(reviewed.workflowFile, "utf8");
        assert.match(workflow, /image: postgres:16/);
        assert.match(workflow, /node --import tsx scripts\/qa\/tenant-billing-setup-page-http\.mjs/);
        assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
        assert.equal(reviewed.credits, 0);
        continue; // Narrow exact-source, zero-credit GAP evidence exception.
      }
      // #1658 HCM Work Queue: historical client-only page evidence is retained
      // without promotion; current server authorization remains a separate
      // exact-source, zero-credit proposal pending current-head HTTP evidence.
      if (path === "src/app/hcm/work-items/page.tsx") {
        const reviewed = entry.reviewedUncertified;
        const historicalClientPageSha = "5b777c882742b95829504fdb96c383b8f80ad30a";
        const pageSha = "1452c03d1a89fe599dda1c8b72edcfcaf67d75ef";
        const previousUiPageSha = "268f84811df574a7240d2fe17996f4674630d3b2";
        const historicalPageSha = "378bf6b6050e488fe7ebeb48b4a18710152f88c1";
        const originalPageSha = "5bfadf60b5e91fec3b0c2e841564f73b72bc5ef3";
        assert.equal(entry.status, "GAP", "Work Queue remains unaccepted");
        assert.equal(entry.testedBy, undefined, "No premature page coverage credit");
        assert.equal(current, pageSha, "Changed HR Work Queue must renew its exact review");
        assert.equal(entry.blob, pageSha);
        assert.equal(baseline.app[path], originalPageSha);
        assert.match(entry.reason, /^Still GAP: #1658/);
        assert.deepEqual(reviewed, {
          kind: "hcm-work-items-client-GET-PG16-unaccepted",
          pageBlobSha: historicalPageSha,
          originalPageBlobSha: originalPageSha,
          helperFile: "src/lib/hcm-work-queue-summary.ts",
          helperBlobSha: "1e6fb2ab6fd10324ee06bf382d6050098a6482de",
          unitTestFile: "tests/hcm-work-queue-summary.test.ts",
          unitTestBlobSha: "eb33b1057cba28ea860828c773faed4e1c70fbe2",
          proofFile: "scripts/qa/hcm-work-queue-http.mjs",
          proofBlobSha: "5d3710f91b0e5d6b06010102566141beba86ca1d",
          harnessFile: "scripts/qa/tenant-second-pass-http.mjs",
          harnessBlobSha: "3765c1923e137f68b75fd545348868672f3f2f5d",
          workflowFile: ".github/workflows/security-http-smoke.yml",
          workflowBlobSha: "96b337c06eecf2a0ea0a72d750b8fb7a35298c85",
          ownPageLine: 145, foreignPageLine: 153,
          ownPositiveLine: 158, foreignDenialLine: 170, unchangedDbLine: 182,
          credits: 0, independentlyAccepted: false, productionCertified: false,
        }, "Only the exact uncredited HR Work Queue PG16 proof candidate is allowed");
        const workflowAddition = entry.pendingWorkflowChange;
        assert.deepEqual(workflowAddition, {
          kind: "managed-payroll-approval-disposable-http-step-review-only",
          previousWorkflowBlobSha: "96b337c06eecf2a0ea0a72d750b8fb7a35298c85",
          workflowBlobSha: "cca392e383c9f24b3ab6d3ec0e5b0de5a6be2736",
          addedProofFile: "scripts/qa/tenant-managed-client-approval-http.mjs",
          addedProofBlobSha: "31de1c8394922da151d1f2fbc2798834e93e7ff1",
          fixtureFile: "scripts/qa/managed-client-worker-fixture.ts",
          fixtureBlobSha: "99f021a0a5cc4075b1c778cbe610a6283ea15356",
          coverageCredits: 0, independentSecurityReview: "PENDING", productionCertified: false,
        }, "Managed approval HTTP addition must be separately source-pinned and unaccepted");
        // Historical PG16 receipt is still pinned to the old client-only page.
        // The later local-search and responsive-card change is separate,
        // exact-source and uncredited until fresh independent acceptance.
        const pendingUiChange = entry.pendingUiChange;
        assert.deepEqual(pendingUiChange, {
          kind: "hcm-work-items-client-local-search-and-responsive-cards-review-only",
          previousPageBlobSha: historicalPageSha,
          pageBlobSha: previousUiPageSha,
          helperBlobSha: "d7e56a5c97aee6a6fb50de64119eaf4fa84e3fed",
          unitTestBlobSha: "714f0d9d02cac0d3a595d3a445377520ac9dd5a7",
          browserScript: "scripts/hcm-request-lifecycle-browser.mjs",
          browserScriptBlobSha: "793ef20c5f75e55b8162054087a8ab0388fafda3",
          coverageCredits: 0,
          independentlyAccepted: false,
          productionCertified: false,
        }, "UI changes need their own exact-source, zero-credit review record");
        // Preserve historical PG16 and mobile-search source receipts.
        // The new local sort/owner filter is only a separate, unaccepted
        // review candidate. No page or API coverage credit is conferred.
        const pendingViewChange = entry.pendingViewChange;
        assert.deepEqual(pendingViewChange, {
          kind: "hcm-work-items-client-local-sla-sort-and-unassigned-filter-review-only",
          previousPageBlobSha: previousUiPageSha,
          pageBlobSha: historicalClientPageSha,
          helperFile: "src/lib/hcm-work-queue-view.ts",
          helperBlobSha: "97a455fa7c2eeda0fb91ca681922665b91909434",
          unitTestFile: "tests/hcm-work-queue-view.test.ts",
          unitTestBlobSha: "790a470197dc816df4e3eaec20d0f4e6e33cb2eb",
          browserScript: "scripts/hcm-request-lifecycle-browser.mjs",
          browserScriptBlobSha: "793ef20c5f75e55b8162054087a8ab0388fafda3",
          coverageCredits: 0, independentlyAccepted: false, productionCertified: false,
        }, "Sort and owner filter require their own exact-source zero-credit record");
        const serverGate = entry.pendingServerGateChange;
        assert.deepEqual(serverGate, {
          kind: "hcm-work-items-server-authorized-boundary-uncredited",
          previousPageBlobSha: historicalClientPageSha,
          pageBlobSha: pageSha,
          clientFile: "src/components/hcm-work-queue.tsx",
          clientBlobSha: "dfeb1c3ba76cdd027dab18494acc99e5343a7408",
          selectorFile: "src/lib/hcm-work-items-page-tenancy.ts",
          selectorBlobSha: "a7ea8e1177a18d3227e167d2e7a060aa637f8413",
          testFile: "tests/hcm-work-items-page-isolation.test.ts",
          testBlobSha: "46799851610501ec356aecd2c7aa3b65b2457257",
          browserFixtureFile: "tests/fixtures/hcm-request-lifecycle.jsx",
          browserFixtureBlobSha: "097724cfb0eb47b763c9ec4f880bcd509afa6262",
          browserScript: "scripts/hcm-request-lifecycle-browser.mjs",
          browserScriptBlobSha: "4e76f4cb405a3c2e9b6d250b5f96518f443558ea",
          migratedSummaryTestFile: "tests/hcm-work-queue-summary.test.ts",
          migratedSummaryTestBlobSha: "ab858d6294263d0e90b2755392e4902c16dfba8c",
          migratedViewTestFile: "tests/hcm-work-queue-view.test.ts",
          migratedViewTestBlobSha: "498ffff3b6a0be6825e89c09af2ca1e463d6ab00",
          migratedPeopleOpsTestFile: "tests/parallel-people-ops-no-money-acceptance.test.ts",
          migratedPeopleOpsTestBlobSha: "db160fd853ef4b98c8692758ab23402e5a09bfef",
          historicalReceiptUnmodified: true,
          coverageCredits: 0, independentSecurityReview: "PENDING", productionCertified: false,
        }, "New server page cannot inherit historical client-only proof credits");
        for (const [file, sha] of [
          [serverGate.clientFile, serverGate.clientBlobSha],
          [serverGate.selectorFile, serverGate.selectorBlobSha],
          [serverGate.testFile, serverGate.testBlobSha],
          [serverGate.browserFixtureFile, serverGate.browserFixtureBlobSha],
          [serverGate.browserScript, serverGate.browserScriptBlobSha],
        ]) {
          assert.equal(gitBlobSha(readFileSync(file)), sha,
            "HCM server boundary source review drifted: " + file);
        }
        assert.equal(gitBlobSha(readFileSync(pendingViewChange.helperFile)), pendingViewChange.helperBlobSha,
          "HR view helper changed without source review");
        for (const [file, sha] of [
          [serverGate.migratedSummaryTestFile, serverGate.migratedSummaryTestBlobSha],
          [serverGate.migratedViewTestFile, serverGate.migratedViewTestBlobSha],
          [serverGate.migratedPeopleOpsTestFile, serverGate.migratedPeopleOpsTestBlobSha],
        ]) assert.equal(gitBlobSha(readFileSync(file)), sha,
          "Relocated HR queue UI test must remain source-pinned: " + file);
        assert.equal(gitBlobSha(readFileSync(serverGate.browserScript)),
          serverGate.browserScriptBlobSha,
          "Server-driven browser tenant-retirement proof changed without renewed review");
        for (const [file, sha] of [
          [reviewed.helperFile, reviewed.helperBlobSha],
          [reviewed.unitTestFile, reviewed.unitTestBlobSha],
          [reviewed.proofFile, reviewed.proofBlobSha],
          [reviewed.workflowFile, reviewed.workflowBlobSha],
        ]) {
          const expected = file === reviewed.helperFile ? pendingUiChange.helperBlobSha :
            file === reviewed.unitTestFile ? serverGate.migratedSummaryTestBlobSha :
            file === reviewed.workflowFile ? workflowAddition.workflowBlobSha : sha;
          assert.equal(gitBlobSha(readFileSync(file)), expected,
            "HR Work Queue current helper or historical evidence changed without renewed review: " + file);
        }
        assert.match(evidenceLine(reviewed.proofFile, reviewed.ownPageLine, path),
          /const ownPage = expectStatus\(await request\("\/hcm\/work-items\?organizationId="/);
        assert.match(evidenceLine(reviewed.proofFile, reviewed.foreignPageLine, path),
          /const foreignPage = await request\("\/hcm\/work-items\?organizationId="/);
        assert.match(evidenceLine(reviewed.proofFile, reviewed.ownPositiveLine, path),
          /const ownApi = expectStatus\(await request\("\/api\/hcm\/work-items\?organizationId="/);
        assert.match(evidenceLine(reviewed.proofFile, reviewed.foreignDenialLine, path),
          /const foreignApi = expectStatus\(await request\("\/api\/hcm\/work-items\?organizationId="/);
        assert.match(evidenceLine(reviewed.proofFile, reviewed.unchangedDbLine, path),
          /assert\.deepEqual\(await victimCaseSnapshot\(\), beforeCases/);
        const proof = readFileSync(reviewed.proofFile, "utf8");
        for (const claim of [
          'assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only")',
          'assert.equal(process.env.SECURITY_SMOKE_URL, "http://127.0.0.1:3000")',
          'assert.equal(process.env.DATABASE_URL, "postgresql://postgres:postgres@127.0.0.1:5432/app_db")',
          "await verifyHcmWorkItemsPageTenantBoundary(f, { request, expectStatus })",
          "for (const idx of [1, 2])", "assert.equal(ownPositives, 2)",
          "assert.equal(foreignDenials, 4)", "assert.deepEqual(await victimWorkerSnapshot()",
          "assert.deepEqual(await victimPayrollSnapshot()", "assert.deepEqual(await victimAuditSnapshot()",
        ]) assert.ok(proof.includes(claim), "Missing HR work-queue negative control: " + claim);
        const page = readFileSync(path, "utf8");
        assert.doesNotMatch(page, /"use client"/, "Server page must not be a client-only shell");
        assert.match(page, /await assertOrganizationRole\(user\.id, organizationId, PEOPLE_ADMIN_ROLES\)/);
        assert.match(page, /if \(!access\?\.companyWide\) notFound\(\)/);
        assert.match(page, /authorizedOrganizationId=\{organizationId\}/);
        const client = readFileSync(serverGate.clientFile, "utf8");
        assert.match(client, /"use client"/);
        assert.match(client, /isVerifiedHcmWorkQueueResponse\(data, Number\(organizationId\)\)/);
        assert.match(client, /const summary = summarizeVerifiedWorkQueue\(items, activeQueue !== null && !loadError\)/);
        assert.match(client, /const visibleItems = summary \? deriveLoadedWorkQueueView\(findLoadedHcmWorkItems\(items, search\), sort, unassignedOnly\) : \[\]/,
          "Search must operate only after verified employer rows load");
        assert.match(client, /aria-label="Show only work items without a named owner"/,
          "Unassigned local filter must be explicit");
        assert.match(client, /aria-label="Work items on mobile"/,
          "Responsive cards must only show verified, employer-scoped work items");
        assert.doesNotMatch(client, /setOrganizationId|window\.location/,
          "Client may not select a different employer after server authorization");
        const route = readFileSync("src/app/api/hcm/work-items/route.ts", "utf8");
        assert.match(route, /const auth = await authorize\(organizationId\)/);
        assert.match(route, /WHERE c\.organization_id = \$1/);
        assert.match(route, /if \(!access\?\.companyWide\)/);
        // Preserve the old unaccepted page record, but bind the current caller
        // to the newly executed two-attacker receipt. The page remains GAP.
        const callerReceipt = verifyDocumentCallerReproof(entry.callerReproof);
        const callerFile = "scripts/qa/tenant-document-caller-reproof-http.mjs";
        const runner = readFileSync(callerFile, "utf8");
        assert.equal(gitBlobSha(Buffer.from(runner)), callerReceipt.pins[callerFile]);
        assert.match(runner, /verifyHcmWorkQueueIsolation\(f,\{request,expectStatus\}\)/);
        const workflow = readFileSync(reviewed.workflowFile, "utf8");
        assert.match(workflow, /npx tsx scripts\/qa\/tenant-second-pass-http\.mjs/);
        // The legacy HR Work Queue evidence stays tied to the original workflow.
        // Verify the new version differs ONLY by the bounded, disposable managed
        // approval HTTP step. This never upgrades HR or managed payroll coverage.
        const managedApprovalStep = [
          "      - name: Managed client approval and reapproval HTTP (fictional PG16, zero credit)",
          "        env:",
          "          CI: \"true\"",
          "          TENANT_SECOND_PASS_MODE: isolated-ci-only",
          "          NODE_ENV: \"production\"",
          "          DEMO_MODE: \"false\"",
          "          WORKER_ENABLED: \"false\"",
          "          CENTRAL_SCHEDULER_ENABLED: \"false\"",
          "          PAYMONGO_DISBURSEMENTS_ENABLED: \"false\"",
          "          XENDIT_PAYOUTS_ENABLED: \"false\"",
          "          XENDIT_BILLING_ENABLED: \"false\"",
          "        run: npx tsx scripts/qa/tenant-managed-client-approval-http.mjs",
          "",
          "",
        ].join("\n");
        assert.equal(workflow.split(managedApprovalStep).length, 2,
          "Expected exactly one guarded managed-approval HTTP step");
        assert.equal(gitBlobSha(Buffer.from(workflow.replace(managedApprovalStep, ""))),
          reviewed.workflowBlobSha, "Historical Work Queue workflow must be otherwise byte-identical");
        assert.equal(workflowAddition.previousWorkflowBlobSha, reviewed.workflowBlobSha);
        assert.equal(gitBlobSha(readFileSync(workflowAddition.addedProofFile)),
          workflowAddition.addedProofBlobSha, "Managed-approval proof code changed without review");
        assert.equal(gitBlobSha(readFileSync(workflowAddition.fixtureFile)),
          workflowAddition.fixtureBlobSha, "Managed-approval worker fixture changed without review");
        assert.match(workflow, /npx tsx scripts\/qa\/tenant-managed-client-approval-http\.mjs/);
        assert.equal(reviewed.credits, 0);
        continue; // Source-pinned, real-HTTP uncredited candidate, not blanket COVERED.
      }
      assert.ok(["COVERED", "PUBLIC-BY-DESIGN"].includes(entry.status),
        path + ": changed scoped entry still lacks valid same-employer + foreign-employer proof");
      if (entry.status === "COVERED") {
        const proof = entry.testedBy;
        assert.ok(proof, path + ": page COVERED needs actual browser/HTTP proof");
        const own = evidenceLine(proof.file, proof.ownPositiveLine, path + " own session");
        const foreign = evidenceLine(proof.file, proof.foreignDenialLine, path + " foreign session");
        if (path === "src/app/hcm/manager-decision-inbox/page.tsx") {
          assert.equal(proof.file, "scripts/qa/hcm-manager-inbox-page-http.mjs");
          assert.match(own, /const ownPage = await requestOn\(/);
          assert.match(foreign, /const foreignPage = await requestOn\(/);
          const proofSource = readFileSync(proof.file, "utf8");
          const runner = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
          assert.match(proofSource, /HCM_MANAGER_DECISION_INBOX_ENABLED: "true"/);
          assert.match(proofSource, /HCM_MANAGER_DECISION_INBOX_ORG_IDS: f\.orgs\.map/);
          assert.match(proofSource, /for \(const idx of \[1, 2\]\)/);
          assert.match(proofSource, /assert\.equal\(ownPage\.status, 200/);
          assert.match(proofSource, /assert\.equal\(foreignPage\.status, 404/);
          assert.match(proofSource, /assert\.equal\(foreignApi\.status, 403/);
          assert.match(proofSource, /assert\.deepEqual\(await db\.select\(\)\.from\(payrollRuns\)/);
          assert.match(runner, /verifyHcmManagerInboxPage\(f\)/);
        }
      } else {
        assert.ok(typeof entry.reason === "string" && entry.reason.trim().length >= 20,
          path + ": public-by-design requires a reviewed reason");
      }
    }
  }
  assert.equal(manifest.metrics.scopedPagesAndActions, manifest.scopedPages.length);
});

test("original three-employer HTTP hard-refuse and anti-false-pass guards remain intact", () => {
  const smoke = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
  for (const required of [
    'process.env.CI !== "true"',
    'process.env.TENANT_SECOND_PASS_MODE !== "isolated-ci-only"',
    'app.hostname !== "127.0.0.1"',
    'database.pathname !== "/app_db"',
    'process.env.PAYMONGO_DISBURSEMENTS_ENABLED === "true"',
    'process.env.XENDIT_PAYOUTS_ENABLED === "true"',
    'Victim-only ID must really exist and exceed 6',
    'Cross-tenant employee PATCH/DELETE must have no victim side effects',
  ]) {
    assert.ok(smoke.includes(required), "hard refuse/negative-control marker lost: " + required);
  }
  const workflow = readFileSync(".github/workflows/security-http-smoke.yml", "utf8");
  assert.match(workflow, /npx tsx scripts\/qa\/tenant-second-pass-http\.mjs/,
    "existing real-HTTP three-employer fixture must remain in Security HTTP Smoke");
  assert.match(workflow, /node --test tests\/tenant-second-pass-inventory\.test\.mjs tests\/tenant-isolation-coverage-inventory\.test\.mjs/,
    "security smoke must invoke the original test alongside the full-surface drift guard");
});

test("real-HTTP login audit for the public credential exchange cannot target a forged employer", () => {
  const path = "src/app/api/auth/login/route.ts";
  const route = readFileSync(path, "utf8");
  const writer = readFileSync("src/lib/audit.ts", "utf8");
  const entry = manifest.allApiRouteFiles[path];
  const method = entry.methods.find(item => item.name === "POST");
  assert.equal(method?.status, "PUBLIC-BY-DESIGN");
  assert.match(method.reason, /server-derived active membership/);
  const proof = method.reviewedPublicProof;
  assert.equal(proof?.file, "scripts/qa/tenant-login-audit-http.mjs");
  assert.equal(proof?.harness, "scripts/qa/tenant-second-pass-http.mjs");
  const suite = readFileSync(proof.file, "utf8");
  const runner = readFileSync(proof.harness, "utf8");
  assert.match(runner, /verifyTenantLoginAuditIsolation\(\s*f,\s*\{\s*request,\s*expectStatus\s*\}\s*\)/);
  assert.ok(runner.includes('if (process.env.LOCAL_LOGIN_AUDIT_ENABLED === "true") await'),
    "Do not require audit receipts while the opt-in feature is disabled");
  const smokeWorkflow = readFileSync(".github/workflows/security-http-smoke.yml", "utf8");
  assert.match(smokeWorkflow, /LOCAL_LOGIN_AUDIT_ENABLED: "true"/,
    "The dedicated tenant security smoke must run live opt-in login-audit acceptance");
  assert.match(suite, /process\.env\.TENANT_SECOND_PASS_MODE, "isolated-ci-only"/);
  assert.match(suite, /for \(const idx of \[1, 2\]\)/);
  assert.match(suite, /hashPassword\(fictionalPassword\)/);
  assert.match(suite, /organizationId: victimOrg\.id, userId: f\.owners\[0\]\.id/);
  assert.match(evidenceLine(proof.file, proof.ownPositiveLine, "local login own HTTP"),
    /const own = expectStatus\(await request\(loginPath,/);
  assert.match(evidenceLine(proof.file, proof.invalidCredentialsLine, "local login 401"),
    /const invalid = expectStatus\(await request\(loginPath,/);
  assert.match(evidenceLine(proof.file, proof.foreignIsolationLine, "victim unchanged"),
    /assert\.deepEqual\(victimAfter, victimBefore,/);
  assert.match(evidenceLine(proof.file, proof.unchangedDbLine, "victim audit invariant"),
    /assert\.deepEqual\(victimAfter, victimBefore,/);
  assert.match(suite, /assert\.equal\(ownAfter\.length, ownBefore\.length \+ 1,/);
  assert.match(suite, /assert\.equal\(receipt\.organizationId, ownOrg\.id\)/);
  assert.match(suite, /assert\.deepEqual\(await tenantAuditRows\(victimOrg\.id\), victimBefore,/);
  assert.match(writer, /eq\(userOrganizations\.active, true\)/);
  assert.match(writer, /await tx\.insert\(auditEvents\)\.values\(memberships\.map\(/);
  const audit = route.indexOf("await recordSuccessfulLocalLogin({");
  const cookie = route.indexOf("jar.set(SESSION_COOKIE, session.token");
  assert.ok(audit > 0 && cookie > audit,
    "Sign-in audit must commit before browser session delivery");
  assert.match(route, /await revokeSession\(session\.token\)\.catch\(\(\) => \{\}\)/);
});

test("roster-batches POST credit requires independent HTTP stage, replay, approve AND reject", () => {
  const routePath = "src/app/api/workforce/roster-batches/route.ts";
  const api = manifest.allApiRouteFiles[routePath];
  const post = api.methods.find(method => method.name === "POST");
  const get = api.methods.find(method => method.name === "GET");
  assert.equal(get.status, "COVERED", "prior GET proof and receipt are preserved");
  const actionFile = "scripts/qa/tenant-batches/roster-batches-actions-http.mjs";
  const legacyFile = "scripts/qa/tenant-batches/roster-batches-http.mjs";
  const script = readFileSync(actionFile, "utf8");
  const legacy = readFileSync(legacyFile, "utf8");
  const workflow = readFileSync(".github/workflows/tenant-roster-batches-http.yml", "utf8");
  // A directly inserted pending batch cannot pass for successful stage or
  // approve. All three real HTTP paths are independent of old reject receipts.
  for (const evidence of [
    'const response = check(await post(e, stageBody(e)), 201',
    'const replay = check(await post(e, stageBody(e)), 200',
    'assert.equal(replay.json?.replayed, true)',
    'assert.equal(row.requestSha256, requestDigest',
    'assert.equal(receipt.action, "WFM bulk roster batch staged")',
    'const result = check(await post(e, decideBody("approve", e.orgId,',
    'assert.equal(row.decidedByUserId, e.checkerId)',
    'assert.equal(override.employeeId, e.workerId)',
    'assert.equal(receipt.action, "WFM governed bulk roster published")',
    'assert.deepEqual(await snapshot(e.orgId), expected.get(e.orgId)',
    'await deny(actor, stageBody(actor, {',
    'victim.stageBatchId, actor.decisionNote), 404',
    'victim.stageBatchId, actor.decisionNote), 403',
    'independentReview: "PENDING", newCredits: 0',
  ]) assert.ok(script.includes(evidence), "new roster POST receipt lacks " + evidence);
  assert.match(legacy, /const victimReject = await reject\(victim, victim\.orgId, victim\.batchId\)/);
  assert.match(legacy, /assertRejectedRosterMutation\(oldVictim,/);
  const oldProve = workflow.indexOf("roster-batches-http.mjs prove");
  const newProve = workflow.indexOf("roster-batches-actions-http.mjs prove");
  assert.ok(oldProve >= 0 && newProve > oldProve,
    "New tests must not replace signed rejection receipts");
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /node --test tests\/tenant-\*\.test\.mjs/);
  assert.match(workflow, /npm run lint/);
  if (post.status === "GAP") {
    assert.equal(post.testedBy, null, "untested stage/approve cannot be credited");
    return;
  }
  assert.equal(post.status, "COVERED");
  const proof = post.testedBy;
  assert.equal(proof?.file, actionFile);
  assert.equal(proof?.independentSecurityReview, "PENDING");
  assert.equal(proof?.postgresMajor, 16);
  assert.equal(proof?.productionTested, false);
  assert.match(proof?.runLabel ?? "", /GitHub Actions .*PG16/);
  assert.ok(Number.isSafeInteger(proof?.workflowRunId) && proof.workflowRunId > 0);
  assert.equal(proof?.proofBlobSha, gitBlobSha(Buffer.from(script)));
  assert.equal(proof?.legacyProofBlobSha, gitBlobSha(Buffer.from(legacy)));
  const anchors = {
    ownPositiveLine: /const response = check\(await post\(e, stageBody\(e\)\), 201/,
    replayLine: /const replay = check\(await post\(e, stageBody\(e\)\), 200/,
    approveLine: /const result = check\(await post\(e, decideBody\("approve", e\.orgId,/,
    foreignDenialLine: /organizationId: victim\.orgId, employeeIds: \[victim\.workerId\]/,
    forgedSelectorLine: /victim\.stageBatchId, actor\.decisionNote\), 404/,
    unchangedDbLine: /assert\.deepEqual\(await snapshot\(e\.orgId\), expected\.get\(e\.orgId\)/,
  };
  for (const [field, re] of Object.entries(anchors)) {
    assert.match(evidenceLine(actionFile, proof[field], field), re);
  }
  assert.match(evidenceLine(legacyFile, proof.legacyRejectLine, "positive reject"),
    /const victimReject = await reject\(victim, victim\.orgId, victim\.batchId\)/);
});

test("worksites POST credit requires every one of the ten actions, both attackers, the victim and the pilot-off employer", async () => {
  const routePath = "src/app/api/workforce/worksites/route.ts";
  const api = manifest.allApiRouteFiles[routePath];
  const post = api.methods.find(method => method.name === "POST");
  assert.equal(api.methods.find(method => method.name === "GET").status, "COVERED", "the separate GET proof is preserved");
  const harnessFile = "scripts/qa/tenant-worksites-actions-http.mjs";
  const { WORKSITE_ACTIONS } = await import("../scripts/qa/tenant-worksites-actions-contract.mjs");
  const harness = readFileSync(harnessFile, "utf8");
  const workflow = readFileSync(".github/workflows/tenant-worksites-actions-http.yml", "utf8");
  const routeActions = new Set([...readFileSync(routePath, "utf8").matchAll(/action === "([a-z_]+)"/g)].map(match => match[1]));
  for (const action of routeActions) assert.ok(WORKSITE_ACTIONS.includes(action), "the route gained an action the proof does not cover: " + action);
  assert.equal(WORKSITE_ACTIONS.length, 10);
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-worksites-actions-http\.mjs/);
  assert.equal(post.status, "COVERED");
  const proof = post.testedBy;
  assert.equal(proof.file, harnessFile);
  assert.deepEqual(proof.methodActions, [...WORKSITE_ACTIONS]);
  assert.equal(proof.postgresMajor, 16);
  assert.match(proof.runLabel, /^GitHub Actions \d+\/\d+ PG16 all actions PASS$/);
  assert.equal(proof.evidence, "https://github.com/erwinmehehe/payrollph/actions/runs/" + proof.workflowRunId + "/job/" + proof.workflowJobId);
  assert.equal(proof.proofBlobSha, gitBlobSha(Buffer.from(harness)), "the harness changed; the proof must be re-run and re-credited");
  assert.equal(proof.contractBlobSha, gitBlobSha(readFileSync("scripts/qa/tenant-worksites-actions-contract.mjs")));
  assert.equal(proof.workflowBlobSha, gitBlobSha(Buffer.from(workflow)));
  assert.equal(proof.routeBlobSha, gitBlobSha(readFileSync(routePath)));
  assert.equal(api.gitBlobSha, proof.routeBlobSha);
  const anchors = {
    ownPositiveLine: /await allowed\(actor, createBody\(actor\.org\.id, "NEW-"/,
    foreignDenialLine: /await refused\(actor, createBody\(victim\.org\.id, "FOREIGN-"/,
    forgedSelectorLine: /await refused\(actor, assignBody\(actor\.org\.id, victim\.worker\.id, actor\.site1\.id\)/,
    unchangedDbLine: /for \(const e of subjects\) assertImmutableWorksiteSql\(before\.get\(e\.org\.id\)/,
    victimIdOrderingLine: /assert\.ok\(victim\.org\.id > Math\.max\(/,
  };
  for (const [field, pattern] of Object.entries(anchors)) assert.match(evidenceLine(harnessFile, proof[field], field), pattern, field);
  assert.equal(proof.line, proof.ownPositiveLine);
  assert.deepEqual(Object.keys(proof.actionOwnLines), [...WORKSITE_ACTIONS], "every action has its own cited own-success line");
  for (const [action, number] of Object.entries(proof.actionOwnLines)) {
    assert.match(evidenceLine(harnessFile, number, action), /await allowed\(actor, /, action + " must cite a real own write");
    assert.ok(evidenceLine(harnessFile, number, action).includes("own " + action), action + " line must name its own action");
  }
  for (const evidence of ["for (const actor of attackers)", "victim.seedAuthorization.id", "assertImmutableWorksiteSql(before.get(other.org.id)",
    "non-allowlisted employer \" + action", "requireDisposableWorksiteActions();"]) assert.ok(harness.includes(evidence), "harness lacks " + evidence);
  assert.ok(harness.indexOf("requireDisposableWorksiteActions();") < harness.indexOf('import("../../src/db/index.ts")'),
    "the fail-closed guard must run before any database import");
});

test("WRK-02 Batch 2 credits require the exact passing run, byte-pinned inputs and a cited call for every method", () => {
  const harnessFile = "scripts/qa/tenant-wrk02-batch2-http.mjs";
  const harness = readFileSync(harnessFile, "utf8"), harnessLines = harness.split("\n");
  const workflow = readFileSync(".github/workflows/tenant-wrk02-batch2-http.yml", "utf8");
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-wrk02-batch2-http\.mjs/);
  const wanted = [
    ["src/app/api/workforce-planning/baselines/route.ts", "POST", ["publish"], /actorResponse\(BASELINE/],
    ["src/app/api/workforce-planning/position-executions/route.ts", "POST", ["preview", "reopen"], /actorResponse\(EXECUTION/],
    ["src/app/api/workforce-planning/position-executions/route.ts", "PATCH", ["apply", "cancel"], /actorResponse\(EXECUTION/],
  ];
  for (const [routePath, name, actions, ownPattern] of wanted) {
    const api = manifest.allApiRouteFiles[routePath];
    const method = api.methods.find(entry => entry.name === name);
    assert.equal(api.methods.find(entry => entry.name === "GET").status, "COVERED", "the separate GET proof is preserved");
    assert.equal(method.status, "COVERED", routePath + " " + name);
    const proof = method.testedBy;
    assert.equal(proof.file, harnessFile);
    assert.deepEqual(proof.methodActions, actions);
    assert.equal(proof.postgresMajor, 16);
    assert.match(proof.runLabel, /^GitHub Actions \d+\/\d+ PG16 batch2 PASS$/);
    assert.equal(proof.evidence, "https://github.com/erwinmehehe/payrollph/actions/runs/" + proof.workflowRunId + "/job/" + proof.workflowJobId);
    assert.equal(proof.proofBlobSha, gitBlobSha(Buffer.from(harness)), "the harness changed; re-run the workflow and re-credit");
    assert.equal(proof.contractBlobSha, gitBlobSha(readFileSync("scripts/qa/tenant-wrk02-batch2-contract.mjs")));
    assert.equal(proof.workflowBlobSha, gitBlobSha(Buffer.from(workflow)));
    assert.equal(proof.routeBlobSha, gitBlobSha(readFileSync(routePath)));
    assert.equal(api.gitBlobSha, proof.routeBlobSha);
    assert.equal(proof.line, proof.ownPositiveLine);
    assert.match(harnessLines[proof.ownPositiveLine - 1] ?? "", ownPattern, name + " own-success anchor");
    assert.match(harnessLines[proof.foreignDenialLine - 1] ?? "", /denied\(/, name + " foreign-denial anchor");
    assert.match(harnessLines[proof.forgedSelectorLine - 1] ?? "", /denied\(/, name + " forged/unknown-selector anchor");
    assert.match(harnessLines[proof.unchangedDbLine - 1] ?? "", /assertPlanningUnchanged\(victimBefore/, name + " unchanged-victim anchor");
  }
  const executions = readFileSync("src/app/api/workforce-planning/position-executions/route.ts", "utf8");
  assert.match(executions, /\["apply", "cancel"\]\.includes\(action\)/, "PATCH gained or lost an action; every action needs its own proof");
  for (const evidence of ["requireDisposableWrk02Batch2(", "assertPlanningUnchanged(victimBefore", '"cross-employer " + action + " on real victim execution"',
    '"Alpha own exact-hash apply"', '"owned execution cancel"', '"foreign approved scenario"']) assert.ok(harness.includes(evidence), "harness lacks " + evidence);
});

test("allocations POST and PATCH credits require the exact passing run, byte-pinned inputs and a cited call per method", () => {
  const routePath = "src/app/api/workforce-planning/allocations/route.ts";
  const harnessFile = "scripts/qa/tenant-wfp-allocations-http.mjs";
  const api = manifest.allApiRouteFiles[routePath];
  const harness = readFileSync(harnessFile, "utf8"), harnessLines = harness.split("\n");
  const workflow = readFileSync(".github/workflows/tenant-wfp-allocations-http.yml", "utf8");
  const route = readFileSync(routePath, "utf8");
  assert.ok(workflow.includes("image: postgres:16"));
  assert.ok(workflow.includes("node --import tsx scripts/qa/tenant-wfp-allocations-http.mjs"));
  assert.equal(api.methods.find(entry => entry.name === "GET").status, "COVERED", "the separate GET proof is preserved");
  assert.ok(route.includes('["submit", "accept", "reject"].includes(action)'), "PATCH gained or lost an action; every action needs its own proof");
  assert.ok(route.includes('if (entityType === "allocation")'));
  assert.ok(route.includes('if (entityType === "submission")'));
  const wanted = {
    POST: { actions: ["allocation_create", "allocation_update", "manager_draft_create"],
      own: "const createAllocation = await post(actor, allocationBody(actor));", second: "const createDraft = await post(actor, submissionBody(actor, allocationId));",
      foreign: "deny(await post(actor, allocationBody(actor, victim.orgId,", secondForeign: "deny(await post(actor, submissionBody(actor," },
    PATCH: { actions: ["submit", "accept", "reject"],
      own: 'const submitted = await patch(actor, actor.draftId, "submit");', second: "const decision = await patch(actor, actor.draftId, action, { checker: true });",
      foreign: "deny(await patch(actor, victim.draftId, action, { orgId: actor.orgId }),", secondForeign: 'deny(await patch(actor, victim.draftId, "accept",' },
  };
  const cites = (number, fragment, label) => assert.ok((harnessLines[number - 1] ?? "").includes(fragment), label);
  for (const [name, spec] of Object.entries(wanted)) {
    const method = api.methods.find(entry => entry.name === name);
    assert.equal(method.status, "COVERED", name);
    assert.equal(method.reviewedUncertified, undefined, "a credited method no longer carries the zero-credit hold");
    const proof = method.testedBy;
    assert.equal(proof.file, harnessFile);
    assert.deepEqual(proof.methodActions, spec.actions);
    assert.equal(proof.postgresMajor, 16);
    assert.equal(proof.runLabel, "GitHub Actions " + proof.workflowRunId + "/" + proof.workflowJobId + " PG16 allocations PASS");
    assert.equal(proof.evidence, "https://github.com/erwinmehehe/payrollph/actions/runs/" + proof.workflowRunId + "/job/" + proof.workflowJobId);
    assert.equal(proof.proofBlobSha, gitBlobSha(Buffer.from(harness)), "the harness changed; re-run the workflow and re-credit");
    assert.equal(proof.contractBlobSha, gitBlobSha(readFileSync("scripts/qa/tenant-wfp-allocations-contract.mjs")));
    assert.equal(proof.testBlobSha, gitBlobSha(readFileSync("tests/tenant-wfp-allocations-contract.test.mjs")));
    assert.equal(proof.workflowBlobSha, gitBlobSha(Buffer.from(workflow)));
    assert.equal(proof.routeBlobSha, gitBlobSha(Buffer.from(route)));
    assert.equal(api.gitBlobSha, proof.routeBlobSha);
    assert.equal(proof.line, proof.ownPositiveLine);
    cites(proof.ownPositiveLine, spec.own, name + " own-success anchor");
    cites(proof.secondaryOwnPositiveLine, spec.second, name + " second own-success anchor");
    cites(proof.foreignDenialLine, spec.foreign, name + " foreign-denial anchor");
    cites(proof.secondaryForeignDenialLine, spec.secondForeign, name + " second foreign-denial anchor");
    cites(proof.unchangedDbLine, "assertNoStateChange(expected.get(e.orgId), await snapshot(e.orgId)", name + " unchanged anchor");
    cites(proof.higherIdVictimLine, "assert.ok(victim[key] > attacker[key]", name + " higher-ID victim anchor");
  }
  for (const evidence of ["requireDisposablePlanningEnv();", "cannot shrink below accepted manager demand", "sum of org-unit budgets cannot exceed plan budget",
    'for (const action of ["submit", "accept", "reject"])', "foreignPatches: 8, nonadminPatches: 2, makerDecisionDenials: 3"]) assert.ok(harness.includes(evidence), "harness lacks " + evidence);
  assert.ok(harness.indexOf("requireDisposablePlanningEnv();") < harness.indexOf('import("../../src/db/index.ts")'), "fail-closed guard must precede database imports");
});

test("xendit payout webhook credit requires the exact passing run, byte-pinned inputs, the provider-callback rule and a cited call per case", () => {
  const routePath = "src/app/api/webhooks/xendit-payout/route.ts";
  const harnessFile = "scripts/qa/tenant-webhook-xendit-payout-http.mjs";
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const harness = readFileSync(harnessFile, "utf8");
  const harnessLines = harness.split(String.fromCharCode(10));
  const workflow = readFileSync(".github/workflows/tenant-webhook-xendit-payout-http.yml", "utf8");
  const route = readFileSync(routePath, "utf8");
  assert.ok(workflow.includes("node --import tsx scripts/qa/tenant-webhook-xendit-payout-http.mjs"));
  assert.ok(workflow.includes("image: postgres:16"));
  assert.equal(manifest.proofPolicy.providerCallback.creditedMethods, 4, "the rule counts the xendit payout, PayMongo transfer, Resend and Xendit subscriptions credits");
  const api = manifest.allApiRouteFiles[routePath];
  assert.deepEqual(api.methods.map(entry => [entry.name, entry.status]), [["POST", "COVERED"]]);
  const method = api.methods[0];
  assert.equal(method.reviewedUncertified, undefined);
  const proof = method.testedBy;
  assert.equal(proof.file, harnessFile);
  assert.equal(proof.rule, "proofPolicy.providerCallback");
  assert.equal(proof.postgresMajor, 16);
  assert.equal(proof.runLabel, "GitHub Actions " + proof.workflowRunId + "/" + proof.workflowJobId + " PG16 xendit-payout-webhook PASS");
  assert.equal(proof.evidence, "https://github.com/erwinmehehe/payrollph/actions/runs/" + proof.workflowRunId + "/job/" + proof.workflowJobId);
  assert.equal(proof.proofPullRequest, 1696);
  assert.equal(proof.proofBlobSha, gitBlobSha(Buffer.from(harness)), "the harness changed; re-run the workflow and re-credit");
  assert.equal(proof.contractBlobSha, gitBlobSha(readFileSync("scripts/qa/tenant-webhook-xendit-payout-contract.mjs")));
  assert.equal(proof.testBlobSha, gitBlobSha(readFileSync("tests/tenant-webhook-xendit-payout.test.mjs")));
  assert.equal(proof.workflowBlobSha, gitBlobSha(Buffer.from(workflow)));
  assert.equal(proof.routeBlobSha, gitBlobSha(Buffer.from(route)));
  assert.equal(api.gitBlobSha, proof.routeBlobSha);
  assert.equal(proof.line, proof.ownPositiveLine);
  const cites = (number, fragment, label) => assert.ok((harnessLines[number - 1] ?? "").includes(fragment), label);
  cites(proof.ownPositiveLine, "const ownEvent = await send(eventBody(a));", "own-observation anchor");
  cites(proof.secondaryOwnPositiveLine, "const forgedEvent = await send(eventBody(a, {", "forged-selector anchor");
  cites(proof.foreignDenialLine, "const foreignVictim = await send(eventBody(victim));", "foreign-run anchor");
  cites(proof.secondaryForeignDenialLine, "const foreignSecondAttacker = await send(eventBody(b));", "second-attacker anchor");
  cites(proof.unchangedDbLine, "await unchangedExcept(before);", "unchanged-SQL anchor");
  cites(proof.unchangedDbLine - 1, "for (const forbidden of [victim.marker,", "unchanged-SQL anchor follows the echo check");
  cites(proof.higherIdVictimLine, "victim.payout[key] > a.payout[key]", "higher-ID victim anchor");
  cites(proof.replayLine, "const replayEvent = await send(eventBody(a), { eventId: ownEvent.eventId });", "replay anchor");
  cites(proof.concurrentDeliveryLine, "const raced = await Promise.all(", "concurrent-delivery anchor");
  cites(proof.crossBoundLine, "const crossVictimReference = await send(", "cross-bound anchor");
  for (const evidence of ["requireDisposableXenditPayoutWebhook();", "a real foreign run must not be distinguishable from a nonexistent run",
    "denial must not echo victim data", "Settlement observation rejected; manual review required."]) assert.ok(harness.includes(evidence), "harness lacks " + evidence);
  assert.ok(harness.indexOf("requireDisposableXenditPayoutWebhook();") < harness.indexOf('import("../../src/db/index.ts")'), "fail-closed guard must precede database imports");
});

test("2026-11-02 exact-head promotion sweep pins six four-part method receipts and preserves holds", () => {
  const specs = [
    ["leave/conversion", "scripts/qa/tenant-leave-conversion-post-http.mjs", "bc90fac8e0023c4e8f8d879c31447bd4f666787f",
      "baa29dc6098085b67fa80bb9e3657964f0045b2c", ".github/workflows/tenant-leave-conversion-post-http.yml", "9c4c7a18465193604de3489fba109620603b03c5",
      1789, "b9ae9ca73fea870eac0ebbab42e2a7f3446613cb", 42153538138, 111, 128, 130, 141,
      "const result = expect(await request(e, ownBody(e)), 201,", "const org = expect(await request(attacker, ownBody(victim)), 403,",
      "const forged = expect(await request(attacker, {", "assert.deepEqual(await snapshot(e), before.get(e.org.id),"],
    ["payroll/overpayment-preflight", "scripts/qa/tenant-overpayment-preflight-post-http.mjs", "24a475e0c695a97789d01b22da22ebd3d361f3f6",
      "e148f3ae34a487822fb9bc361b7a494afbc653f5", ".github/workflows/tenant-overpayment-preflight-post-http.yml", "def46af65b1d983c0d3fb2a32cf7f42e6821166f",
      1674, "ec0e8b081c52bb8b22b7911c886c2005e45312f2", 41264867045, 84, 95, 99, 114,
      "const result = expect(await post(e, body(e)), 200,", "const foreignOrg = expect(await post(attacker, body(victim)), 403,",
      "const worker = expect(await post(attacker, { ...own, employeeId: victim.worker.id })", "assert.deepEqual(await snapshot(e), before.get(e.org.id),"],
    ["outbox", "scripts/qa/tenant-edg02-outbox-http.mjs", "1b1d3a79989f6a1c9aaeba39969ceccc4ce24e92",
      "65144a65d42039fbb99f91110e1bc49d79679994", ".github/workflows/tenant-edg02-outbox-http.yml", "a7d6a8ba13726a92575912f8920321f25f999756",
      1684, "72387977d98c05ad83a8b8affe6732a5de827423", 41306939767, 208, 175, 174, 184,
      "assert.equal(ownSingle.status, 200", "[{ organizationId: victim.org.id, messageId: victim.single.id }, 403]",
      "[{ organizationId: actor.org.id, messageId: victim.single.id }, 404]", "assert.deepEqual(await snapshot(victim.org.id), victimBefore,"],
    ["treasury-controls", "scripts/qa/tenant-mny02-treasury-http.mjs", "06ccd8204c45e93edf9db34fc465e7685b39eb73",
      "56583ab43e7dc39101bb17122b4e9bdcbbaad81a", ".github/workflows/tenant-mny02-treasury-http.yml", "790ff70cdbae22ef9709e7676b2ba99f1244fb4e",
      1683, "b7ea3bf6ea693b1cbb001060c0d234b86046bd9c", 41319237095, 169, 123, 130, 115,
      "const own = await post(e, body(e));", "const cross = await post(e, body(victim));",
      "const forged = await post(e, body(e, { operatorUserIds: [victim.operator.id] }));", "assertUnchangedTreasury(victimBeforeAttacks, await snapshot(victim.org.id),"],
    ["compliance/labor-inspection", "scripts/qa/tenant-labor-inspection-post-http.mjs", "454bbfde7aab91069fd2eb006abd2c16fe268441",
      "94cc58cb4de0d8e79b7bd7881413b71e6f1fddb5", ".github/workflows/tenant-labor-inspection-post-http.yml", "99a24fbdc2077dd5ed779eaf5b7c428d0b09638d",
      1714, "e2e408735dd42c5104b55318bca0e74e67eaf019", 41392987376, 127, 104, 111, 108,
      "const response = await post(e);", "const foreign = await post(actor, {",
      "const stolen = await post(actor, { findingKey: victim.findingKey });", "await unchanged(before, \"foreign actual employer\");"],
    ["earned-wage", "scripts/qa/tenant-earned-wage-post-http.mjs", "eef1126fe34ad8bf31a784865a07e4ced197b86c",
      "e030259bb14719a806acbdad77c35135f63e1520", ".github/workflows/tenant-earned-wage-post-http.yml", "8d5d0100c39c22531f62528c4cf8674ecf5ed1bb",
      1669, "3c8787ce4cf9ed787b3b253067a6032700ef2068", 41366324196, 34, 41, 42, 44,
      "const own=await send(e,body(e),201);", "await send(e,body(victim),403);",
      "await send(e,{...body(e),employeeId:victim.worker.id},404);", "assert.deepEqual(await snapshot(victim),victimBefore,"],
  ];
  for (const [route, file, proofBlobSha, routeBlobSha, workflowFile, workflowBlobSha,
    proofPullRequest, proofHeadSha, workflowRunId, own, foreign, forged, unchanged,
    ownText, foreignText, forgedText, unchangedText] of specs) {
    const path = "src/app/api/" + route + "/route.ts";
    const record = manifest.allApiRouteFiles[path];
    const method = record?.methods.find(m => m.name === "POST");
    assert.equal(method?.status, "COVERED", route + " must have one real executed POST");
    assert.equal(method?.reviewedUncertified, undefined, route + " cannot retain an uncredited hold");
    assert.equal(record?.gitBlobSha, routeBlobSha, route + " pinned route SHA");
    const proof = method.testedBy;
    assert.equal(proof.file, file);
    assert.equal(proof.proofBlobSha, proofBlobSha);
    assert.equal(proof.routeBlobSha, routeBlobSha);
    assert.equal(proof.workflowFile, workflowFile);
    assert.equal(proof.workflowBlobSha, workflowBlobSha);
    assert.equal(proof.proofPullRequest, proofPullRequest);
    assert.equal(proof.proofHeadSha, proofHeadSha);
    assert.equal(proof.workflowRunId, workflowRunId);
    assert.equal(proof.evidence,
      "https://github.com/erwinmehehe/payrollph/actions/runs/" + workflowRunId);
    assert.equal(proof.postgresMajor, 16);
    assert.equal(proof.independentSecurityReview, "PENDING",
      "Provisional method credit must not claim human/production acceptance");
    for (const [source, sha] of [[path, routeBlobSha], [file, proofBlobSha],
      [workflowFile, workflowBlobSha]]) {
      assert.equal(gitBlobSha(readFileSync(source)), sha,
        route + " changed source/proof/workflow and must be freshly re-proven: " + source);
    }
    for (const [field, n, expected] of [
      ["ownPositiveLine", own, ownText], ["foreignDenialLine", foreign, foreignText],
      ["forgedSelectorLine", forged, forgedText], ["unchangedDbLine", unchanged, unchangedText],
    ]) assert.ok(evidenceLine(file, proof[field], route + " " + field).includes(expected) && proof[field] === n,
      route + " " + field + ": changed proof citation; repin only after re-running exact-head PG16");
    assert.equal(proof.line, proof.ownPositiveLine);
  }
  const held = [
    ["bir/annual-employer/candidate", "POST"],
    ["workforce-planning", "POST"],
    ["workforce-planning", "PATCH"], ["workforce-planning/scenarios", "POST"],
  ];
  for (const [route, name] of held) {
    const method = manifest.allApiRouteFiles["src/app/api/" + route + "/route.ts"]?.methods.find(m => m.name === name);
    if(route==='workforce-planning/scenarios'&&name==='POST'){
      assert.equal(verifyRecoveryCredits(manifest),3);continue;
    }
    if (route === "workforce-planning" && ["POST","PATCH"].includes(name)) {
      assert.equal(verifyRootCredits(manifest),2);
      continue;
    }
    assert.equal(method?.status, "GAP", name + " " + route + " remains held or lacks whole-method proof");
    assert.equal(method?.testedBy, null);
  }
  // Live manifest counts must be derived and non-regressing against the PR base.
  // Never pin a moving six-credit tally inside a regression test.
  assertLiveTenantCounts(assert, manifest);
});

test("PayMongo transfer webhook credit requires the exact passing run, byte-pinned inputs, the provider-callback rule and a cited call per case", () => {
  const routePath = "src/app/api/webhooks/paymongo/transfers/route.ts";
  const harnessFile = "scripts/qa/tenant-webhook-paymongo-transfer-http.mjs";
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const harness = readFileSync(harnessFile, "utf8");
  const harnessLines = harness.split(String.fromCharCode(10));
  const workflow = readFileSync(".github/workflows/tenant-webhook-paymongo-transfer-http.yml", "utf8");
  const route = readFileSync(routePath, "utf8");
  assert.ok(workflow.includes("node --import tsx scripts/qa/tenant-webhook-paymongo-transfer-http.mjs"));
  assert.ok(workflow.includes("image: postgres:16"));
  assert.ok(workflow.includes("paymongo-transfer-webhook-isolation:"));
  assert.equal(manifest.proofPolicy.providerCallback.creditedMethods, 4, "the rule counts exactly the four credited methods");
  const api = manifest.allApiRouteFiles[routePath];
  assert.deepEqual(api.methods.map(entry => [entry.name, entry.status]), [["POST", "COVERED"]]);
  const method = api.methods[0];
  assert.equal(method.reviewedUncertified, undefined);
  const proof = method.testedBy;
  assert.equal(proof.file, harnessFile);
  assert.equal(proof.rule, "proofPolicy.providerCallback");
  assert.equal(proof.postgresMajor, 16);
  assert.equal(proof.runLabel, "GitHub Actions " + proof.workflowRunId + "/" + proof.workflowJobId + " PG16 paymongo-transfer-webhook PASS");
  assert.equal(proof.evidence, "https://github.com/erwinmehehe/payrollph/actions/runs/" + proof.workflowRunId + "/job/" + proof.workflowJobId);
  assert.equal(proof.proofPullRequest, 1708);
  assert.equal(proof.proofBlobSha, gitBlobSha(Buffer.from(harness)), "the harness changed; re-run the workflow and re-credit");
  assert.equal(proof.contractBlobSha, gitBlobSha(readFileSync("scripts/qa/tenant-webhook-paymongo-transfer-contract.mjs")));
  assert.equal(proof.testBlobSha, gitBlobSha(readFileSync("tests/tenant-webhook-paymongo-transfer.test.mjs")));
  assert.equal(proof.workflowBlobSha, gitBlobSha(Buffer.from(workflow)));
  assert.equal(proof.routeBlobSha, gitBlobSha(Buffer.from(route)));
  assert.equal(api.gitBlobSha, proof.routeBlobSha);
  assert.equal(proof.line, proof.ownPositiveLine);
  const cites = (number, fragment, label) => assert.ok((harnessLines[number - 1] ?? "").includes(fragment), label);
  cites(proof.ownPositiveLine, "const own = await send(ownEvent);", "own-observation anchor");
  cites(proof.secondaryOwnPositiveLine, "const ownB = await send(eventBody(b));", "second-employer own-observation anchor");
  cites(proof.forgedSelectorLine, "const forged = await send(eventBody(a, {", "forged-selector anchor");
  cites(proof.foreignDenialLine, "eventBody(a, { transferId: victim.payout.transferId }),", "foreign-transfer anchor");
  cites(proof.secondaryForeignDenialLine, "eventBody(b, { transferId: victim.payout.transferId }),", "second-attacker anchor");
  cites(proof.crossBoundLine, "const ignored = await send(payload);", "cross-bound anchor");
  cites(proof.unchangedDbLine, "await unchangedExcept(before);", "unchanged-SQL anchor");
  assert.ok(proof.unchangedDbLine > proof.crossBoundLine, "unchanged-SQL anchor follows the refusal loop");
  cites(proof.replayLine, 'result(await send(ownEvent), 200, { ok: true, duplicate: true }, "same signed event replay");', "replay anchor");
  cites(proof.concurrentDeliveryLine, "const raced = await Promise.all(", "concurrent-delivery anchor");
  cites(proof.unknownRunLine, "const unknownRun = await send(eventBody(victim, { reference: nonexistentReference }));", "unknown-run anchor");
  for (const evidence of ["requireDisposablePaymongoTransferWebhook();", "a real foreign run must not be distinguishable from a nonexistent run",
    "every cross-bound ignore must be byte-identical", "concurrent duplicates must not double-write"]) assert.ok(harness.includes(evidence), "harness lacks " + evidence);
  assert.ok(harness.indexOf("requireDisposablePaymongoTransferWebhook();") < harness.indexOf('import("../../src/db/index.ts")'), "fail-closed guard must precede database imports");
  assert.ok(!route.includes("unknown-payroll-run"), "the existence oracle must stay removed");
});

test("Resend delivery webhook credit requires the exact passing run, byte-pinned inputs, the provider-callback rule and a cited call per case", () => {
  const routePath = "src/app/api/webhooks/resend/route.ts";
  const harnessFile = "scripts/qa/tenant-webhook-resend-http.mjs";
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const harness = readFileSync(harnessFile, "utf8");
  const harnessLines = harness.split(String.fromCharCode(10));
  const workflow = readFileSync(".github/workflows/tenant-webhook-resend-http.yml", "utf8");
  const route = readFileSync(routePath, "utf8");
  assert.ok(workflow.includes("node --import tsx scripts/qa/tenant-webhook-resend-http.mjs"));
  assert.ok(workflow.includes("image: postgres:16"));
  assert.ok(workflow.includes("resend-webhook-isolation:"));
  assert.equal(manifest.proofPolicy.providerCallback.creditedMethods, 4, "the rule counts exactly the four credited methods");
  const api = manifest.allApiRouteFiles[routePath];
  assert.deepEqual(api.methods.map(entry => [entry.name, entry.status]), [["POST", "COVERED"]]);
  const method = api.methods[0];
  assert.equal(method.reviewedUncertified, undefined);
  const proof = method.testedBy;
  assert.equal(proof.file, harnessFile);
  assert.equal(proof.rule, "proofPolicy.providerCallback");
  assert.equal(proof.postgresMajor, 16);
  assert.equal(proof.runLabel, "GitHub Actions " + proof.workflowRunId + "/" + proof.workflowJobId + " PG16 resend-webhook PASS");
  assert.equal(proof.evidence, "https://github.com/erwinmehehe/payrollph/actions/runs/" + proof.workflowRunId + "/job/" + proof.workflowJobId);
  assert.equal(proof.proofPullRequest, 1763);
  assert.equal(proof.proofBlobSha, gitBlobSha(Buffer.from(harness)), "the harness changed; re-run the workflow and re-credit");
  assert.equal(proof.contractBlobSha, gitBlobSha(readFileSync("scripts/qa/tenant-webhook-resend-contract.mjs")));
  assert.equal(proof.testBlobSha, gitBlobSha(readFileSync("tests/tenant-webhook-resend.test.mjs")));
  assert.equal(proof.workflowBlobSha, gitBlobSha(Buffer.from(workflow)));
  assert.equal(proof.routeBlobSha, gitBlobSha(Buffer.from(route)));
  assert.equal(api.gitBlobSha, proof.routeBlobSha);
  assert.equal(proof.line, proof.ownPositiveLine);
  const cites = (number, fragment, label) => assert.ok((harnessLines[number - 1] ?? "").includes(fragment), label);
  cites(proof.ownPositiveLine, 'result(own, 200, { ok: true, matched: true, duplicate: false, outboxId: a.mail.sent.id }, "A own delivery");', "own-delivery anchor");
  cites(proof.secondaryOwnPositiveLine, '"B own bounce");', "second-employer own-delivery anchor");
  cites(proof.forgedSelectorLine, '"old replay after 520 unrelated receipts");', "old-replay anchor");
  cites(proof.foreignDenialLine, "const refused = await send(eventBody(outboxId, providerMessage));", "foreign-row anchor");
  cites(proof.secondaryForeignDenialLine, '["B message id on the victim row", victim.mail.sent.id, b.mail.sent.providerMessageId],', "second-attacker anchor");
  cites(proof.crossBoundLine, "const refused = await send(eventBody(outboxId, providerMessage));", "cross-bound anchor");
  cites(proof.unchangedDbLine, "after = await unchangedExcept(before, beforeGlobal);", "unchanged-SQL anchor");
  assert.ok(proof.unchangedDbLine > proof.crossBoundLine, "unchanged-SQL anchor follows the refusal loop");
  cites(proof.replayLine, '"same event replay");', "replay anchor");
  cites(proof.concurrentDeliveryLine, "const raced = await Promise.all(", "concurrent-delivery anchor");
  cites(proof.unknownRunLine, "const missingRow = await send(eventBody(2_000_000_000", "nonexistent-row anchor");
  for (const evidence of ["requireDisposableResendWebhook();", "a real foreign row must not be distinguishable from a nonexistent row",
    "a signed event must not plant a provider message id on an unsent row", "an old replay must not rewrite delivery state",
    "concurrent duplicates must not double-write", "A rejected receipt insert must fail the complete callback so the provider retries"]) assert.ok(harness.includes(evidence), "harness lacks " + evidence);
  assert.ok(harness.indexOf("requireDisposableResendWebhook();") < harness.indexOf('import("../../src/db/index.ts")'), "fail-closed guard must precede database imports");
  // The credited source must keep the stored-message-id and in-transaction receipt rules the proof exercises.
  const mailer = readFileSync("src/lib/mailer.ts", "utf8");
  assert.ok(mailer.includes(".for(\"update\")") && mailer.includes("!row.providerMessageId") && mailer.includes("}, tx);"), "the credited recorder rules must stay in place");
});

test("Xendit subscriptions webhook credit requires the exact passing run, byte-pinned inputs, the bounded retry-refusal exception and a cited call per case", () => {
  const routePath = "src/app/api/webhooks/xendit/subscriptions/route.ts";
  const harnessFile = "scripts/qa/tenant-webhook-xendit-subscriptions-http.mjs";
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const harness = readFileSync(harnessFile, "utf8");
  const harnessLines = harness.split(String.fromCharCode(10));
  const workflow = readFileSync(".github/workflows/tenant-webhook-xendit-subscriptions-http.yml", "utf8");
  const route = readFileSync(routePath, "utf8");
  assert.ok(workflow.includes("node --import tsx scripts/qa/tenant-webhook-xendit-subscriptions-http.mjs"));
  assert.ok(workflow.includes("image: postgres:16"));
  assert.ok(workflow.includes("xendit-subscriptions-webhook-isolation:"));
  assert.ok(workflow.includes('XENDIT_BILLING_ENABLED: "true"'), "the route must run enabled, so a 503 is never the disabled path");
  assert.equal(manifest.proofPolicy.providerCallback.creditedMethods, 4);
  assert.ok(manifest.proofPolicy.providerCallback.neverCounts.includes("503"), "503 stays in neverCounts; only the bounded exception carves it out");
  assert.equal(manifest.proofPolicy.providerCallback.documentedRetryRefusal.appliesTo, "webhooks/xendit/subscriptions POST only.");
  const api = manifest.allApiRouteFiles[routePath];
  assert.deepEqual(api.methods.map(entry => [entry.name, entry.status]), [["POST", "COVERED"]]);
  const method = api.methods[0];
  assert.equal(method.reviewedUncertified, undefined, "the prior zero-credit record moves into the receipt");
  const proof = method.testedBy;
  assert.equal(proof.file, harnessFile);
  assert.equal(proof.rule, "proofPolicy.providerCallback");
  assert.equal(proof.ruleException, "proofPolicy.providerCallback.documentedRetryRefusal");
  assert.equal(proof.postgresMajor, 16);
  assert.equal(proof.runLabel, "GitHub Actions " + proof.workflowRunId + "/" + proof.workflowJobId + " PG16 xendit-subscriptions-webhook PASS");
  assert.equal(proof.evidence, "https://github.com/erwinmehehe/payrollph/actions/runs/" + proof.workflowRunId + "/job/" + proof.workflowJobId);
  assert.equal(proof.proofPullRequest, 1777);
  assert.equal(proof.mergedProofCommit, "eb230e357");
  assert.equal(proof.supersedesReview.kind, "xendit-subscriptions-audit-atomicity-PG16-review-only");
  assert.equal(proof.supersedesReview.coverageCredits, 0);
  assert.equal(proof.proofBlobSha, gitBlobSha(Buffer.from(harness)), "the harness changed; re-run the workflow and re-credit");
  assert.equal(proof.contractBlobSha, gitBlobSha(readFileSync("scripts/qa/tenant-webhook-xendit-subscriptions-contract.mjs")));
  assert.equal(proof.testBlobSha, gitBlobSha(readFileSync("tests/tenant-webhook-xendit-subscriptions.test.mjs")));
  assert.equal(proof.workflowBlobSha, gitBlobSha(Buffer.from(workflow)));
  assert.equal(proof.routeBlobSha, gitBlobSha(Buffer.from(route)));
  assert.equal(api.gitBlobSha, proof.routeBlobSha);
  assert.equal(proof.line, proof.ownPositiveLine);
  const cites = (number, fragment, label) => assert.ok((harnessLines[number - 1] ?? "").includes(fragment), label);
  cites(proof.ownPositiveLine, 'result(own, 200, { received: true, handled: true, status: "paid" }, "A own paid cycle");', "own-cycle anchor");
  cites(proof.secondaryOwnPositiveLine, '"B own paid cycle");', "second-employer own-cycle anchor");
  cites(proof.forgedSelectorLine, '"forged selectors ignored");', "forged-selector anchor");
  cites(proof.foreignDenialLine, "const refused = await send(payload);", "cross-bound refusal anchor");
  cites(proof.crossBoundLine, "const refused = await send(payload);", "cross-bound anchor");
  cites(proof.secondaryForeignDenialLine, '"victim wrong amount");', "victim amount-refusal anchor");
  cites(proof.unchangedDbLine, "await unchangedExcept(before);", "unchanged-SQL anchor");
  assert.ok(proof.unchangedDbLine > proof.crossBoundLine, "unchanged-SQL anchor follows the refusal loop");
  cites(proof.replayLine, '"same event replay");', "replay anchor");
  cites(proof.concurrentDeliveryLine, "const raced = await Promise.all([send(simultaneous), send(simultaneous)]);", "concurrent anchor");
  cites(proof.unknownPairLine, "const unknownPair = await send(eventBody(a, {", "invented-pair anchor");
  cites(proof.stalePlanLine, '"stale plan ignored");', "stale-plan anchor");
  for (const evidence of ["requireDisposableXenditSubscriptionsWebhook();", "a real foreign pair must not be distinguishable from a nonexistent pair",
    "concurrent duplicates must not double-write", "assert.equal(refused.status, 503", "CI_ONLY_XENDIT_SUBSCRIPTION_AUDIT_REJECTED",
    "assertFictionalHighIdVictim(a, b, victim, fillers)"]) assert.ok(harness.includes(evidence), "harness lacks " + evidence);
  assert.ok(harness.indexOf("requireDisposableXenditSubscriptionsWebhook();") < harness.indexOf('import("../../src/db/index.ts")'), "fail-closed guard must precede database imports");
  // The credited source must keep the audit-in-transaction and stored-checkout binding the proof exercises.
  assert.ok(route.includes("}, tx);") && route.includes("saasBillingCheckouts.providerPlanId, planId") && route.includes('{ status: 503 }'), "the credited binding and retry refusal must stay in place");
});

test("effective-change POST credit requires the exact passing run, byte-pinned inputs, all eight own dimensions and every refusal cited", () => {
  const routePath = "src/app/api/hcm/effective-changes/route.ts";
  const harnessFile = "scripts/qa/tenant-hcm-effective-change-post-http.mjs";
  const helperFile = "scripts/qa/tenant-table-rows/helpers/hcm-effective-change-actions.mjs";
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const harness = readFileSync(harnessFile, "utf8");
  const helper = readFileSync(helperFile, "utf8");
  const workflow = readFileSync(".github/workflows/tenant-hcm-effective-change-post-http.yml", "utf8");
  const route = readFileSync(routePath, "utf8");
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-hcm-effective-change-post-http\.mjs/);
  assert.ok(workflow.includes("image: postgres:16"));
  assert.ok(workflow.includes("hcm-effective-change-post-isolation:"));
  const api = manifest.allApiRouteFiles[routePath];
  assert.deepEqual(api.methods.map(entry => [entry.name, entry.status]), [["GET", "COVERED"], ["POST", "COVERED"], ["PATCH", "COVERED"]]);
  const method = api.methods.find(entry => entry.name === "POST");
  const proof = method.testedBy;
  assert.equal(proof.file, harnessFile);
  assert.equal(proof.helperFile, helperFile);
  assert.equal(proof.postgresMajor, 16);
  assert.equal(proof.runLabel, "GitHub Actions " + proof.workflowRunId + "/" + proof.workflowJobId + " PG16 hcm-effective-change-post PASS");
  assert.equal(proof.evidence, "https://github.com/erwinmehehe/payrollph/actions/runs/" + proof.workflowRunId + "/job/" + proof.workflowJobId);
  assert.equal(proof.proofPullRequest, 1779);
  assert.equal(proof.mergedProofCommit, "98424a6fef54bf9f1192e4f7349c73b6ea66a654");
  assert.equal(proof.proofBlobSha, gitBlobSha(Buffer.from(harness)), "the harness changed; re-run the workflow and re-credit");
  assert.equal(proof.helperBlobSha, gitBlobSha(Buffer.from(helper)), "the helper changed; re-run the workflow and re-credit");
  assert.equal(proof.contractBlobSha, gitBlobSha(readFileSync("scripts/qa/tenant-hcm-effective-change-post-contract.mjs")));
  assert.equal(proof.testBlobSha, gitBlobSha(readFileSync("tests/tenant-hcm-effective-change-post.test.mjs")));
  assert.equal(proof.workflowBlobSha, gitBlobSha(Buffer.from(workflow)));
  assert.equal(proof.routeBlobSha, gitBlobSha(Buffer.from(route)));
  assert.equal(api.gitBlobSha, proof.routeBlobSha);
  assert.equal(proof.routeBlobSha, "fb4bd6692a33a2130f0ec369fedc854334e718db", "the proof was written against this exact route");
  assert.equal(proof.line, proof.ownPositiveLine);
  const harnessLines = harness.split(String.fromCharCode(10)), helperLines = helper.split(String.fromCharCode(10));
  const cites = (lines, number, fragment, label) => assert.ok((lines[number - 1] ?? "").includes(fragment), label);
  cites(harnessLines, proof.ownPositiveLine, "const proof = await actions.effectiveChangeActions(", "own-actions anchor");
  cites(harnessLines, proof.foreignDenialLine, "assert.deepEqual(after[j], before[j]", "all-employer unchanged anchor");
  cites(harnessLines, proof.unchangedDbLine, "assert.deepEqual(after[j], before[j]", "all-employer unchanged anchor");
  cites(harnessLines, proof.victimIdOrderingLine, "victim.org.id > 6", "high-ID victim anchor");
  const own = ["operating organization unit", "employment type", "employee status", "supervisory organization", "cost center", "manager", "legal employer", "position move"];
  assert.deepEqual(Object.keys(proof.helperOwnLines), own, "all eight own dimensions must stay cited");
  for (const name of own) cites(helperLines, proof.helperOwnLines[name], 'await created("' + name + '"', "own anchor " + name);
  const refusals = ["victim organization", "victim operating organization unit", "victim supervisory organization", "victim cost center", "victim manager", "victim legal employer",
    "victim position", "victim employee under own organization id", "supervisory unit is not an operating unit", "an employee cannot be their own manager", "occupied position",
    "position that is not approved", "retroactive position move", "unsupported movement type", "position move may not override inherited dimensions"];
  assert.deepEqual(Object.keys(proof.helperRefusalLines), refusals, "every refusal must stay cited");
  for (const name of refusals) cites(helperLines, proof.helperRefusalLines[name], '"' + name + '");', "refusal anchor " + name);
  cites(helperLines, proof.forgedSelectorLine, '"victim employee under own organization id");', "forged-selector anchor");
  cites(helperLines, proof.secondaryForeignDenialLine, '"victim cost center");', "victim cost-center anchor");
  assert.ok(harness.indexOf("requireDisposableHcmEffectiveChangePost();") < harness.indexOf('import("../../src/db/index.ts")'), "fail-closed guard must precede database imports");
  for (const token of ["allEmployerSnapshotsCompared", "eight own pending changes per attacker", "eight own business processes per attacker"]) assert.ok(harness.includes(token), "harness lacks " + token);
  // The credited route must keep the employer-scoped lookups the proof exercises.
  for (const scoped of ["eq(employees.organizationId, organizationId)", "eq(orgUnits.organizationId, organizationId)", "eq(costCenters.organizationId, organizationId)",
    "eq(legalEntities.organizationId, organizationId)", "eq(positions.organizationId, organizationId)"]) assert.ok(route.includes(scoped), "route lost employer scope: " + scoped);
});

test("account password POST credit requires the exact passing run, byte-pinned inputs and every cited proof line", () => {
  const routePath = "src/app/api/account/password/route.ts";
  const harnessFile = "scripts/qa/tenant-account-password-http.mjs";
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const harness = readFileSync(harnessFile, "utf8");
  const workflow = readFileSync(".github/workflows/tenant-account-password-http.yml", "utf8");
  const route = readFileSync(routePath, "utf8");
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-account-password-http\.mjs/);
  assert.ok(workflow.includes("image: postgres:16"));
  assert.ok(workflow.includes("fictional-account-password-http:"));
  const api = manifest.allApiRouteFiles[routePath];
  assert.deepEqual(api.methods.map(entry => [entry.name, entry.status]), [["POST", "COVERED"]]);
  const proof = api.methods[0].testedBy;
  assert.equal(proof.file, harnessFile);
  assert.equal(proof.postgresMajor, 16);
  assert.equal(proof.runLabel, "GitHub Actions " + proof.workflowRunId + "/" + proof.workflowJobId + " PG16 account-password PASS");
  assert.equal(proof.evidence, "https://github.com/erwinmehehe/payrollph/actions/runs/" + proof.workflowRunId + "/job/" + proof.workflowJobId);
  assert.equal(proof.proofPullRequest, 1794);
  assert.equal(proof.mergedProofCommit, "1d475f4e74734625e703a4305bdaad266432ff37");
  assert.equal(proof.proofBlobSha, gitBlobSha(Buffer.from(harness)), "the harness changed; re-run the workflow and re-credit");
  assert.equal(proof.contractBlobSha, gitBlobSha(readFileSync("scripts/qa/tenant-account-password-contract.mjs")));
  assert.equal(proof.testBlobSha, gitBlobSha(readFileSync("tests/tenant-account-password-contract.test.mjs")));
  assert.equal(proof.workflowBlobSha, gitBlobSha(Buffer.from(workflow)));
  assert.equal(proof.routeBlobSha, gitBlobSha(Buffer.from(route)));
  assert.equal(api.gitBlobSha, proof.routeBlobSha);
  assert.equal(proof.routeBlobSha, "73a7d44673f567bd53c03df02a58d40e0059fb13", "the proof was written against this exact route");
  assert.equal(proof.line, proof.ownPositiveLine);
  const lines = harness.split(String.fromCharCode(10));
  const cites = (number, fragment, label) => assert.ok((lines[number - 1] ?? "").includes(fragment), label);
  cites(proof.ownPositiveLine, "assertOwnPasswordChange(response, { otherSessionsRevoked: 1 });", "own-change anchor");
  cites(proof.foreignDenialLine, "const stolen = assertPasswordRefusal(await request(attacker.cookie, {", "victim-password-as-current anchor");
  cites(proof.forgedSelectorLine, "...forged(victim), currentPassword: oldPassword[key]", "forged-principal anchor");
  cites(proof.unchangedDbLine, 'assertRowsUnchanged(victimBefore, await snapshot(victim), "victim after both complete attacker journeys");', "victim byte-identical anchor");
  cites(proof.victimIdOrderingLine, "victim.owner.id > Math.max(a.owner.id, b.owner.id, 6)", "high-ID victim anchor");
  assert.ok(harness.indexOf("requireDisposableAccountPassword();") < harness.indexOf('import("../../src/db/index.ts")'), "fail-closed guard must precede database imports");
  for (const token of ["the caller's other device is revoked", "the replacement session works", "exactly one own audit row", "the audit row holds no password material",
    "A's change must not satisfy B's own-object proof", "for (let i = 0; i < 7; i++)"]) assert.ok(harness.includes(token), "harness lacks " + token);
  // The credited route must keep the session-bound account lookup, the current-password check and the session revocation the proof exercises.
  for (const bound of ["const user = await getSessionUser();", "eq(users.id, user.id)", "verifyPassword(currentPassword, account.passwordHash)",
    "await revokeAllSessions(account.id)", "enforceSameOriginMutation(request)"]) assert.ok(route.includes(bound), "route lost a bound the proof exercises: " + bound);
  assert.ok(!/body\.(?:userId|id|email)/.test(route), "the route must never read an identity from the request body");
});

test("auth logout POST credit requires the exact passing run, byte-pinned inputs and every cited proof line", () => {
  const routePath = "src/app/api/auth/logout/route.ts";
  const harnessFile = "scripts/qa/tenant-auth-logout-http.mjs";
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const harness = readFileSync(harnessFile, "utf8");
  const workflow = readFileSync(".github/workflows/tenant-auth-logout-http.yml", "utf8");
  const route = readFileSync(routePath, "utf8");
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-auth-logout-http\.mjs/);
  assert.ok(workflow.includes("image: postgres:16"));
  assert.ok(workflow.includes("fictional-auth-logout-http:"));
  const api = manifest.allApiRouteFiles[routePath];
  assert.deepEqual(api.methods.map(entry => [entry.name, entry.status]), [["POST", "COVERED"]]);
  const proof = api.methods[0].testedBy;
  assert.equal(proof.file, harnessFile);
  assert.equal(proof.postgresMajor, 16);
  assert.equal(proof.runLabel, "GitHub Actions " + proof.workflowRunId + "/" + proof.workflowJobId + " PG16 auth-logout PASS");
  assert.equal(proof.evidence, "https://github.com/erwinmehehe/payrollph/actions/runs/" + proof.workflowRunId + "/job/" + proof.workflowJobId);
  assert.equal(proof.proofPullRequest, 1795);
  assert.equal(proof.mergedProofCommit, "b1824479000a69b9657b250344b7edc57ae288a2");
  assert.equal(proof.proofBlobSha, gitBlobSha(Buffer.from(harness)), "the harness changed; re-run the workflow and re-credit");
  assert.equal(proof.contractBlobSha, gitBlobSha(readFileSync("scripts/qa/tenant-auth-logout-contract.mjs")));
  assert.equal(proof.testBlobSha, gitBlobSha(readFileSync("tests/tenant-auth-logout-contract.test.mjs")));
  assert.equal(proof.workflowBlobSha, gitBlobSha(Buffer.from(workflow)));
  assert.equal(proof.routeBlobSha, gitBlobSha(Buffer.from(route)));
  assert.equal(api.gitBlobSha, proof.routeBlobSha);
  assert.equal(proof.routeBlobSha, "5e385d15d457620af0bcbd910bc0fe535103c53e", "the proof was written against this exact route");
  assert.deepEqual(proof.integrityReproof.pins, {
  "src/app/api/auth/logout/route.ts": "5e385d15d457620af0bcbd910bc0fe535103c53e",
  "src/lib/revoke-presented-session.ts": "e6bd056401cf8998950834732b6c2f2e83508f88",
  "scripts/qa/tenant-auth-logout-http.mjs": "6b2b45bf6f06580d88db03ca29d0ac546bc3514b",
  "scripts/qa/tenant-auth-logout-contract.mjs": "36516e9ce60b75109f325df2a4047bb2cb9b3154",
  "tests/tenant-auth-logout-contract.test.mjs": "3c1e4222c0c549a282202c614aa12bb60bc5608a",
  ".github/workflows/tenant-auth-logout-http.yml": "f3359240462e4bbd732e9186f0336e950b1e7c17",
  "scripts/qa/tenant-approval-task-contract.mjs": "aec1742a120c93e7c2f54ab127bd8312501c733a",
  "scripts/qa/tenant-table-http.mjs": "31894982d768e34c1653be7c4335194f60233c6e",
  "scripts/qa/tenant-table-env.mjs": "05dcdcdbd513b0e257b6aefb5d9449117224b357",
  "scripts/qa/apply-isolated-baseline.mjs": "75b9e7f1b39a6ca5b2253086e519ae7d71229255",
  "src/lib/auth.ts": "b13275e0e09b629ddb679c55e7898da44c72ad20",
  "src/lib/crypto.ts": "2316f58f15961e25ffee0353e107e993b630206c",
  "src/lib/security-request.ts": "de996ebb7eb663aaebf65f8a963d955b8bc90c9d",
  "src/db/index.ts": "7a5718d0a99ce5b3a7f0f25e385f79a61be807f6",
  "src/db/schema.ts": "3f504163c9847a99434a5e01a72c120dfd680a02"
});
  for (const [file, sha] of Object.entries(proof.integrityReproof.pins)) assert.equal(gitBlobSha(readFileSync(file)), sha, "Logout reproof input changed: " + file);
  assert.ok(harness.includes("assert.deepEqual(afterReplay, afterFirst"), "replay must compare every SQL field");
  const helper = readFileSync("src/lib/revoke-presented-session.ts", "utf8");
  for (const guard of ["eq(sessions.tokenHash, sha256(token))", "isNull(sessions.revokedAt)"]) assert.ok(helper.includes(guard));
  assert.equal(proof.line, proof.ownPositiveLine);
  const lines = harness.split(String.fromCharCode(10));
  const cites = (number, fragment, label) => assert.ok((lines[number - 1] ?? "").includes(fragment), label);
  cites(proof.ownPositiveLine, "exactly the presented session is revoked", "presented-session-only anchor");
  cites(proof.foreignDenialLine, 'assertRowsUnchanged(victimBefore, await snapshot(victim), "victim after "', "victim byte-identical after each attacker anchor");
  cites(proof.forgedSelectorLine, "userId: victim.owner.id, sessionId: victimSession.id, token: token(device.v.one), organizationId: victim.org.id,", "forged-session-id anchor");
  cites(proof.unchangedDbLine, 'assertRowsUnchanged(victimBefore, await snapshot(victim), "victim after both complete attacker journeys");', "victim byte-identical anchor");
  cites(proof.victimIdOrderingLine, "victim.owner.id > Math.max(a.owner.id, b.owner.id, 6)", "high-ID victim anchor");
  cites(proof.crossSiteLine, "a cross-site logout must revoke nothing", "cross-site refusal anchor");
  assert.ok(harness.indexOf("requireDisposableAuthLogout();") < harness.indexOf('import("../../src/db/index.ts")'), "fail-closed guard must precede database imports");
  for (const token of ["the caller's other device still works", "A's session evidence cannot satisfy B's", "for (let i = 0; i < 7; i++)", "coverageCredits: 0"]) {
    assert.ok(harness.includes(token), "harness lacks " + token);
  }
  // The credited route must keep the same-origin check and revoke only the token in the caller's own cookie.
  for (const bound of ["enforceSameOriginMutation(request)", "jar.get(SESSION_COOKIE)?.value", "await revokePresentedSessionOnce(token)"]) assert.ok(route.includes(bound), "route lost a bound the proof exercises: " + bound);
  assert.ok(!/await request\.(?:json|formData)\(/.test(route), "the route must never read an identity from the request body");
});

test("payout reconciliation POST credit requires the exact passing run, byte-pinned inputs, a loopback-only synthetic provider and every cited proof line", () => {
  const routePath = "src/app/api/payroll-runs/[id]/payout-reconciliation/route.ts";
  const harnessFile = "scripts/qa/paymongo-export-isolation-local.mjs";
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const harness = readFileSync(harnessFile, "utf8");
  const workflow = readFileSync(".github/workflows/paymongo-export-isolation.yml", "utf8");
  const route = readFileSync(routePath, "utf8");
  // The provider is a loopback-only synthetic: the workflow, the harness and the target contract must all say so.
  for (const token of ["PAYMONGO_HTTP_PROOF: loopback-only", "PAYMONGO_SECRET_KEY: sk_test_synthetic_no_network", "MONEY_PROOF_TRANSPORT: http",
    "image: postgres:16", "npx tsx scripts/qa/paymongo-export-isolation-local.mjs", "paymongo-http-proof-preload.mjs"]) assert.ok(workflow.includes(token), "workflow lacks " + token);
  assert.ok(harness.includes("providerServer.listen(3012, '127.0.0.1', resolve)"), "the synthetic provider must listen on loopback only");
  assert.ok(harness.indexOf("assertPaymongoHttpProofTarget(process.env)") < harness.indexOf('await import("../../src/db/index.ts")'), "fail-closed target guard must precede database imports");
  const api = manifest.allApiRouteFiles[routePath];
  assert.deepEqual(api.methods.map(entry => [entry.name, entry.status]), [["GET", "COVERED"], ["POST", "COVERED"]]);
  const post = api.methods[1];
  assert.equal(post.reviewedUncertified, undefined, "the superseded provider-disabled hold must be gone");
  const proof = post.testedBy;
  assert.equal(proof.file, harnessFile);
  assert.equal(proof.postgresMajor, 16);
  assert.equal(proof.providerMode, "loopback-synthetic-paymongo");
  assert.equal(proof.moneyMovedByLinaw, false);
  assert.equal(proof.runLabel, "GitHub Actions " + proof.workflowRunId + "/" + proof.workflowJobId + " PG16 paymongo-export-isolation PASS");
  assert.equal(proof.evidence, "https://github.com/erwinmehehe/payrollph/actions/runs/" + proof.workflowRunId + "/job/" + proof.workflowJobId);
  assert.equal(proof.verifiedMainHeadSha, "9c9f0ad789ad83d4c7df526155550f61b0db9c20");
  assert.deepEqual(proof.methodActions, ["reconcile", "retry-failed"]);
  assert.equal(proof.proofBlobSha, gitBlobSha(Buffer.from(harness)), "the harness changed; re-run the workflow and re-credit");
  assert.equal(proof.workflowBlobSha, gitBlobSha(Buffer.from(workflow)));
  assert.equal(proof.routeBlobSha, gitBlobSha(Buffer.from(route)));
  assert.equal(api.gitBlobSha, proof.routeBlobSha);
  assert.equal(proof.routeBlobSha, "8a08081eb1ede1f24809d496804c9874ab1b46a7", "the proof was written against this exact route");
  assert.equal(proof.line, proof.ownPositiveLine);
  const lines = harness.split(String.fromCharCode(10));
  const cites = (number, fragment, label) => assert.ok((lines[number - 1] ?? "").includes(fragment), label);
  cites(proof.ownPositiveLine, "'own successful provider reconciliation'", "own reconcile anchor");
  cites(proof.ownRetryLine, "'fresh-preflight confirmed-failed transfer retry succeeds'", "own retry anchor");
  cites(proof.foreignDenialLine, "'foreign reconciliation ' + action", "foreign denial for both actions anchor");
  cites(proof.unchangedDbLine, "'victim unchanged after complete investigation'", "victim unchanged anchor");
  cites(proof.victimIdOrderingLine, "high-ID actual victim run", "high-ID victim anchor");
  cites(proof.secondAttackerLine, "await investigate(v, a); await investigate(v, b);", "second independent attacker anchor");
  cites(proof.retryActorsLine, "for (const label of ['PM-RETRY-B', 'PM-RETRY-C'])", "retry actors anchor");
  cites(proof.loopbackProviderLine, "providerServer.listen(3012, '127.0.0.1', resolve)", "loopback provider anchor");
  const foreignLines = lines.slice(proof.foreignDenialLine - 3, proof.foreignDenialLine + 1).join(String.fromCharCode(10));
  assert.ok(foreignLines.includes("for (const action of ['reconcile', 'retry-failed'])") && foreignLines.includes("403"), "both actions must be refused 403 on the victim run");
  for (const token of ["'missing MFA blocks provider lookup'", "'revoked membership retained session'", "'same-employer other-unit retry'",
    "'changed destination blocks reconciliation before retry'", "'overlapping retry requests cannot both submit'", "'repeating retry cannot resend'",
    "for (let i = 0; i < 7; i++) await seed('PM-PAD' + i, nonce);"]) assert.ok(harness.includes(token), "harness lacks " + token);
  // The credited route must keep the authorization order the proof exercises, and never take an identity from the request body.
  const postSource = route.slice(route.indexOf("export async function POST("));
  const order = ["enforceSameOriginMutation(request)", "await authorizeTreasuryOperation({", "await assertOrganizationUnitAccess(", "await requireRunEmployer({",
    "requireSensitiveActionMfa(user)", "enforceSensitiveActionRateLimit(request", "if (!process.env.PAYMONGO_SECRET_KEY)"].map(token => {
    assert.ok(postSource.includes(token), "route lost a bound the proof exercises: " + token);
    return postSource.indexOf(token);
  });
  assert.deepEqual([...order].sort((x, y) => x - y), order, "authorization must precede any provider handling");
  assert.ok(!/body\.(?:organizationId|runId|userId)/.test(postSource), "the route must never read an identity from the request body");
});

test("payroll-run actions credit (pilot-signoff POST, xendit-payout GET) requires the exact passing run, byte-pinned inputs and every cited proof line", () => {
  const harnessFile = "scripts/qa/tenant-payroll-run-actions-http.mjs";
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const harness = readFileSync(harnessFile, "utf8");
  const workflow = readFileSync(".github/workflows/tenant-payroll-run-actions-http.yml", "utf8");
  for (const token of ["TENANT_APPROVAL_TASK_MODE: fictional-pg16-http", "image: postgres:16", "fictional-payroll-run-actions-http:",
    "node --import tsx scripts/qa/tenant-payroll-run-actions-http.mjs"]) assert.ok(workflow.includes(token), "workflow lacks " + token);
  assert.ok(harness.indexOf("requireDisposablePayrollRunActions();") < harness.indexOf('import("../../src/db/index.ts")'), "fail-closed target guard must precede database imports");
  const targets = [
    ["src/app/api/payroll-runs/[id]/pilot-signoff/route.ts", "POST", "18390e65b137a0e73d5c5c78e3368dbd18a26af4"],
    ["src/app/api/payroll-runs/[id]/xendit-payout/route.ts", "GET", "c100c146ce1373c1526bae90dd77667d6ed6aaad"],
  ];
  const lines = harness.split(String.fromCharCode(10));
  const cites = (number, fragment, label) => assert.ok((lines[number - 1] ?? "").includes(fragment), label);
  for (const [routePath, methodName, routeBlob] of targets) {
    const route = readFileSync(routePath, "utf8");
    const api = manifest.allApiRouteFiles[routePath];
    const method = api.methods.find(entry => entry.name === methodName);
    assert.equal(method.status, "COVERED");
    assert.equal(method.reviewedUncertified, undefined, "the zero-credit negative-only hold must be gone for the credited method");
    const proof = method.testedBy;
    assert.equal(proof.file, harnessFile);
    assert.equal(proof.postgresMajor, 16);
    assert.equal(proof.moneyMovedByLinaw, false);
    assert.equal(proof.providerCalled, false);
    assert.equal(proof.runLabel, "GitHub Actions " + proof.workflowRunId + "/" + proof.workflowJobId + " PG16 payroll-run-actions PASS");
    assert.equal(proof.evidence, "https://github.com/erwinmehehe/payrollph/actions/runs/" + proof.workflowRunId + "/job/" + proof.workflowJobId);
    assert.equal(proof.proofPullRequest, 1803);
    assert.equal(proof.proofBlobSha, gitBlobSha(Buffer.from(harness)), "the harness changed; re-run the workflow and re-credit");
    assert.equal(proof.contractBlobSha, gitBlobSha(readFileSync("scripts/qa/tenant-payroll-run-actions-contract.mjs")));
    assert.equal(proof.testBlobSha, gitBlobSha(readFileSync("tests/tenant-payroll-run-actions-contract.test.mjs")));
    assert.equal(proof.workflowBlobSha, gitBlobSha(Buffer.from(workflow)));
    assert.equal(proof.routeBlobSha, gitBlobSha(Buffer.from(route)));
    assert.equal(api.gitBlobSha, proof.routeBlobSha);
    assert.equal(proof.routeBlobSha, routeBlob, "the proof was written against this exact route");
    cites(proof.pilotOwnLine, "const signedOff = assertPilotSignedOff(await standaloneRequest(pilotPath", "own pilot sign-off anchor");
    cites(proof.pilotReplayLine, "a replayed sign-off is the same single record", "pilot replay anchor");
    cites(proof.pilotRefusedWritesNothingLine, "refused attempts write no sign-off", "pilot refused-writes-nothing anchor");
    cites(proof.ledgerOwnLine, "own xendit ledger read:", "own ledger anchor");
    cites(proof.ledgerOnlyOwnLine, "the ledger names only the own employer", "ledger own-only anchor");
    cites(proof.foreignDenialLine, '"victim after " + key', "foreign denial anchor");
    cites(proof.unchangedDbLine, "complete journey", "victim unchanged anchor");
    cites(proof.victimIdOrderingLine, "victim.owner.id > Math.max(a.owner.id, b.owner.id, 6)", "high-ID victim anchor");
    cites(proof.anonymousLine, "const anonymous = await standaloneRequest(pilotPath", "anonymous anchor");
    assert.equal(proof.line, methodName === "POST" ? proof.pilotOwnLine : proof.ledgerOwnLine);
  }
  for (const token of ["for (let i = 0; i < 7; i++)", '["xendit-payout GET", victim.runs.ledger.run.id, "GET"]', "coverageCredits: 0", "payoutEvidenceMode"])
    assert.ok(harness.includes(token), "harness lacks " + token);
  // exports and xendit-payout POST must remain GAP: the harness proves them only as refusals (no provider, rail OFF).
  const exportsMethods = manifest.allApiRouteFiles["src/app/api/payroll-runs/[id]/exports/route.ts"].methods;
  for (const entry of exportsMethods.filter(item => item.name === "POST")) assert.equal(entry.status, "GAP", "exports POST must not borrow this credit");
  const xenditPost = manifest.allApiRouteFiles["src/app/api/payroll-runs/[id]/xendit-payout/route.ts"].methods.find(entry => entry.name === "POST");
  assert.equal(xenditPost.status, "GAP", "xendit-payout POST must not borrow this credit");
  // The credited routes must keep the authorization gates the proof exercises, and never take an identity from the request body.
  const pilotSource = readFileSync(targets[0][0], "utf8");
  const pilotPost = pilotSource.slice(pilotSource.indexOf("export async function POST("));
  const order = ["enforceSameOriginMutation(request)", "getSessionUser(", "assertOrganizationRole(", "assertOrganizationUnitAccess(", "requireRunEmployer("].map(token => {
    assert.ok(pilotPost.includes(token), "pilot-signoff lost a bound the proof exercises: " + token);
    return pilotPost.indexOf(token);
  });
  assert.ok(order[0] < order[2] && order[2] < order[3], "same-origin, role and unit scope must precede the write");
  const xenditSource = readFileSync(targets[1][0], "utf8");
  const xenditGet = xenditSource.slice(xenditSource.indexOf("export async function GET("), xenditSource.indexOf("export async function POST("));
  assert.ok(xenditGet.includes('context(request, params, false, "status")'), "xendit-payout GET must go through the shared gated context");
  const xenditContext = xenditSource.slice(xenditSource.indexOf("async function context("), xenditSource.indexOf("export async function GET("));
  const gateOrder = ["getSessionUser(", "authorizeTreasuryOperation({", "assertOrganizationUnitAccess(", "requireRunEmployer("].map(token => {
    assert.ok(xenditContext.includes(token), "xendit-payout context lost a bound the proof exercises: " + token);
    return xenditContext.indexOf(token);
  });
  assert.deepEqual([...gateOrder].sort((x, y) => x - y), gateOrder, "session, treasury, unit scope and legal employer must precede the read");
});

test("POS demand credit (loyverse and square-sandbox GET/POST) requires the exact passing run, byte-pinned inputs, a test-only provider and every cited proof line", () => {
  const harnessFile = "scripts/qa/tenant-pos-demand-http.mjs";
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const harness = readFileSync(harnessFile, "utf8");
  const workflow = readFileSync(".github/workflows/tenant-pos-demand-http.yml", "utf8");
  const mock = readFileSync("scripts/qa/tenant-pos-demand-provider-mock.cjs", "utf8");
  for (const token of ["image: postgres:16", "pos-demand-four-methods:", "TENANT_POS_DEMAND_PROOF=fictional-provider-only", 'echo "WFM_LOYVERSE_ACCESS_TOKEN="',
    'echo "WFM_SQUARE_SANDBOX_ACCESS_TOKEN="', 'echo "PAYMONGO_SECRET_KEY="']) assert.ok(workflow.includes(token), "workflow lacks " + token);
  for (const token of ["POS_MOCK_BLOCKED_EXTERNAL_NETWORK", "api.loyverse.com"]) assert.ok(mock.includes(token), "provider mock lacks " + token);
  assert.ok(harness.includes("requireDisposablePosDemand();"), "fail-closed target guard required");
  const lines = harness.split(String.fromCharCode(10));
  const cites = (number, fragment, label) => assert.ok((lines[number - 1] ?? "").includes(fragment), label);
  const targets = [
    ["src/app/api/workforce/demand-observations/loyverse/route.ts", "GET", "84125e11d3b6558922ceec600c2ccb8f0a778afb"],
    ["src/app/api/workforce/demand-observations/loyverse/route.ts", "POST", "84125e11d3b6558922ceec600c2ccb8f0a778afb"],
    ["src/app/api/workforce/demand-observations/square-sandbox/route.ts", "GET", "de84727241fdd90dcaf2f7138bdd54f751ec2f95"],
    ["src/app/api/workforce/demand-observations/square-sandbox/route.ts", "POST", "de84727241fdd90dcaf2f7138bdd54f751ec2f95"],
  ];
  for (const [routePath, methodName, routeBlob] of targets) {
    const route = readFileSync(routePath, "utf8");
    const api = manifest.allApiRouteFiles[routePath];
    const method = api.methods.find(entry => entry.name === methodName);
    assert.equal(method.status, "COVERED", routePath + " " + methodName);
    const proof = method.testedBy;
    assert.equal(proof.file, harnessFile);
    assert.equal(proof.postgresMajor, 16);
    assert.equal(proof.providerMode, "test-only-exact-host-preload");
    assert.equal(proof.externalProviderCalled, false);
    assert.equal(proof.moneyMovedByLinaw, false);
    assert.equal(proof.runLabel, "GitHub Actions " + proof.workflowRunId + "/" + proof.workflowJobId + " PG16 pos-demand-four-methods PASS");
    assert.equal(proof.evidence, "https://github.com/erwinmehehe/payrollph/actions/runs/" + proof.workflowRunId + "/job/" + proof.workflowJobId);
    assert.equal(proof.proofBlobSha, gitBlobSha(Buffer.from(harness)), "the harness changed; re-run the workflow and re-credit");
    assert.equal(proof.contractBlobSha, gitBlobSha(readFileSync("scripts/qa/tenant-pos-demand-contract.mjs")));
    assert.equal(proof.mockBlobSha, gitBlobSha(Buffer.from(mock)));
    assert.equal(proof.testBlobSha, gitBlobSha(readFileSync("tests/tenant-pos-demand-contract.test.mjs")));
    assert.equal(proof.workflowBlobSha, gitBlobSha(Buffer.from(workflow)));
    assert.equal(proof.routeBlobSha, gitBlobSha(Buffer.from(route)));
    assert.equal(api.gitBlobSha, proof.routeBlobSha);
    assert.equal(proof.routeBlobSha, routeBlob, "the proof was written against this exact route");
    assert.equal(proof.line, proof.ownPositiveLine);
    cites(proof.ownGetLine, "assertOwnGet(own, actor, provider, actor.site);", "own GET anchor");
    cites(proof.ownDryRunLine, "assertOwnPost(dry, provider, true);", "own dry-run anchor");
    cites(proof.ownPostLine, "assertOwnPost(stored, provider, false);", "own applied POST anchor");
    cites(proof.foreignGetDenialLine, "real high-ID victim GET", "foreign GET denial anchor");
    cites(proof.foreignPostDenialLine, "real high-ID victim POST", "foreign POST denial anchor");
    cites(proof.stolenWorksiteGetLine, "stolen victim worksite GET", "stolen worksite GET anchor");
    cites(proof.stolenWorksitePostLine, "stolen victim worksite POST", "stolen worksite POST anchor");
    cites(proof.anonymousGetLine, "anonymous GET", "anonymous GET anchor");
    cites(proof.anonymousPostLine, "anonymous POST", "anonymous POST anchor");
    cites(proof.dryRunWritesNothingLine, "dry-run must write nothing", "dry-run writes nothing anchor");
    cites(proof.unchangedDbLine, "successful POST", "own write unchanged-elsewhere anchor");
    cites(proof.victimIdOrderingLine, "victim.org.id > Math.max(a.org.id, b.org.id)", "high-ID victim anchor");
    cites(proof.twoAttackersLine, "for (const actor of [a, b, victim])", "two independent attackers anchor");
    assert.equal(proof.line, methodName === "GET" ? proof.ownGetLine : proof.ownPostLine);
    assert.equal(proof.foreignDenialLine, methodName === "GET" ? proof.foreignGetDenialLine : proof.foreignPostDenialLine);
    // The routes must keep the authenticated scope checks the proof exercises.
    for (const token of ["getSessionUser(", "assertOrganizationRole("]) assert.ok(route.includes(token), routePath + " lost a bound the proof exercises: " + token);
  }
});

test("POS demand credit (loyverse and square-sandbox GET/POST) requires the exact passing run, byte-pinned inputs, a test-only provider and every cited proof line", () => {
  const harnessFile = "scripts/qa/tenant-pos-demand-http.mjs";
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const harness = readFileSync(harnessFile, "utf8");
  const workflow = readFileSync(".github/workflows/tenant-pos-demand-http.yml", "utf8");
  const mock = readFileSync("scripts/qa/tenant-pos-demand-provider-mock.cjs", "utf8");
  for (const token of ["image: postgres:16", "pos-demand-four-methods:", "TENANT_POS_DEMAND_PROOF=fictional-provider-only", 'echo "WFM_LOYVERSE_ACCESS_TOKEN="',
    'echo "WFM_SQUARE_SANDBOX_ACCESS_TOKEN="', 'echo "PAYMONGO_SECRET_KEY="']) assert.ok(workflow.includes(token), "workflow lacks " + token);
  for (const token of ["POS_MOCK_BLOCKED_EXTERNAL_NETWORK", "api.loyverse.com"]) assert.ok(mock.includes(token), "provider mock lacks " + token);
  assert.ok(harness.includes("requireDisposablePosDemand();"), "fail-closed target guard required");
  const lines = harness.split(String.fromCharCode(10));
  const cites = (number, fragment, label) => assert.ok((lines[number - 1] ?? "").includes(fragment), label);
  const targets = [
    ["src/app/api/workforce/demand-observations/loyverse/route.ts", "GET", "84125e11d3b6558922ceec600c2ccb8f0a778afb"],
    ["src/app/api/workforce/demand-observations/loyverse/route.ts", "POST", "84125e11d3b6558922ceec600c2ccb8f0a778afb"],
    ["src/app/api/workforce/demand-observations/square-sandbox/route.ts", "GET", "de84727241fdd90dcaf2f7138bdd54f751ec2f95"],
    ["src/app/api/workforce/demand-observations/square-sandbox/route.ts", "POST", "de84727241fdd90dcaf2f7138bdd54f751ec2f95"],
  ];
  for (const [routePath, methodName, routeBlob] of targets) {
    const route = readFileSync(routePath, "utf8");
    const api = manifest.allApiRouteFiles[routePath];
    const method = api.methods.find(entry => entry.name === methodName);
    assert.equal(method.status, "COVERED", routePath + " " + methodName);
    const proof = method.testedBy;
    assert.equal(proof.file, harnessFile);
    assert.equal(proof.postgresMajor, 16);
    assert.equal(proof.providerMode, "test-only-exact-host-preload");
    assert.equal(proof.externalProviderCalled, false);
    assert.equal(proof.moneyMovedByLinaw, false);
    assert.equal(proof.runLabel, "GitHub Actions " + proof.workflowRunId + "/" + proof.workflowJobId + " PG16 pos-demand-four-methods PASS");
    assert.equal(proof.evidence, "https://github.com/erwinmehehe/payrollph/actions/runs/" + proof.workflowRunId + "/job/" + proof.workflowJobId);
    assert.equal(proof.proofBlobSha, gitBlobSha(Buffer.from(harness)), "the harness changed; re-run the workflow and re-credit");
    assert.equal(proof.contractBlobSha, gitBlobSha(readFileSync("scripts/qa/tenant-pos-demand-contract.mjs")));
    assert.equal(proof.mockBlobSha, gitBlobSha(Buffer.from(mock)));
    assert.equal(proof.testBlobSha, gitBlobSha(readFileSync("tests/tenant-pos-demand-contract.test.mjs")));
    assert.equal(proof.workflowBlobSha, gitBlobSha(Buffer.from(workflow)));
    assert.equal(proof.routeBlobSha, gitBlobSha(Buffer.from(route)));
    assert.equal(api.gitBlobSha, proof.routeBlobSha);
    assert.equal(proof.routeBlobSha, routeBlob, "the proof was written against this exact route");
    assert.equal(proof.line, proof.ownPositiveLine);
    cites(proof.ownGetLine, "assertOwnGet(own, actor, provider, actor.site);", "own GET anchor");
    cites(proof.ownDryRunLine, "assertOwnPost(dry, provider, true);", "own dry-run anchor");
    cites(proof.ownPostLine, "assertOwnPost(stored, provider, false);", "own applied POST anchor");
    cites(proof.foreignGetDenialLine, "real high-ID victim GET", "foreign GET denial anchor");
    cites(proof.foreignPostDenialLine, "real high-ID victim POST", "foreign POST denial anchor");
    cites(proof.stolenWorksiteGetLine, "stolen victim worksite GET", "stolen worksite GET anchor");
    cites(proof.stolenWorksitePostLine, "stolen victim worksite POST", "stolen worksite POST anchor");
    cites(proof.anonymousGetLine, "anonymous GET", "anonymous GET anchor");
    cites(proof.anonymousPostLine, "anonymous POST", "anonymous POST anchor");
    cites(proof.dryRunWritesNothingLine, "dry-run must write nothing", "dry-run writes nothing anchor");
    cites(proof.unchangedDbLine, "successful POST", "own write unchanged-elsewhere anchor");
    cites(proof.victimIdOrderingLine, "victim.org.id > Math.max(a.org.id, b.org.id)", "high-ID victim anchor");
    cites(proof.twoAttackersLine, "for (const actor of [a, b, victim])", "two independent attackers anchor");
    assert.equal(proof.line, methodName === "GET" ? proof.ownGetLine : proof.ownPostLine);
    assert.equal(proof.foreignDenialLine, methodName === "GET" ? proof.foreignGetDenialLine : proof.foreignPostDenialLine);
    // The routes must keep the authenticated scope checks the proof exercises.
    for (const token of ["getSessionUser(", "assertOrganizationRole("]) assert.ok(route.includes(token), routePath + " lost a bound the proof exercises: " + token);
  }
});

test("multi-entity transfers credit (POST and PATCH) requires the exact passing run, byte-pinned inputs, no provider and every cited proof line", () => {
  const harnessFile = "scripts/qa/tenant-transfers-http.mjs";
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const harness = readFileSync(harnessFile, "utf8");
  const workflow = readFileSync(".github/workflows/tenant-transfers-http.yml", "utf8");
  for (const token of ["image: postgres:16", "fictional-multi-entity-transfers-http:", "node scripts/qa/tenant-table-env.mjs multi-entity", "XENDIT_PAYOUTS_ENABLED=false",
    "PAYMONGO_DISBURSEMENTS_ENABLED=false", "WORKER_ENABLED=false", "node --import tsx scripts/qa/tenant-transfers-http.mjs"]) assert.ok(workflow.includes(token), "workflow lacks " + token);
  assert.ok(!workflow.includes("secrets."), "the proof workflow must hold no secret");
  assert.ok(harness.includes("requireDisposableTransfers();"), "fail-closed target guard required");
  const lines = harness.split(String.fromCharCode(10));
  const cites = (number, fragment, label) => assert.ok((lines[number - 1] ?? "").includes(fragment), label);
  const routePath = "src/app/api/multi-entity/transfers/route.ts";
  const route = readFileSync(routePath, "utf8");
  const api = manifest.allApiRouteFiles[routePath];
  assert.equal(api.gitBlobSha, "a4ac9ec92df17492c4c0918f08114660bc4c6ebe", "the proof was written against this exact route");
  assert.equal(gitBlobSha(Buffer.from(route)), api.gitBlobSha);
  for (const methodName of ["POST", "PATCH"]) {
    const method = api.methods.find(entry => entry.name === methodName);
    assert.equal(method.status, "COVERED", methodName);
    assert.equal(method.reviewedUncertified, undefined, methodName + ": the superseded hold must be gone");
    const proof = method.testedBy;
    assert.equal(proof.file, harnessFile);
    assert.equal(proof.postgresMajor, 16);
    assert.equal(proof.providerMode, "none-configured");
    assert.equal(proof.externalProviderCalled, false);
    assert.equal(proof.moneyMovedByLinaw, false);
    assert.equal(proof.runLabel, "GitHub Actions " + proof.workflowRunId + "/" + proof.workflowJobId + " PG16 multi-entity-transfers-two-methods PASS");
    assert.equal(proof.evidence, "https://github.com/erwinmehehe/payrollph/actions/runs/" + proof.workflowRunId + "/job/" + proof.workflowJobId);
    assert.equal(proof.proofBlobSha, gitBlobSha(Buffer.from(harness)), "the harness changed; re-run the workflow and re-credit");
    assert.equal(proof.contractBlobSha, gitBlobSha(readFileSync("scripts/qa/tenant-transfers-contract.mjs")));
    assert.equal(proof.testBlobSha, gitBlobSha(readFileSync("tests/tenant-transfers-contract.test.mjs")));
    assert.equal(proof.workflowBlobSha, gitBlobSha(Buffer.from(workflow)));
    assert.equal(proof.routeBlobSha, api.gitBlobSha);
    assert.equal(proof.line, proof.ownPositiveLine);
    cites(proof.ownPostLine, "const proposed = await propose(attacker);", "own proposal anchor");
    cites(proof.replayConflictLine, "assert.equal(replay.status, 409);", "replay conflict anchor");
    cites(proof.foreignPostDenialLine, "const foreignOrg = await propose(attacker,", "foreign proposal denial anchor");
    cites(proof.foreignWorkerSameAnswerLine, "assertSameAnswer(foreignWorker, absent,", "foreign worker indistinguishable-from-absent anchor");
    cites(proof.anonymousPostLine, "401, forbidden", "anonymous proposal anchor");
    cites(proof.crossSitePostLine, 'crossSite("POST"', "cross-site proposal anchor");
    cites(proof.postUnchangedDbLine, 'mustStayUnchanged("refused proposals")', "proposal unchanged-snapshot anchor");
    cites(proof.makerSelfApprovalRefusedLine, "the maker cannot approve their own request", "maker self-approval anchor");
    cites(proof.ownPatchLine, 'const approved = await decide(attacker, transferId, "approve");', "own approval anchor");
    cites(proof.ownRejectLine, 'const rejected = await decide(attacker, second.json.transfer.id, "reject");', "own rejection anchor");
    cites(proof.foreignPatchDenialLine, "assertRefusal(foreignDecision, 404, forbidden);", "foreign decision denial anchor");
    cites(proof.foreignTransferSameAnswerLine, "assertSameAnswer(foreignDecision, absentDecision,", "foreign transfer indistinguishable-from-absent anchor");
    cites(proof.anonymousPatchLine, 'method: "PATCH", body:', "anonymous decision anchor");
    cites(proof.crossSitePatchLine, 'crossSite("PATCH"', "cross-site decision anchor");
    cites(proof.patchUnchangedDbLine, 'mustStayUnchanged("refused decisions")', "decision unchanged-snapshot anchor");
    cites(proof.approvalUnchangedDbLine, 'mustStayUnchanged("own approval")', "approval unchanged-snapshot anchor");
    cites(proof.victimIdOrderingLine, "victim.owner.id > Math.max(a.owner.id, b.owner.id, 6)", "high-ID victim anchor");
    cites(proof.twoAttackersLine, 'for (const [attacker, other, key] of [[a, b, "A"], [b, a, "B"]])', "two independent attackers anchor");
    assert.equal(proof.line, methodName === "POST" ? proof.ownPostLine : proof.ownPatchLine);
    assert.equal(proof.foreignDenialLine, methodName === "POST" ? proof.foreignPostDenialLine : proof.foreignPatchDenialLine);
    assert.equal(proof.unchangedDbLine, methodName === "POST" ? proof.postUnchangedDbLine : proof.patchUnchangedDbLine);
  }
  // The route must keep the authentication, same-origin, MFA, membership and maker-checker bounds the proof exercises.
  for (const token of ["getSessionUser(", "enforceSameOriginMutation(", "requireSensitiveActionMfa(", "resolveMultiEntityContext(", "canActOnEntityTransfer(", "pg_advisory_xact_lock"]) {
    assert.ok(route.includes(token), routePath + " lost a bound the proof exercises: " + token);
  }
});
