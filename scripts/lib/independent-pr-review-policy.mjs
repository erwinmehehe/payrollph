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

const FROZEN_LANES = [
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
  const wfm12DevEvidence = isExactWfm12DevelopmentEvidence(files);
  const wfmFiveWorkerDevEvidence = isPinnedWfmFiveWorkerDevEvidence(files);
  const sensitivePaths = list.filter(path =>
    ALWAYS_SENSITIVE.some(regex => regex.test(path)) ||
    ["T2", "T3"].includes(tierForPath(path)));
  return {
    fileCount: files.length,
    requiresIndependentHuman: sensitivePaths.length > 0,
    hcmWfmFrozen: frozenPaths.length > 0,
    wfm12DevEvidence,
    wfmFiveWorkerDevEvidence,
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
      !scope.wfmFiveWorkerDevEvidence &&
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
