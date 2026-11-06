#!/usr/bin/env node
/**
 * Restricted credit command for POST auth/logout, executable only AFTER the dedicated workflow
 * (.github/workflows/tenant-auth-logout-http.yml) passed on --head-sha. This is not an evidence generator.
 * The proof PR was merged with a merge commit: that commit must be an ancestor of HEAD, name the proof PR number, have the passing
 * head as its second parent, and every proof input must be byte-identical between the passing head, the merge commit and HEAD.
 * Independent review stays PENDING.
 *
 *   node scripts/qa/tenant-auth-logout-credit.mjs --only-key "POST auth/logout" \
 *     --run-label "GitHub Actions <run>/<job> PG16 auth-logout PASS" --workflow-run-id <run> --job-id <job> \
 *     --head-sha <40 hex> --merge-commit <sha> --proof-pr <number> [--check]
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const KEY = "POST auth/logout";
const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const OVERVIEW = "docs/engineering/tenant-isolation-coverage-inventory.md";
const ROUTE = "src/app/api/auth/logout/route.ts";
const HARNESS = "scripts/qa/tenant-auth-logout-http.mjs";
const CONTRACT = "scripts/qa/tenant-auth-logout-contract.mjs";
const CONTRACT_TEST = "tests/tenant-auth-logout-contract.test.mjs";
const WORKFLOW = ".github/workflows/tenant-auth-logout-http.yml";
// Every file the workflow executes or whose behavior it depends on.
const IDENTICAL_INPUTS = [ROUTE, HARNESS, CONTRACT, CONTRACT_TEST, WORKFLOW,
  "scripts/qa/tenant-approval-task-contract.mjs", "scripts/qa/tenant-table-http.mjs", "scripts/qa/tenant-table-env.mjs",
  "scripts/qa/apply-isolated-baseline.mjs", "src/lib/auth.ts", "src/lib/crypto.ts", "src/lib/security-request.ts"];
const UNCHANGED_PATHS = ["src/db", "src/app/api/auth/logout"];

const argv = process.argv.slice(2);
const arg = (name) => {
  assert.equal(argv.filter((x) => x === name).length, 1, "one " + name + " required");
  const i = argv.indexOf(name);
  assert.ok(argv[i + 1] && !argv[i + 1].startsWith("--"), name + " needs a value");
  return argv[i + 1];
};
assert.equal(arg("--only-key"), KEY, "credit ONLY POST auth/logout");
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
assert.equal(runLabel, "GitHub Actions " + workflowRunId + "/" + workflowJobId + " PG16 auth-logout PASS",
  "no unexecuted, stale or unverified run label");

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
git("cat-file", "-e", headSha + "^{commit}");
git("cat-file", "-e", mergeCommit + "^{commit}");
execFileSync("git", ["merge-base", "--is-ancestor", mergeCommit, "HEAD"]); // the merged proof is in this history
assert.ok(git("log", "-1", "--format=%s", mergeCommit).startsWith("Merge pull request #" + proofPr + " "), "merge commit must be the proof PR merge");
assert.equal(git("rev-parse", mergeCommit + "^2"), headSha, "the passing head must be the merged proof head");
execFileSync("git", ["merge-base", "--is-ancestor", headSha, "HEAD"]);
// Read committed blobs through git (never "rev:path" on a Windows shell, and never working-tree line endings).
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
const api = manifest.allApiRouteFiles[ROUTE];
assert.equal(api.gitBlobSha, sha(ROUTE), "route changed without re-inventory");
assert.equal(api.gitBlobSha, "290f703135c3051d5feb8a3dd594ce9b29da3796", "the proof was written against this exact route");
const post = api.methods.find((x) => x.name === "POST");
assert.equal(api.methods.length, 1);
assert.equal(post.status, "GAP");
assert.equal(post.testedBy, null);

const cite = (fragment, expected = 1) => {
  const matches = harness.split("\n").flatMap((entry, i) => (entry.includes(fragment) ? [i + 1] : []));
  assert.equal(matches.length, expected, "exact proof line count changed for " + fragment + " (" + matches.length + ")");
  return matches[0];
};
for (const required of [
  "requireDisposableAuthLogout();", "exactly the presented session is revoked", "the caller's other device still works",
  "a cross-site logout must revoke nothing", "victim after both complete attacker journeys", "A's session evidence cannot satisfy B's",
  "coverageCredits: 0", "for (let i = 0; i < 7; i++)",
]) assert.ok(harness.includes(required), "missing " + required);
assert.ok(harness.indexOf("requireDisposableAuthLogout();") < harness.indexOf('import("../../src/db/index.ts")'));

const ownPositiveLine = cite('assert.equal(rows.filter((row) => row.revokedAt).length, 1, "exactly the presented session is revoked");');
const foreignDenialLine = cite("assertRowsUnchanged(victimBefore, await snapshot(victim), \"victim after \" + attacker.label + \"'s logout\");");
const forgedSelectorLine = cite("userId: victim.owner.id, sessionId: victimSession.id, token: token(device.v.one), organizationId: victim.org.id,");
const unchangedDbLine = cite('assertRowsUnchanged(victimBefore, await snapshot(victim), "victim after both complete attacker journeys");');
const victimIdOrderingLine = cite("victim.owner.id > Math.max(a.owner.id, b.owner.id, 6)");
const crossSiteLine = cite('assert.equal(await live(a.owner.id), 2, "a cross-site logout must revoke nothing");');

const evidence = "https://github.com/erwinmehehe/payrollph/actions/runs/" + workflowRunId + "/job/" + workflowJobId;
const testedBy = {
  file: HARNESS,
  testFile: CONTRACT_TEST,
  line: ownPositiveLine,
  ownPositiveLine,
  foreignDenialLine,
  forgedSelectorLine,
  unchangedDbLine,
  victimIdOrderingLine,
  crossSiteLine,
  methodActions: ["own_logout_revokes_presented_session_only", "forged_session_ids_ignored", "other_device_untouched", "victim_rows_byte_identical",
    "anonymous_noop", "garbage_cookie_noop", "cross_site_refused", "replay_restamp_observed"],
  proofBlobSha: sha(HARNESS),
  contractBlobSha: sha(CONTRACT),
  testBlobSha: sha(CONTRACT_TEST),
  workflowFile: WORKFLOW,
  workflowBlobSha: sha(WORKFLOW),
  routeBlobSha: sha(ROUTE),
  scope: "Real HTTP on disposable PG16 against a production build, two independent attacker accounts, seven fillers and a higher-ID victim, each with two devices. The route accepts no identity, so the claim is that a logout revokes ONLY the session whose cookie was presented. Each attacker's own logout answers 200 with the constant body and a clearing cookie, revokes exactly the presented session (the account endpoint then answers 401), leaves the caller's other device working, and ignores forged userId/sessionId/token/organizationId fields in the body and query that name the victim's session. Anonymous and garbage-cookie logouts are constant 200s that change no row anywhere, and a cross-site logout with a valid cookie is refused 403 and revokes nothing. The other attacker's and the victim's user rows, sessions and audit rows are compared before and after every step and are byte-identical, and both victim devices still work. Observed and pinned, not a tenant issue: replaying a logout on an already-revoked session re-stamps that session's own revokedAt. Not proven: the Set-Cookie attributes beyond clearing, and behaviour behind a proxy that rewrites Origin.",
  evidence, runLabel, postgresMajor: 16, workflowRunId, workflowJobId, verifiedPrHeadSha: headSha,
  mergedProofCommit: mergeCommit, proofPullRequest: proofPr,
  independentSecurityReview: "PENDING", productionTested: false,
};
const oldCovered = manifest.metrics.coveredAfter, oldGap = manifest.metrics.gap;
post.status = "COVERED";
post.testedBy = testedBy;
post.reason = "Provisional dedicated method proof (revokes only the presented session, forged session ids ignored, cross-site refused and a byte-identical victim) on disposable PG16 at " + evidence +
  ". Independent tenant-security review PENDING; no production or global approval.";
const methods = Object.values(manifest.allApiRouteFiles).flatMap((x) => x.methods);
const covered = methods.filter((x) => x.status === "COVERED").length;
const gap = methods.filter((x) => x.status === "GAP").length;
assert.equal(covered, oldCovered + 1);
assert.equal(gap, oldGap - 1);
manifest.metrics.coveredAfter = covered;
manifest.metrics.gap = gap;
manifest.acceptanceStatus = manifest.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/, "NOT ACCEPTED: " + gap + " API methods") +
  " POST auth/logout has one provisional dedicated PG16 proof at " + evidence +
  " (every proof input byte-identical on the credit base). Independent security review PENDING. No production activation.";

const tick = String.fromCharCode(96);
const prefix = "| [" + tick + "auth/logout" + tick + " POST]";
const rows = overview.split("\n");
const index = rows.findIndex((r) => r.startsWith(prefix));
assert.ok(index >= 0, "overview row for auth/logout POST");
assert.ok(rows[index].endsWith("| NO VALID METHOD PROOF | **GAP** |"), "overview row is still GAP");
rows[index] = rows[index].replace("| NO VALID METHOD PROOF | **GAP** |",
  "| [auth/logout dedicated proof](../../" + HARNESS + "#L" + ownPositiveLine + ") ([exact-head run](" + evidence + ")) | **COVERED** |");
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
overview = overview.replace(heading, heading + "\n> **Auth logout provisional evidence:** " + covered + " COVERED / " + manifest.metrics.publicByDesign +
  " PUBLIC-BY-DESIGN / " + gap + " GAP. auth/logout POST: [PG16 receipt](" + evidence + ") from head `" + headSha.slice(0, 9) +
  "`, merged as `" + mergeCommit.slice(0, 9) + "`; route, harness, contract, test, workflow and shared inputs are byte-identical on the credit base. Independent security review **PENDING**. No production authorization.\n");
if (argv.includes("--check")) {
  console.log(JSON.stringify({ result: "CHECK_ONLY", onlyKey: KEY, runLabel, covered, gap }));
} else {
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(OVERVIEW, overview);
  console.log(JSON.stringify({ result: "PROVISIONAL_CREDIT", onlyKey: KEY, runLabel, covered, gap, independentReview: "PENDING" }));
}
