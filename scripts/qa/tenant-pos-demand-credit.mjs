#!/usr/bin/env node
/**
 * Restricted credit command for exactly four methods, executable only AFTER the dedicated workflow
 * (.github/workflows/tenant-pos-demand-http.yml) passed on --head-sha:
 *   GET/POST workforce/demand-observations/loyverse   and   GET/POST workforce/demand-observations/square-sandbox
 * The provider is a test-only exact-host preload that blocks every other outbound fetch: no merchant, API or provider is contacted.
 * Not an evidence generator. The proof PR was merged with a merge commit: that commit must be an ancestor of HEAD, name the proof PR
 * number and have the passing head as its second parent; every proof input must be byte-identical between the passing head, the merge
 * commit and HEAD. Independent review stays PENDING.
 *
 *   node scripts/qa/tenant-pos-demand-credit.mjs --run-label "GitHub Actions <run>/<job> PG16 pos-demand-four-methods PASS" \
 *     --workflow-run-id <run> --job-id <job> --head-sha <40 hex> --merge-commit <sha> --proof-pr <number> [--check]
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const OVERVIEW = "docs/engineering/tenant-isolation-coverage-inventory.md";
const LOYVERSE = "src/app/api/workforce/demand-observations/loyverse/route.ts";
const SQUARE = "src/app/api/workforce/demand-observations/square-sandbox/route.ts";
const HARNESS = "scripts/qa/tenant-pos-demand-http.mjs";
const CONTRACT = "scripts/qa/tenant-pos-demand-contract.mjs";
const MOCK = "scripts/qa/tenant-pos-demand-provider-mock.cjs";
const CONTRACT_TEST = "tests/tenant-pos-demand-contract.test.mjs";
const WORKFLOW = ".github/workflows/tenant-pos-demand-http.yml";
const TARGETS = [
  { route: LOYVERSE, method: "GET", short: "workforce/demand-observations/loyverse", provider: "loyverse", blob: "84125e11d3b6558922ceec600c2ccb8f0a778afb" },
  { route: LOYVERSE, method: "POST", short: "workforce/demand-observations/loyverse", provider: "loyverse", blob: "84125e11d3b6558922ceec600c2ccb8f0a778afb" },
  { route: SQUARE, method: "GET", short: "workforce/demand-observations/square-sandbox", provider: "square-sandbox", blob: "de84727241fdd90dcaf2f7138bdd54f751ec2f95" },
  { route: SQUARE, method: "POST", short: "workforce/demand-observations/square-sandbox", provider: "square-sandbox", blob: "de84727241fdd90dcaf2f7138bdd54f751ec2f95" },
];
// Every file the workflow executes or whose behavior it depends on.
const IDENTICAL_INPUTS = [LOYVERSE, SQUARE, HARNESS, CONTRACT, MOCK, CONTRACT_TEST, WORKFLOW, "next.config.ts",
  "src/lib/workforce-loyverse-pos.ts", "src/lib/workforce-square-sandbox.ts",
  "src/lib/workforce-operational-demand-forecast.ts", "src/lib/workforce-operational-demand-import.ts",
  "src/lib/workforce-operational-demand-scope.ts", "src/lib/workforce-operational-demand-server.ts",
  "scripts/qa/tenant-table-http.mjs", "scripts/qa/tenant-table-env.mjs", "scripts/qa/apply-isolated-baseline.mjs"];
const UNCHANGED_PATHS = ["src/db", "src/app/api/workforce/demand-observations/loyverse", "src/app/api/workforce/demand-observations/square-sandbox"];

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
assert.equal(runLabel, "GitHub Actions " + workflowRunId + "/" + workflowJobId + " PG16 pos-demand-four-methods PASS",
  "no unexecuted, stale or unverified run label");

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
git("cat-file", "-e", headSha + "^{commit}");
git("cat-file", "-e", mergeCommit + "^{commit}");
execFileSync("git", ["merge-base", "--is-ancestor", mergeCommit, "HEAD"]);
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
const sha = (path) => blobAt("HEAD", path);
const harness = read(HARNESS);
const mock = read(MOCK);
const manifest = JSON.parse(read(MANIFEST));
let overview = read(OVERVIEW);
for (const required of ["requireDisposablePosDemand();", "assertCompletePosDemandCounts(counts);", "newManifestCredits: 0", "forbiddenRealProviderCalls: true",
  "for (const actor of [a, b, victim])", "genuinely signed-in fictional employer owner session"]) assert.ok(harness.includes(required), "missing " + required);
for (const required of ["POS_MOCK_BLOCKED_EXTERNAL_NETWORK", "api.loyverse.com"]) assert.ok(mock.includes(required), "provider mock lacks " + required);
const cite = (fragment, expected = 1) => {
  const matches = harness.split("\n").flatMap((entry, i) => (entry.includes(fragment) ? [i + 1] : []));
  assert.equal(matches.length, expected, "exact proof line count changed for " + fragment + " (" + matches.length + ")");
  return matches[0];
};
const lines = {
  ownGetLine: cite("assertOwnGet(own, actor, provider, actor.site);"),
  ownDryRunLine: cite("assertOwnPost(dry, provider, true);"),
  ownPostLine: cite("assertOwnPost(stored, provider, false);"),
  foreignGetDenialLine: cite('provider + " real high-ID victim GET"'),
  foreignPostDenialLine: cite('provider + " real high-ID victim POST"'),
  stolenWorksiteGetLine: cite('provider + " stolen victim worksite GET"'),
  stolenWorksitePostLine: cite('provider + " stolen victim worksite POST"'),
  anonymousGetLine: cite('provider + " anonymous GET"'),
  anonymousPostLine: cite('provider + " anonymous POST"'),
  dryRunWritesNothingLine: cite('provider + " dry-run must write nothing"'),
  unchangedDbLine: cite('await unchanged(beforeWrite, provider + " successful POST", actor.org.id);'),
  victimIdOrderingLine: cite("assert.ok(victim.org.id > Math.max(a.org.id, b.org.id));"),
  twoAttackersLine: cite("for (const actor of [a, b, victim]) {"),
};

const evidence = "https://github.com/erwinmehehe/payrollph/actions/runs/" + workflowRunId + "/job/" + workflowJobId;
const common = {
  file: HARNESS, testFile: CONTRACT_TEST, contractFile: CONTRACT, mockFile: MOCK, ...lines,
  proofBlobSha: sha(HARNESS), contractBlobSha: sha(CONTRACT), mockBlobSha: sha(MOCK), testBlobSha: sha(CONTRACT_TEST),
  workflowFile: WORKFLOW, workflowBlobSha: sha(WORKFLOW),
  evidence, runLabel, postgresMajor: 16, workflowRunId, workflowJobId, verifiedPrHeadSha: headSha,
  mergedProofCommit: mergeCommit, proofPullRequest: proofPr,
  providerMode: "test-only-exact-host-preload", externalProviderCalled: false, moneyMovedByLinaw: false,
  independentSecurityReview: "PENDING", productionTested: false,
};
const scopeFor = (t) => (t.method === "GET"
  ? "Real HTTP on disposable PG16 against a production-mode Next server restarted once per fictional employer (two independent attacker employers A and B and a genuinely higher-ID victim, plus an unrelated disabled employer), each with its own synthetic one-employer " + t.provider + " binding. Each employer's own GET answers 200 with its own populated SQL import batch, its own employer, worksite and source, a following read reflects its own persisted batch, no other employer's marker appears, and the read writes nothing. The same GET aimed at the real higher-ID victim employer, at the victim's stolen worksite and at the unrelated disabled employer is refused 403, anonymous is 401 and an invalid interval is 400, each leaving the complete four-employer snapshot byte-identical. Provider traffic is a test-only exact-host preload that blocks every other outbound fetch; no real merchant is contacted. Not proven: live merchant consent or source completeness."
  : "Real HTTP on disposable PG16 against a production-mode Next server restarted once per fictional employer (two independent attacker employers A and B and a genuinely higher-ID victim, plus an unrelated disabled employer), each with its own synthetic one-employer " + t.provider + " binding. Each employer's own dry-run POST returns synthetic aggregate data and writes nothing; its own applied POST persists exactly 24 interval revisions and one import batch for its own employer, worksite and source, with the source and audit actors checked, and may change only its own aggregate source and audit rows. The same POST aimed at the real higher-ID victim employer, at the victim's stolen worksite and at the unrelated disabled employer is refused 403, anonymous is 401 and an unknown source selector is 400, each leaving the complete four-employer snapshot byte-identical. Provider traffic is a test-only exact-host preload that blocks every other outbound fetch; no real merchant is contacted. Not proven: live merchant consent, provider failure handling, or MFA branches beyond those the harness exercises.");

const oldCovered = manifest.metrics.coveredAfter, oldGap = manifest.metrics.gap;
for (const t of TARGETS) {
  const api = manifest.allApiRouteFiles[t.route];
  assert.equal(api.gitBlobSha, sha(t.route), t.route + " changed without re-inventory");
  assert.equal(api.gitBlobSha, t.blob, "the proof was written against this exact route");
  const m = api.methods.find((x) => x.name === t.method);
  assert.ok(m, "method " + t.method);
  assert.equal(m.status, "GAP");
  assert.equal(m.testedBy, null);
  m.status = "COVERED";
  const own = t.method === "GET" ? lines.ownGetLine : lines.ownPostLine;
  m.testedBy = {
    ...common, routeBlobSha: sha(t.route), line: own, ownPositiveLine: own,
    foreignDenialLine: t.method === "GET" ? lines.foreignGetDenialLine : lines.foreignPostDenialLine,
    methodActions: t.method === "GET"
      ? ["own_get_populated_batch", "foreign_victim_403", "stolen_worksite_403", "excluded_employer_403", "anonymous_401", "invalid_interval_400", "snapshots_byte_identical"]
      : ["own_dry_run_writes_nothing", "own_applied_post_24_intervals_one_batch", "foreign_victim_403", "stolen_worksite_403", "excluded_employer_403", "anonymous_401", "unknown_source_400", "snapshots_byte_identical"],
    scope: scopeFor(t),
  };
  m.reason = "Provisional dedicated method proof (real own success, real higher-ID victim refusal, stolen worksite refusal and byte-identical snapshots) on disposable PG16 at " + evidence +
    ". Independent tenant-security review PENDING; no production or global approval.";
}
const methods = Object.values(manifest.allApiRouteFiles).flatMap((x) => x.methods);
const covered = methods.filter((x) => x.status === "COVERED").length;
const gap = methods.filter((x) => x.status === "GAP").length;
assert.equal(covered, oldCovered + 4);
assert.equal(gap, oldGap - 4);
manifest.metrics.coveredAfter = covered;
manifest.metrics.gap = gap;
manifest.acceptanceStatus = manifest.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/, "NOT ACCEPTED: " + gap + " API methods") +
  " GET/POST workforce/demand-observations/loyverse and square-sandbox have one provisional dedicated PG16 proof at " + evidence +
  " (every proof input byte-identical on the credit base). Independent security review PENDING. No production activation.";

const tick = String.fromCharCode(96);
for (const t of TARGETS) {
  const prefix = "| [" + tick + t.short + tick + " " + t.method + "]";
  const rows = overview.split("\n");
  const index = rows.findIndex((r) => r.startsWith(prefix));
  assert.ok(index >= 0, "overview row for " + t.short + " " + t.method);
  assert.ok(rows[index].endsWith("| NO VALID METHOD PROOF | **GAP** |"), "overview row is still GAP: " + t.short + " " + t.method);
  rows[index] = rows[index].replace("| NO VALID METHOD PROOF | **GAP** |",
    "| [POS demand dedicated proof](../../" + HARNESS + "#L" + (t.method === "GET" ? lines.ownGetLine : lines.ownPostLine) + ") ([exact-head run](" + evidence + ")) | **COVERED** |");
  overview = rows.join("\n");
}
for (const [key, before, after] of [["coveredAfter", oldCovered, covered], ["gap", oldGap, gap]]) {
  const oldRow = "| " + key + " | " + before + " |";
  assert.equal(overview.split(oldRow).length, 2, "unique current " + key + " metric required");
  overview = overview.replace(oldRow, "| " + key + " | " + after + " |");
}
overview = overview.replace(/^> \*\*RELEASE BLOCKER:\*\* \d+ API methods/m, "> **RELEASE BLOCKER:** " + gap + " API methods")
  .replace(/^> \*\*NOT ACCEPTED\*\*: \d+ (?:API )?method gaps/m, "> **NOT ACCEPTED**: " + gap + " method gaps");
const heading = "# Tenant isolation — complete API and page coverage inventory (NOT ACCEPTED)\n";
assert.equal(overview.split(heading).length, 2, "one inventory heading required");
overview = overview.replace(heading, heading + "\n> **POS demand provisional evidence:** " + covered + " COVERED / " + manifest.metrics.publicByDesign +
  " PUBLIC-BY-DESIGN / " + gap + " GAP. GET/POST workforce/demand-observations/loyverse and square-sandbox: [PG16 receipt](" + evidence + ") from head `" +
  headSha.slice(0, 9) + "`, merged as `" + mergeCommit.slice(0, 9) + "`; routes, harness, contract, mock, test, workflow and shared inputs are byte-identical on the credit base. " +
  "The provider is a test-only exact-host preload; no merchant is contacted. Independent security review **PENDING**. No production authorization.\n");
if (argv.includes("--check")) {
  console.log(JSON.stringify({ result: "CHECK_ONLY", runLabel, covered, gap }));
} else {
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(OVERVIEW, overview);
  console.log(JSON.stringify({ result: "PROVISIONAL_CREDIT", runLabel, covered, gap, independentReview: "PENDING" }));
}
