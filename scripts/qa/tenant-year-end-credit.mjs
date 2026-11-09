/**
 * Independent source-pinned provisional credits for GET /api/year-end and
 * POST /api/year-end, from merged #1804's fictional PG16 localhost evidence.
 * Historical #1730 proof is superseded. These are NOT payroll/tax or security
 * acceptance; no real provider, government filing or production run occurs.
 * Subscription POST method credits are owned by separate draft PR #1826.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const HEAD = "d79db85b2a2ca0276810634dccaf904fd4469099";
const ROUTE = "src/app/api/year-end/route.ts";
const PROOF = "scripts/qa/tenant-table-rows/write/year-end-annualization-post.mjs";
const WORKFLOW = ".github/workflows/tenant-year-end-post-candidate.yml";
const RUN = 42254117862;
const JOB = 128016606342;
export const YEAR_END_SOURCE_PINS = Object.freeze({
  [ROUTE]: "f040f5bbbc3df275d32d23f1728b1b0345f77814",
  [PROOF]: "9e64fc18a1a5b76c3ec583a0668ea680efd1ed19",
  [WORKFLOW]: "7acd794545ba36febdc7877306fc4021999cb739",
  "scripts/qa/tenant-batches/year-end-json-http.mjs": "0b778aea9d1e66f508a54f3c63cf43a2342f9e55",
  "scripts/qa/tenant-write-table-http.mjs": "c9db7e9f1b0f7035836b4f599e82c51384a0f127",
  "scripts/qa/tenant-table-http.mjs": "31894982d768e34c1653be7c4335194f60233c6e",
  "src/lib/year-end.ts": "7194658c42b9ef33c84acd84ab356c28c6303883",
  "src/lib/payroll-engine.ts": "dc5719a2c34094b5449bf4ecacb198ab0d74a313",
  "tests/year-end-binding-transaction-contract.test.mjs": "9562442c4d9e7d820027630cead6d753c0fc3767",
});

export const YEAR_END_RECEIPTS = Object.freeze([
  Object.freeze({
    path: ROUTE, method: "GET", line: 102,
    lines: [102, 113, 118, 116],
    anchors: ["const ownRead = expectStatus", "const refused = expectStatus",
      "const forgedRead = expectStatus", "assert.deepEqual(await state(c.victim.org.id), victimState"],
    actions: ["json", "preflight", "2316_draft", "2316_print", "alphalist_source"],
  }),
  Object.freeze({
    path: ROUTE, method: "POST", line: 125,
    lines: [125, 140, 144, 148],
    anchors: ["const bound = expectStatus", "const foreignBound = expectStatus",
      "const forgedBound = expectStatus", "assert.deepEqual(await state(c.victim.org.id), victimState"],
    actions: ["unbound_annualization", "bind_december_payroll"],
  }),
]);

function sha(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return createHash("sha1").update("blob " + buf.length + "\0").update(buf).digest("hex");
}

export function verifyYearEndCredits(manifest, read = readFileSync) {
  const source = path => read(path, "utf8");
  for (const [file, hash] of Object.entries(YEAR_END_SOURCE_PINS))
    assert.equal(sha(read(file)), hash, file + ": source/proof changed; renew PG16 review");
  const row = source(PROOF), wf = source(WORKFLOW);
  assert.match(row, /methodCredit: 0, independentReviewPending: true/,
    "Proof execution was zero-credit; reviewed reconciliation must remain separate");
  assert.match(row, /successfulOwn2316Print: 1/);
  assert.match(row, /successfulOwnAlphalistSource: 1/);
  assert.match(source("scripts/qa/tenant-batches/year-end-json-http.mjs"),
    /victim\.org\.id > attacker\.org\.id/);
  assert.match(wf, /postgres:16/);
  assert.doesNotMatch(wf, /vercel deploy|db:migrate:production|npm run deploy/i);
  assert.equal(YEAR_END_RECEIPTS.length, 2);
  const route = manifest.allApiRouteFiles[ROUTE];
  assert.equal(route.gitBlobSha, YEAR_END_SOURCE_PINS[ROUTE]);
  for (const spec of YEAR_END_RECEIPTS) {
    const method = route.methods.find(m => m.name === spec.method);
    assert.equal(method?.status, "COVERED", spec.method + ": current-source proof required");
    assert.equal(method.reviewedUncertified, undefined, spec.method + ": superseded hold");
    const p = method.testedBy;
    assert.equal(p?.file, PROOF);
    assert.equal(p?.line, spec.line);
    assert.equal(p?.workflowFile, WORKFLOW);
    assert.equal(p?.routeBlobSha, YEAR_END_SOURCE_PINS[ROUTE]);
    assert.equal(p?.proofBlobSha, YEAR_END_SOURCE_PINS[PROOF]);
    assert.equal(p?.workflowBlobSha, YEAR_END_SOURCE_PINS[WORKFLOW]);
    assert.equal(p?.verifiedPrHeadSha, HEAD);
    assert.equal(p?.mergedProofCommit, "9022010d76b656b48d2e2640cf90bbe5fe7c16e8");
    assert.equal(p?.proofPullRequest, 1804);
    assert.equal(p?.workflowRunId, RUN);
    assert.equal(p?.workflowJobId, JOB);
    assert.equal(p?.postgresMajor, 16);
    assert.equal(p?.evidence, "https://github.com/erwinmehehe/payrollph/actions/runs/" +
      RUN + "/job/" + JOB);
    assert.equal(p?.ownerIsOnlyReviewer, true);
    assert.equal(p?.independentSecurityReview, "PENDING");
    assert.equal(p?.independentPayrollReview, "PENDING");
    assert.equal(p?.independentlyAccepted, false);
    assert.equal(p?.productionCertified, false);
    assert.equal(p?.productionTested, false);
    assert.equal(p?.governmentFilingPerformed, false);
    assert.equal(p?.productionMoneyMoved, false);
    assert.deepEqual(p?.methodActions, spec.actions);
    assert.deepEqual([p?.ownPositiveLine, p?.foreignDenialLine,
      p?.forgedSelectorLine, p?.unchangedDbLine], spec.lines);
    const lines = row.split("\n");
    spec.lines.forEach((n, i) => {
      assert.ok(lines[n - 1]?.includes(spec.anchors[i]),
        spec.method + " " + PROOF + ":" + n + " missing observed evidence");
    });
  }
  for (const method of ["GET", "POST"]) {
    const legacy = manifest.allApiRouteFiles[
      "src/app/api/year-end/prior-evidence/route.ts"].methods.find(m => m.name === method);
    assert.equal(legacy?.status, "COVERED");
    assert.equal(legacy?.testedBy?.prNumber, 1730, "Old prior-evidence is separate");
  }
  const standaloneRead = manifest.allApiRouteFiles[
    "src/app/api/billing/subscription/route.ts"].methods.find(m => m.name === "GET");
  assert.equal(standaloneRead?.status, "COVERED", "Unrelated billing read is unchanged");
  for (const name of ["start", "cancel"]) {
    const billing = manifest.allApiRouteFiles[
      "src/app/api/billing/subscription/" + name + "/route.ts"].methods.find(m => m.name === "POST");
    assert.ok(["GAP", "COVERED"].includes(billing?.status));
    if (billing.status === "COVERED") {
      assert.equal(billing.testedBy?.workflowRunId, 42254118161,
        "Subscription proof must belong to the independent billing PR");
      assert.equal(billing.testedBy?.file, "scripts/qa/tenant-billing-subscription-http.mjs");
    }
  }
  const actualMethodCount = Object.values(manifest.allApiRouteFiles)
    .reduce((sum, route) => sum + route.methods.length, 0);
  assert.equal(manifest.metrics.methods, actualMethodCount);
  assert.equal(manifest.metrics.coveredAfter + manifest.metrics.publicByDesign + (manifest.metrics.privilegedOperationsTokenOnly ?? 0) +
    manifest.metrics.gap, manifest.metrics.methods);
  assert.match(manifest.acceptanceStatus, /^NOT ACCEPTED:/);
  assert.equal(manifest.metrics.scopedPagesAndActions, 21);
  return YEAR_END_RECEIPTS.length;
}
