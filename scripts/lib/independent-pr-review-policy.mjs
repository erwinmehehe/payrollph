/**
 * P0-3 independent source review policy. Pure decisions only; no API writes.
 * Production payroll release, DB migrations and payout approvals are separate.
 */
import { tierForPath } from "../classify-pr-risk.mjs";

const SHA = /^[0-9a-f]{40}$/;
const REVIEWER = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;
const HUMAN_PERMISSIONS = new Set(["write", "maintain", "admin"]);
const DECISIVE_REVIEW = new Set(["APPROVED", "CHANGES_REQUESTED", "DISMISSED"]);
const MAX_FILES = 3000;

const ALWAYS_SENSITIVE = [
  /^drizzle\//,
  /^src\/db\//,
  /^src\/lib\/(?:payroll(?:-|\.|$)|final-pay|wage-order|statutory|bank-|government-id-|payout-|paymongo|xendit|payment|separation|approval|audit-|scheduler|worker-)/,
  /^src\/app\/api\/(?:payroll|payroll-runs|payout|approvals|separation|bank|webhooks\/(?:paymongo|xendit))/,
  /^src\/components\/workspace\/(?:payroll|approvals|payslip|compensation|bank|audit)/,
  /^scripts\/(?:worker\.ts|.*(?:payroll|payout|bank|migration|review|scheduler|encrypt|release))/,
  /^\.github\/(?:CODEOWNERS|workflows\/)/,
  /^docs\/engineering\/(?:change-risk-policy|pr-queue-operating-model|independent-review-gate)\.md$/,
  /^tests\/.*(?:payroll|payout|bank|financial|review|approval|migration|scheduler).*\.test\.(?:ts|mjs)$/,
];

// One narrow development-only source-evidence lane for WFM-12. This does NOT
// permit runtime behavior, new tests, migrations, operational pilot activation,
// environment flags, or payroll release. Every GitHub file must be MODIFIED.
const WFM12_DEV_EVIDENCE_FILES = new Set([
  "scripts/wfm-pilot-synthetic-evidence.mjs",
  "tests/wfm-roster-scale-postgres.test.ts",
]);
function isExactWfm12DevelopmentEvidence(files) {
  if (files.length !== WFM12_DEV_EVIDENCE_FILES.size) return false;
  const actual = new Set(files.map(file => file.filename));
  return actual.size === WFM12_DEV_EVIDENCE_FILES.size
    && files.every(file => file.status === "modified"
      && WFM12_DEV_EVIDENCE_FILES.has(file.filename));
}

// One additional exact development acceptance artifact, reviewed as immutable
// content rather than trusting filenames. Any changed byte or added file must
// return to P0-3's pilot freeze; this is never runtime/payout authorization.
const WFM5_DEV_PINNED_BLOBS = new Map([
  [".github/workflows/wfm-five-worker-dev-acceptance.yml", "f925a4d6e14ca02676b9a381a3f35dd5a52fd2eb"],
  ["docs/wfm-five-worker-development-acceptance.md", "2bdb7bf9f9f92855f6ce04323af531f0d4a1f96a"],
  ["scripts/qa/wfm-five-worker-dev-acceptance.ts", "fea3ed7ad0d2142a2828cdfdf0725aacc92c489c"],
]);
function isPinnedWfmFiveWorkerDevEvidence(files) {
  if (files.length !== WFM5_DEV_PINNED_BLOBS.size) return false;
  const uniquePaths = new Set(files.map(file => file.filename));
  return uniquePaths.size === WFM5_DEV_PINNED_BLOBS.size
    && files.every(file => file.status === "added"
      && typeof file.sha === "string"
      && WFM5_DEV_PINNED_BLOBS.get(file.filename) === file.sha);
}

// Reviewed exact-blob exception PROPOSAL for #969: offline WFM-691 witness
// packet only. No flags, runtime, DB, live device, human signoff or release.
// The original files must be ADDED unchanged; extra paths fail closed.
const WFM691_WITNESS_PINNED_BLOBS = new Map([
  ["docs/qa/wfm-691-independent-witness-handoff.md", "4cbcc7bb09e21e0d836f4d52fb17750273bdd2bc"],
  ["scripts/qa/wfm-independent-witness.mjs", "ed923d4bead1dab6f98583b59435fc494a773d1b"],
  ["tests/wfm-independent-witness.test.mjs", "5dbfc80577b30365cf17573c1d19693cdb9ce3a0"],
]);
function isPinnedWfm691WitnessDevEvidence(files) {
  if (files.length !== WFM691_WITNESS_PINNED_BLOBS.size) return false;
  const unique = new Set(files.map(file => file.filename));
  return unique.size === WFM691_WITNESS_PINNED_BLOBS.size
    && files.every(file => file.status === "added"
      && typeof file.sha === "string"
      && WFM691_WITNESS_PINNED_BLOBS.get(file.filename) === file.sha);
}

