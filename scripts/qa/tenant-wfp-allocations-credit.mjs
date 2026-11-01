#!/usr/bin/env node
/**
 * Restricted credit command for POST and PATCH workforce-planning/allocations, executable only AFTER the dedicated
 * workflow (.github/workflows/tenant-wfp-allocations-http.yml) passed on --head-sha. This is not an evidence generator.
 * It refuses unless every proof input is byte-identical between that passing head and the current tree, so a credit
 * made after the proof PR merged still cites exactly the code that ran. Independent review stays PENDING.
 *
 *   node scripts/qa/tenant-wfp-allocations-credit.mjs \
 *     --run-label "GitHub Actions <run>/<job> PG16 allocations PASS" --workflow-run-id <run> --job-id <job> \
 *     --head-sha <40 hex> [--check]
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const OVERVIEW = "docs/engineering/tenant-isolation-coverage-inventory.md";
const ROUTE = "src/app/api/workforce-planning/allocations/route.ts";
const HARNESS = "scripts/qa/tenant-wfp-allocations-http.mjs";
const CONTRACT = "scripts/qa/tenant-wfp-allocations-contract.mjs";
const CONTRACT_TEST = "tests/tenant-wfp-allocations-contract.test.mjs";
const WORKFLOW = ".github/workflows/tenant-wfp-allocations-http.yml";
// Every file the workflow executes or whose behavior it depends on (its path filter, minus the QA note).
const IDENTICAL_INPUTS = [ROUTE, HARNESS, CONTRACT, CONTRACT_TEST, WORKFLOW,
  "scripts/qa/tenant-table-http.mjs", "scripts/qa/tenant-table-invariants.mjs", "scripts/qa/tenant-table-env.mjs",
  "scripts/qa/apply-isolated-baseline.mjs", "src/lib/access.ts", "src/lib/auth.ts",
  "src/lib/enterprise-advanced-plan-policy.ts", "src/lib/security-request.ts"];
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
assert.ok(Number.isSafeInteger(workflowRunId) && workflowRunId > 0);
assert.ok(Number.isSafeInteger(workflowJobId) && workflowJobId > 0);
assert.match(headSha, /^[a-f0-9]{40}$/);
assert.equal(runLabel, "GitHub Actions " + workflowRunId + "/" + workflowJobId + " PG16 allocations PASS",
  "no unexecuted, stale or unverified run label");

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
git("cat-file", "-e", headSha + "^{commit}");
execFileSync("git", ["merge-base", "--is-ancestor", headSha, "HEAD"]); // throws unless the passing head is in this history
const blobAt = (rev, path) => git("rev-parse", rev + ":" + path);
for (const path of IDENTICAL_INPUTS) {
  assert.equal(blobAt("HEAD", path), blobAt(headSha, path), path + " changed since the passing run; re-run the workflow on the new source");
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
assert.equal(api.methods.find((x) => x.name === "GET")?.status, "COVERED", "the separate GET proof is preserved");

const lines = harness.split("\n");
const line = (fragment, expected = 1) => {
  const matches = lines.flatMap((text, i) => (text.includes(fragment) ? [i + 1] : []));
  assert.equal(matches.length, expected, "exact proof line count changed for " + fragment + " (" + matches.length + ")");
  return matches[0];
};
for (const required of [
  "requireDisposablePlanningEnv();", "const [a, b, victim] = employers;", "for (const actor of [a, b])",
  "assertNoStateChange(expected.get(e.orgId)", 'for (const action of ["submit", "accept", "reject"])',
  "assertDecisionTransition(beforeSubmit, afterSubmit", "assertDecisionTransition(beforeDecide, afterDecide",
  "cannot shrink below accepted manager demand", "sum of org-unit budgets cannot exceed plan budget", '" version race"',
  "foreignPatches: 8, nonadminPatches: 2, makerDecisionDenials: 3", "productionCertified: false, wholeMethodAccepted: false, newCredits: 0",
]) assert.ok(harness.includes(required), "missing " + required);

const common = {
  file: HARNESS,
  testFile: CONTRACT_TEST,
  proofBlobSha: sha(harness),
  contractBlobSha: sha(read(CONTRACT)),
  testBlobSha: sha(read(CONTRACT_TEST)),
  workflowFile: WORKFLOW,
  workflowBlobSha: sha(read(WORKFLOW)),
  routeBlobSha: sha(read(ROUTE)),
  higherIdVictimLine: line("assert.ok(victim[key] > attacker[key]"),
  evidence: "https://github.com/erwinmehehe/payrollph/actions/runs/" + workflowRunId + "/job/" + workflowJobId,
  runLabel, postgresMajor: 16, workflowRunId, workflowJobId, verifiedPrHeadSha: headSha,
  independentSecurityReview: "PENDING", productionTested: false,
};
const unchangedLines = lines.flatMap((text, i) => (text.includes("assertNoStateChange(expected.get(e.orgId), await snapshot(e.orgId),") ? [i + 1] : []));
const specs = {
  POST: {
    methodActions: ["allocation_create", "allocation_update", "manager_draft_create"],
    ownPositiveLine: line("const createAllocation = await post(actor, allocationBody(actor));"),
    secondaryOwnPositiveLine: line("const createDraft = await post(actor, submissionBody(actor, allocationId));"),
    foreignDenialLine: line("deny(await post(actor, allocationBody(actor, victim.orgId,"),
    secondaryForeignDenialLine: line("deny(await post(actor, submissionBody(actor,", 2),
    unchangedDbLine: unchangedLines[0],
    scope: "Real signed-in HTTP on disposable PG16 with two attacker employers and a higher-ID victim: owned allocation create, existing-allocation update (ID and creator preserved, one audit), owned manager draft; update below an accepted manager demand, cross-employer plan/unit/allocation references and plan-budget overspend refused; same-allocation draft race and joint-budget race each give one winner and one 409; foreign owner/draft creation 403, non-admin 403; all other employers byte-identical.",
  },
  PATCH: {
    methodActions: ["submit", "accept", "reject"],
    ownPositiveLine: line('const submitted = await patch(actor, actor.draftId, "submit");'),
    secondaryOwnPositiveLine: line("const decision = await patch(actor, actor.draftId, action, { checker: true });"),
    foreignDenialLine: line("deny(await patch(actor, victim.draftId, action, { orgId: actor.orgId }),"),
    secondaryForeignDenialLine: line('deny(await patch(actor, victim.draftId, "accept",'),
    unchangedDbLine: unchangedLines[1],
    scope: "Real signed-in HTTP on disposable PG16: each attacker's submit, accept and reject against the victim's real higher-ID manager submission (also with a forged organizationId, and with a separate checker identity) is refused 403 with no victim marker and unchanged SQL; own submit, independent-checker accept and reject each persist exactly one actor-bound audit; the maker cannot accept their own request (409); concurrent submits and concurrent accept/reject give one winner and one 409; non-admin employees are denied.",
  },
};
assert.equal(unchangedLines.length, 2, "two unchanged-state anchors expected");
const oldCovered = manifest.metrics.coveredAfter, oldGap = manifest.metrics.gap;
const credited = [];
for (const name of ["POST", "PATCH"]) {
  const method = api.methods.find((x) => x.name === name);
  assert.equal(method.status, "GAP");
  assert.equal(method.testedBy, null);
  assert.equal(method.reviewedUncertified?.kind, "wrk02-partial-allocation-and-manager-decision-tenant-hardening");
  const spec = specs[name];
  method.status = "COVERED";
  method.testedBy = { ...common, line: spec.ownPositiveLine, ...spec };
  method.reason = "Provisional method proof on disposable PG16 at " + common.evidence +
    ". Independent tenant-security review PENDING; no production or global approval.";
  delete method.reviewedUncertified;
  credited.push("allocations " + name);
}
const methods = Object.values(manifest.allApiRouteFiles).flatMap((x) => x.methods);
const covered = methods.filter((x) => x.status === "COVERED").length;
const gap = methods.filter((x) => x.status === "GAP").length;
assert.equal(covered, oldCovered + 2);
assert.equal(gap, oldGap - 2);
manifest.metrics.coveredAfter = covered;
manifest.metrics.gap = gap;
manifest.acceptanceStatus = manifest.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/, "NOT ACCEPTED: " + gap + " API methods") +
  " workforce-planning/allocations POST and PATCH have one provisional PG16 proof at " + common.evidence +
  " (every proof input byte-identical on the credit base). Independent security review PENDING. No production activation.";

const tick = String.fromCharCode(96);
const rows = overview.split("\n");
for (const name of ["POST", "PATCH"]) {
  const prefix = "| [" + tick + "workforce-planning/allocations" + tick + " " + name + "]";
  const index = rows.findIndex((r) => r.startsWith(prefix));
  assert.ok(index >= 0, "overview row for allocations " + name);
  assert.ok(rows[index].endsWith("| NO VALID METHOD PROOF | **GAP** |"), "overview row is still GAP: " + name);
  rows[index] = rows[index].replace("| NO VALID METHOD PROOF | **GAP** |",
    "| [allocations " + name + " proof](../../" + HARNESS + "#L" + specs[name].ownPositiveLine + ") ([exact-head run](" + common.evidence + ")) | **COVERED** |");
}
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
overview = overview.replace(heading, heading + "\n> **Allocations provisional evidence:** " + covered + " COVERED / " + manifest.metrics.publicByDesign +
  " PUBLIC-BY-DESIGN / " + gap + " GAP. Allocations POST and PATCH: [PG16 receipt](" + common.evidence + ") from head `" + headSha.slice(0, 9) +
  "`; route, harness, contract, test, workflow and shared inputs are byte-identical on the credit base. Independent security review **PENDING**. No production/payout authorization.\n");
if (argv.includes("--check")) {
  console.log(JSON.stringify({ result: "CHECK_ONLY", credited, runLabel, covered, gap }));
} else {
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(OVERVIEW, overview);
  console.log(JSON.stringify({ result: "PROVISIONAL_CREDIT", credited, runLabel, covered, gap, independentReview: "PENDING" }));
}
