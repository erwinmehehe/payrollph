#!/usr/bin/env node
/**
 * Restricted credit command for POST webhooks/resend under proofPolicy.providerCallback, executable only AFTER the
 * dedicated workflow (.github/workflows/tenant-webhook-resend-http.yml) passed on --head-sha. Not an evidence generator.
 * The proof PR was merged with a merge commit: that commit must be an ancestor of HEAD, name the proof PR number, have the passing
 * head as its second parent, and every proof input must be byte-identical between the passing head and HEAD.
 * Independent review stays PENDING.
 *
 *   node scripts/qa/tenant-webhook-resend-credit.mjs \
 *     --run-label "GitHub Actions <run>/<job> PG16 resend-webhook PASS" --workflow-run-id <run> --job-id <job> \
 *     --head-sha <40 hex> --merge-commit <sha> --proof-pr <number> [--check]
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const OVERVIEW = "docs/engineering/tenant-isolation-coverage-inventory.md";
const ROUTE = "src/app/api/webhooks/resend/route.ts";
const HARNESS = "scripts/qa/tenant-webhook-resend-http.mjs";
const CONTRACT = "scripts/qa/tenant-webhook-resend-contract.mjs";
const CONTRACT_TEST = "tests/tenant-webhook-resend.test.mjs";
const WORKFLOW = ".github/workflows/tenant-webhook-resend-http.yml";
// Every file the workflow executes or whose behavior it depends on.
const IDENTICAL_INPUTS = [ROUTE, HARNESS, CONTRACT, CONTRACT_TEST, WORKFLOW,
  "scripts/qa/tenant-table-http.mjs", "scripts/qa/tenant-table-env.mjs", "scripts/qa/apply-isolated-baseline.mjs",
  "scripts/qa/prepare-hcm-work-item-fixture.mjs", "src/lib/resend-webhook.ts", "src/lib/mailer.ts", "src/lib/audit.ts"];
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
assert.equal(runLabel, "GitHub Actions " + workflowRunId + "/" + workflowJobId + " PG16 resend-webhook PASS",
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
assert.ok(rule && rule.creditedMethods === 2, "the provider callback rule must exist with exactly the xendit payout and paymongo credits");

const lines = harness.split("\n");
const line = (fragment, expected = 1) => {
  const matches = lines.flatMap((text, i) => (text.includes(fragment) ? [i + 1] : []));
  assert.equal(matches.length, expected, "exact proof line count changed for " + fragment + " (" + matches.length + ")");
  return matches[0];
};
for (const required of [
  "requireDisposableResendWebhook();", "a real foreign row must not be distinguishable from a nonexistent row",
  "a signed event must not plant a provider message id on an unsent row", "an old replay must not rewrite delivery state",
  "concurrent duplicates must not double-write", "a callback never creates or removes outbox rows",
  "A rejected receipt insert must fail the complete callback so the provider retries", "duplicate: true",
  "persisted timestamp must match the signed provider event",
]) assert.ok(harness.includes(required), "missing " + required);
const crossBoundLine = line("const refused = await send(eventBody(outboxId, providerMessage));");
const unchangedDbLine = lines.findIndex((text, i) => i >= crossBoundLine && text.trim() === "after = await unchangedExcept(before, beforeGlobal);") + 1;
assert.ok(unchangedDbLine > crossBoundLine, "cross-bound unchanged-SQL anchor must follow the refusal loop");

const method = api.methods.find((x) => x.name === "POST");
assert.equal(api.methods.length, 1);
assert.equal(method.status, "GAP");
assert.equal(method.testedBy, null);
const evidence = "https://github.com/erwinmehehe/payrollph/actions/runs/" + workflowRunId + "/job/" + workflowJobId;
const ownPositiveLine = line('result(own, 200, { ok: true, matched: true, duplicate: false, outboxId: a.mail.sent.id }, "A own delivery");');
const oldCovered = manifest.metrics.coveredAfter, oldGap = manifest.metrics.gap;
method.status = "COVERED";
method.testedBy = {
  file: HARNESS, testFile: CONTRACT_TEST, rule: "proofPolicy.providerCallback",
  proofBlobSha: sha(harness), contractBlobSha: sha(read(CONTRACT)), testBlobSha: sha(read(CONTRACT_TEST)),
  workflowFile: WORKFLOW, workflowBlobSha: sha(read(WORKFLOW)), routeBlobSha: sha(read(ROUTE)),
  methodActions: ["own_delivery", "second_own_delivery", "replay", "old_replay_after_520_receipts", "concurrent_delivery", "foreign_row", "planted_message_id", "unknown_row", "cross_bound_reference", "receipt_rollback"],
  line: ownPositiveLine, ownPositiveLine,
  secondaryOwnPositiveLine: line('"B own bounce");'),
  forgedSelectorLine: line('"old replay after 520 unrelated receipts");'),
  foreignDenialLine: crossBoundLine,
  secondaryForeignDenialLine: line('["B message id on the victim row", victim.mail.sent.id, b.mail.sent.providerMessageId],'),
  unchangedDbLine,
  replayLine: line('"same event replay");'),
  concurrentDeliveryLine: line("const raced = await Promise.all("),
  crossBoundLine,
  unknownRunLine: line("const missingRow = await send(eventBody(2_000_000_000"),
  scope: "Real HTTP on disposable PG16 with a platform-wide Svix signing secret, two attackers, six fillers and a higher-ID victim: own signed deliveries update only the named outbox row (status, detail and provider timestamp) and write one exact receipt in the owning employer only, replay (including after 520 unrelated receipts and with a different signed body) and 8 concurrent deliveries deduplicate exactly, a rejected receipt insert rolls the delivery back and the retry succeeds once, and real foreign rows, a row sent by another provider, a planted or empty message id on an unsent row and a nonexistent row all answer one byte-identical ignore body (no existence oracle) with every employer SQL state unchanged. Signature and payload negatives are recorded but not counted. A system email with no organization has no duplicate protection; that is stated, not credited.",
  evidence, runLabel, postgresMajor: 16, workflowRunId, workflowJobId, verifiedPrHeadSha: headSha,
  mergedProofCommit: mergeCommit, proofPullRequest: proofPr,
  independentSecurityReview: "PENDING", productionTested: false,
};
method.reason = "Provisional method proof on disposable PG16 at " + evidence +
  ". Independent tenant-security review PENDING; no production or global approval.";
rule.creditedMethods = 3;
const methods = Object.values(manifest.allApiRouteFiles).flatMap((x) => x.methods);
const covered = methods.filter((x) => x.status === "COVERED").length;
const gap = methods.filter((x) => x.status === "GAP").length;
assert.equal(covered, oldCovered + 1);
assert.equal(gap, oldGap - 1);
manifest.metrics.coveredAfter = covered;
manifest.metrics.gap = gap;
manifest.acceptanceStatus = manifest.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/, "NOT ACCEPTED: " + gap + " API methods") +
  " webhooks/resend POST has one provisional PG16 proof under proofPolicy.providerCallback at " + evidence +
  " (every proof input byte-identical on the credit base). Independent security review PENDING. No production activation.";

const tick = String.fromCharCode(96);
const rows = overview.split("\n");
const prefix = "| [" + tick + "webhooks/resend" + tick + " POST]";
const index = rows.findIndex((r) => r.startsWith(prefix));
assert.ok(index >= 0, "overview row for resend webhook");
assert.ok(rows[index].endsWith("| NO VALID METHOD PROOF | **GAP** |"), "overview row is still GAP");
rows[index] = rows[index].replace("| NO VALID METHOD PROOF | **GAP** |",
  "| [resend webhook proof](../../" + HARNESS + "#L" + ownPositiveLine + ") ([exact-head run](" + evidence + ")) | **COVERED** |");
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
overview = overview.replace(heading, heading + "\n> **Resend delivery webhook provisional evidence:** " + covered + " COVERED / " + manifest.metrics.publicByDesign +
  " PUBLIC-BY-DESIGN / " + gap + " GAP. webhooks/resend POST: [PG16 receipt](" + evidence + ") from head `" + headSha.slice(0, 9) +
  "`, merged as `" + mergeCommit.slice(0, 9) + "`; route, harness, contract, test, workflow, mailer and shared inputs are byte-identical on the credit base. Independent security review **PENDING**. No production/provider authorization.\n");
if (argv.includes("--check")) {
  console.log(JSON.stringify({ result: "CHECK_ONLY", credited: ["webhooks/resend POST"], runLabel, covered, gap }));
} else {
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(OVERVIEW, overview);
  console.log(JSON.stringify({ result: "PROVISIONAL_CREDIT", credited: ["webhooks/resend POST"], runLabel, covered, gap, independentReview: "PENDING" }));
}
