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

// Narrow development test-only exception for #936. This does NOT authorize
// a pilot, application-side workforce changes, SQL, photo capture or payroll.
// Every changed file must already exist and both named files must be modified.
const WFM12_DEV_VERIFICATION_FILES = new Set([
  "scripts/wfm-pilot-synthetic-evidence.mjs",
  "tests/wfm-roster-scale-postgres.test.ts",
]);
function isWfm12DevVerification(files) {
  return files.length === WFM12_DEV_VERIFICATION_FILES.size &&
    new Set(files.map(file => file.filename)).size === files.length &&
    files.every(file => file.status === "modified" &&
      WFM12_DEV_VERIFICATION_FILES.has(file.filename));
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
  const sensitivePaths = list.filter(path =>
    ALWAYS_SENSITIVE.some(regex => regex.test(path)) ||
    ["T2", "T3"].includes(tierForPath(path)));
  const wfm12DevVerification = isWfm12DevVerification(files);
  return {
    fileCount: files.length,
    // Force actual non-author human review even if the changed script is T1.
    requiresIndependentHuman: sensitivePaths.length > 0 || wfm12DevVerification,
    hcmWfmFrozen: frozenPaths.length > 0,
    wfm12DevVerification,
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
  if (scope.hcmWfmFrozen && !scope.wfm12DevVerification &&
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
