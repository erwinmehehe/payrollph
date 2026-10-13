#!/usr/bin/env node
/**
 * GitHub read-only independent-review gate for protected DEFAULT BRANCH code.
 * Run only with a read-scoped token on pull_request_target/review events;
 * NEVER check out or execute code from the untrusted PR head.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  allowedHumanReviewerLogins, classifyReviewScope, evaluateIndependentReview,
} from "./lib/independent-pr-review-policy.mjs";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_PAGES = 31;
function refuse(reason) { throw new Error("REVIEW_GATE_" + reason); }
function safeRepo(raw) {
  if (typeof raw !== "string" ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(raw) ||
      raw.includes("..")) refuse("INVALID_REPOSITORY");
  return raw;
}
async function githubJson(path, token, fetcher = fetch) {
  if (typeof token !== "string" || token.length < 8) refuse("READ_ONLY_GITHUB_TOKEN_REQUIRED");
  if (!/^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:pulls\/[1-9][0-9]{0,8}(?:\/(?:files|reviews))?|collaborators\/[a-z0-9-]+\/permission)(?:\?per_page=100&page=[1-9][0-9]?)?$/.test(path)) {
    refuse("INVALID_GITHUB_API_PATH");
  }
  const url = "https://api.github.com" + path;
  let response;
  try {
    response = await fetcher(url, {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": "Bearer " + token,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch { refuse("GITHUB_READ_FAILED"); }
  if (response.status !== 200 ||
      !response.headers?.get("content-type")?.includes("application/json")) {
    refuse("GITHUB_UNAVAILABLE_OR_ACCESS_DENIED");
  }
  const declared = response.headers.get("content-length");
  if (declared !== null &&
      (!/^[0-9]+$/.test(declared) || Number(declared) > MAX_BYTES)) {
    refuse("GITHUB_RESPONSE_OVERSIZED");
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    refuse("GITHUB_RESPONSE_BODY_UNAVAILABLE");
  }
  const reader = response.body.getReader();
  let size = 0;
  const buffers = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) refuse("GITHUB_RESPONSE_INVALID_BYTES");
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        refuse("GITHUB_RESPONSE_OVERSIZED");
      }
      buffers.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(buffers, size).toString("utf8"));
  } catch { refuse("GITHUB_INVALID_JSON"); }
}
async function githubList(path, token, fetcher) {
  const result = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const items = await githubJson(path + "?per_page=100&page=" + page, token, fetcher);
    if (!Array.isArray(items) || items.length > 100) refuse("GITHUB_LIST_INVALID");
    result.push(...items);
    if (result.length >= 3000) refuse("GITHUB_LIST_MAY_BE_TRUNCATED");
    if (items.length < 100) return result;
  }
  refuse("GITHUB_LIST_MAY_BE_TRUNCATED");
}

export async function checkIndependentReview(env, fetcher = fetch) {
  const repo = safeRepo(env.GITHUB_REPOSITORY);
  const number = Number(env.PR_NUMBER);
  const head = env.PR_HEAD_SHA;
  const token = env.GITHUB_TOKEN;
  if (!Number.isSafeInteger(number) || number < 1 || number > 999_999_999 ||
      !/^[0-9a-f]{40}$/.test(head ?? "")) {
    refuse("MISSING_PR_OR_SHA");
  }
  const root = "/repos/" + repo;
  const pr = await githubJson(root + "/pulls/" + number, token, fetcher);
  const files = await githubList(root + "/pulls/" + number + "/files", token, fetcher);
  // Never trust only the PR's claimed changed_files number or first 100 files.
  if (!pr || pr.number !== number || pr.changed_files !== files.length) {
    refuse("FULL_DIFF_NOT_AVAILABLE");
  }
  const scope = classifyReviewScope(files);
  if (pr.state !== "open" || pr.base?.ref !== "main" || pr.head?.sha !== head) {
    refuse("PR_HEAD_OR_FILE_SET_UNVERIFIED");
  }
  // Repository-owner source policy: a solo maintainer reviews source merges.
  // This result validates the exact diff; it never fabricates a human review
  // and never authorizes payroll, migrations, deployments or money movement.
  if (env.INDEPENDENT_SOURCE_REVIEW_REQUIRED !== "true") {
    // Only the independent *person* requirement is waived for a solo
    // maintainer. The separately adopted HCM/WFM pilot freeze still applies
    // to source integrations; a review-mode flag cannot disable it.
    const pilotEvidence = env.PILOT_START_EVIDENCE_REF ?? "";
    const pilotAccepted = env.PILOT_HCM_WFM_STARTED === "true" &&
      /^[A-Za-z0-9][A-Za-z0-9_.:/-]{7,119}$/.test(pilotEvidence);
    const blockers = scope.hcmWfmFrozen && !scope.wfm12DevEvidence &&
      !scope.wfmFiveWorkerDevEvidence && !scope.hrDocumentLegacyCompatibility && !pilotAccepted
      ? ["PILOT_HCM_WFM_FREEZE_ACTIVE"] : [];
    return { ok: blockers.length === 0, scope, approvalCount: 0, blockers,
      releaseAuthorized: false, mode: "solo-maintainer" };
  }
  const reviewers = scope.requiresIndependentHuman
    ? allowedHumanReviewerLogins(env.PAYROLL_INDEPENDENT_REVIEWERS ?? "")
    : [];
  const reviews = scope.requiresIndependentHuman
    ? await githubList(root + "/pulls/" + number + "/reviews", token, fetcher)
    : [];
  const permissions = {};
  for (const login of reviewers) {
    if (login === pr.user?.login?.toLowerCase()) continue;
    const role = await githubJson(
      root + "/collaborators/" + login + "/permission", token, fetcher,
    );
    permissions[login] = role?.permission ?? "";
  }
  return evaluateIndependentReview({
    pr, files, reviews, permissions, expectedHeadSha: head,
    reviewerAllowlist: env.PAYROLL_INDEPENDENT_REVIEWERS ?? "",
    pilotStarted: env.PILOT_HCM_WFM_STARTED ?? "",
    pilotEvidenceRef: env.PILOT_START_EVIDENCE_REF ?? "",
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checkIndependentReview(process.env).then(verdict => {
    // Do not print reviewer identities, branch payloads or any secret.
    const result = {
      name: "independent-payroll-pr-review",
      mode: verdict.mode ?? "independent-review-required",
      state: verdict.ok ? "PASS" : "BLOCKED",
      requiresIndependentHuman: verdict.scope.requiresIndependentHuman,
      hcmWfmFreezeScope: verdict.scope.hcmWfmFrozen,
      independentCurrentHeadApprovalCount: verdict.approvalCount,
      blockers: verdict.blockers,
      payrollOrProductionReleaseApproved: false,
    };
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (!verdict.ok) process.exitCode = 1;
  }).catch(error => {
    const code = error instanceof Error && /^REVIEW_GATE_[A-Z_]+$/.test(error.message)
      ? error.message : "REVIEW_GATE_UNVERIFIED";
    console.error(code + ": source review acceptance is blocked.");
    process.exitCode = 1;
  });
}
