#!/usr/bin/env node
/**
 * Restricted credit command for POST workforce/worksites, executable only AFTER the dedicated all-action workflow
 * (.github/workflows/tenant-worksites-actions-http.yml) passed on --head-sha. This is not an evidence generator.
 * It refuses unless every proof input is byte-identical between that passing head and the current tree, so a credit
 * made after the proof PR merged still cites exactly the code that ran. Independent review stays PENDING.
 *
 *   node scripts/qa/tenant-worksites-credit.mjs --only-key "POST workforce/worksites" \
 *     --run-label "GitHub Actions <run>/<job> PG16 all actions PASS" --workflow-run-id <run> --job-id <job> \
 *     --head-sha <40 hex> [--check]
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const KEY = "POST workforce/worksites";
const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const OVERVIEW = "docs/engineering/tenant-isolation-coverage-inventory.md";
const ROUTE = "src/app/api/workforce/worksites/route.ts";
const HARNESS = "scripts/qa/tenant-worksites-actions-http.mjs";
const CONTRACT = "scripts/qa/tenant-worksites-actions-contract.mjs";
const CONTRACT_TEST = "tests/tenant-worksites-actions-contract.test.mjs";
const WORKFLOW = ".github/workflows/tenant-worksites-actions-http.yml";
const ENV_FILE = "scripts/qa/tenant-table-env.mjs";
// Every file the workflow executes or whose behavior it depends on. All must be byte-identical to the passing head.
const IDENTICAL_INPUTS = [ROUTE, HARNESS, CONTRACT, CONTRACT_TEST, WORKFLOW,
  "scripts/qa/tenant-table-allowlist-bootstrap.mjs", "scripts/qa/tenant-table-http.mjs", "scripts/qa/tenant-table-invariants.mjs",
  "scripts/qa/apply-isolated-baseline.mjs", "src/lib/workforce-geofence.ts", "src/lib/workforce-punch-evidence.ts",
  "src/lib/access.ts", "src/lib/auth.ts"];
// Path-filter globs of the workflow that must not have changed at all since the passing head.
const UNCHANGED_PATHS = ["src/db", "src/lib/workforce-worksite-eligibility.ts", "src/lib/hcm-timesheet*"];

const argv = process.argv.slice(2);
const arg = (name) => {
  assert.equal(argv.filter((x) => x === name).length, 1, "one " + name + " required");
  const i = argv.indexOf(name);
  assert.ok(argv[i + 1] && !argv[i + 1].startsWith("--"), name + " needs a value");
  return argv[i + 1];
};
assert.equal(arg("--only-key"), KEY, "credit ONLY POST workforce/worksites");
const runLabel = arg("--run-label");
const workflowRunId = Number(arg("--workflow-run-id"));
const workflowJobId = Number(arg("--job-id"));
const headSha = arg("--head-sha");
assert.ok(Number.isSafeInteger(workflowRunId) && workflowRunId > 0);
assert.ok(Number.isSafeInteger(workflowJobId) && workflowJobId > 0);
assert.match(headSha, /^[a-f0-9]{40}$/);
assert.equal(runLabel, "GitHub Actions " + workflowRunId + "/" + workflowJobId + " PG16 all actions PASS",
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
// The shared profile file may legitimately gain flags for other profiles; the profile this workflow uses must not move.
const loadEnv = async (rev) => {
  const dir = mkdtempSync(join(tmpdir(), "worksites-credit-env-"));
  const file = join(dir, "env.mjs");
  writeFileSync(file, git("show", rev + ":" + ENV_FILE));
  return import(pathToFileURL(file).href);
};
const [passed, current] = [await loadEnv(headSha), await loadEnv("HEAD")];
assert.deepEqual(current.TENANT_TABLE_PROFILES["allowlisted-reads"], passed.TENANT_TABLE_PROFILES["allowlisted-reads"],
  "the allowlisted-reads profile used by the workflow changed since the passing run");
assert.deepEqual(current.TENANT_TABLE_BASE_ENV, passed.TENANT_TABLE_BASE_ENV, "the shared base environment changed since the passing run");

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
const post = api.methods.find((x) => x.name === "POST");
assert.equal(post.status, "GAP");
assert.equal(post.testedBy, null);
assert.equal(api.methods.find((x) => x.name === "GET")?.status, "COVERED");

const lines = harness.split("\n");
const line = (fragment, expected = 1) => {
  const matches = lines.flatMap((text, i) => (text.includes(fragment) ? [i + 1] : []));
  assert.equal(matches.length, expected, "exact proof line count changed for " + fragment);
  return matches[0];
};
const ACTIONS = ["create_worksite", "update_worksite", "assign_employee", "set_arrangement", "authorize_site", "deny_site",
  "end_authorization", "configure_punch_photo", "configure_geofence", "disable_geofence"];
const ownLabel = { update_worksite: "own update_worksite rename" };
const actionOwnLines = Object.fromEntries(ACTIONS.map((action) => [action, line('"' + (ownLabel[action] ?? "own " + action) + '"')]));
for (const required of [
  'assertImmutableWorksiteSql(before.get(other.org.id)', "for (const actor of attackers)", "victim.seedAuthorization.id",
  'receipt(actor, r.before, r.after, "Worksite created")', 'receipt(actor, r.before, r.after, "Worksite geofence disabled")',
  '"non-allowlisted employer " + action',
]) assert.ok(harness.includes(required), "missing " + required);
const testedBy = {
  file: HARNESS,
  line: actionOwnLines.create_worksite,
  ownPositiveLine: actionOwnLines.create_worksite,
  foreignDenialLine: line('await refused(actor, createBody(victim.org.id, "FOREIGN-"'),
  forgedSelectorLine: line('await refused(actor, assignBody(actor.org.id, victim.worker.id, actor.site1.id)'),
  unchangedDbLine: line("for (const e of subjects) assertImmutableWorksiteSql(before.get(e.org.id)"),
  victimIdOrderingLine: line("assert.ok(victim.org.id > Math.max("),
  methodActions: ACTIONS,
  actionOwnLines,
  proofBlobSha: sha(harness),
  contractBlobSha: sha(read(CONTRACT)),
  workflowBlobSha: sha(read(WORKFLOW)),
  routeBlobSha: sha(read(ROUTE)),
  evidence: "https://github.com/erwinmehehe/payrollph/actions/runs/" + workflowRunId + "/job/" + workflowJobId,
  scope: "Two independent attacker employers, a higher-ID victim and a non-allowlisted employer. Every one of the ten POST actions is proven by an own write read back from PostgreSQL with an exact actor-bound audit receipt; forged victim worker, site, org unit and authorization ids and the victim employer are refused; the pilot-gated actions return 404 for the non-allowlisted employer; every other employer's worksite, assignment, authorization, arrangement, policy, geofence, employee and audit rows are byte-identical after every refusal and success.",
  runLabel, postgresMajor: 16, workflowRunId, workflowJobId, verifiedPrHeadSha: headSha,
  independentSecurityReview: "PENDING", productionTested: false,
};
const oldCovered = manifest.metrics.coveredAfter, oldGap = manifest.metrics.gap;
post.status = "COVERED";
post.testedBy = testedBy;
post.reason = "Provisional all-action method proof (ten actions) on disposable PG16 at " + testedBy.evidence +
  ". Independent tenant-security review PENDING; no production or global approval.";
const methods = Object.values(manifest.allApiRouteFiles).flatMap((x) => x.methods);
const covered = methods.filter((x) => x.status === "COVERED").length;
const gap = methods.filter((x) => x.status === "GAP").length;
assert.equal(covered, oldCovered + 1);
assert.equal(gap, oldGap - 1);
manifest.metrics.coveredAfter = covered;
manifest.metrics.gap = gap;
manifest.acceptanceStatus = manifest.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/, "NOT ACCEPTED: " + gap + " API methods") +
  " POST workforce/worksites has one provisional complete ten-action PG16 proof at " + testedBy.evidence +
  " (every proof input byte-identical on the credit base). Independent security review PENDING. No production activation.";

const tick = String.fromCharCode(96);
const prefix = "| [" + tick + "workforce/worksites" + tick + " POST]";
const rows = overview.split("\n");
const index = rows.findIndex((r) => r.startsWith(prefix));
assert.ok(index >= 0, "overview row for worksites POST");
assert.ok(rows[index].endsWith("| NO VALID METHOD PROOF | **GAP** |"), "overview row is still GAP");
rows[index] = rows[index].replace("| NO VALID METHOD PROOF | **GAP** |",
  "| [ten-action worksites POST proof](../../" + HARNESS + "#L" + testedBy.ownPositiveLine + ") ([exact-head run](" + testedBy.evidence + ")) | **COVERED** |");
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
overview = overview.replace(heading, heading + "\n> **Worksites POST provisional evidence:** " + covered + " COVERED / " + manifest.metrics.publicByDesign +
  " PUBLIC-BY-DESIGN / " + gap + " GAP. All ten actions: [PG16 receipt](" + testedBy.evidence + ") from head `" + headSha.slice(0, 9) +
  "`; the route, harness, contract, workflow and every shared input are byte-identical on the credit base. Independent security review **PENDING**. No production/payout authorization.\n");
if (argv.includes("--check")) {
  console.log(JSON.stringify({ result: "CHECK_ONLY", onlyKey: KEY, runLabel, covered, gap }));
} else {
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(OVERVIEW, overview);
  console.log(JSON.stringify({ result: "PROVISIONAL_CREDIT", onlyKey: KEY, runLabel, covered, gap, independentReview: "PENDING" }));
}