/**
 * Exact, development-only source fixture exception proposal for #965.
 * This is a three-file TEST correction for the already-split CSV import.
 * Every tracked Git blob must match the independently inspected PR #965 HEAD.
 * Any runtime, schema, extra test, changed byte or Git rename remains frozen.
 */
const HCM_INTAKE_REGRESSIONS_PINNED_BLOBS = new Map([
  ["tests/hcm-direct-route-policy-races.test.ts", "c986dc63f7e490a4e8ec3360f56d2f0a49525539"],
  ["tests/hcm-governed-intake.test.ts", "94f9523c257a3b603ab726f61b5b80b11ff6e212"],
  ["tests/hcm-legacy-write-integration.test.ts", "ba929f96c369fc9db00e414ae360bf7ee2c4e4ea"],
]);
function isPinnedHcmIntakeRegressionDevEvidence(files) {
  if (files.length !== HCM_INTAKE_REGRESSIONS_PINNED_BLOBS.size) return false;
  const unique = new Set(files.map(file => file.filename));
  return unique.size === HCM_INTAKE_REGRESSIONS_PINNED_BLOBS.size
    && files.every(file => file.status === "modified"
      && typeof file.sha === "string"
      && HCM_INTAKE_REGRESSIONS_PINNED_BLOBS.get(file.filename) === file.sha);
}

// Owner-approved #925 source-only exception. Entire delta, including schema and
// default-OFF flag, is immutable. No production activation or migration approval.
const APPLICANT_PRIVACY_PINNED_FILES = [
  {
    "filename": "docs/engineering/migration-proposals/recruitment-applicant-privacy.sql",
    "status": "added",
    "sha": "1554b2c899f1606941a81de6fe4320e9c23f85e2"
  },
  {
    "filename": "scripts/qa/nine-stage-mobile-browser.mjs",
    "status": "modified",
    "sha": "22d7208a9bcf632b4a88ae97a06360535478b74f"
  },
  {
    "filename": "src/app/api/recruitment/hire/route.ts",
    "status": "modified",
    "sha": "c9cd681a0ae23a35188c42a853647400957f9d87"
  },
  {
    "filename": "src/app/api/recruitment/privacy/route.ts",
    "status": "added",
    "sha": "33c77eeeb06c449a58e98d9e07b4058b08a2f1f3"
  },
  {
    "filename": "src/app/api/recruitment/route.ts",
    "status": "modified",
    "sha": "d54420453b3e3846a5c0c2c44ea76f308ec3ec69"
  },
  {
    "filename": "src/db/schema.ts",
    "status": "modified",
    "sha": "e52841f16ec4e292213b4c7320255fdabcce1c48"
  },
  {
    "filename": "src/lib/critical-release-flags.ts",
    "status": "modified",
    "sha": "b02ec6daf626d14a8e7e64d043f49c4719f6cce3"
  },
  {
    "filename": "src/lib/data-retention.ts",
    "status": "modified",
    "sha": "9b126db1ac1ebb4d37eab0b2b94c1fdcd56893b8"
  },
  {
    "filename": "src/lib/recruitment-applicant-copy-hold.ts",
    "status": "added",
    "sha": "d9e91de55ed731a7570c87f194370f36ef3af176"
  },
  {
    "filename": "src/lib/recruitment-applicant-privacy.ts",
    "status": "added",
    "sha": "66ffa6cc37c0a3545266b6dd40184d51b9da1779"
  },
  {
    "filename": "src/lib/recruitment-applicant-retention.ts",
    "status": "added",
    "sha": "343d75c78b7027f3372275c4ba95831e6abbe9f2"
  },
  {
    "filename": "tests/recruitment-applicant-privacy.test.ts",
    "status": "added",
    "sha": "a22afde07d4dfae53387180d101565a7084811e4"
  },
  {
    "filename": "tests/recruitment-applicant-retention-db.test.ts",
    "status": "added",
    "sha": "33dbe2855b6e04356a0991dbd457c1a8c24e242d"
  },
  {
    "filename": "tests/recruitment-privacy-route.test.ts",
    "status": "added",
    "sha": "bdd8dc98c93fce0f1720cc4fd5eec4ed86289faf"
  }
];
function isPinnedApplicantPrivacySource(files) {
  if (files.length !== APPLICANT_PRIVACY_PINNED_FILES.length || new Set(files.map(f => f.filename)).size !== files.length) return false;
  return APPLICANT_PRIVACY_PINNED_FILES.every(expected => files.some(file =>
    file.filename === expected.filename && file.status === expected.status && file.sha === expected.sha));
}

