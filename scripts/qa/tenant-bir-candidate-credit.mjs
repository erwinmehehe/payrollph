#!/usr/bin/env node
/**
 * Restricted credit command for exactly one method, executable only AFTER the dedicated workflow
 * (.github/workflows/bir-1604c-candidate-qa.yml, job "synthetic") passed on --head-sha:
 *   POST bir/annual-employer/candidate   (all three actions: template, check, download)
 * No BIR filing, payment, provider or agency call is made; the endpoint only builds a draft candidate. Not an evidence generator.
 * The proof PR was merged with a merge commit: that commit must be an ancestor of HEAD, name the proof PR number and
 * have the passing head as its second parent; every proof input must be byte-identical between the passing head, the
 * merge commit and HEAD. Independent review stays PENDING.
 *
 *   node scripts/qa/tenant-bir-candidate-credit.mjs --run-label "GitHub Actions <run>/<job> PG16 bir-annual-employer-candidate-post PASS" \
 *     --workflow-run-id <run> --job-id <job> --head-sha <40 hex> --merge-commit <sha> --proof-pr <number> [--check]
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const OVERVIEW = "docs/engineering/tenant-isolation-coverage-inventory.md";
const ROUTE = "src/app/api/bir/annual-employer/candidate/route.ts";
const ROUTE_BLOB = "431fcc6375fb6d1a8a318bd70fb77ef47f40941a";
const HARNESS = "scripts/qa/tenant-bir1604c-candidate-post-http.mjs";
const CONTRACT_TEST = "tests/tenant-bir1604c-candidate-post-contract.test.mjs";
const WORKFLOW = ".github/workflows/bir-1604c-candidate-qa.yml";
const TARGET = { method: "POST", short: "bir/annual-employer/candidate" };
// Every file the workflow executes or whose behavior it depends on.
const IDENTICAL_INPUTS = [ROUTE, HARNESS, CONTRACT_TEST, WORKFLOW, "next.config.ts",
  "src/lib/bir-annual-employer-source.ts", "src/lib/bir-annual-entity-access.ts", "src/lib/bir-1604c-pre-export.ts",
  "src/lib/bir-1604c-source-review.ts", "src/lib/bir-1604c-review-request.ts", "src/lib/critical-release-flags.ts",
  "src/lib/security-request.ts", "src/lib/access.ts", "src/lib/auth.ts", "src/lib/audit.ts", "src/lib/government-id-crypto.ts",
  "src/lib/multi-entity-server.ts", "scripts/qa/tenant-table-http.mjs", "scripts/qa/tenant-table-env.mjs",
  "scripts/qa/apply-isolated-baseline.mjs", "scripts/bir-1604c-synthetic-browser-fixture.ts",
  "scripts/bir-1604c-synthetic-browser.mjs", "scripts/bir-1604c-synthetic-https-proxy.mjs"];
const UNCHANGED_PATHS = ["src/db", "src/app/api/bir"];

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
assert.equal(runLabel, "GitHub Actions " + workflowRunId + "/" + workflowJobId + " PG16 bir-annual-employer-candidate-post PASS",
  "no unexecuted, stale or unverified run label");

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
git("cat-file", "-e", headSha + "^{commit}");
git("cat-file", "-e", mergeCommit + "^{commit}");
execFileSync("git", ["merge-base", "--is-ancestor", mergeCommit, "HEAD"]);
assert.ok(git("log", "-1", "--format=%s", mergeCommit).startsWith("Merge pull request #" + proofPr + " "), "merge commit must be the proof PR merge");
assert.equal(git("rev-parse", mergeCommit + "^2"), headSha, "the passing head must be the merged proof head");
execFileSync("git", ["merge-base", "--is-ancestor", headSha, "HEAD"]);
// Read blobs with the object-id syntax, which Git Bash cannot rewrite as a path.
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
for (const required of ["BIR_SYNTHETIC_BROWSER_QA", "credits: 0", "allThreeModesExercised: true", "check(refusals === 22,",
  "for (const name of [\"ATTA\", \"ATTB\", \"VICTIM\"])", "for (const mode of [\"template\", \"check\", \"download\"])"]) {
  assert.ok(harness.includes(required), "missing " + required);
}
const cite = (fragment, expected = 1) => {
  const matches = harness.split("\n").flatMap((entry, i) => (entry.includes(fragment) ? [i + 1] : []));
  assert.equal(matches.length, expected, "exact proof line count changed for " + fragment + " (" + matches.length + ")");
  return matches[0];
};
const lines = {
  ownTemplateLine: cite("Owned reviewer gets a real reviewed-source template"),
  ownCheckLine: cite("Real own reviewed-source candidate check"),
  ownDownloadLine: cite("Real own reviewed-source draft DAT download"),
  foreignDenialLine: cite("Authenticated foreign employer cannot \" + mode + \" victim source"),
  forgedSelectorLine: cite("Real victim legal-employer selector rejected for \" + mode"),
  forgedEmployeeLine: cite("Foreign worker ID cannot pass an own"),
  unchangedDbLine: cite("Real victim source, annual rows and audit immutable after denied"),
  victimIdOrderingLine: cite("victim.org.id > 6 && victim.worker.id > 6 && victim.entity.id > 6 &&"),
  anonymousLine: cite("Anonymous caller cannot \""),
  crossSiteLine: cite("A cross-site mutation cannot \""),
  malformedBodyLine: cite("A malformed \""),
  staleDigestLine: cite("A stale source digest cannot produce a review template"),
  protocolRefusalCountLine: cite("check(refusals === 22,"),
  twoAttackersLine: cite("for (const name of [\"ATTA\", \"ATTB\", \"VICTIM\"])"),
};

const evidence = "https://github.com/erwinmehehe/payrollph/actions/runs/" + workflowRunId + "/job/" + workflowJobId;
const oldCovered = manifest.metrics.coveredAfter, oldGap = manifest.metrics.gap;
const api = manifest.allApiRouteFiles[ROUTE];
assert.equal(api.gitBlobSha, sha(ROUTE), ROUTE + " changed without re-inventory");
assert.equal(api.gitBlobSha, ROUTE_BLOB, "the proof was written against this exact route");
const m = api.methods.find((x) => x.name === TARGET.method);
assert.ok(m, "method " + TARGET.method);
assert.equal(m.status, "GAP");
assert.equal(m.testedBy, null);
m.status = "COVERED";
m.testedBy = {
  file: HARNESS, testFile: CONTRACT_TEST, ...lines,
  proofBlobSha: sha(HARNESS), testBlobSha: sha(CONTRACT_TEST),
  workflowFile: WORKFLOW, workflowBlobSha: sha(WORKFLOW), routeBlobSha: sha(ROUTE),
  line: lines.ownDownloadLine, ownPositiveLine: lines.ownDownloadLine,
  evidence, runLabel, postgresMajor: 16, workflowRunId, workflowJobId, verifiedPrHeadSha: headSha,
  mergedProofCommit: mergeCommit, proofPullRequest: proofPr,
  providerMode: "none-configured", externalProviderCalled: false, birFilingMade: false,
  independentSecurityReview: "PENDING", independentlyAccepted: false, productionTested: false,
  methodActions: ["template_own_200", "check_own_200_read_only", "download_own_200_exact_bytes_one_audit", "foreign_org_403_per_action",
    "forged_legal_entity_404_per_action", "foreign_employee_422_check_and_download", "anonymous_401_per_action", "cross_site_403_per_action",
    "malformed_body_400_per_action", "stale_digest_409", "unknown_action_400", "snapshots_byte_identical"],
  scope: "Real HTTPS on disposable PG16 against a production-mode Next server with the BIR candidate flag on and every provider and worker off: two independent attacker employers A and B and a genuinely higher-ID victim (six fillers first, so the victim's organization, legal employer and employee IDs all exceed 6), each with its own released payroll, settled year-end row and reconciled remittance, behind genuinely signed-in MFA sessions. Each attacker's own template, check and draft DAT download answer 200; check changes nothing; the download adds exactly one source-provenance audit receipt and its bytes, hash and source digest agree. For every action a foreign organization is refused 403, the victim's legal-employer selector 404, and a foreign employee reference 422 (check and download); no response mentions the victim's marker, employee or TIN. For every action an anonymous caller is refused 401, a cross-site mutation 403 and a malformed body 400; a stale digest is 409 and an unknown action 400. The victim's and both attackers' complete snapshots (workers, runs, entries, year-end rows, remittances, audit) stay byte-identical. Not proven: concurrent requests, an official BIR module validation, or production data.",
};
// The #1676 template-only review was withheld pending exactly this proof; it is superseded by the stricter run, not weakened.
delete m.reviewedUncertified;
m.reason = "Provisional dedicated method proof (real own success for all three actions, real higher-ID victim refusal per action, protocol refusals and byte-identical snapshots) on disposable PG16 at " + evidence +
  ". Supersedes the template-only #1676 review hold. Draft candidate only: no BIR filing or validation. Independent tenant-security and tax review PENDING; no production or global approval.";

const methods = Object.values(manifest.allApiRouteFiles).flatMap((x) => x.methods);
const covered = methods.filter((x) => x.status === "COVERED").length;
const gap = methods.filter((x) => x.status === "GAP").length;
assert.equal(covered, oldCovered + 1);
assert.equal(gap, oldGap - 1);
manifest.metrics.coveredAfter = covered;
manifest.metrics.gap = gap;
manifest.acceptanceStatus = manifest.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/, "NOT ACCEPTED: " + gap + " API methods") +
  " POST bir/annual-employer/candidate has one provisional dedicated PG16 proof at " + evidence +
  " (every proof input byte-identical on the credit base). Independent security and tax review PENDING. No production activation.";

const tick = String.fromCharCode(96);
const GAP_TAIL = "| **GAP** |";
{
  const prefix = "| [" + tick + TARGET.short + tick + " " + TARGET.method + "]";
  const rows = overview.split("\n");
  const index = rows.findIndex((r) => r.startsWith(prefix));
  assert.ok(index >= 0, "overview row for " + TARGET.short);
  assert.ok(rows[index].endsWith(GAP_TAIL), "overview row is still GAP: " + TARGET.short);
  const cellStart = rows[index].lastIndexOf("| ", rows[index].length - GAP_TAIL.length - 2);
  const link = "[BIR candidate dedicated proof](../../" + HARNESS + "#L" + lines.ownDownloadLine + ") ([exact-head run](" + evidence + ")); supersedes the template-only #1676 review hold ";
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
overview = overview.replace(heading, heading + "\n> **BIR annual employer candidate provisional evidence:** " + covered + " COVERED / " + manifest.metrics.publicByDesign +
  " PUBLIC-BY-DESIGN / " + gap + " GAP. POST bir/annual-employer/candidate: [PG16 receipt](" + evidence + ") from head `" +
  headSha.slice(0, 9) + "`, merged as `" + mergeCommit.slice(0, 9) + "`; route, harness, contract, workflow and shared inputs are byte-identical on the credit base. " +
  "A draft candidate only: no BIR submission, official validation or payment. Independent security and tax review **PENDING**. No production authorization.\n");
if (argv.includes("--check")) {
  console.log(JSON.stringify({ result: "CHECK_ONLY", runLabel, covered, gap }));
} else {
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(OVERVIEW, overview);
  console.log(JSON.stringify({ result: "PROVISIONAL_CREDIT", runLabel, covered, gap, independentReview: "PENDING" }));
}
