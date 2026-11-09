#!/usr/bin/env node
/**
 * Restricted credit command for exactly two methods, executable only AFTER the dedicated workflow
 * (.github/workflows/tenant-transfers-http.yml) passed on --head-sha:
 *   POST multi-entity/transfers   and   PATCH multi-entity/transfers
 * No payout or notification provider is configured or reachable; nothing moves money. Not an evidence generator.
 * The proof PR was merged with a merge commit: that commit must be an ancestor of HEAD, name the proof PR number and
 * have the passing head as its second parent; every proof input must be byte-identical between the passing head, the
 * merge commit and HEAD. Independent review stays PENDING.
 *
 *   node scripts/qa/tenant-transfers-credit.mjs --run-label "GitHub Actions <run>/<job> PG16 multi-entity-transfers-two-methods PASS" \
 *     --workflow-run-id <run> --job-id <job> --head-sha <40 hex> --merge-commit <sha> --proof-pr <number> [--check]
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const OVERVIEW = "docs/engineering/tenant-isolation-coverage-inventory.md";
const ROUTE = "src/app/api/multi-entity/transfers/route.ts";
const ROUTE_BLOB = "a4ac9ec92df17492c4c0918f08114660bc4c6ebe";
const HARNESS = "scripts/qa/tenant-transfers-http.mjs";
const CONTRACT = "scripts/qa/tenant-transfers-contract.mjs";
const CONTRACT_TEST = "tests/tenant-transfers-contract.test.mjs";
const WORKFLOW = ".github/workflows/tenant-transfers-http.yml";
const TARGETS = [{ method: "POST", short: "multi-entity/transfers" }, { method: "PATCH", short: "multi-entity/transfers" }];
// Every file the workflow executes or whose behavior it depends on.
const IDENTICAL_INPUTS = [ROUTE, HARNESS, CONTRACT, CONTRACT_TEST, WORKFLOW, "next.config.ts",
  "src/lib/multi-entity-server.ts", "src/lib/multi-entity-policy.ts", "src/lib/multi-entity-money.ts", "src/lib/final-pay.ts",
  "src/lib/critical-release-flags.ts", "src/lib/auth.ts", "src/lib/access.ts", "src/lib/security-request.ts", "src/lib/payroll-period-ui.ts",
  "scripts/qa/tenant-table-http.mjs", "scripts/qa/tenant-table-env.mjs", "scripts/qa/apply-isolated-baseline.mjs",
  "scripts/qa/tenant-approval-task-contract.mjs"];
const UNCHANGED_PATHS = ["src/db", "src/app/api/multi-entity"];

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
assert.equal(runLabel, "GitHub Actions " + workflowRunId + "/" + workflowJobId + " PG16 multi-entity-transfers-two-methods PASS",
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
for (const required of ["requireDisposableTransfers();", "coverageCredits: 0", "independentlyAccepted: false", "x-legal-entity-id",
  "for (const [attacker, other, key] of [[a, b, \"A\"], [b, a, \"B\"]])", "the maker cannot approve their own request"]) {
  assert.ok(harness.includes(required), "missing " + required);
}
const cite = (fragment, expected = 1) => {
  const matches = harness.split("\n").flatMap((entry, i) => (entry.includes(fragment) ? [i + 1] : []));
  assert.equal(matches.length, expected, "exact proof line count changed for " + fragment + " (" + matches.length + ")");
  return matches[0];
};
const lines = {
  ownPostLine: cite("const proposed = await propose(attacker);"),
  replayConflictLine: cite("assert.equal(replay.status, 409);"),
  foreignPostDenialLine: cite("const foreignOrg = await propose(attacker,"),
  foreignWorkerSameAnswerLine: cite("assertSameAnswer(foreignWorker, absent,"),
  anonymousPostLine: cite('assertRefusal(await req(TRANSFER_PATH, { method: "POST", body: { organizationId: attacker.org.id } }), 401, forbidden);'),
  crossSitePostLine: cite('assertRefusal(await crossSite("POST"'),
  postUnchangedDbLine: cite('await mustStayUnchanged("refused proposals");'),
  makerSelfApprovalRefusedLine: cite("the maker cannot approve their own request"),
  ownPatchLine: cite('const approved = await decide(attacker, transferId, "approve");'),
  ownRejectLine: cite('const rejected = await decide(attacker, second.json.transfer.id, "reject");'),
  foreignPatchDenialLine: cite("assertRefusal(foreignDecision, 404, forbidden);"),
  foreignTransferSameAnswerLine: cite("assertSameAnswer(foreignDecision, absentDecision,"),
  anonymousPatchLine: cite('assertRefusal(await req(TRANSFER_PATH, { method: "PATCH", body:'),
  crossSitePatchLine: cite('assertRefusal(await crossSite("PATCH"'),
  patchUnchangedDbLine: cite('await mustStayUnchanged("refused decisions");'),
  approvalUnchangedDbLine: cite('await mustStayUnchanged("own approval");'),
  victimIdOrderingLine: cite("assert.ok(victim.owner.id > Math.max(a.owner.id, b.owner.id, 6)"),
  twoAttackersLine: cite('for (const [attacker, other, key] of [[a, b, "A"], [b, a, "B"]]) {'),
};

const evidence = "https://github.com/erwinmehehe/payrollph/actions/runs/" + workflowRunId + "/job/" + workflowJobId;
const common = {
  file: HARNESS, testFile: CONTRACT_TEST, contractFile: CONTRACT, ...lines,
  proofBlobSha: sha(HARNESS), contractBlobSha: sha(CONTRACT), testBlobSha: sha(CONTRACT_TEST),
  workflowFile: WORKFLOW, workflowBlobSha: sha(WORKFLOW),
  evidence, runLabel, postgresMajor: 16, workflowRunId, workflowJobId, verifiedPrHeadSha: headSha,
  mergedProofCommit: mergeCommit, proofPullRequest: proofPr,
  providerMode: "none-configured", externalProviderCalled: false, moneyMovedByLinaw: false,
  independentSecurityReview: "PENDING", independentlyAccepted: false, productionTested: false,
};
const SHARED = "Real HTTP on disposable PG16 against a production-mode Next server with the multi-entity flags on and every provider and worker off: two independent attacker employers A and B and a genuinely higher-ID victim (seven fillers first), each with two legal employers, a maker (owner), an independent checker (admin) and two workers, all behind genuinely signed-in fictional sessions and the real x-legal-entity-id selector. ";
const scopeFor = (t) => (t.method === "POST"
  ? SHARED + "Each attacker's own proposal answers 201 and persists exactly one pending request for its own employer, worker and employers, requested by the authenticated maker, with one audit receipt, while nobody moves; a replay is a 409 that writes nothing. A foreign organization, a foreign worker, a foreign target employer, a foreign or all-employers selector, anonymous and cross-site requests are each refused; a foreign worker ID answers exactly like an absent one; the victim's and the other attacker's complete snapshots (every organization-scoped table, payroll entries, users and sessions) stay byte-identical. Not proven: concurrent proposals, live payroll cutoffs, or production data."
  : SHARED + "The maker's own approval is refused and leaves the request pending. The independent checker's approval of a due request applies it in one transaction: the worker moves to the target employer, the old employer-of-record interval closes the day before and a new one opens, exactly one legal_employer_transfer event and one audit receipt are written and no separation is created; a repeated decision is a 409 that writes nothing. A second request is rejected without moving its worker. A foreign transfer ID decided by the maker or the checker, under the victim's organization or the own one, a foreign employer selector, an invalid action, anonymous and cross-site requests are each refused; a foreign transfer ID answers exactly like an absent one; the victim's pending request is never decided and the victim's and the other attacker's complete snapshots stay byte-identical. Not proven: concurrent decisions, future-dated apply, or production data.");

const oldCovered = manifest.metrics.coveredAfter, oldGap = manifest.metrics.gap;
const api = manifest.allApiRouteFiles[ROUTE];
assert.equal(api.gitBlobSha, sha(ROUTE), ROUTE + " changed without re-inventory");
assert.equal(api.gitBlobSha, ROUTE_BLOB, "the proof was written against this exact route");
for (const t of TARGETS) {
  const m = api.methods.find((x) => x.name === t.method);
  assert.ok(m, "method " + t.method);
  assert.equal(m.status, "GAP");
  assert.equal(m.testedBy, null);
  m.status = "COVERED";
  const own = t.method === "POST" ? lines.ownPostLine : lines.ownPatchLine;
  m.testedBy = {
    ...common, routeBlobSha: sha(ROUTE), line: own, ownPositiveLine: own,
    foreignDenialLine: t.method === "POST" ? lines.foreignPostDenialLine : lines.foreignPatchDenialLine,
    unchangedDbLine: t.method === "POST" ? lines.postUnchangedDbLine : lines.patchUnchangedDbLine,
    methodActions: t.method === "POST"
      ? ["own_proposal_201_one_pending_request", "replay_409_writes_nothing", "foreign_org_403", "foreign_worker_404_same_as_absent", "foreign_target_employer_403",
        "foreign_and_all_selector_403", "anonymous_401", "cross_site_403", "snapshots_byte_identical"]
      : ["maker_self_approval_403", "checker_approve_applies_transfer", "intervals_event_audit_written", "repeat_decision_409", "second_request_rejected_worker_unmoved",
        "foreign_transfer_404_same_as_absent", "foreign_org_403", "foreign_selector_403", "invalid_action_400", "anonymous_401", "cross_site_403", "snapshots_byte_identical"],
    scope: scopeFor(t),
  };
  // The #1662/#1711/#1762 holds were about the old Playwright candidate; they are superseded by this stricter proof, not weakened.
  delete m.reviewedUncertified;
  m.reason = "Provisional dedicated method proof (real own success under maker-checker, real higher-ID victim refusal, foreign IDs indistinguishable from absent ones and byte-identical snapshots) on disposable PG16 at " + evidence +
    ". Supersedes the earlier uncredited Playwright candidate hold. Independent tenant-security review PENDING; no production or global approval.";
}
const methods = Object.values(manifest.allApiRouteFiles).flatMap((x) => x.methods);
const covered = methods.filter((x) => x.status === "COVERED").length;
const gap = methods.filter((x) => x.status === "GAP").length;
assert.equal(covered, oldCovered + 2);
assert.equal(gap, oldGap - 2);
manifest.metrics.coveredAfter = covered;
manifest.metrics.gap = gap;
manifest.acceptanceStatus = manifest.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/, "NOT ACCEPTED: " + gap + " API methods") +
  " POST/PATCH multi-entity/transfers have one provisional dedicated PG16 proof at " + evidence +
  " (every proof input byte-identical on the credit base). Independent security review PENDING. No production activation.";

const tick = String.fromCharCode(96);
const GAP_TAIL = "| **GAP** |";
for (const t of TARGETS) {
  const prefix = "| [" + tick + t.short + tick + " " + t.method + "]";
  const rows = overview.split("\n");
  const index = rows.findIndex((r) => r.startsWith(prefix));
  assert.ok(index >= 0, "overview row for " + t.short + " " + t.method);
  assert.ok(rows[index].endsWith(GAP_TAIL), "overview row is still GAP: " + t.short + " " + t.method);
  const cellStart = rows[index].lastIndexOf("| ", rows[index].length - GAP_TAIL.length - 2);
  const link = "[transfers dedicated proof](../../" + HARNESS + "#L" + (t.method === "POST" ? lines.ownPostLine : lines.ownPatchLine) + ") ([exact-head run](" + evidence + ")); supersedes the uncredited Playwright candidate hold ";
  rows[index] = rows[index].slice(0, cellStart) + "| " + link + "| **COVERED** |";
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
overview = overview.replace(heading, heading + "\n> **Multi-entity transfers provisional evidence:** " + covered + " COVERED / " + manifest.metrics.publicByDesign +
  " PUBLIC-BY-DESIGN / " + gap + " GAP. POST/PATCH multi-entity/transfers: [PG16 receipt](" + evidence + ") from head `" +
  headSha.slice(0, 9) + "`, merged as `" + mergeCommit.slice(0, 9) + "`; route, harness, contract, test, workflow and shared inputs are byte-identical on the credit base. " +
  "No payout or notification provider is configured and nothing moves money. Independent security review **PENDING**. No production authorization.\n");
if (argv.includes("--check")) {
  console.log(JSON.stringify({ result: "CHECK_ONLY", runLabel, covered, gap }));
} else {
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(OVERVIEW, overview);
  console.log(JSON.stringify({ result: "PROVISIONAL_CREDIT", runLabel, covered, gap, independentReview: "PENDING" }));
}
