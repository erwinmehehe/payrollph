#!/usr/bin/env node
/**
 * Restricted credit command for the three WRK-02 Batch 2 methods (POST workforce-planning/baselines, POST and PATCH
 * workforce-planning/position-executions), executable only AFTER the dedicated workflow
 * (.github/workflows/tenant-wrk02-batch2-http.yml) passed on --head-sha. This is not an evidence generator.
 * It refuses unless every proof input is byte-identical between that passing head and the current tree, so a credit
 * made after the proof PR merged still cites exactly the code that ran. Independent review stays PENDING.
 *
 *   node scripts/qa/tenant-wrk02-batch2-credit.mjs \
 *     --run-label "GitHub Actions <run>/<job> PG16 batch2 PASS" --workflow-run-id <run> --job-id <job> \
 *     --head-sha <40 hex> [--check]
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const OVERVIEW = "docs/engineering/tenant-isolation-coverage-inventory.md";
const BASELINES = "src/app/api/workforce-planning/baselines/route.ts";
const EXECUTIONS = "src/app/api/workforce-planning/position-executions/route.ts";
const HARNESS = "scripts/qa/tenant-wrk02-batch2-http.mjs";
const CONTRACT = "scripts/qa/tenant-wrk02-batch2-contract.mjs";
const JSONB = "scripts/qa/tenant-wrk02-batch2-jsonb-hash.mjs";
const WORKFLOW = ".github/workflows/tenant-wrk02-batch2-http.yml";
const KEYS = [[BASELINES, "POST"], [EXECUTIONS, "POST"], [EXECUTIONS, "PATCH"]];
// Everything the workflow executes or builds against. The guard test (tests/tenant-wrk02-batch2.test.mjs) is only syntax
// checked by the workflow, and it must change at credit time (it asserted GAP), so it is deliberately not in this list.
const IDENTICAL_INPUTS = [BASELINES, EXECUTIONS, HARNESS, CONTRACT, JSONB, WORKFLOW,
  "scripts/qa/tenant-table-env.mjs", "scripts/qa/apply-isolated-baseline.mjs", "scripts/qa/prepare-hcm-work-item-fixture.mjs",
  "src/lib/access.ts", "src/lib/auth.ts"];
const UNCHANGED_PATHS = ["src/db", "src/lib/workforce-plan*", "src/lib/workforce-position*"];

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
assert.equal(runLabel, "GitHub Actions " + workflowRunId + "/" + workflowJobId + " PG16 batch2 PASS",
  "no unexecuted, stale or unverified run label");

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
git("cat-file", "-e", headSha + "^{commit}");
execFileSync("git", ["merge-base", "--is-ancestor", headSha, "HEAD"]); // throws unless the passing head is in this history
const blobAt = (rev, path) => git("rev-parse", rev + ":" + path);
for (const path of IDENTICAL_INPUTS) {
  assert.equal(blobAt("HEAD", path), blobAt(headSha, path), path + " changed since the passing run; re-run the workflow on the new source");
}
assert.equal(git("diff", "--name-only", headSha, "HEAD", "--", ...UNCHANGED_PATHS), "",
  "a workflow input path changed since the passing run");

const read = (path) => readFileSync(path, "utf8");
const sha = (source) => {
  const bytes = Buffer.from(source);
  return createHash("sha1").update(Buffer.from("blob " + bytes.length + "\0")).update(bytes).digest("hex");
};
const harness = read(HARNESS);
const manifest = JSON.parse(read(MANIFEST));
let overview = read(OVERVIEW);
const lines = harness.split("\n");
const line = (fragment, expected = 1) => {
  const matches = lines.flatMap((text, i) => (text.includes(fragment) ? [i + 1] : []));
  assert.equal(matches.length, expected, "exact proof line count changed for " + fragment + " (" + matches.length + ")");
  return matches[0];
};
// The cited line is where the call starts: the nearest line at or above the labelled one that opens an HTTP assertion.
const anchor = (label) => {
  let at = line(label) - 1;
  while (at > 0 && !/actorResponse\(|denied\(/.test(lines[at - 1])) at--;
  assert.ok(at > 0, "no call opens above " + label);
  return at;
};
for (const required of [
  "requireDisposableWrk02Batch2(", "for (const actor of [a, b])", "assertPlanningUnchanged(victimBefore",
  '"foreign approved scenario"', '"cross-employer " + action + " on real victim execution"',
  '"Alpha own exact-hash apply"', '"owned execution cancel"', '"Owned persisted position execution preview"',
  "stale baseline v1 preview must fail before any position, payroll or audit write",
]) assert.ok(harness.includes(required), "missing " + required);

const common = {
  file: HARNESS,
  proofBlobSha: sha(harness),
  contractBlobSha: sha(read(CONTRACT)),
  workflowBlobSha: sha(read(WORKFLOW)),
  evidence: "https://github.com/erwinmehehe/payrollph/actions/runs/" + workflowRunId + "/job/" + workflowJobId,
  runLabel, postgresMajor: 16, workflowRunId, workflowJobId, verifiedPrHeadSha: headSha,
  independentSecurityReview: "PENDING", productionTested: false,
};
const specs = {
  [BASELINES + " POST"]: {
    methodActions: ["publish"],
    own: anchor('b, 201, "Beta owned baseline"'),
    foreign: anchor('404, "foreign approved scenario"'),
    forged: anchor('404, "unknown scenario"'),
    scope: "Real signed-in HTTP on disposable PG16 with two attacker employers and a higher-ID victim: owned approved scenarios publish once (a same-scenario race yields one 201 and one 409), version 2 publishes after a new approved scenario; a real foreign approved scenario and an unknown scenario both get the same 404 with no victim marker and unchanged SQL; invalid selector 400; anonymous 401.",
  },
  [EXECUTIONS + " POST"]: {
    methodActions: ["preview", "reopen"],
    own: anchor('actor, 201, "Owned persisted position execution preview"'),
    foreign: anchor('403, "direct victim employer execution preview"'),
    forged: anchor('404, "victim plan ID forged inside own organization"'),
    scope: "Real signed-in HTTP on disposable PG16: an owned preview is persisted with its execution hash and leaves live positions unchanged; direct victim employer 403 and a stolen victim plan under the own employer 404; an exact-hash preview is reopened; stale baseline previews fail 409 with no writes; revoked membership and unit-scoped or permission-overlay callers are denied.",
  },
  [EXECUTIONS + " PATCH"]: {
    methodActions: ["apply", "cancel"],
    own: anchor('actor, 200, "owned execution cancel"'),
    foreign: anchor('403, "cross-employer " + action + " on real victim execution"'),
    forged: anchor('404, "missing execution must never act on a victim"'),
    scope: "Real signed-in HTTP on disposable PG16: both actions (cancel and apply) are refused against a real higher-ID victim execution with unchanged victim SQL; own cancel ignores a forged organizationId/baselineId; own exact-hash apply updates a persisted planned position and a replay is refused; an apply of a stale version-1 preview is 409 with no writes; unsupported actions 400.",
  },
};
const oldCovered = manifest.metrics.coveredAfter, oldGap = manifest.metrics.gap;
const unchangedDbLine = line("assertPlanningUnchanged(victimBefore");
const credited = [];
for (const [path, name] of KEYS) {
  const api = manifest.allApiRouteFiles[path];
  assert.equal(api.gitBlobSha, sha(read(path)), path + " changed without re-inventory");
  assert.equal(api.methods.find((x) => x.name === "GET")?.status, "COVERED", "the separate GET proof is preserved");
  const method = api.methods.find((x) => x.name === name);
  assert.equal(method.status, "GAP");
  assert.equal(method.testedBy, null);
  const spec = specs[path + " " + name];
  method.status = "COVERED";
  method.testedBy = { ...common, line: spec.own, ownPositiveLine: spec.own, foreignDenialLine: spec.foreign, forgedSelectorLine: spec.forged,
    unchangedDbLine, methodActions: spec.methodActions, routeBlobSha: sha(read(path)), scope: spec.scope };
  method.reason = "Provisional method proof on disposable PG16 at " + common.evidence + ". Independent tenant-security review PENDING; no production or global approval.";
  delete method.reviewedUncertified;
  credited.push(path.split("/").slice(-2, -1)[0] + " " + name);
}
const methods = Object.values(manifest.allApiRouteFiles).flatMap((x) => x.methods);
const covered = methods.filter((x) => x.status === "COVERED").length;
const gap = methods.filter((x) => x.status === "GAP").length;
assert.equal(covered, oldCovered + 3);
assert.equal(gap, oldGap - 3);
manifest.metrics.coveredAfter = covered;
manifest.metrics.gap = gap;
manifest.acceptanceStatus = manifest.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/, "NOT ACCEPTED: " + gap + " API methods") +
  " WRK-02 Batch 2 (baselines POST, position-executions POST and PATCH) has one provisional PG16 proof at " + common.evidence +
  " (every proof input byte-identical on the credit base). Independent security review PENDING. No production activation.";

const tick = String.fromCharCode(96);
const rows = overview.split("\n");
for (const [path, name] of KEYS) {
  const route = path.replace("src/app/api/", "").replace("/route.ts", "");
  const prefix = "| [" + tick + route + tick + " " + name + "]";
  const index = rows.findIndex((r) => r.startsWith(prefix));
  assert.ok(index >= 0, "overview row for " + route + " " + name);
  assert.ok(rows[index].endsWith("| NO VALID METHOD PROOF | **GAP** |"), "overview row is still GAP: " + route + " " + name);
  const spec = specs[path + " " + name];
  rows[index] = rows[index].replace("| NO VALID METHOD PROOF | **GAP** |",
    "| [WRK-02 batch 2 " + name + " proof](../../" + HARNESS + "#L" + spec.own + ") ([exact-head run](" + common.evidence + ")) | **COVERED** |");
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
overview = overview.replace(heading, heading + "\n> **WRK-02 Batch 2 provisional evidence:** " + covered + " COVERED / " + manifest.metrics.publicByDesign +
  " PUBLIC-BY-DESIGN / " + gap + " GAP. Baselines POST and position-executions POST/PATCH: [PG16 receipt](" + common.evidence + ") from head `" + headSha.slice(0, 9) +
  "`; routes, harness, contract, workflow and shared inputs are byte-identical on the credit base. Independent security review **PENDING**. No production/payout authorization.\n");
if (argv.includes("--check")) {
  console.log(JSON.stringify({ result: "CHECK_ONLY", credited, runLabel, covered, gap }));
} else {
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(OVERVIEW, overview);
  console.log(JSON.stringify({ result: "PROVISIONAL_CREDIT", credited, runLabel, covered, gap, independentReview: "PENDING" }));
}