const FROZEN_LANES = [
  // Treat every component of the exact #969 offline witness set as frozen.
  // Otherwise dropping the test file leaves the docs and QA script outside
  // the existing WFM path classifiers and bypasses the three-file guarantee.
  /^docs\/qa\/wfm-691-independent-witness-handoff\.md$/,
  /^scripts\/qa\/wfm-independent-witness\.mjs$/,
  /^src\/lib\/(?:hcm-|workforce-|wfm-|compensation-|performance-)/,
  /^src\/app\/api\/(?:hcm|workforce|recruitment|talent|compensation|performance|planning)\//,
  /^src\/components\/(?:hcm-|wfm-|workforce-|compensation-|performance-)/,
  /^src\/components\/workspace\/(?:hcm|wfm|talent|worker-360|planning|compensation|performance|coverage|workforce)/,
  /^tests\/(?:hcm-|wfm-|workforce-|compensation-|performance-)/,
  /^scripts\/(?:hcm-|wfm-|workforce-|compensation-|performance-|recruitment-)/,
  /^\.github\/workflows\/(?:hcm-|wfm-|workforce-|compensation-|performance-)/,
  /^drizzle\/[0-9]{4}_(?:hcm|wfm|workforce|compensation|performance)_/,
];

function refuse(message) { throw new Error("REVIEW_GATE_" + message); }
function validPath(path) {
  if (typeof path !== "string" || path.length > 1024 || path.length < 1 ||
      path.startsWith("/") || path.includes("\0") || path.includes("\\") ||
      path.split("/").some(section => section === ".." || section === ".")) {
    refuse("INVALID_CHANGED_PATH");
  }
  return path;
}

export function classifyReviewScope(files) {
  if (!Array.isArray(files) || files.length === 0 || files.length >= MAX_FILES) {
    refuse("FILES_MISSING_OR_TRUNCATED");
  }
  const paths = new Set();
  for (const item of files) {
    if (!item || typeof item !== "object") refuse("INVALID_CHANGED_FILE");
    paths.add(validPath(item.filename));
    if (item.status === "renamed") {
      paths.add(validPath(item.previous_filename));
    }
  }
  const list = [...paths];
  const frozenPaths = list.filter(path => FROZEN_LANES.some(regex => regex.test(path)));
  // Owner-approved #888 compatibility correction, not new HCM functionality.
  // Only this exact modified blob may cross the freeze; any other frozen path,
  // rename, changed byte, absent SHA or duplicate restores the normal hold.
  const legacyEvidencePath = "src/app/api/hcm/employment-term-decisions/[id]/evidence/route.ts";
  const legacyEvidenceFiles = files.filter(file => file.filename === legacyEvidencePath);
  const hrDocumentLegacyCompatibility = frozenPaths.length === 1 &&
    frozenPaths[0] === legacyEvidencePath && legacyEvidenceFiles.length === 1 &&
    legacyEvidenceFiles[0].status === "modified" &&
    legacyEvidenceFiles[0].sha === "49957255191041ee83440bd7f24ea5cfd72d491c";
  const wfm12DevEvidence = isExactWfm12DevelopmentEvidence(files);
  const wfmFiveWorkerDevEvidence = isPinnedWfmFiveWorkerDevEvidence(files);
  const wfm691WitnessDevEvidence = isPinnedWfm691WitnessDevEvidence(files);
  const hcmIntakeRegressionDevEvidence = isPinnedHcmIntakeRegressionDevEvidence(files);
  const applicantPrivacySource = isPinnedApplicantPrivacySource(files);
  const sensitivePaths = list.filter(path =>
    ALWAYS_SENSITIVE.some(regex => regex.test(path)) ||
    ["T2", "T3"].includes(tierForPath(path)));
  return {
    fileCount: files.length,
    requiresIndependentHuman: sensitivePaths.length > 0,
    hcmWfmFrozen: frozenPaths.length > 0,
    wfm12DevEvidence,
    wfmFiveWorkerDevEvidence,
    wfm691WitnessDevEvidence,
    hcmIntakeRegressionDevEvidence,
    hrDocumentLegacyCompatibility,
    applicantPrivacySource,
    sensitiveFileCount: sensitivePaths.length,
    frozenFileCount: frozenPaths.length,
  };
}

