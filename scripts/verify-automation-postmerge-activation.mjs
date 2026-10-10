#!/usr/bin/env node
/**
 * Read-only post-merge activation evidence gate for Automation Studio #609.
 * Neither this command nor a PASS activates a flag, deploys code, or approves a release.
 * After a PR merges, the pre-merge checker cannot validate activation because
 * that checker (correctly) requires an open PR. Keep these checks separate.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { REQUIRED_WORKFLOWS } from "./verify-automation-language-release.mjs";

const REPO = "erwinmehehe/payrollph";
const API = "https://api.github.com/repos/" + REPO;
const SHA = /^[0-9a-f]{40}$/;
const ROLES = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const SECURITY_LINES = [
  "INTENT-FIDELITY: PASS",
  "TENANT-ACCESS: VERIFIED",
  "NO-EXECUTION-BYPASS: VERIFIED",
];
const STAGING_LINES = [
  "LIVE-PROVIDER: PASS",
  "NONPROD-DB: VERIFIED",
  "MFA: VERIFIED",
  "NO-PRODUCTION-DATA: VERIFIED",
  "ROLLOUT-FLAG: OFF",
];

function hasIndependentEvidence(comments, author, prefix, sha, required) {
  return Array.isArray(comments) && comments.some((item) => {
    const person = item?.user;
    if (person?.type !== "User" || typeof person.login !== "string" ||
        person.login.toLowerCase() === String(author ?? "").toLowerCase() ||
        !ROLES.has(item.author_association)) return false;
    const lines = (typeof item.body === "string" ? item.body : "")
      .split(/\r?\n/).map((line) => line.trim());
    return lines.includes(prefix + ": " + sha) &&
      required.every((line) => lines.includes(line));
  });
}

/** Pure evidence evaluator; does not perform network access or mutate flags. */
export function evaluatePostmergeActivation(input) {
  const reasons = [];
  const { expectedSha, pr, mainRef, ancestry, reviewIssue, stagingIssue,
    securityComments, stagingComments, runs } = input ?? {};
  const author = pr?.user?.login;
  const mergeSha = pr?.merge_commit_sha;

  if (!SHA.test(expectedSha ?? "")) reasons.push("Invalid exact deployment SHA");
  if (mainRef?.ref !== "refs/heads/main" ||
      mainRef?.object?.sha !== expectedSha) {
    reasons.push("Exact checked SHA is not current main");
  }
  if (pr?.number !== 609 || pr?.state !== "closed" || !pr?.merged ||
      !pr?.merged_at || pr?.base?.ref !== "main" ||
      pr?.head?.ref !== "feature/automation-studio-language-drafts" ||
      pr?.head?.repo?.full_name !== REPO ||
      typeof author !== "string" || !SHA.test(mergeSha ?? "")) {
    reasons.push("Merged Automation Studio PR identity cannot be verified");
  }
  if (!ancestry || !["ahead", "identical"].includes(ancestry.status) ||
      ancestry.behind_by !== 0 ||
      !Number.isSafeInteger(ancestry.ahead_by) ||
      (ancestry.status === "identical" && mergeSha !== expectedSha)) {
    reasons.push("Merged code must be an ancestor of the exact current main SHA");
  }

  if (reviewIssue?.state !== "closed" ||
      !hasIndependentEvidence(securityComments, author,
        "SECURITY-REVIEWED", expectedSha, SECURITY_LINES)) {
    reasons.push("Missing independently reviewed exact-SHA security/intent sign-off in #621");
  }
  if (stagingIssue?.state !== "closed" ||
      !hasIndependentEvidence(stagingComments, author,
        "STAGING-ACCEPTED", expectedSha, STAGING_LINES)) {
    reasons.push("Missing independently witnessed exact-SHA live-provider staging in #622");
  }

  // Treat a newer failed/re-running workflow as authoritative over an older pass.
  const latest = new Map();
  for (const run of Array.isArray(runs) ? runs : []) {
    if (run?.head_sha !== expectedSha ||
        !REQUIRED_WORKFLOWS.includes(run?.name)) continue;
    const rank = String(run.created_at ?? "") + "/" +
      String(run.run_attempt ?? 0).padStart(6, "0") + "/" +
      String(run.id ?? 0).padStart(20, "0");
    if (!latest.has(run.name) || rank > latest.get(run.name).rank) {
      latest.set(run.name, { run, rank });
    }
  }
  for (const workflow of REQUIRED_WORKFLOWS) {
    const run = latest.get(workflow)?.run;
    if (!run || run.status !== "completed" ||
        run.conclusion !== "success" ||
        !["push", "workflow_dispatch"].includes(run.event)) {
      reasons.push("Missing passing exact-main workflow: " + workflow);
    }
  }
  return {
    checkedSha: SHA.test(expectedSha ?? "") ? expectedSha : null,
    readyForActivationDecision: reasons.length === 0,
    reasons,
    note: "Read-only evidence validation, NOT deployment or authorization to enable features.",
  };
}

async function githubJson(url, token) {
  const u = new URL(url);
  if (u.origin !== "https://api.github.com" ||
      !u.pathname.startsWith("/repos/" + REPO + "/")) {
    throw new Error("Rejected GitHub API location");
  }
  const response = await fetch(u, {
    method: "GET",
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("GitHub GET failed: HTTP " + response.status);
  return {
    data: await response.json(),
    next: response.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null,
  };
}
async function readPages(path, token, field = null) {
  const all = [];
  let url = API + path;
  for (let i = 0; i < 10 && url; i++) {
    const response = await githubJson(url, token);
    const items = field ? response.data[field] : response.data;
    if (!Array.isArray(items)) throw new Error("GitHub returned invalid paged evidence");
    all.push(...items);
    url = response.next;
  }
  if (url) throw new Error("Incomplete paginated GitHub evidence");
  return all;
}

export async function main() {
  const token = process.env.GITHUB_TOKEN;
  const expectedSha = process.env.AUTOMATION_ACTIVATION_MAIN_SHA;
  if (process.env.GITHUB_REPOSITORY !== REPO ||
      !SHA.test(expectedSha ?? "") || typeof token !== "string" || token.length < 20) {
    throw new Error("Exact repository, main SHA and read-only GITHUB_TOKEN are required");
  }
  const read = async (path) => (await githubJson(API + path, token)).data;
  const pr = await read("/pulls/609");
  const mergeSha = pr?.merge_commit_sha;
  if (!SHA.test(mergeSha ?? "")) throw new Error("Merged PR SHA unavailable");
  const [mainRef, ancestry, reviewIssue, stagingIssue,
    securityComments, stagingComments, runs] = await Promise.all([
      read("/git/ref/heads/main"),
      read("/compare/" + mergeSha + "..." + expectedSha),
      read("/issues/621"),
      read("/issues/622"),
      readPages("/issues/621/comments?per_page=100", token),
      readPages("/issues/622/comments?per_page=100", token),
      readPages("/actions/runs?branch=main&per_page=100", token, "workflow_runs"),
    ]);
  const outcome = evaluatePostmergeActivation({
    expectedSha, pr, mainRef, ancestry, reviewIssue, stagingIssue,
    securityComments, stagingComments, runs,
  });
  console.log(JSON.stringify(outcome, null, 2));
  if (!outcome.readyForActivationDecision) process.exitCode = 1;
}

if (process.argv[1] &&
    resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main().catch((error) => {
    // Never log tokens, comment bodies, private staging URLs or provider data.
    console.error("Post-merge activation evidence unavailable: " + error.message);
    process.exitCode = 1;
  });
}
