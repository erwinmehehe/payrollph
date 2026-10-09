#!/usr/bin/env node
/**
 * Read-only PR queue check. It never merges, closes, labels or updates PRs.
 * Run from trusted default-branch source in pull_request_target; do NOT check
 * out the PR head or use a write-capable token.
 */
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const MAX_READY_FOR_REVIEW = 3;
const MIGRATION = /^drizzle\/([0-9]{4})_[a-z0-9][a-z0-9_-]*\.sql$/;
const MAX_PAGES = 10;

function safePrNumber(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid PR number");
  return value;
}

function comparePrCreation(a, b) {
  const aDate = Date.parse(a.created_at ?? "") || 0;
  const bDate = Date.parse(b.created_at ?? "") || 0;
  return aDate - bDate || a.number - b.number;
}

/** Deterministic pure evaluator; file lists are incremental PR diffs. */
export function evaluatePullQueue(prs, filesByNumber, currentNumber, maxReady = MAX_READY_FOR_REVIEW) {
  safePrNumber(currentNumber);
  if (!Number.isSafeInteger(maxReady) || maxReady < 1) throw new Error("Invalid review WIP limit");
  if (!Array.isArray(prs)) throw new Error("PR list was not available");

  const current = prs.find((pr) => pr.number === currentNumber);
  if (!current) throw new Error("Current PR is missing from the open PR list");
  const ready = prs.filter((pr) => !pr.draft).sort(comparePrCreation).map((pr) => pr.number);
  const allClaims = [];

  for (const pr of prs) {
    safePrNumber(pr.number);
    const files = filesByNumber[pr.number];
    if (!Array.isArray(files)) throw new Error("Missing changed-file evidence for PR #" + pr.number);
    if (files.length >= 3000) throw new Error("File list may be truncated for PR #" + pr.number);
    for (const file of files) {
      // The SQL history guard separately rejects renames and old-file edits.
      // Both newly added and renamed-to numbered SQL count as competing claims.
      if (!["added", "renamed"].includes(file.status)) continue;
      const match = String(file.filename || "").match(MIGRATION);
      if (match) {
        allClaims.push({
          pr: pr.number,
          prefix: match[1],
          filename: file.filename,
          created_at: pr.created_at,
        });
      }
    }
  }

  allClaims.sort((a, b) => comparePrCreation(
    { number: a.pr, created_at: a.created_at },
    { number: b.pr, created_at: b.created_at },
  ) || a.filename.localeCompare(b.filename));

  const owners = new Map();
  const collisions = [];
  for (const claim of allClaims) {
    const previous = owners.get(claim.prefix);
    if (!previous) {
      owners.set(claim.prefix, claim);
    } else if (previous.pr !== claim.pr) {
      collisions.push({
        prefix: claim.prefix,
        reservedBy: previous.pr,
        reservedPath: previous.filename,
        conflictingPr: claim.pr,
        conflictingPath: claim.filename,
      });
    } else if (previous.filename !== claim.filename) {
      // Two newly added files in the *same* PR claim the same prefix.
      collisions.push({
        prefix: claim.prefix,
        reservedBy: previous.pr,
        reservedPath: previous.filename,
        conflictingPr: claim.pr,
        conflictingPath: claim.filename,
      });
    }
  }

  const currentCollisions = collisions.filter((conflict) => conflict.conflictingPr === currentNumber);
  const failures = [];
  if (!current.draft && ready.length > maxReady) {
    failures.push("Review-ready queue exceeds " + maxReady + " PRs (" + ready.join(", ") +
      "). Convert excess items to draft before asking for another review.");
  }
  for (const clash of currentCollisions) {
    failures.push("Migration " + clash.prefix + " is already claimed by #" + clash.reservedBy +
      " (" + clash.reservedPath + "); this PR #" + clash.conflictingPr +
      " also adds " + clash.conflictingPath + ". Resolve the release train; never renumber applied SQL.");
  }

  return {
    ready,
    currentDraft: Boolean(current.draft),
    maxReady,
    claims: allClaims,
    collisions,
    currentCollisions,
    failures,
  };
}

export function formatQueueSummary(result, currentNumber) {
  const lines = [
    "## Pull request integration queue",
    "",
    "PR under check: #" + currentNumber,
    "Review-ready: " + result.ready.length + " / " + result.maxReady,
    "Review-ready PRs: " + (result.ready.length ? result.ready.map((n) => "#" + n).join(", ") : "none"),
    "Open migration claims: " + result.claims.length,
    "Cross-PR or within-PR SQL prefix collisions: " + result.collisions.length,
    "Outcome: " + (result.failures.length ? "BLOCKED" : "PASS"),
    "",
  ];
  for (const issue of result.failures) lines.push("- " + issue);
  lines.push("", "This gate is read-only. It does not approve code, merge, run DDL, enable a worker, deploy or authorize real payroll.",
    "Independent reviewer, applied SQL journal and stage/release evidence remain separate gates.", "");
  return lines.join("\n");
}

async function githubList(path, token, maxPages = MAX_PAGES) {
  const collected = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const query = path.includes("?") ? "&" : "?";
    const uri = "https://api.github.com" + path + query + "per_page=100&page=" + page;
    const response = await fetch(uri, {
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) throw new Error("GitHub read failed (" + response.status + ") for " + path);
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error("GitHub returned an invalid list for " + path);
    collected.push(...batch);
    if (batch.length < 100) return collected;
  }
  throw new Error("GitHub pagination limit reached: cannot prove full PR/file coverage");
}

export async function main(env = process.env) {
  const repo = env.GITHUB_REPOSITORY ?? "";
  const token = env.GITHUB_TOKEN ?? "";
  const currentNumber = Number(env.PR_NUMBER);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !token || !Number.isSafeInteger(currentNumber)) {
    throw new Error("GitHub repository, read-only token and exact PR number are required");
  }
  const root = "/repos/" + repo;
  const prs = await githubList(root + "/pulls?state=open", token);
  const filesByNumber = {};
  // Explicitly page every open PR; guessing from the changed-files count
  // could miss a migration in a later page.
  for (const pr of prs) {
    filesByNumber[pr.number] = await githubList(root + "/pulls/" + pr.number + "/files", token);
  }
  const result = evaluatePullQueue(prs, filesByNumber, currentNumber);
  const summary = formatQueueSummary(result, currentNumber);
  process.stdout.write(summary + "\n");
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary + "\n");
  if (result.failures.length) process.exitCode = 1;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("PR queue gate cannot prove safety: " + (error instanceof Error ? error.message : "unknown error"));
    process.exitCode = 1;
  });
}
