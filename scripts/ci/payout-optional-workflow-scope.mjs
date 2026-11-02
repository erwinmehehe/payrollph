// Conservative CI optimization for independent payout-profile PATCH-only PRs.
// It never grants coverage credit and never changes the dedicated payout proof.
// Unknown changes, missing history, shared dependencies, and manual/main runs
// execute every optional workflow normally.
import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PAYOUT_ROUTE = "src/app/api/payout-profiles/route.ts";
export const COVERAGE_MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const CONTRACT = "tests/tenant-payout-profiles-patch-audit.test.mjs";
const PROOF = "scripts/qa/tenant-payout-profiles-patch-http.mjs";
const ALLOWED = new Set([
  PAYOUT_ROUTE,
  COVERAGE_MANIFEST,
  CONTRACT,
  PROOF,
  "tests/tenant-isolation-coverage-inventory.test.mjs",
]);

export function isIndependentPayoutPatchChange({ files, beforeRoute, afterRoute, beforeManifest, afterManifest }) {
  if (!Array.isArray(files) || files.length < 4 ||
      files.some((name) => typeof name !== "string" || !ALLOWED.has(name))) return false;
  // Both the executable proof and source contract must be part of the same PR.
  if (![PAYOUT_ROUTE, COVERAGE_MANIFEST, PROOF, CONTRACT].every((name) => files.includes(name))) return false;
  if (typeof beforeRoute !== "string" || typeof afterRoute !== "string") return false;

  const marker = "export async function PATCH(request: Request) {";
  const oldIndex = beforeRoute.indexOf(marker);
  const newIndex = afterRoute.indexOf(marker);
  if (oldIndex < 0 || newIndex < 0 ||
      beforeRoute.slice(0, oldIndex) !== afterRoute.slice(0, newIndex) ||
      beforeRoute.slice(oldIndex) === afterRoute.slice(newIndex)) return false;

  if (!beforeManifest || !afterManifest ||
      !beforeManifest.allApiRouteFiles || !afterManifest.allApiRouteFiles) return false;
  const oldEntry = beforeManifest.allApiRouteFiles[PAYOUT_ROUTE];
  const newEntry = afterManifest.allApiRouteFiles[PAYOUT_ROUTE];
  if (!oldEntry || !newEntry || !Array.isArray(oldEntry.methods) || !Array.isArray(newEntry.methods)) return false;

  // Every other route's coverage evidence, totals and manifest metadata must
  // be IDENTICAL. Do not skip a workflow if another route's proof changed.
  const oldWithoutPayout = { ...beforeManifest, allApiRouteFiles: { ...beforeManifest.allApiRouteFiles } };
  const newWithoutPayout = { ...afterManifest, allApiRouteFiles: { ...afterManifest.allApiRouteFiles } };
  delete oldWithoutPayout.allApiRouteFiles[PAYOUT_ROUTE];
  delete newWithoutPayout.allApiRouteFiles[PAYOUT_ROUTE];
  if (JSON.stringify(oldWithoutPayout) !== JSON.stringify(newWithoutPayout)) return false;

  // GET cannot borrow PATCH evidence; PATCH must remain GAP with zero credits.
  const oldGet = oldEntry.methods.find((entry) => entry.name === "GET");
  const newGet = newEntry.methods.find((entry) => entry.name === "GET");
  const patch = newEntry.methods.find((entry) => entry.name === "PATCH");
  if (!oldGet || JSON.stringify(oldGet) !== JSON.stringify(newGet) ||
      patch?.status !== "GAP" || patch.testedBy !== null ||
      patch.reviewedUncertified?.credits !== 0) return false;
  return true;
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
}

function skipUnrelatedHeavyWorkflows() {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") return false;
  const base = process.env.PR_BASE_SHA || "";
  const head = process.env.PR_HEAD_SHA || "";
  if (!/^[a-f0-9]{40}$/i.test(base) || !/^[a-f0-9]{40}$/i.test(head) || base === head) return false;

  try {
    git("fetch", "--no-tags", "--depth=1", "origin", base, head);
    const files = git("diff", "--no-renames", "--name-only", "-z", base, head, "--").split("\0").filter(Boolean);
    if (files.length === 0 || files.some((name) => !ALLOWED.has(name))) return false;
    return isIndependentPayoutPatchChange({
      files,
      beforeRoute: git("show", base + ":" + PAYOUT_ROUTE),
      afterRoute: git("show", head + ":" + PAYOUT_ROUTE),
      beforeManifest: JSON.parse(git("show", base + ":" + COVERAGE_MANIFEST)),
      afterManifest: JSON.parse(git("show", head + ":" + COVERAGE_MANIFEST)),
    });
  } catch {
    // Fetch, parse or comparison failures always RUN the expensive proof.
    return false;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT required for fail-closed workflow gating");
  const skip = skipUnrelatedHeavyWorkflows();
  appendFileSync(process.env.GITHUB_OUTPUT, "skip_heavy=" + (skip ? "true" : "false") + "\n");
  console.log(skip
    ? "Independent payout PATCH-only PR: unrelated optional proof may skip; core CI and payout proofs still run."
    : "Full optional proof required: shared, unknown, malformed, or non-PR change.");
}
