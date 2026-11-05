#!/usr/bin/env node
/**
 * Restricted credit command for POST webhooks/xendit/subscriptions under proofPolicy.providerCallback (including its bounded
 * documentedRetryRefusal exception), executable only AFTER the dedicated workflow (.github/workflows/tenant-webhook-xendit-subscriptions-http.yml) passed on --head-sha. Not an evidence generator.
 * The proof PR was merged with a merge commit: that commit must be an ancestor of HEAD, name the proof PR number, have the passing
 * head as its second parent, and every proof input must be byte-identical between the passing head and HEAD.
 * Independent review stays PENDING.
 *
 *   node scripts/qa/tenant-webhook-xendit-subscriptions-credit.mjs \
 *     --run-label "GitHub Actions <run>/<job> PG16 xendit-subscriptions-webhook PASS" --workflow-run-id <run> --job-id <job> \
 *     --head-sha <40 hex> --merge-commit <sha> --proof-pr <number> [--check]
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const OVERVIEW = "docs/engineering/tenant-isolation-coverage-inventory.md";
const ROUTE = "src/app/api/webhooks/xendit/subscriptions/route.ts";
const HARNESS = "scripts/qa/tenant-webhook-xendit-subscriptions-http.mjs";
const CONTRACT = "scripts/qa/tenant-webhook-xendit-subscriptions-contract.mjs";
const CONTRACT_TEST = "tests/tenant-webhook-xendit-subscriptions.test.mjs";
const WORKFLOW = ".github/workflows/tenant-webhook-xendit-subscriptions-http.yml";
// Every file the workflow executes or whose behavior it depends on.
const IDENTICAL_INPUTS = [ROUTE, HARNESS, CONTRACT, CONTRACT_TEST, WORKFLOW,
  "scripts/qa/tenant-table-http.mjs", "scripts/qa/tenant-table-env.mjs", "scripts/qa/apply-isolated-baseline.mjs",
  "scripts/qa/prepare-hcm-work-item-fixture.mjs", "src/lib/saas-billing-schema.ts", "src/lib/saas-pricing.ts", "src/lib/saas-launch-config.ts", "src/lib/security-secret.ts", "src/lib/audit.ts"];
const UNCHANGED_PATHS = ["src/db"];

const argv = process.argv.slice(2);
const arg = (name) => {
  assert.equal(argv.filter((x) => x === name).length, 1, "one " + name + " required");
  const i = argv.indexOf(name);
  assert.ok(argv[i + 1] && !argv[i + 1].startsWith("--"), name + " needs a value");
  return argv[i + 1];
};
const runLabel = arg("--run-label");
const workflowRunId = Number(arg("--workflow-run-id"));
const workflowJobId = Number(arg("--job-id"));
const headSha = arg("--head-sha");
const mergeCommit = arg("--merge-commit");
const proofPr = Number(arg("--proof-pr"));
assert.ok(Number.isSafeInteger(workflowRunId) && workflowRunId > 0);
assert.ok(Number.isSafeInteger(workflowJobId) && workflowJobId > 0);
assert.ok(Number.isSafeInteger(proofPr) && proofPr > 0);
assert.match(headSha, /^[a-f0-9]{40}$/);
assert.equal(runLabel, "GitHub Actions " + workflowRunId + "/" + workflowJobId + " PG16 xendit-subscriptions-webhook PASS",
  "no unexecuted, stale or unverified run label");

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
git("cat-file", "-e", headSha + "^{commit}");
git("cat-file", "-e", mergeCommit + "^{commit}");
execFileSync("git", ["merge-base", "--is-ancestor", mergeCommit, "HEAD"]); // the merged proof is in this history
assert.ok(git("log", "-1", "--format=%s", mergeCommit).startsWith("Merge pull request #" + proofPr + " "), "merge commit must be the proof PR merge");
assert.equal(git("rev-parse", mergeCommit + "^2"), headSha, "the passing head must be the merged proof head");
execFileSync("git", ["merge-base", "--is-ancestor", headSha, "HEAD"]);
const blobAt = (rev, path) => git("rev-parse", rev + ":" + path);
for (const path of IDENTICAL_INPUTS) {
  assert.equal(blobAt("HEAD", path), blobAt(headSha, path), path + " changed since the passing run; re-run the workflow on the new source");
  assert.equal(blobAt(mergeCommit, path), blobAt(headSha, path), path + " differs between the passing head and the merged proof");
}
assert.equal(git("diff", "--name-only", headSha, "HEAD", "--", ...UNCHANGED_PATHS), "",
  "a workflow path-filter input changed since the passing run");

const read = (path) => readFileSync(path, "utf8");
const sha = (source) => {
  const bytes = Buffer.from(source);
  return createHash("sha1").update(Buffer.from("blob " + bytes.length + "\0")).update(bytes).digest("hex");
};
const harness = read(HARNESS);
const manifest = JSON.parse(read(MANIFEST));
let overview = read(OVERVIEW);
const api = manifest.allApiRouteFiles[ROUTE];
assert.equal(api.gitBlobSha, sha(read(ROUTE)), "route changed without re-inventory");
const rule = manifest.proofPolicy.providerCallback;
assert.ok(rule && rule.creditedMethods === 3 && rule.documentedRetryRefusal?.appliesTo === "webhooks/xendit/subscriptions POST only.", "the provider callback rule must exist with the three prior credits and the bounded retry-refusal exception");

const lines = harness.split("\n");
const line = (fragment, expected = 1) => {
  const matches = lines.flatMap((text, i) => (text.includes(fragment) ? [i + 1] : []));
  assert.equal(matches.length, expected, "exact proof line count changed for " + fragment + " (" + matches.length + ")");
  return matches[0];
};
for (const required of [
  "requireDisposableXenditSubscriptionsWebhook();", "a real foreign pair must not be distinguishable from a nonexistent pair",
  "concurrent duplicates must not double-write", "assert.equal(refused.status, 503", "CI_ONLY_XENDIT_SUBSCRIPTION_AUDIT_REJECTED",
  "assertFictionalHighIdVictim(a, b, victim, fillers)", "counts.auditAtomicRollbacks++", "counts.auditRetryRecovered++",
]) assert.ok(harness.includes(required), "missing " + required);
const crossBoundLine = line("const refused = await send(payload);");
const unchangedDbLine = lines.findIndex((text, i) => i >= crossBoundLine && text.trim() === "await unchangedExcept(before);") + 1;
assert.ok(unchangedDbLine > crossBoundLine, "cross-bound unchanged-SQL anchor must follow the refusal loop");

const method = api.methods.find((x) => x.name === "POST");
assert.equal(api.methods.length, 1);
assert.equal(method.status, "GAP");
assert.equal(method.testedBy, null);
const priorReview = method.reviewedUncertified;
assert.equal(priorReview?.kind, "xendit-subscriptions-audit-atomicity-PG16-review-only", "the prior zero-credit review record must be what is superseded");
const evidence = "https://github.com/erwinmehehe/payrollph/actions/runs/" + workflowRunId + "/job/" + workflowJobId;
const ownPositiveLine = line('result(own, 200, { received: true, handled: true, status: "paid" }, "A own paid cycle");');
const oldCovered = manifest.metrics.coveredAfter, oldGap = manifest.metrics.gap;
method.status = "COVERED";
method.testedBy = {
  file: HARNESS, testFile: CONTRACT_TEST, rule: "proofPolicy.providerCallback", ruleException: "proofPolicy.providerCallback.documentedRetryRefusal",
  proofBlobSha: sha(harness), contractBlobSha: sha(read(CONTRACT)), testBlobSha: sha(read(CONTRACT_TEST)),
  workflowFile: WORKFLOW, workflowBlobSha: sha(read(WORKFLOW)), routeBlobSha: sha(read(ROUTE)),
  methodActions: ["own_paid_cycle", "second_own_paid_cycle", "replay", "concurrent_delivery", "forged_selectors", "stale_plan", "cross_bound_pair", "unknown_pair", "amount_currency_refusal", "audit_rollback_and_retry"],
  line: ownPositiveLine, ownPositiveLine,
  secondaryOwnPositiveLine: line('"B own paid cycle");'),
  forgedSelectorLine: line('"forged selectors ignored");'),
  foreignDenialLine: crossBoundLine,
  secondaryForeignDenialLine: line('"victim wrong amount");'),
  unchangedDbLine,
  replayLine: line('"same event replay");'),
  concurrentDeliveryLine: line("const raced = await Promise.all([send(simultaneous), send(simultaneous)]);"),
  crossBoundLine,
  unknownPairLine: line("const unknownPair = await send(eventBody(a, {"),
  stalePlanLine: line('"stale plan ignored");'),
  scope: "Real HTTP on disposable PG16 with synthetic CI-only callback token and merchant id (billing enabled, no provider key), two attackers, six fillers and a higher-ID victim: own paid cycles bind only through the stored checkout reference and plan and write exactly one billing event, state, subscription, invoice and matching audit row in the owning employer, replay and concurrent duplicates deduplicate exactly, forged organization/subscription/legal-entity selectors are ignored, a superseded plan cannot reactivate the newer plan, a rejected audit insert rolls the whole callback back and the retry succeeds once, and six cross-bound pairs naming real other-employer references or plans answer the same 503 body as an invented pair (counted only under the bounded documentedRetryRefusal exception) with every employer SQL state unchanged. Wrong amount, currency and missing cycle id are refused with no write. The callback token is platform-wide: a well-formed event for the victim's own checkout is processed as the provider reporting that victim only; this is recorded as providerAuthorityVictimOnly and is not credited as foreign refusal. Authentication negatives are recorded but not counted.",
  evidence, runLabel, postgresMajor: 16, workflowRunId, workflowJobId, verifiedPrHeadSha: headSha,
  mergedProofCommit: mergeCommit, proofPullRequest: proofPr,
  supersedesReview: priorReview,
  independentSecurityReview: "PENDING", productionTested: false,
};
delete method.reviewedUncertified;
method.reason = "Provisional method proof on disposable PG16 at " + evidence +
  ". Independent tenant-security review PENDING; no production or global approval.";
rule.creditedMethods = 4;
const methods = Object.values(manifest.allApiRouteFiles).flatMap((x) => x.methods);
const covered = methods.filter((x) => x.status === "COVERED").length;
const gap = methods.filter((x) => x.status === "GAP").length;
assert.equal(covered, oldCovered + 1);
assert.equal(gap, oldGap - 1);
manifest.metrics.coveredAfter = covered;
manifest.metrics.gap = gap;
manifest.acceptanceStatus = manifest.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/, "NOT ACCEPTED: " + gap + " API methods") +
  " webhooks/xendit/subscriptions POST has one provisional PG16 proof under proofPolicy.providerCallback (counting its documented retry refusal only under that bounded exception) at " + evidence +
  " (every proof input byte-identical on the credit base). Independent security review PENDING. No production activation.";

const tick = String.fromCharCode(96);
const rows = overview.split("\n");
const prefix = "| [" + tick + "webhooks/xendit/subscriptions" + tick + " POST]";
const index = rows.findIndex((r) => r.startsWith(prefix));
assert.ok(index >= 0, "overview row for xendit subscriptions webhook");
assert.ok(rows[index].endsWith("| NO VALID METHOD PROOF | **GAP** |"), "overview row is still GAP");
rows[index] = rows[index].replace("| NO VALID METHOD PROOF | **GAP** |",
  "| [xendit subscriptions webhook proof](../../" + HARNESS + "#L" + ownPositiveLine + ") ([exact-head run](" + evidence + ")) | **COVERED** |");
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
overview = overview.replace(heading, heading + "\n> **Xendit subscriptions webhook provisional evidence:** " + covered + " COVERED / " + manifest.metrics.publicByDesign +
  " PUBLIC-BY-DESIGN / " + gap + " GAP. webhooks/xendit/subscriptions POST: [PG16 receipt](" + evidence + ") from head `" + headSha.slice(0, 9) +
  "`, merged as `" + mergeCommit.slice(0, 9) + "`; route, harness, contract, test, workflow, billing libs and shared inputs are byte-identical on the credit base. Independent security review **PENDING**. No production/provider authorization.\n");
if (argv.includes("--check")) {
  console.log(JSON.stringify({ result: "CHECK_ONLY", credited: ["webhooks/xendit/subscriptions POST"], runLabel, covered, gap }));
} else {
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(OVERVIEW, overview);
  console.log(JSON.stringify({ result: "PROVISIONAL_CREDIT", credited: ["webhooks/xendit/subscriptions POST"], runLabel, covered, gap, independentReview: "PENDING" }));
}
