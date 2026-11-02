#!/usr/bin/env node
/**
 * Restricted credit command for POST webhooks/paymongo/transfers under proofPolicy.providerCallback, executable only AFTER the
 * dedicated workflow (.github/workflows/tenant-webhook-paymongo-transfer-http.yml) passed on --head-sha. Not an evidence generator.
 * The proof PR was merged with a merge commit: that commit must be an ancestor of HEAD, name the proof PR number, have the passing
 * head as its second parent, and every proof input must be byte-identical between the passing head and HEAD.
 * Independent review stays PENDING.
 *
 *   node scripts/qa/tenant-webhook-paymongo-transfer-credit.mjs \
 *     --run-label "GitHub Actions <run>/<job> PG16 paymongo-transfer-webhook PASS" --workflow-run-id <run> --job-id <job> \
 *     --head-sha <40 hex> --merge-commit <sha> --proof-pr <number> [--check]
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const OVERVIEW = "docs/engineering/tenant-isolation-coverage-inventory.md";
const ROUTE = "src/app/api/webhooks/paymongo/transfers/route.ts";
const HARNESS = "scripts/qa/tenant-webhook-paymongo-transfer-http.mjs";
const CONTRACT = "scripts/qa/tenant-webhook-paymongo-transfer-contract.mjs";
const CONTRACT_TEST = "tests/tenant-webhook-paymongo-transfer.test.mjs";
const WORKFLOW = ".github/workflows/tenant-webhook-paymongo-transfer-http.yml";
// Every file the workflow executes or whose behavior it depends on.
const IDENTICAL_INPUTS = [ROUTE, HARNESS, CONTRACT, CONTRACT_TEST, WORKFLOW,
  "scripts/qa/tenant-table-http.mjs", "scripts/qa/tenant-table-env.mjs", "scripts/qa/apply-isolated-baseline.mjs",
  "scripts/qa/prepare-hcm-work-item-fixture.mjs", "src/lib/paymongo-transfer-webhook.ts"];
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
const squashCommit = arg("--merge-commit");
const proofPr = Number(arg("--proof-pr"));
assert.ok(Number.isSafeInteger(workflowRunId) && workflowRunId > 0);
assert.ok(Number.isSafeInteger(workflowJobId) && workflowJobId > 0);
assert.ok(Number.isSafeInteger(proofPr) && proofPr > 0);
assert.match(headSha, /^[a-f0-9]{40}$/);
assert.equal(runLabel, "GitHub Actions " + workflowRunId + "/" + workflowJobId + " PG16 paymongo-transfer-webhook PASS",
  "no unexecuted, stale or unverified run label");

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
git("cat-file", "-e", headSha + "^{commit}");
git("cat-file", "-e", squashCommit + "^{commit}");
execFileSync("git", ["merge-base", "--is-ancestor", squashCommit, "HEAD"]); // the merged proof is in this history
assert.ok(git("log", "-1", "--format=%s", squashCommit).startsWith("Merge pull request #" + proofPr + " "), "merge commit must be the proof PR merge");
assert.equal(git("rev-parse", squashCommit + "^2"), headSha, "the passing head must be the merged proof head");
execFileSync("git", ["merge-base", "--is-ancestor", headSha, "HEAD"]);
const blobAt = (rev, path) => git("rev-parse", rev + ":" + path);
for (const path of IDENTICAL_INPUTS) {
  assert.equal(blobAt("HEAD", path), blobAt(headSha, path), path + " changed since the passing run; re-run the workflow on the new source");
  assert.equal(blobAt(squashCommit, path), blobAt(headSha, path), path + " differs between the passing head and the merged proof");
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
assert.ok(rule && rule.creditedMethods === 1, "the provider callback rule must exist with exactly the xendit payout credit");

const lines = harness.split("\n");
const line = (fragment, expected = 1) => {
  const matches = lines.flatMap((text, i) => (text.includes(fragment) ? [i + 1] : []));
  assert.equal(matches.length, expected, "exact proof line count changed for " + fragment + " (" + matches.length + ")");
  return matches[0];
};
for (const required of [
  "requireDisposablePaymongoTransferWebhook();", "a real foreign run must not be distinguishable from a nonexistent run",
  "every cross-bound ignore must be byte-identical", "cross-bound run/transfer data must not be recorded",
  "concurrent duplicates must not double-write", "duplicate: true",
]) assert.ok(harness.includes(required), "missing " + required);
const crossBoundLine = line("const ignored = await send(payload);");
const unchangedDbLine = lines.findIndex((text, i) => i >= crossBoundLine && text.trim() === "await unchangedExcept(before);") + 1;
assert.ok(unchangedDbLine > crossBoundLine, "cross-bound unchanged-SQL anchor must follow the refusal loop");

const method = api.methods.find((x) => x.name === "POST");
assert.equal(api.methods.length, 1);
assert.equal(method.status, "GAP");
assert.equal(method.testedBy, null);
assert.equal(method.reviewedUncertified.kind, "paymongo-transfer-webhook-no-run-oracle-hardening-only-zero-credit");
const evidence = "https://github.com/erwinmehehe/payrollph/actions/runs/" + workflowRunId + "/job/" + workflowJobId;
const ownPositiveLine = line("const own = await send(ownEvent);");
const oldCovered = manifest.metrics.coveredAfter, oldGap = manifest.metrics.gap;
method.status = "COVERED";
method.testedBy = {
  file: HARNESS, testFile: CONTRACT_TEST, rule: "proofPolicy.providerCallback",
  proofBlobSha: sha(harness), contractBlobSha: sha(read(CONTRACT)), testBlobSha: sha(read(CONTRACT_TEST)),
  workflowFile: WORKFLOW, workflowBlobSha: sha(read(WORKFLOW)), routeBlobSha: sha(read(ROUTE)),
  methodActions: ["own_observation", "second_own_observation", "replay", "forged_selector", "concurrent_delivery", "foreign_transfer", "second_attacker_transfer", "unknown_run", "cross_bound_reference"],
  line: ownPositiveLine, ownPositiveLine,
  secondaryOwnPositiveLine: line("const forged = await send(eventBody(a, {"),
  foreignDenialLine: line("eventBody(a, { transferId: victim.payout.transferId }),"),
  secondaryForeignDenialLine: line("eventBody(b, { transferId: victim.payout.transferId }),"),
  unchangedDbLine,
  replayLine: line('result(await send(ownEvent), 200, { ok: true, duplicate: true }, "same signed event replay");'),
  concurrentDeliveryLine: line("const raced = await Promise.all("),
  crossBoundLine,
  unknownRunLine: line("const unknownRun = await send(eventBody(victim, { reference: nonexistentReference }));"),
  scope: "Real HTTP on disposable PG16 with a platform-wide signature secret, two attackers and a higher-ID victim: own signed events recorded once (one provider event and one audit row in the owning employer only), replay and concurrent delivery deduplicated, forged organization/entity/employee/run selectors ignored, foreign transfers on own, second-attacker and victim runs, a mismatched employee reference, a mismatched amount and an unknown run all answered with one byte-identical ignore body (no existence oracle), and every employer SQL state unchanged on refusal. Signature negatives are recorded but not counted.",
  evidence, runLabel, postgresMajor: 16, workflowRunId, workflowJobId, verifiedPrHeadSha: headSha,
  mergedProofCommit: squashCommit, proofPullRequest: proofPr,
  independentSecurityReview: "PENDING", productionTested: false,
};
method.reason = "Provisional method proof on disposable PG16 at " + evidence +
  ". Independent tenant-security review PENDING; no production or global approval.";
rule.creditedMethods = 2;
delete method.reviewedUncertified;
const methods = Object.values(manifest.allApiRouteFiles).flatMap((x) => x.methods);
const covered = methods.filter((x) => x.status === "COVERED").length;
const gap = methods.filter((x) => x.status === "GAP").length;
assert.equal(covered, oldCovered + 1);
assert.equal(gap, oldGap - 1);
manifest.metrics.coveredAfter = covered;
manifest.metrics.gap = gap;
manifest.acceptanceStatus = manifest.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/, "NOT ACCEPTED: " + gap + " API methods") +
  " webhooks/paymongo/transfers POST has one provisional PG16 proof under proofPolicy.providerCallback at " + evidence +
  " (every proof input byte-identical on the credit base). Independent security review PENDING. No production activation.";

const tick = String.fromCharCode(96);
const rows = overview.split("\n");
const prefix = "| [" + tick + "webhooks/paymongo/transfers" + tick + " POST]";
const index = rows.findIndex((r) => r.startsWith(prefix));
assert.ok(index >= 0, "overview row for paymongo-transfer webhook");
assert.ok(rows[index].endsWith("| NO VALID METHOD PROOF | **GAP** |"), "overview row is still GAP");
rows[index] = rows[index].replace("| NO VALID METHOD PROOF | **GAP** |",
  "| [paymongo-transfer webhook proof](../../" + HARNESS + "#L" + ownPositiveLine + ") ([exact-head run](" + evidence + ")) | **COVERED** |");
overview = rows.join("\n");
for (const [key, before, after] of [["coveredAfter", oldCovered, covered], ["gap", oldGap, gap]]) {
  const oldRow = "| " + key + " | " + before + " |";
  assert.equal(overview.split(oldRow).length, 2, "unique current " + key + " metric required");
  overview = overview.replace(oldRow, "| " + key + " | " + after + " |");
}
overview = overview.replace(/^> \*\*RELEASE BLOCKER:\*\* \d+ API methods/m, "> **RELEASE BLOCKER:** " + gap + " API methods")
  .replace(/^> \*\*NOT ACCEPTED\*\*: \d+ (?:API )?method gaps/m, "> **NOT ACCEPTED**: " + gap + " method gaps");
const heading = "# Tenant isolation — complete API and page coverage inventory (NOT ACCEPTED)\n";
assert.ok(overview.startsWith(heading));
overview = overview.replace(heading, heading + "\n> **PayMongo transfer webhook provisional evidence:** " + covered + " COVERED / " + manifest.metrics.publicByDesign +
  " PUBLIC-BY-DESIGN / " + gap + " GAP. webhooks/paymongo/transfers POST: [PG16 receipt](" + evidence + ") from head `" + headSha.slice(0, 9) +
  "`, merged as `" + squashCommit.slice(0, 9) + "`; route, harness, contract, test, workflow and shared inputs are byte-identical on the credit base. Independent security review **PENDING**. No production/payout authorization.\n");
if (argv.includes("--check")) {
  console.log(JSON.stringify({ result: "CHECK_ONLY", credited: ["webhooks/paymongo/transfers POST"], runLabel, covered, gap }));
} else {
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(OVERVIEW, overview);
  console.log(JSON.stringify({ result: "PROVISIONAL_CREDIT", credited: ["webhooks/paymongo/transfers POST"], runLabel, covered, gap, independentReview: "PENDING" }));
}