export function allowedHumanReviewerLogins(raw) {
  if (typeof raw !== "string" || !raw.trim()) return [];
  if (raw.length > 512 || /[\r\n]/.test(raw)) refuse("INVALID_REVIEWER_ALLOWLIST");
  const names = raw.split(",").map(v => v.trim().toLowerCase());
  if (names.length > 10 || names.some(name =>
    !REVIEWER.test(name) || name.endsWith("-bot") || name.endsWith("[bot]"))) {
    refuse("INVALID_REVIEWER_ALLOWLIST");
  }
  const unique = new Set(names);
  if (unique.size !== names.length) refuse("DUPLICATE_REVIEWER_ALLOWLIST");
  return [...unique];
}

function latestDecisiveByLogin(reviews) {
  if (!Array.isArray(reviews) || reviews.length > 500) refuse("REVIEWS_MISSING_OR_TRUNCATED");
  const latest = new Map();
  for (const review of reviews) {
    const login = review?.user?.login;
    if (typeof login !== "string" || !REVIEWER.test(login.toLowerCase()) ||
        !DECISIVE_REVIEW.has(review.state)) continue;
    if (!Number.isSafeInteger(review.id) || review.id <= 0 ||
        typeof review.submitted_at !== "string" ||
        !Number.isFinite(Date.parse(review.submitted_at))) {
      refuse("INVALID_DECISIVE_REVIEW");
    }
    const key = login.toLowerCase();
    const prev = latest.get(key);
    if (!prev || review.id > prev.id) latest.set(key, review);
  }
  return latest;
}

/**
 * Scope is derived ONLY from GitHub's full changed-file list. A source PR
 * cannot supply reviewers or pilot authorization by editing its own files.
 */
export function evaluateIndependentReview({
  pr, files, reviews, expectedHeadSha, reviewerAllowlist = "",
  permissions = {}, pilotStarted = "", pilotEvidenceRef = "",
}) {
  if (!pr || pr.state !== "open" || pr.base?.ref !== "main" ||
      !SHA.test(expectedHeadSha ?? "") ||
      pr.head?.sha !== expectedHeadSha || !SHA.test(pr.head.sha) ||
      typeof pr.user?.login !== "string" ||
      !Number.isSafeInteger(pr.changed_files) ||
      pr.changed_files !== files?.length) {
    refuse("PR_HEAD_OR_FILE_SET_UNVERIFIED");
  }
  const scope = classifyReviewScope(files);
  const blockers = [];
  if (scope.hcmWfmFrozen && !scope.wfm12DevEvidence &&
      !scope.wfmFiveWorkerDevEvidence && !scope.wfm691WitnessDevEvidence &&
       !scope.hcmIntakeRegressionDevEvidence && !scope.hrDocumentLegacyCompatibility && !scope.applicantPrivacySource &&
      (pilotStarted !== "true" ||
       typeof pilotEvidenceRef !== "string" ||
       !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{7,119}$/.test(pilotEvidenceRef))) {
    blockers.push("PILOT_HCM_WFM_FREEZE_ACTIVE");
  }
  if (scope.requiresIndependentHuman) {
    if (pr.draft) blockers.push("SENSITIVE_PR_STILL_DRAFT");
    const names = allowedHumanReviewerLogins(reviewerAllowlist);
    if (names.length === 0) blockers.push("NAMED_REVIEWER_NOT_CONFIGURED");
    const latest = latestDecisiveByLogin(reviews);
    let accepted = 0;
    let veto = false;
    for (const name of names) {
      if (name === pr.user.login.toLowerCase()) continue;
      const review = latest.get(name);
      if (!review) continue;
      if (review.state === "CHANGES_REQUESTED") veto = true;
      if (review.state !== "APPROVED" ||
          review.commit_id !== expectedHeadSha ||
          review.user?.type !== "User" ||
          !HUMAN_PERMISSIONS.has(permissions[name])) continue;
      accepted += 1;
    }
    if (veto) blockers.push("INDEPENDENT_REVIEW_CHANGE_REQUESTED");
    if (accepted < 1) blockers.push("CURRENT_HEAD_INDEPENDENT_APPROVAL_REQUIRED");
  }
  return {
    ok: blockers.length === 0,
    scope,
    approvalCount: scope.requiresIndependentHuman && blockers.includes("CURRENT_HEAD_INDEPENDENT_APPROVAL_REQUIRED") ? 0
      : scope.requiresIndependentHuman ? 1 : 0,
    blockers,
    releaseAuthorized: false,
  };
}
