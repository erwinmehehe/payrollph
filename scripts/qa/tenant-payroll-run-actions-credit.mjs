#!/usr/bin/env node
/**
 * Restricted credit command for exactly two methods, executable only AFTER the dedicated workflow
 * (.github/workflows/tenant-payroll-run-actions-http.yml) passed on --head-sha:
 *   POST payroll-runs/[id]/pilot-signoff   and   GET payroll-runs/[id]/xendit-payout
 * It deliberately does NOT credit POST payroll-runs/[id]/exports (preflight/disburse need a payout provider) or POST xendit-payout
 * (needs the Xendit rail and live approval). Not an evidence generator. The proof PR was merged with a merge commit: that commit must
 * be an ancestor of HEAD, name the proof PR number and have the passing head as its second parent; every proof input must be
 * byte-identical between the passing head, the merge commit and HEAD. Independent review stays PENDING.
 *
 *   node scripts/qa/tenant-payroll-run-actions-credit.mjs \
 *     --run-label "GitHub Actions <run>/<job> PG16 payroll-run-actions PASS" --workflow-run-id <run> --job-id <job> \
 *     --head-sha <40 hex> --merge-commit <sha> --proof-pr <number> [--check]
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const OVERVIEW = "docs/engineering/tenant-isolation-coverage-inventory.md";
const PILOT_ROUTE = "src/app/api/payroll-runs/[id]/pilot-signoff/route.ts";
const XENDIT_ROUTE = "src/app/api/payroll-runs/[id]/xendit-payout/route.ts";
const HARNESS = "scripts/qa/tenant-payroll-run-actions-http.mjs";
const CONTRACT = "scripts/qa/tenant-payroll-run-actions-contract.mjs";
const CONTRACT_TEST = "tests/tenant-payroll-run-actions-contract.test.mjs";
const WORKFLOW = ".github/workflows/tenant-payroll-run-actions-http.yml";
const TARGETS = [
  { route: PILOT_ROUTE, method: "POST", short: "payroll-runs/[id]/pilot-signoff", blob: "18390e65b137a0e73d5c5c78e3368dbd18a26af4" },
  { route: XENDIT_ROUTE, method: "GET", short: "payroll-runs/[id]/xendit-payout", blob: "c100c146ce1373c1526bae90dd77667d6ed6aaad" },
];
// Every file the workflow executes or whose behavior it depends on (the route directory is covered by UNCHANGED_PATHS).
const IDENTICAL_INPUTS = [PILOT_ROUTE, XENDIT_ROUTE, HARNESS, CONTRACT, CONTRACT_TEST, WORKFLOW,
  "scripts/qa/tenant-approval-task-contract.mjs", "scripts/qa/tenant-table-http.mjs", "scripts/qa/tenant-table-env.mjs",
  "scripts/qa/apply-isolated-baseline.mjs", "src/lib/auth.ts", "src/lib/access.ts", "src/lib/treasury-controls.ts",
  "src/lib/multi-entity-run-guard.ts", "src/lib/payroll-payout-provider.ts", "src/lib/xendit-payout-ledger.ts",
  "src/lib/pilot-bank-dry-run-evidence.ts", "src/lib/security-request.ts", "src/lib/crypto.ts"];
const UNCHANGED_PATHS = ["src/db", "src/app/api/payroll-runs"];

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
assert.equal(runLabel, "GitHub Actions " + workflowRunId + "/" + workflowJobId + " PG16 payroll-run-actions PASS",
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
const manifest = JSON.parse(read(MANIFEST));
let overview = read(OVERVIEW);
for (const required of [
  "requireDisposablePayrollRunActions();", "for (let i = 0; i < 7; i++)", "coverageCredits: 0", "a replayed sign-off is the same single record",
  "own xendit ledger read:", "the ledger names only the own employer", "a replay writes nothing", "refused attempts write no sign-off",
]) assert.ok(harness.includes(required), "missing " + required);
assert.ok(harness.indexOf("requireDisposablePayrollRunActions();") < harness.indexOf('import("../../src/db/index.ts")'));
const cite = (fragment, expected = 1) => {
  const matches = harness.split("\n").flatMap((entry, i) => (entry.includes(fragment) ? [i + 1] : []));
  assert.equal(matches.length, expected, "exact proof line count changed for " + fragment + " (" + matches.length + ")");
  return matches[0];
};
const lines = {
  pilotOwnLine: cite("const signedOff = assertPilotSignedOff(await standaloneRequest(pilotPath, { method: \"POST\", cookie: attacker.cookie,"),
  pilotReplayLine: cite('assert.equal(replay.json?.alreadyRecorded, true, "a replayed sign-off is the same single record");'),
  pilotRefusedWritesNothingLine: cite('"refused attempts write no sign-off"'),
  ledgerOwnLine: cite('assert.equal(status.status, 200, "own xendit ledger read: " + status.text.slice(0, 300));'),
  ledgerOnlyOwnLine: cite('"the ledger names only the own employer"'),
  foreignDenialLine: cite('assertRowsUnchanged(victimBefore, await snapshot(victim), "victim after " + key + "\'s " + label + " refusal");'),
  unchangedDbLine: cite('assertRowsUnchanged(victimBefore, await snapshot(victim), "victim after " + key + "\'s complete journey");'),
  victimIdOrderingLine: cite("victim.owner.id > Math.max(a.owner.id, b.owner.id, 6)"),
  anonymousLine: cite("const anonymous = await standaloneRequest(pilotPath, { method: \"POST\", body: signoffBody(attacker) });"),
};
for (const required of ['"xendit-payout GET", victim.runs.ledger.run.id, "GET"', '"pilot-signoff"']) assert.ok(harness.includes(required), "missing refusal case " + required);

const evidence = "https://github.com/erwinmehehe/payrollph/actions/runs/" + workflowRunId + "/job/" + workflowJobId;
const common = {
  file: HARNESS, testFile: CONTRACT_TEST, ...lines,
  proofBlobSha: sha(HARNESS), contractBlobSha: sha(CONTRACT), testBlobSha: sha(CONTRACT_TEST),
  workflowFile: WORKFLOW, workflowBlobSha: sha(WORKFLOW),
  evidence, runLabel, postgresMajor: 16, workflowRunId, workflowJobId, verifiedPrHeadSha: headSha,
  mergedProofCommit: mergeCommit, proofPullRequest: proofPr,
  moneyMovedByLinaw: false, providerCalled: false,
  independentSecurityReview: "PENDING", productionTested: false,
};
const scopes = {
  "POST payroll-runs/[id]/pilot-signoff": {
    line: lines.pilotOwnLine,
    methodActions: ["own_signoff_with_system_derived_figures", "replay_is_one_record", "unconfirmed_400", "mismatching_figure_409", "forged_body_ids_ignored",
      "foreign_run_403_victim_byte_identical", "anonymous_401"],
    scope: "Real HTTP on disposable PG16 against a production build, two independent attacker employers, seven fillers and a higher-ID victim, with no payout provider configured or called. Each attacker's own pilot sign-off on its own Released run answers 200 with the system-derived register figures, writes exactly one own audit row (completed-payout evidence mode) and ignores forged organizationId/runId/legalEntityId/userId in the body; a replay returns the same single record and writes nothing; an unconfirmed attestation (400) and a mismatching independent figure (409, named) write nothing. The attacker's body carries figures equal to the VICTIM's register totals, so a missing gate would really sign off the victim's run. The same call aimed at the victim's real higher-ID run is refused 403 with no victim marker, and the victim's complete organization rows are byte-identical (and the other attacker's); anonymous is 401. A local mutation removing the role, unit-scope and legal-employer gates made the harness fail with the victim run signed off. Not proven: bank or statutory correctness of the signed-off figures, or any provider.",
  },
  "GET payroll-runs/[id]/xendit-payout": {
    line: lines.ledgerOwnLine,
    methodActions: ["own_ledger_read_only_own_row", "forged_org_and_run_query_ignored", "foreign_run_403_victim_byte_identical", "anonymous_401"],
    scope: "Real HTTP on disposable PG16 against a production build, two independent attacker employers, seven fillers and a higher-ID victim. Each attacker's own Xendit status read on its own Released run answers 200 with exactly its own batch and its single seeded own row (own employee number, own -UNSENT reference, prepared), ignoring a forged organizationId and a forged victim runId in the query, and the response names neither the victim nor the other attacker. The same read aimed at the victim's real higher-ID run is refused 403 with the victim's complete organization rows byte-identical (and the other attacker's); anonymous is 401. A local mutation removing the treasury, unit-scope and legal-employer gates let the attacker read the victim's ledger and made the harness fail. Nothing is submitted to Xendit and no provider is configured; the rows are pre-populated fictional data. Not proven: POST xendit-payout (needs the Xendit rail and live approval).",
  },
};

const oldCovered = manifest.metrics.coveredAfter, oldGap = manifest.metrics.gap;
for (const t of TARGETS) {
  const api = manifest.allApiRouteFiles[t.route];
  assert.equal(api.gitBlobSha, sha(t.route), t.route + " changed without re-inventory");
  assert.equal(api.gitBlobSha, t.blob, "the proof was written against this exact route");
  const m = api.methods.find((x) => x.name === t.method);
  assert.ok(m, "method " + t.method);
  assert.equal(m.status, "GAP");
  assert.equal(m.testedBy, null);
  const key = t.method + " " + t.short;
  m.status = "COVERED";
  m.testedBy = { ...common, ...scopes[key], ownPositiveLine: scopes[key].line, routeBlobSha: sha(t.route) };
  delete m.reviewedUncertified; // the zero-credit negative-only hold is superseded by this real own-success + victim-denial receipt
  m.reason = "Provisional dedicated method proof (real own success, forged selectors ignored, victim-run refusal with byte-identical victim) on disposable PG16 at " + evidence +
    ". Independent tenant-security review PENDING; no production or global approval.";
}
const methods = Object.values(manifest.allApiRouteFiles).flatMap((x) => x.methods);
const covered = methods.filter((x) => x.status === "COVERED").length;
const gap = methods.filter((x) => x.status === "GAP").length;
assert.equal(covered, oldCovered + 2);
assert.equal(gap, oldGap - 2);
manifest.metrics.coveredAfter = covered;
manifest.metrics.gap = gap;
manifest.acceptanceStatus = manifest.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/, "NOT ACCEPTED: " + gap + " API methods") +
  " POST payroll-runs/[id]/pilot-signoff and GET payroll-runs/[id]/xendit-payout have one provisional dedicated PG16 proof at " + evidence +
  " (every proof input byte-identical on the credit base). Independent security review PENDING. No production activation.";

const tick = String.fromCharCode(96);
for (const t of TARGETS) {
  const prefix = "| [" + tick + t.short + tick + " " + t.method + "]";
  const rows = overview.split("\n");
  const index = rows.findIndex((r) => r.startsWith(prefix));
  assert.ok(index >= 0, "overview row for " + t.short + " " + t.method);
  assert.ok(rows[index].endsWith("| NO VALID METHOD PROOF | **GAP** |"), "overview row is still GAP: " + t.short);
  rows[index] = rows[index].replace("| NO VALID METHOD PROOF | **GAP** |",
    "| [payroll-run actions dedicated proof](../../" + HARNESS + "#L" + (t.method === "POST" ? lines.pilotOwnLine : lines.ledgerOwnLine) + ") ([exact-head run](" + evidence + ")) | **COVERED** |");
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
overview = overview.replace(heading, heading + "\n> **Payroll-run actions provisional evidence:** " + covered + " COVERED / " + manifest.metrics.publicByDesign +
  " PUBLIC-BY-DESIGN / " + gap + " GAP. payroll-runs/[id]/pilot-signoff POST and payroll-runs/[id]/xendit-payout GET: [PG16 receipt](" + evidence + ") from head `" +
  headSha.slice(0, 9) + "`, merged as `" + mergeCommit.slice(0, 9) + "`; route, harness, contract, test, workflow and shared inputs are byte-identical on the credit base. " +
  "exports POST and xendit-payout POST stay GAP. Independent security review **PENDING**. No production authorization.\n");
if (argv.includes("--check")) {
  console.log(JSON.stringify({ result: "CHECK_ONLY", runLabel, covered, gap }));
} else {
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(OVERVIEW, overview);
  console.log(JSON.stringify({ result: "PROVISIONAL_CREDIT", runLabel, covered, gap, independentReview: "PENDING" }));
}
