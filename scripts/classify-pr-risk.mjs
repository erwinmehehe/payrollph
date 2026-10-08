import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TIERS = ["T0", "T1", "T2", "T3"];
const T3 = [
  /^drizzle\/(?:.*\.sql|baseline\.sql)$/,
  /^src\/db\/schema\.ts$/,
  /^src\/lib\/(?:hcm-compensation|compensation-automation-outbox|compensation-release-schema|compensation|paymongo|bank-|payout-|payroll-payout-|treasury-|financial-)/,
  /^src\/app\/api\/(?:compensation|payout-|treasury-|webhooks\/paymongo|payroll-runs\/\[id\]\/(?:release|exports|payout-))/,
  /^scripts\/(?:recover-compensation|rehearse-compensation|check-compensation-release|verify-payout-)/,
  /^src\/lib\/(?:payroll-bank-|payout-reconciliation)/,
];
const T2 = [
  /^src\/lib\/(?:payroll-|workforce-|pay-policy|leave-payroll|oidc|security|auth|enterprise-identity|automation(?:-|\.)|hcm-|pilot-)/,
  /^src\/app\/api\/(?:payroll-runs|approvals|workforce|automation-studio|auth|oidc|scim|separation|recruitment)/,
  /^src\/components\/(?:automation-|compensation-|workforce-|separation-)/,
  /^tests\/.*(?:payroll|payout|bank|security|automation|compensation|wfm|identity|recovery).*\.test\.(?:ts|mjs)$/,
  /^(?:package-lock\.json|package\.json)$/,
  /^\.github\/workflows\//,
];
const T0 = [
  /^(?:README|CONTRIBUTING|CHANGELOG)\.md$/,
  /^docs\/(?!security\/|payroll-certification\/).+\.(?:md|mdx|txt)$/,
  /^public\/.+\.(?:png|jpg|jpeg|webp|svg|ico|woff2|gif)$/,
  /^content\/.+\.(?:md|mdx|txt)$/,
  /^\.github\/pull_request_template\.md$/,
];

export function tierForPath(path) {
  if (typeof path !== "string" || !path || path.includes("\0") || path.includes("..")) return "T2";
  const p = path.replaceAll("\\", "/");
  if (T3.some((rule) => rule.test(p))) return "T3";
  if (T2.some((rule) => rule.test(p))) return "T2";
  if (T0.some((rule) => rule.test(p))) return "T0";
  return "T1";
}

export function classifyFiles(paths) {
  if (!Array.isArray(paths)) throw new TypeError("Expected changed file paths.");
  const unique = [...new Set(paths)];
  const counts = Object.fromEntries(TIERS.map((tier) => [tier, 0]));
  for (const path of unique) counts[tierForPath(path)] += 1;
  const highest = [...TIERS].reverse().find((tier) => counts[tier] > 0) ?? "T0";
  return { tier: highest, counts, fileCount: unique.length };
}

function getPrChanges() {
  const base = process.env.PR_BASE_REF ?? "";
  const head = process.env.PR_HEAD_SHA ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(base) || base.includes("..") || base.includes("//")
    || !/^[0-9a-f]{40}$/.test(head)) {
    throw new Error("PR base/ref metadata is missing or invalid.");
  }
  const currentBase = execFileSync("git", ["rev-parse", "--verify", "refs/remotes/origin/" + base],
    { encoding: "utf8" }).trim();
  const mergeBase = execFileSync("git", ["merge-base", currentBase, head],
    { encoding: "utf8" }).trim();
  if (!/^[0-9a-f]{40}$/.test(mergeBase)) throw new Error("Cannot establish current PR merge-base.");
  const out = execFileSync("git", ["diff", "--name-only", "-z", "-M", mergeBase, head],
    { encoding: "utf8" });
  return out.split("\0").filter(Boolean);
}

function run() {
  const result = classifyFiles(getPrChanges());
  const meaning = {
    T0: "Routine checks; no special payroll/financial release approval",
    T1: "Applicable CI plus normal maintainer review",
    T2: "Exact-head CI plus focused domain/security review; staging before activation",
    T3: "Exact-head CI plus independent high-risk review, controlled migration/activation decision",
  };
  const summary = [
    "## PayrollPH PR risk classification (advisory)",
    "",
    "| Suggested tier | Changed files | Proposed review |",
    "| --- | ---: | --- |",
    "|" + result.tier + "|" + result.fileCount + "|" + meaning[result.tier] + "|",
    "",
    "This check is based on filenames, not a human audit. It never authorizes payroll, bank payments, migration, merge or deployment.",
    "See docs/engineering/change-risk-policy.md.",
    "",
  ].join("\n");
  process.stdout.write(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "risk_tier=" + result.tier + "\n");
}
if (process.argv[1] && import.meta.url === new URL("file://" + fileURLToPath(import.meta.url)).href
  && process.argv[1] === fileURLToPath(import.meta.url)) {
  try { run(); } catch (error) {
    console.error("Risk classification unavailable: " + (error instanceof Error ? error.message : "unknown error"));
    process.exitCode = 1;
  }
}
