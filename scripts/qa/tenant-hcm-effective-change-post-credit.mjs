#!/usr/bin/env node
/**
 * Restricted credit command for POST hcm/effective-changes, executable only AFTER the dedicated workflow
 * (.github/workflows/tenant-hcm-effective-change-post-http.yml) passed on --head-sha. This is not an evidence generator.
 * The proof PR was merged with a merge commit: that commit must be an ancestor of HEAD, name the proof PR number, have the passing
 * head as its second parent, and every proof input must be byte-identical between the passing head, the merge commit and HEAD.
 * Independent review stays PENDING.
 *
 *   node scripts/qa/tenant-hcm-effective-change-post-credit.mjs --only-key "POST hcm/effective-changes" \
 *     --run-label "GitHub Actions <run>/<job> PG16 hcm-effective-change-post PASS" --workflow-run-id <run> --job-id <job> \
 *     --head-sha <40 hex> --merge-commit <sha> --proof-pr <number> [--check]
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const KEY = "POST hcm/effective-changes";
const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const OVERVIEW = "docs/engineering/tenant-isolation-coverage-inventory.md";
const ROUTE = "src/app/api/hcm/effective-changes/route.ts";
const HARNESS = "scripts/qa/tenant-hcm-effective-change-post-http.mjs";
const CONTRACT = "scripts/qa/tenant-hcm-effective-change-post-contract.mjs";
const HELPER = "scripts/qa/tenant-table-rows/helpers/hcm-effective-change-actions.mjs";
const CONTRACT_TEST = "tests/tenant-hcm-effective-change-post.test.mjs";
const WORKFLOW = ".github/workflows/tenant-hcm-effective-change-post-http.yml";
// Every file the workflow executes or whose behavior it depends on.
const IDENTICAL_INPUTS = [ROUTE, HARNESS, CONTRACT, HELPER, CONTRACT_TEST, WORKFLOW,
  "scripts/qa/tenant-table-http.mjs", "scripts/qa/tenant-table-invariants.mjs", "scripts/qa/tenant-table-env.mjs",
  "scripts/qa/apply-isolated-baseline.mjs", "scripts/qa/prepare-hcm-work-item-fixture.mjs",
  "src/lib/hcm-business-process.ts", "src/lib/access.ts", "src/lib/auth.ts", "src/lib/audit.ts"];
const UNCHANGED_PATHS = ["src/db", "src/app/api/hcm/effective-changes"];

const argv = process.argv.slice(2);
const arg = (name) => {
  assert.equal(argv.filter((x) => x === name).length, 1, "one " + name + " required");
  const i = argv.indexOf(name);
  assert.ok(argv[i + 1] && !argv[i + 1].startsWith("--"), name + " needs a value");
  return argv[i + 1];
};
assert.equal(arg("--only-key"), KEY, "credit ONLY POST hcm/effective-changes");
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
assert.equal(runLabel, "GitHub Actions " + workflowRunId + "/" + workflowJobId + " PG16 hcm-effective-change-post PASS",
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
const helper = read(HELPER);
const manifest = JSON.parse(read(MANIFEST));
let overview = read(OVERVIEW);
const api = manifest.allApiRouteFiles[ROUTE];
assert.equal(api.gitBlobSha, sha(read(ROUTE)), "route changed without re-inventory");
assert.equal(api.gitBlobSha, "fb4bd6692a33a2130f0ec369fedc854334e718db", "the proof was written against this exact route");
const post = api.methods.find((x) => x.name === "POST");
assert.equal(post.status, "GAP");
assert.equal(post.testedBy, null);
assert.equal(api.methods.find((x) => x.name === "GET")?.status, "COVERED");
assert.equal(api.methods.find((x) => x.name === "PATCH")?.status, "COVERED");

const cite = (text, fragment, expected = 1) => {
  const lines = text.split("\n");
  const matches = lines.flatMap((entry, i) => (entry.includes(fragment) ? [i + 1] : []));
  assert.equal(matches.length, expected, "exact proof line count changed for " + fragment + " (" + matches.length + ")");
  return matches[0];
};
const harnessLine = (fragment, expected = 1) => cite(harness, fragment, expected);
const helperLine = (fragment, expected = 1) => cite(helper, fragment, expected);
for (const required of [
  "requireDisposableHcmEffectiveChangePost();", "allEmployerSnapshotsCompared", "assert.deepEqual(after[j], before[j]",
  "eight own pending changes per attacker", "eight own business processes per attacker", "victim.org.id > 6", "victim.worker.id > 6", "coverageCreditsAdded: 0",
]) assert.ok(harness.includes(required), "missing " + required);
assert.ok(harness.indexOf("requireDisposableHcmEffectiveChangePost();") < harness.indexOf('import("../../src/db/index.ts")'));
const ownDimensions = ["operating organization unit", "employment type", "employee status", "supervisory organization", "cost center", "manager", "legal employer", "position move"];
const refusals = ["victim organization", "victim operating organization unit", "victim supervisory organization", "victim cost center", "victim manager", "victim legal employer",
  "victim position", "victim employee under own organization id", "supervisory unit is not an operating unit", "an employee cannot be their own manager", "occupied position",
  "position that is not approved", "retroactive position move", "unsupported movement type", "position move may not override inherited dimensions"];
const ownLines = Object.fromEntries(ownDimensions.map((name) => [name, helperLine('await created("' + name + '"')]));
const refusalLines = Object.fromEntries(refusals.map((name) => [name, helperLine('"' + name + '");')]));

const evidence = "https://github.com/erwinmehehe/payrollph/actions/runs/" + workflowRunId + "/job/" + workflowJobId;
const ownPositiveLine = harnessLine("const proof = await actions.effectiveChangeActions(");
const testedBy = {
  file: HARNESS,
  helperFile: HELPER,
  testFile: CONTRACT_TEST,
  line: ownPositiveLine,
  ownPositiveLine,
  foreignDenialLine: harnessLine("assert.deepEqual(after[j], before[j]"),
  unchangedDbLine: harnessLine("assert.deepEqual(after[j], before[j]"),
  victimIdOrderingLine: harnessLine("victim.org.id > 6"),
  helperOwnLines: ownLines,
  helperRefusalLines: refusalLines,
  forgedSelectorLine: refusalLines["victim employee under own organization id"],
  secondaryForeignDenialLine: refusalLines["victim cost center"],
  methodActions: ["operating_org_unit", "employment_type", "status", "supervisory_org", "cost_center", "manager", "legal_employer", "position_move",
    "foreign_organization_denial", "foreign_reference_refusals", "own_rule_refusals"],
  proofBlobSha: sha(harness),
  helperBlobSha: sha(helper),
  contractBlobSha: sha(read(CONTRACT)),
  testBlobSha: sha(read(CONTRACT_TEST)),
  workflowFile: WORKFLOW,
  workflowBlobSha: sha(read(WORKFLOW)),
  routeBlobSha: sha(read(ROUTE)),
  scope: "Real HTTP on disposable PG16 against a production build, two independent attacker employers, six fillers and a higher-ID victim. Each attacker proves eight own pending effective changes (operating org unit, employment type, status, supervisory org, cost center, manager, own legal employer, position move), each writing exactly one change row, one business process and one audit receipt together with nothing applied, and 17 refusals: the victim organization (403) and the victim's worker, org unit, supervisory unit, cost center, manager, legal employer and position named from an own-employer request (400/404) plus the route's own-employer rules (occupied or unapproved position, retroactive move, unsupported movement, inherited-dimension override, self as manager, supervisory unit as operating unit). Every refusal leaks no victim marker and every employer's SQL state (changes, processes, workers, positions, assignments, units, cost centers, entities, audit) is compared before and after. Not proven: the multiEntity flag path (flag off, so a legal-employer move is accepted rather than routed to the transfer maker-checker) and the no-pay-profile worker.",
  evidence, runLabel, postgresMajor: 16, workflowRunId, workflowJobId, verifiedPrHeadSha: headSha,
  mergedProofCommit: mergeCommit, proofPullRequest: proofPr,
  independentSecurityReview: "PENDING", productionTested: false,
};
const oldCovered = manifest.metrics.coveredAfter, oldGap = manifest.metrics.gap;
post.status = "COVERED";
post.testedBy = testedBy;
post.reason = "Provisional dedicated method proof (eight own changes and 17 refusals per attacker) on disposable PG16 at " + evidence +
  ". Independent tenant-security review PENDING; no production or global approval.";
const methods = Object.values(manifest.allApiRouteFiles).flatMap((x) => x.methods);
const covered = methods.filter((x) => x.status === "COVERED").length;
const gap = methods.filter((x) => x.status === "GAP").length;
assert.equal(covered, oldCovered + 1);
assert.equal(gap, oldGap - 1);
manifest.metrics.coveredAfter = covered;
manifest.metrics.gap = gap;
manifest.acceptanceStatus = manifest.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/, "NOT ACCEPTED: " + gap + " API methods") +
  " POST hcm/effective-changes has one provisional dedicated PG16 proof at " + evidence +
  " (every proof input byte-identical on the credit base). Independent security review PENDING. No production activation.";

const tick = String.fromCharCode(96);
const prefix = "| [" + tick + "hcm/effective-changes" + tick + " POST]";
const rows = overview.split("\n");
const index = rows.findIndex((r) => r.startsWith(prefix));
assert.ok(index >= 0, "overview row for hcm/effective-changes POST");
assert.ok(rows[index].endsWith("| NO VALID METHOD PROOF | **GAP** |"), "overview row is still GAP");
rows[index] = rows[index].replace("| NO VALID METHOD PROOF | **GAP** |",
  "| [effective-change POST dedicated proof](../../" + HARNESS + "#L" + ownPositiveLine + ") ([exact-head run](" + evidence + ")) | **COVERED** |");
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
overview = overview.replace(heading, heading + "\n> **HCM effective-change POST provisional evidence:** " + covered + " COVERED / " + manifest.metrics.publicByDesign +
  " PUBLIC-BY-DESIGN / " + gap + " GAP. hcm/effective-changes POST: [PG16 receipt](" + evidence + ") from head `" + headSha.slice(0, 9) +
  "`, merged as `" + mergeCommit.slice(0, 9) + "`; route, harness, helper, contract, test, workflow and shared inputs are byte-identical on the credit base. Independent security review **PENDING**. No production authorization.\n");
if (argv.includes("--check")) {
  console.log(JSON.stringify({ result: "CHECK_ONLY", onlyKey: KEY, runLabel, covered, gap }));
} else {
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(OVERVIEW, overview);
  console.log(JSON.stringify({ result: "PROVISIONAL_CREDIT", onlyKey: KEY, runLabel, covered, gap, independentReview: "PENDING" }));
}
