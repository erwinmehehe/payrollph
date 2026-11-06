#!/usr/bin/env node
/**
 * Restricted credit command for POST payroll-runs/[id]/submit-review and POST payroll-runs/[id]/release.
 * Executable only AFTER .github/workflows/tenant-money-lifecycle.yml passed BOTH matrix legs (exact-links false and true)
 * on --head-sha. This is not an evidence generator: it writes no proof, it only links an executed receipt.
 *
 * The existing harness scripts/qa/tenant-money-lifecycle-http.mjs already runs, for EACH of two independent attacker
 * employers, process -> submit-review (201, forged victim body selectors ignored) -> independent checker approval ->
 * release by a separate MFA-verified releaser (200, forged selectors ignored), and before that denies submit-review and
 * release on the real higher-ID victim run (403) with the victim's payroll/payout/approval/audit SQL state unchanged.
 * The passing head must be an ancestor of HEAD and every proof input must be byte-identical between it and HEAD.
 * Independent review stays PENDING.
 *
 *   node scripts/qa/tenant-payroll-review-release-credit.mjs \
 *     --run-label "GitHub Actions <run>/<jobFalse>+<jobTrue> PG16 money-lifecycle PASS" \
 *     --workflow-run-id <run> --job-id-false <job> --job-id-true <job> --head-sha <40 hex> [--check]
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const KEYS = ["POST payroll-runs/[id]/submit-review", "POST payroll-runs/[id]/release"];
const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const OVERVIEW = "docs/engineering/tenant-isolation-coverage-inventory.md";
const HARNESS = "scripts/qa/tenant-money-lifecycle-http.mjs";
const WORKFLOW = ".github/workflows/tenant-money-lifecycle.yml";
const ROUTES = {
  "POST payroll-runs/[id]/submit-review": "src/app/api/payroll-runs/[id]/submit-review/route.ts",
  "POST payroll-runs/[id]/release": "src/app/api/payroll-runs/[id]/release/route.ts",
};
const ROUTE_BLOBS = {
  "POST payroll-runs/[id]/submit-review": "98abed695eee9462a233f3da78b794e60f40c581",
  "POST payroll-runs/[id]/release": "87fb97879aa19473a67ff9815c9db2e4b9f5d0b9",
};
// Every file the workflow executes for this harness, plus the routes and libraries the journey depends on.
const IDENTICAL_INPUTS = [HARNESS, WORKFLOW, ...Object.values(ROUTES),
  "src/app/api/payroll-runs/[id]/process/route.ts", "src/app/api/approvals/[id]/route.ts",
  "scripts/qa/money-proof-target.mjs", "tests/money-proof-target.test.mjs", "scripts/qa/apply-isolated-baseline.mjs",
  "src/lib/access.ts", "src/lib/auth.ts", "src/lib/multi-entity-run-guard.ts", "src/lib/payroll-release-checklist.ts",
  "src/lib/security-request.ts", "package.json", "package-lock.json"];
// Workflow path-filter inputs that must not have changed at all since the passing run.
const UNCHANGED_PATHS = ["src/db", "drizzle", "src/app/api/payroll-runs", "src/app/api/approvals",
  "src/lib/payroll-*", "src/lib/approval-*", "src/lib/payout-*", "src/lib/bank-*"];

const argv = process.argv.slice(2);
const arg = (name) => {
  assert.equal(argv.filter((x) => x === name).length, 1, "one " + name + " required");
  const i = argv.indexOf(name);
  assert.ok(argv[i + 1] && !argv[i + 1].startsWith("--"), name + " needs a value");
  return argv[i + 1];
};
assert.ok(!argv.includes("--only-key"), "this command credits exactly the two lifecycle keys and nothing else");
const runLabel = arg("--run-label");
const workflowRunId = Number(arg("--workflow-run-id"));
const jobFalse = Number(arg("--job-id-false"));
const jobTrue = Number(arg("--job-id-true"));
const headSha = arg("--head-sha");
for (const n of [workflowRunId, jobFalse, jobTrue]) assert.ok(Number.isSafeInteger(n) && n > 0);
assert.notEqual(jobFalse, jobTrue, "both matrix legs are separate jobs");
assert.match(headSha, /^[a-f0-9]{40}$/);
assert.equal(runLabel, "GitHub Actions " + workflowRunId + "/" + jobFalse + "+" + jobTrue + " PG16 money-lifecycle PASS",
  "no unexecuted, stale or unverified run label");

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
git("cat-file", "-e", headSha + "^{commit}");
execFileSync("git", ["merge-base", "--is-ancestor", headSha, "HEAD"]); // the passing source is in this history
const blobAt = (rev, path) => git("rev-parse", rev + ":" + path);
for (const path of IDENTICAL_INPUTS) {
  assert.equal(blobAt("HEAD", path), blobAt(headSha, path), path + " changed since the passing run; re-run the workflow on the new source");
}
assert.equal(git("diff", "--name-only", headSha, "HEAD", "--", ...UNCHANGED_PATHS), "",
  "a workflow path-filter input changed since the passing run");

// Pin committed Git blobs, never working-tree line endings (which differ on Windows).
const sha = (path) => blobAt("HEAD", path);
const harness = readFileSync(HARNESS, "utf8");
const workflow = readFileSync(WORKFLOW, "utf8");
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
let overview = readFileSync(OVERVIEW, "utf8");

const cite = (fragment, expected = 1) => {
  const lines = harness.split("\n");
  const matches = lines.flatMap((entry, i) => (entry.includes(fragment) ? [i + 1] : []));
  assert.equal(matches.length, expected, "exact proof line count changed for " + fragment + " (" + matches.length + ")");
  return matches[0];
};
for (const required of [
  "assertMoneyProofTarget(process.env);",
  'assert.notEqual(process.env.GITHUB_ACTIONS, "true", "GitHub acceptance must use real HTTP authentication");',
  "for (const attacker of [a, b]) {",
  "await lifecycle(v, attacker); }",
  '"real victim IDs exceed attacker IDs and 6"',
  '"victim unchanged across both complete attacker journeys"',
  'for (const suffix of ["process", "submit-review", "release"]) {',
  '"maker cannot be own payroll checker"',
  '"foreign checker cannot be assigned"',
  '"checker cannot release checked payroll"',
  '"release requires recent MFA"',
  '"settlement creates only own worker payslip"',
]) assert.ok(harness.includes(required), "missing harness step " + required);
assert.ok(harness.indexOf("assertMoneyProofTarget(process.env);") < harness.indexOf('import("../../src/db/index.ts")'),
  "the disposable-target guard must run before the database is imported");
for (const required of ["exact-links: ['false', 'true']", "MONEY_PROOF_TRANSPORT: http", "npx tsx scripts/qa/tenant-money-lifecycle-http.mjs", "image: postgres:16"]) {
  assert.ok(workflow.includes(required), "missing workflow step " + required);
}

const foreignDenialLine = cite("await deny(v, a.maker, `/api/payroll-runs/${v.run.id}/${suffix}`");
const unchangedDbLine = cite("assert.deepEqual(await snapshot(v), before, label");
const ownLines = {
  "POST payroll-runs/[id]/submit-review": cite('const submitted = status(await request(`/api/payroll-runs/${a.run.id}/submit-review`'),
  "POST payroll-runs/[id]/release": cite('const released = status(await request(`/api/payroll-runs/${a.run.id}/release`'),
};
const confirmLines = {
  "POST payroll-runs/[id]/submit-review": cite('"own review task and independent checker"'),
  "POST payroll-runs/[id]/release": cite('"SQL confirms own release"'),
};
const evidenceFalse = "https://github.com/erwinmehehe/payrollph/actions/runs/" + workflowRunId + "/job/" + jobFalse;
const evidenceTrue = "https://github.com/erwinmehehe/payrollph/actions/runs/" + workflowRunId + "/job/" + jobTrue;
const scopes = {
  "POST payroll-runs/[id]/submit-review": "Real HTTP on disposable PG16 against a production build (both exact-approval-link flag states), two independent attacker employers, seven fillers and a higher-ID victim. Each attacker calculates its own run, then submits it for review to its own independent checker (201; the forged victim organization, entity and employee in the body are ignored; the task and SQL name the own run, own employer and own checker). Refusals: submit-review on the real victim run (403, victim payroll/payout/approval/audit SQL unchanged, no victim marker), self as checker (409) and the victim employer's checker (422). Both attackers' journeys run; the victim is compared again after both.",
  "POST payroll-runs/[id]/release": "Real HTTP on disposable PG16 against a production build (both exact-approval-link flag states), two independent attacker employers, seven fillers and a higher-ID victim. Each attacker's own run, after an independent checker approved it, is released by a separate MFA-verified releaser (200; forged victim body selectors ignored; SQL confirms the own run is Released and exactly one payslip exists, for the own worker). Refusals: release on the real victim run (403, victim payroll/payout/approval/audit SQL unchanged, no victim marker), release by the checker (403) and release without recent MFA (403 MFA_REQUIRED, own financial state unchanged). No payout provider is configured or called.",
};
const oldCovered = manifest.metrics.coveredAfter, oldGap = manifest.metrics.gap;
const tick = String.fromCharCode(96);
const rows = overview.split("\n");
for (const key of KEYS) {
  const path = ROUTES[key];
  const api = manifest.allApiRouteFiles[path];
  assert.equal(api.gitBlobSha, sha(path), path + " changed without re-inventory");
  assert.equal(api.gitBlobSha, ROUTE_BLOBS[key], "the receipt was produced against this exact route");
  const method = api.methods.find((x) => x.name === "POST");
  assert.equal(method.status, "GAP", key + " is still GAP");
  assert.equal(method.testedBy, null, key + " has no proof yet");
  method.status = "COVERED";
  delete method.reviewedUncertified;
  method.testedBy = {
    file: HARNESS,
    line: ownLines[key],
    ownPositiveLine: ownLines[key],
    foreignDenialLine,
    forgedSelectorLine: foreignDenialLine,
    unchangedDbLine,
    ownConfirmationLine: confirmLines[key],
    twoAttackerLoopLine: cite("for (const attacker of [a, b]) {"),
    victimIdOrderingLine: cite('"real victim IDs exceed attacker IDs and 6"'),
    victimUnchangedAfterBothLine: cite('"victim unchanged across both complete attacker journeys"'),
    proofBlobSha: sha(HARNESS),
    workflowFile: WORKFLOW,
    workflowBlobSha: sha(WORKFLOW),
    routeBlobSha: sha(path),
    scope: scopes[key],
    evidence: evidenceFalse,
    secondEvidence: evidenceTrue,
    runLabel, postgresMajor: 16, workflowRunId, workflowJobIds: { exactLinksFalse: jobFalse, exactLinksTrue: jobTrue },
    verifiedHeadSha: headSha,
    independentSecurityReview: "PENDING", productionTested: false,
  };
  method.reason = "Provisional credit from the existing money-lifecycle real-HTTP PG16 journey (two attacker employers, real higher-ID victim) at " +
    evidenceFalse + " and " + evidenceTrue + ". Independent tenant-security review PENDING; no payout, production or global approval.";
  const route = key.slice("POST ".length);
  const prefix = "| [" + tick + route + tick + " POST]";
  const index = rows.findIndex((r) => r.startsWith(prefix));
  assert.ok(index >= 0, "overview row for " + key);
  assert.ok(rows[index].endsWith("| NO VALID METHOD PROOF | **GAP** |"), "overview row is still GAP for " + key);
  rows[index] = rows[index].replace("| NO VALID METHOD PROOF | **GAP** |",
    "| [money-lifecycle own success, two attackers](../../" + HARNESS + "#L" + ownLines[key] + ") ([exact-head run](" + evidenceFalse + ")) | **COVERED** |");
}
overview = rows.join("\n");
const methods = Object.values(manifest.allApiRouteFiles).flatMap((x) => x.methods);
const covered = methods.filter((x) => x.status === "COVERED").length;
const gap = methods.filter((x) => x.status === "GAP").length;
assert.equal(covered, oldCovered + 2);
assert.equal(gap, oldGap - 2);
manifest.metrics.coveredAfter = covered;
manifest.metrics.gap = gap;
manifest.acceptanceStatus = manifest.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/, "NOT ACCEPTED: " + gap + " API methods") +
  " POST payroll-runs/[id]/submit-review and POST payroll-runs/[id]/release have provisional credit from the money-lifecycle PG16 journey at " +
  evidenceFalse + " and " + evidenceTrue + " (every proof input byte-identical on the credit base). Independent security review PENDING. No payout or production activation.";
for (const [key, before, after] of [["coveredAfter", oldCovered, covered], ["gap", oldGap, gap]]) {
  const oldRow = "| " + key + " | " + before + " |";
  assert.equal(overview.split(oldRow).length, 2, "unique current " + key + " metric required");
  overview = overview.replace(oldRow, "| " + key + " | " + after + " |");
}
overview = overview.replace(/^> \*\*RELEASE BLOCKER:\*\* \d+ API methods/m, "> **RELEASE BLOCKER:** " + gap + " API methods")
  .replace(/^> \*\*NOT ACCEPTED\*\*: \d+ (?:API )?method gaps/m, "> **NOT ACCEPTED**: " + gap + " method gaps");
const heading = "# Tenant isolation — complete API and page coverage inventory (NOT ACCEPTED)\n";
assert.equal(overview.split(heading).length, 2, "one inventory heading required");
overview = overview.replace(heading, heading + "\n> **Payroll review/release provisional evidence:** " + covered + " COVERED / " + manifest.metrics.publicByDesign +
  " PUBLIC-BY-DESIGN / " + gap + " GAP. payroll-runs/[id]/submit-review POST and payroll-runs/[id]/release POST: money-lifecycle PG16 receipts ([exact-links off](" +
  evidenceFalse + "), [on](" + evidenceTrue + ")) from main head `" + headSha.slice(0, 9) +
  "`; routes, harness, workflow and shared inputs are byte-identical on the credit base. Independent security review **PENDING**. No payout or production authorization.\n");
if (argv.includes("--check")) {
  console.log(JSON.stringify({ result: "CHECK_ONLY", keys: KEYS, runLabel, covered, gap }));
} else {
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(OVERVIEW, overview);
  console.log(JSON.stringify({ result: "PROVISIONAL_CREDIT", keys: KEYS, runLabel, covered, gap, independentReview: "PENDING" }));
}
