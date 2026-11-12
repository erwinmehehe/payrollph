#!/usr/bin/env node
/**
 * Restricted credit command for POST payroll-runs/[id]/exports, executable only AFTER
 * .github/workflows/tenant-payroll-exports-post-http.yml passed its real-HTTP PostgreSQL 16 job on --head-sha, a commit in main's
 * history. This is not an evidence generator: it writes no proof, it only links an executed receipt.
 *
 * The proof scripts/qa/tenant-payroll-exports-post-http.mjs runs all three modes (preflight, disburse, complete-manual) against a
 * LOOPBACK-ONLY SYNTHETIC PayMongo server (sk_test_synthetic_no_network, 127.0.0.1:3012; no real provider is contacted and no real
 * money can move): two independent employers each get a 200 own preflight (provider reads only), a 200 own disbursement (exactly one
 * synthetic batch bound to the own run, worker, amount, account and idempotency key; replay refused) and a 200 own manual completion
 * bound to a real bank export and the employer's own accepted validation; an employer without its own validation cannot borrow
 * another's; and the real higher-ID victim's two released runs are refused 403 in all three modes for every attacker actor with the
 * victim's rows byte-identical and no refusal reaching the provider. The synthetic provider means this credit proves tenant
 * isolation of the route, never real PayMongo behavior or a real payout. The passing head must be an ancestor of HEAD and every
 * proof input must be byte-identical between it and HEAD. Independent review stays PENDING. Known finding not closed: a foreign
 * run answers 403 while a missing run answers 404.
 *
 *   node scripts/qa/tenant-exports-post-credit.mjs --only-key "POST payroll-runs/[id]/exports" \
 *     --run-label "GitHub Actions <run>/<job> PG16 payroll-exports-post PASS" --workflow-run-id <run> --job-id <job> \
 *     --head-sha <40 hex> [--check]
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const KEY = "POST payroll-runs/[id]/exports";
const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const OVERVIEW = "docs/engineering/tenant-isolation-coverage-inventory.md";
const ROUTE = "src/app/api/payroll-runs/[id]/exports/route.ts";
const ROUTE_BLOB = "6d4397c1ef98df82fa4917d6241b44e14b3ae96f";
const HARNESS = "scripts/qa/tenant-payroll-exports-post-http.mjs";
const WORKFLOW = ".github/workflows/tenant-payroll-exports-post-http.yml";
// Every file the workflow executes for this harness, plus the route and libraries the journeys depend on.
const IDENTICAL_INPUTS = [ROUTE, HARNESS, WORKFLOW, "scripts/qa/tenant-payroll-exports-post-contract.mjs", "tests/tenant-payroll-exports-post-contract.test.mjs",
  "scripts/qa/paymongo-http-proof-preload.mjs", "scripts/qa/paymongo-http-proof-target.mjs", "scripts/qa/money-proof-target.mjs",
  "tests/paymongo-http-proof-target.test.mjs", "tests/money-proof-target.test.mjs", "scripts/qa/apply-isolated-baseline.mjs",
  "src/lib/access.ts", "src/lib/auth.ts", "src/lib/multi-entity-run-guard.ts", "src/lib/security-request.ts", "src/lib/treasury-controls.ts",
  "src/lib/payroll-payout-provider.ts", "src/lib/audit.ts", "package.json", "package-lock.json"];
// Workflow path-filter inputs that must not have changed at all since the passing run.
const UNCHANGED_PATHS = ["src/db", "drizzle", "src/app/api/payroll-runs", "src/app/api/approvals", "src/app/api/payout-profiles",
  "src/app/api/payout-destination-changes", "src/app/api/treasury-controls", "src/app/api/webhooks/paymongo",
  "src/lib/payroll-*", "src/lib/approval-*", "src/lib/payout-*", "src/lib/bank-*", "src/lib/paymongo*", "src/lib/treasury-*",
  "src/lib/xendit-*", "src/lib/multi-entity-money.ts", "src/lib/stored-money-centavos.ts"];

const argv = process.argv.slice(2);
const arg = (name) => {
  assert.equal(argv.filter((x) => x === name).length, 1, "one " + name + " required");
  const i = argv.indexOf(name);
  assert.ok(argv[i + 1] && !argv[i + 1].startsWith("--"), name + " needs a value");
  return argv[i + 1];
};
assert.equal(arg("--only-key"), KEY, "credit ONLY POST payroll-runs/[id]/exports");
const runLabel = arg("--run-label");
const workflowRunId = Number(arg("--workflow-run-id"));
const workflowJobId = Number(arg("--job-id"));
const headSha = arg("--head-sha");
assert.ok(Number.isSafeInteger(workflowRunId) && workflowRunId > 0);
assert.ok(Number.isSafeInteger(workflowJobId) && workflowJobId > 0);
assert.match(headSha, /^[a-f0-9]{40}$/);
assert.equal(runLabel, "GitHub Actions " + workflowRunId + "/" + workflowJobId + " PG16 payroll-exports-post PASS",
  "no unexecuted, stale or unverified run label");

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
git("cat-file", "-e", headSha + "^{commit}");
execFileSync("git", ["merge-base", "--is-ancestor", headSha, "HEAD"]); // the passing source is in this history
// Read committed blobs through git (never working-tree line endings, which differ on Windows).
const blobAt = (rev, path) => git("rev-parse", rev + ":" + path);
for (const path of IDENTICAL_INPUTS) {
  assert.equal(blobAt("HEAD", path), blobAt(headSha, path), path + " changed since the passing run; re-run the workflow on the new source");
}
assert.equal(git("diff", "--name-only", headSha, "HEAD", "--", ...UNCHANGED_PATHS), "",
  "a workflow path-filter input changed since the passing run");

const read = (path) => readFileSync(path, "utf8");
const sha = (path) => blobAt("HEAD", path);
const harness = read(HARNESS);
const manifest = JSON.parse(read(MANIFEST));
let overview = read(OVERVIEW);
const api = manifest.allApiRouteFiles[ROUTE];
assert.equal(api.gitBlobSha, sha(ROUTE), "route changed without re-inventory");
assert.equal(api.gitBlobSha, ROUTE_BLOB, "the proof was written against this exact route");
const post = api.methods.find((x) => x.name === "POST");
assert.equal(post.status, "GAP");
assert.equal(post.testedBy, null);

const cite = (fragment, expected = 1) => {
  const matches = harness.split("\n").flatMap((entry, i) => (entry.includes(fragment) ? [i + 1] : []));
  assert.equal(matches.length, expected, "exact proof line count changed for " + fragment + " (" + matches.length + ")");
  return matches[0];
};
for (const required of [
  "assertPaymongoHttpProofTarget(process.env);", "sk_test_synthetic_no_network", 'provider.listen(3012, "127.0.0.1"',
  "a refusal must never contact the synthetic provider", "another employer's accepted bank validation must not be borrowed",
  "exactly one synthetic batch transfer is created", "a replay must not create a second batch transfer",
  "a manual completion never contacts the provider", "exactly two synthetic batch transfers in the whole proof",
  'for (let i = 0; i < 7; i++) await seed("PAD" + i);', "for (const actor of [attacker.owner, attacker.second, attacker.employeeUser])",
]) assert.ok(harness.includes(required), "missing " + required);

const ownPreflightLine = cite('e.label + " own preflight: "');
const ownDisbursementLine = cite('" own disbursement: "');
const ownManualLine = cite('" own manual completion: "');
const foreignDenialLine = cite('"foreign " + body.mode + " on the victim run"');
const forgedSelectorLine = cite("const forgedBody = { organizationId: v.org.id");
const unchangedDbLine = cite('"victim after both complete attacker journeys"');
const victimIdOrderingLine = cite("must be a real persisted row with an ID above both attackers and six");
const secondAttackerLine = cite("for (const e of [a, b]) {");
const borrowedValidationLine = cite("another employer's accepted bank validation must not be borrowed");
const loopbackProviderLine = cite('provider.listen(3012, "127.0.0.1"');

const evidence = "https://github.com/erwinmehehe/payrollph/actions/runs/" + workflowRunId + "/job/" + workflowJobId;
const testedBy = {
  file: HARNESS,
  line: ownDisbursementLine,
  ownPositiveLine: ownDisbursementLine,
  ownPreflightLine,
  ownManualCompletionLine: ownManualLine,
  foreignDenialLine,
  forgedSelectorLine,
  unchangedDbLine,
  victimIdOrderingLine,
  secondAttackerLine,
  borrowedValidationLine,
  loopbackProviderLine,
  methodActions: ["preflight", "disburse", "complete-manual"],
  proofBlobSha: sha(HARNESS),
  workflowFile: WORKFLOW,
  workflowBlobSha: sha(WORKFLOW),
  routeBlobSha: sha(ROUTE),
  providerMode: "loopback-synthetic-paymongo",
  scope: "Real HTTP on disposable PG16 against a production build, with PayMongo replaced by a loopback-only synthetic server (no real provider is contacted and no real money can move). Own successes in all three modes for two independent employers: preflight (provider reads only), disbursement (exactly one synthetic batch bound to the own run, worker, amount, account and idempotency key; replay refused) and manual completion (bound to a real bank export and the employer's own accepted validation). Refusals: every attacker actor on the real higher-ID victim's two released runs in all three modes (403), no refusal reaches the provider, victim rows byte-identical; an employer without its own accepted validation cannot borrow another's. Known finding not closed: foreign run 403 versus missing run 404.",
  evidence, runLabel, postgresMajor: 16, workflowRunId, workflowJobId, verifiedMainHeadSha: headSha,
  independentSecurityReview: "PENDING", productionTested: false, moneyMovedByLinaw: false,
};
const oldCovered = manifest.metrics.coveredAfter, oldGap = manifest.metrics.gap;
post.status = "COVERED";
post.testedBy = testedBy;
delete post.reviewedUncertified;
post.reason = "Provisional dedicated method proof (own preflight, disbursement and manual completion for two employers, all three modes refused on the real higher-ID victim runs, byte-identical victim, loopback-synthetic PayMongo only) on disposable PG16 at " + evidence +
  ". Independent tenant-security review PENDING; no real provider behavior, no production or global approval.";
const methods = Object.values(manifest.allApiRouteFiles).flatMap((x) => x.methods);
const covered = methods.filter((x) => x.status === "COVERED").length;
const gap = methods.filter((x) => x.status === "GAP").length;
assert.equal(covered, oldCovered + 1);
assert.equal(gap, oldGap - 1);
manifest.metrics.coveredAfter = covered;
manifest.metrics.gap = gap;
manifest.acceptanceStatus = manifest.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/, "NOT ACCEPTED: " + gap + " API methods") +
  " POST payroll-runs/[id]/exports has one provisional PG16 proof against a loopback-synthetic PayMongo at " + evidence +
  " (every proof input byte-identical on the credit base). Independent security review PENDING. No production activation.";

const tick = String.fromCharCode(96);
const prefix = "| [" + tick + "payroll-runs/[id]/exports" + tick + " POST]";
const rows = overview.split("\n");
const index = rows.findIndex((r) => r.startsWith(prefix));
assert.ok(index >= 0, "overview row for exports POST");
assert.ok(rows[index].endsWith("| NO VALID METHOD PROOF | **GAP** |"), "overview row is still GAP");
rows[index] = rows[index].replace("| NO VALID METHOD PROOF | **GAP** |",
  "| [exports loopback-synthetic proof](../../" + HARNESS + "#L" + ownDisbursementLine + ") ([exact-head run](" + evidence + ")) | **COVERED** |");
overview = rows.join("\n");
for (const [key, before, after] of [["coveredAfter", oldCovered, covered], ["gap", oldGap, gap]]) {
  const oldRow = "| " + key + " | " + before + " |";
  assert.equal(overview.split(oldRow).length, 2, "unique current " + key + " metric required");
  overview = overview.replace(oldRow, "| " + key + " | " + after + " |");
}
overview = overview.replace(/^> \*\*RELEASE BLOCKER:\*\* \d+ API methods/m, "> **RELEASE BLOCKER:** " + gap + " API methods")
  .replace(/^> \*\*NOT ACCEPTED\*\*: \d+ (?:API )?method gaps/m, "> **NOT ACCEPTED**: " + gap + " method gaps");
const heading = "# Tenant isolation — complete API and page coverage inventory (NOT ACCEPTED)\n";
assert.equal(overview.split(heading).length, 2, "one inventory heading required");
overview = overview.replace(heading, heading + "\n> **Payroll exports POST provisional evidence:** " + covered + " COVERED / " + manifest.metrics.publicByDesign +
  " PUBLIC-BY-DESIGN / " + gap + " GAP. exports POST: [PG16 receipt](" + evidence + ") from main head `" + headSha.slice(0, 9) +
  "`, against a loopback-synthetic PayMongo only (no real provider contacted); route, harness, workflow and shared inputs are byte-identical on the credit base. Independent security review **PENDING**. No production authorization.\n");
if (argv.includes("--check")) {
  console.log(JSON.stringify({ result: "CHECK_ONLY", onlyKey: KEY, runLabel, covered, gap }));
} else {
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(OVERVIEW, overview);
  console.log(JSON.stringify({ result: "PROVISIONAL_CREDIT", onlyKey: KEY, runLabel, covered, gap, independentReview: "PENDING" }));
}
