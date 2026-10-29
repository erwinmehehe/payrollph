#!/usr/bin/env node
/**
 * Restricted source-only credit command, executable only AFTER actual
 * exact-head PG16 HTTP proof passes. This is not an evidence generator.
 * Use --only-key "POST workforce/roster-batches", an honest --run-label,
 * --workflow-run-id, --job-id, and --head-sha. Independent review stays PENDING.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const KEY = "POST workforce/roster-batches";
const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const OVERVIEW = "docs/engineering/tenant-isolation-coverage-inventory.md";
const ROUTE = "src/app/api/workforce/roster-batches/route.ts";
const ACTIONS = "scripts/qa/tenant-batches/roster-batches-actions-http.mjs";
const LEGACY = "scripts/qa/tenant-batches/roster-batches-http.mjs";
const argv = process.argv.slice(2);
const arg = name => {
  assert.equal(argv.filter(x => x === name).length, 1, "one " + name + " required");
  const i = argv.indexOf(name);
  assert.ok(argv[i + 1] && !argv[i + 1].startsWith("--"), name + " needs a value");
  return argv[i + 1];
};
assert.equal(arg("--only-key"), KEY, "credit ONLY full roster POST");
const runLabel = arg("--run-label");
const workflowRunId = Number(arg("--workflow-run-id"));
const workflowJobId = Number(arg("--job-id"));
const headSha = arg("--head-sha");
assert.ok(Number.isSafeInteger(workflowRunId) && workflowRunId > 0);
assert.ok(Number.isSafeInteger(workflowJobId) && workflowJobId > 0);
assert.match(headSha, /^[a-f0-9]{40}$/);
assert.equal(runLabel, "GitHub Actions " + workflowRunId + "/" + workflowJobId +
  " PG16 all actions PASS", "no unexecuted, stale or unverified run label");
assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  headSha, "the exact source head must match the reviewed passing job");

const read = path => readFileSync(path, "utf8");
const sha = source => {
  const bytes = Buffer.from(source);
  return createHash("sha1").update(Buffer.from("blob " + bytes.length + "\0"))
    .update(bytes).digest("hex");
};
const actionSource = read(ACTIONS), legacySource = read(LEGACY);
const manifest = JSON.parse(read(MANIFEST));
let overview = read(OVERVIEW);
const api = manifest.allApiRouteFiles[ROUTE];
assert.equal(api.gitBlobSha, sha(read(ROUTE)), "route changed without review");
const post = api.methods.find(x => x.name === "POST");
assert.equal(post.status, "GAP");
assert.equal(post.testedBy, null);
assert.equal(api.methods.find(x => x.name === "GET")?.status, "COVERED");

const line = (source, fragment) => {
  const matches = source.split("\n").flatMap((text, i) =>
    text.includes(fragment) ? [i + 1] : []);
  assert.equal(matches.length, 1, "one unambiguous proof line required for " + fragment);
  return matches[0];
};
const testedBy = {
  file: ACTIONS,
  line: line(actionSource, "const response = check(await post(e, stageBody(e)), 201"),
  ownPositiveLine: line(actionSource, "const response = check(await post(e, stageBody(e)), 201"),
  replayLine: line(actionSource, "const replay = check(await post(e, stageBody(e)), 200"),
  approveLine: line(actionSource, 'const result = check(await post(e, decideBody("approve", e.orgId,'),
  foreignDenialLine: line(actionSource, "organizationId: victim.orgId, employeeIds: [victim.workerId]"),
  forgedSelectorLine: line(actionSource, "victim.stageBatchId, actor.decisionNote), 404"),
  unchangedDbLine: line(actionSource, "assert.deepEqual(await snapshot(e.orgId), expected.get(e.orgId)"),
  legacyRejectLine: line(legacySource, "const victimReject = await reject(victim, victim.orgId, victim.batchId)"),
  legacyProofFile: LEGACY,
  proofBlobSha: sha(actionSource),
  legacyProofBlobSha: sha(legacySource),
  evidence: "https://github.com/erwinmehehe/payrollph/actions/runs/" +
    workflowRunId + "/job/" + workflowJobId,
  scope: "Two independent attackers, higher-ID victim, own stage 201 SQL/audit, replay 200, second-checker approve 200 override/audit, old own reject 200 and unchanged three-employer SQL after all denials.",
  runLabel, postgresMajor: 16, workflowRunId, workflowJobId,
  verifiedPrHeadSha: headSha, independentSecurityReview: "PENDING",
  productionTested: false,
};
for (const required of [
  'assert.equal(receipt.action, "WFM bulk roster batch staged")',
  'assert.equal(receipt.action, "WFM governed bulk roster published")',
  'assert.equal(replay.json?.replayed, true)',
  'assert.deepEqual(await snapshot(e.orgId), expected.get(e.orgId)',
]) assert.ok(actionSource.includes(required), "missing " + required);
assert.ok(legacySource.includes("assertRejectedRosterMutation(oldVictim,"));
const oldCovered = manifest.metrics.coveredAfter, oldGap = manifest.metrics.gap;
post.status = "COVERED";
post.testedBy = testedBy;
post.reason = "Provisional full stage/replay/approve/reject method proof on disposable PG16 at " +
  testedBy.evidence + ". Independent tenant-security review PENDING; no production or global approval.";
const methods = Object.values(manifest.allApiRouteFiles).flatMap(x => x.methods);
const covered = methods.filter(x => x.status === "COVERED").length;
const gap = methods.filter(x => x.status === "GAP").length;
assert.equal(covered, oldCovered + 1);
assert.equal(gap, oldGap - 1);
manifest.metrics.coveredAfter = covered;
manifest.metrics.gap = gap;
manifest.acceptanceStatus = manifest.acceptanceStatus.replace(
  /^NOT ACCEPTED: \d+ API methods/, "NOT ACCEPTED: " + gap + " API methods") +
  " Roster POST has one provisional complete stage/replay/approve/reject PG16 proof at " +
  testedBy.evidence + ". Independent security review PENDING. No production activation.";

const tick = String.fromCharCode(96);
const prefix = "| [" + tick + "workforce/roster-batches" + tick + " POST]";
const rows = overview.split("\n");
const index = rows.findIndex(r => r.startsWith(prefix));
assert.ok(index >= 0);
assert.ok(rows[index].endsWith("| NO VALID METHOD PROOF | **GAP** |"));
rows[index] = rows[index].replace("| NO VALID METHOD PROOF | **GAP** |",
  "| [three-employer full POST proof](../../" + ACTIONS + "#L" +
  testedBy.ownPositiveLine + ") ([exact-head run](" + testedBy.evidence +
  ")) | **COVERED** |");
overview = rows.join("\n");
for (const [key, before, after] of [
  ["coveredAfter", oldCovered, covered], ["gap", oldGap, gap],
]) {
  const oldRow = "| " + key + " | " + before + " |";
  assert.equal(overview.split(oldRow).length, 2, "unique current " + key + " metric required");
  overview = overview.replace(oldRow, "| " + key + " | " + after + " |");
}
overview = overview.replace(/^> \*\*RELEASE BLOCKER:\*\* \d+ API methods/m,
  "> **RELEASE BLOCKER:** " + gap + " API methods");
overview = overview.replace(/^> \*\*NOT ACCEPTED\*\*: \d+ method gaps/m,
  "> **NOT ACCEPTED**: " + gap + " method gaps");
const heading = "# Tenant isolation — complete API and page coverage inventory (NOT ACCEPTED)\n";
assert.ok(overview.startsWith(heading));
overview = overview.replace(heading, heading + "\n> **Roster POST provisional evidence:** " +
  covered + " COVERED / " + manifest.metrics.publicByDesign + " PUBLIC-BY-DESIGN / " +
  gap + " GAP. Stage/replay/approve/reject: [PG16 receipt](" + testedBy.evidence +
  "). Independent security review **PENDING**. No production/payout authorization.\n");
if (argv.includes("--check")) {
  console.log(JSON.stringify({ result: "CHECK_ONLY", onlyKey: KEY, runLabel, covered, gap }));
} else {
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(OVERVIEW, overview);
  console.log(JSON.stringify({ result: "PROVISIONAL_CREDIT", onlyKey: KEY, runLabel,
    covered, gap, independentReview: "PENDING" }));
}
