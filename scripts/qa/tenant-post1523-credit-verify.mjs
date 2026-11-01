/**
 * Review-only, fail-closed reconciliation of exactly three distinct, previously
 * uncredited methods. Historical PG16 HTTP receipts are not a CI bypass or
 * independent approval; no method, payroll or production release is authorized.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { assertLiveTenantCounts } from "../../tests/helpers/tenant-counts.mjs";
import { assertHistoricalDemandSourceCompatible } from "./tenant-wfm-demand-overlay-history.mjs";

export const POST_1523_CREDIT_SPECS = Object.freeze([
  {
    "key": "PUT benefits",
    "path": "src/app/api/benefits/route.ts",
    "workflow": ".github/workflows/tenant-benefit-catalog-put.yml",
    "workflowBlobSha": "8f4fbc9df427dbb2b352b7bb292284ee2753ce47",
    "evidence": {
      "file": "scripts/qa/tenant-benefit-catalog-put-http.mjs",
      "line": 90,
      "ownPositiveLine": 101,
      "secondaryOwnPositiveLine": 131,
      "foreignDenialLine": 169,
      "unchangedDbLine": 172,
      "forgedSelectorLine": 180,
      "victimIdOrderingLine": 147,
      "methodActions": [
        "first-employer seed",
        "concurrent first seed/replay",
        "legacy-global read without tenant overwrite"
      ],
      "prNumber": 1560,
      "workflowRunId": 40839189888,
      "reviewedHead": "e3229c1cbcd4f61f88a622074f45dccf18fab43d",
      "passedJob": "https://github.com/erwinmehehe/payrollph/actions/runs/40839189888/job/123331153761",
      "routeBlobSha": "f6a7f4803a8b0a72e6fbeb55c9cbead29c34c764",
      "proofBlobSha": "633f6c75c531ab9d22ce33ea0ccf8e49be41e18b",
      "scope": "Two independently authenticated owners create persisted own-employer benefit defaults, real higher-ID victim 403, forged organization selectors rejected 400, all employer plan/member/payroll/audit/outbox rows unchanged on denial. GET/POST/DELETE retain their separate previous proof.",
      "postgresMajor": 16,
      "verifiedMainCommit": "5a3c209dffb2198e8944d0781025c42b117024b0",
      "independentReview": "PENDING: this credit-promotion PR must be reviewed before merge",
      "productionCertified": false
    }
  },
  {
    "key": "PATCH self/performance/action-items",
    "path": "src/app/api/self/performance/action-items/route.ts",
    "workflow": ".github/workflows/tenant-self-action-items-http.yml",
    "workflowBlobSha": "0f7d35a798604c14ccbb099b1cd5874dddf3fc43",
    "evidence": {
      "file": "scripts/qa/tenant-self-action-items-http.mjs",
      "line": 113,
      "ownPositiveLine": 232,
      "secondaryOwnPositiveLine": 242,
      "foreignDenialLine": 200,
      "unchangedDbLine": 203,
      "forgedSelectorLine": 206,
      "victimIdOrderingLine": 175,
      "methodActions": [
        "in_progress",
        "completed"
      ],
      "prNumber": 1541,
      "workflowRunId": 40798614855,
      "reviewedHead": "d528eb30e5019190f68b40fae43595eabbe4cc3a",
      "passedJob": "https://github.com/erwinmehehe/payrollph/actions/runs/40798614855/job/123201034215",
      "routeBlobSha": "87da381fee787a65e1ae59c927a33bda5c9f0de4",
      "proofBlobSha": "6d09b6f8a561b5c629e6a92afd8fff668b001d32",
      "scope": "Both A/B linked employee sessions persist both own action-item transitions, stolen higher-ID victim item denied, forged employer/employee selectors denied or cannot redirect scope, victim items/events/audits unchanged, concurrent/revoked-membership controls and atomic-audit rollback.",
      "postgresMajor": 16,
      "verifiedMainCommit": "5a3c209dffb2198e8944d0781025c42b117024b0",
      "independentReview": "PENDING: this credit-promotion PR must be reviewed before merge",
      "productionCertified": false
    }
  },
  {
    "key": "POST workforce-planning/demand-handoff",
    "path": "src/app/api/workforce-planning/demand-handoff/route.ts",
    "workflow": ".github/workflows/tenant-wfp-demand-handoff-http.yml",
    "workflowBlobSha": "79d7b9d11ff394082ecd3137d39e5743ebaea888",
    "evidence": {
      "file": "scripts/qa/tenant-wfp-demand-handoff-http.mjs",
      "line": 271,
      "ownPositiveLine": 225,
      "secondaryOwnPositiveLine": 246,
      "foreignDenialLine": 192,
      "unchangedDbLine": 208,
      "forgedSelectorLine": 193,
      "victimIdOrderingLine": 142,
      "methodActions": [
        "created",
        "updated"
      ],
      "prNumber": 1544,
      "workflowRunId": 40798739712,
      "reviewedHead": "81e6a5918d6cc9aae79b0fc2311c19ec600fd211",
      "passedJob": "https://github.com/erwinmehehe/payrollph/actions/runs/40798739712/job/123201446961",
      "routeBlobSha": "52d0fbad61e5e9c514a7e5d95d45c7c812688bdc",
      "proofBlobSha": "c60700b5d600123bb4845b5eb949003597deddd9",
      "scope": "Three persisted own create and update results including independent A/B, real higher-ID victim employer denied, foreign plan/job/site/shift identifiers rejected, all employers' employee/payroll/staffing/audit rows unchanged on each negative; no provider or payroll write.",
      "postgresMajor": 16,
      "verifiedMainCommit": "5a3c209dffb2198e8944d0781025c42b117024b0",
      "independentReview": "PENDING: this credit-promotion PR must be reviewed before merge",
      "productionCertified": false
    }
  }
]);

const MAIN_AT_REVIEW = "5a3c209dffb2198e8944d0781025c42b117024b0";
/**
 * PR #1592's independent WRK-01 POST/PATCH receipts happen to share the same
 * reviewed-main SHA as PR #1591. That SHA denotes a review baseline, NOT an
 * exclusive proof owner. Explicitly recognize only these separately pinned
 * method identities; never allow arbitrary methods to borrow #1591's three
 * receipts or silently count staffing GET as covered.
 */
const COLOCATED_STAFFING_CREDIT_SPECS = Object.freeze([
  { key: "POST workforce/demand-staffing/policies", verb: "POST",
    actions: ["create", "idempotent replay"] },
  { key: "PATCH workforce/demand-staffing/policies", verb: "PATCH",
    actions: ["submit", "approve", "reject"] },
]);
const STAFFING_ROUTE = "src/app/api/workforce/demand-staffing/policies/route.ts";
const STAFFING_PROOF = "scripts/qa/tenant-wrk01-staffing-writes-http.mjs";
const STAFFING_CONTRACT = "scripts/qa/tenant-wrk01-staffing-writes-contract.mjs";
const STAFFING_WORKFLOW = ".github/workflows/tenant-wrk01-staffing-writes-http.yml";
const STAFFING_HASHES = Object.freeze({
  route: "513975b118713becbf98caffa7d813a5b8c33c71",
  proof: "b7b2d8941c40d264f734dd3fec5e69a5dc453ae2",
  contract: "a3360332c2d9e8b502dc952931ead719cc349201",
  workflow: "1be21bad4a1a7c150c28c9f6c2f51d776de0da7e",
});

const REVIEW_PENDING = "PENDING: this credit-promotion PR must be reviewed before merge";
const REASON = "Provisional source-pinned four-part tenant isolation evidence: distinct owned success, real higher-ID victim denial, unchanged victim PostgreSQL and forged selector containment across all supported method actions. Independent security/coverage-owner review and this PR's exact-head CI remain mandatory; NOT a production or whole-batch certification.";
const blobSha = content => {
  const bytes = Buffer.from(content, "utf8");
  return createHash("sha1").update(Buffer.from("blob " + bytes.length + "\\0".replace("\\0", "\0")))
    .update(bytes).digest("hex");
};
const sourceLine = (source, n, label) => {
  const lines = source.split("\n");
  assert.ok(Number.isSafeInteger(n) && n > 0 && n <= lines.length &&
    lines[n - 1].trim(), label + ": missing executed source-line anchor");
  return lines[n - 1];
};

/** All 3 exact identities, 4-part source anchors, blob pins and acceptance gates. */
export function verifyPost1523Credits(manifest, read = file => readFileSync(file, "utf8")) {
  const promoted = Object.values(manifest.allApiRouteFiles).flatMap(row =>
    row.methods.filter(method => method.testedBy?.verifiedMainCommit === MAIN_AT_REVIEW)
      .map(method => method.name + " " + row.route)).sort();
  const expected = POST_1523_CREDIT_SPECS.map(spec => spec.key);
  const staffing = manifest.allApiRouteFiles[STAFFING_ROUTE];
  assert.equal(staffing?.route, "workforce/demand-staffing/policies");
  assert.equal(staffing.methods.find(method => method.name === "GET")?.status, "GAP",
    "Unproven staffing-policy GET must remain a GAP");
  const staffingWrites = staffing.methods.filter(method =>
    ["POST", "PATCH"].includes(method.name) && method.status === "COVERED");
  assert.ok(staffingWrites.length === 0 || staffingWrites.length === 2,
    "Independent WRK-01 POST/PATCH credits must be all-or-nothing");
  const extra = staffingWrites.length === 2 ? COLOCATED_STAFFING_CREDIT_SPECS : [];
  assert.deepEqual(promoted, [...expected, ...extra.map(spec => spec.key)].sort(),
    "Only three #1591 methods plus separately owned, fully credited WRK-01 POST/PATCH may share the historical review SHA");
  if (extra.length) {
    for (const spec of extra) {
      const method = staffing.methods.find(item => item.name === spec.verb);
      const proof = method?.testedBy;
      assert.equal(method.status, "COVERED", spec.key);
      assert.equal(proof?.file, STAFFING_PROOF, spec.key + ": separate proof owner required");
      assert.equal(proof.verifiedMainCommit, MAIN_AT_REVIEW);
      assert.equal(proof.reviewedHead, "fc5219fa4147c11e0b3d76b35c82754a4d875f4e");
      assert.equal(proof.prNumber, 1522);
      assert.equal(proof.workflowRunId, 40647378457);
      assert.equal(proof.passedJob,
        "https://github.com/erwinmehehe/payrollph/actions/runs/40647378457/job/122679238079");
      assert.equal(proof.postgresMajor, 16);
      assert.equal(proof.routeBlobSha, STAFFING_HASHES.route);
      assert.equal(proof.proofBlobSha, STAFFING_HASHES.proof);
      assert.equal(proof.contractBlobSha, STAFFING_HASHES.contract);
      assert.equal(proof.workflowBlobSha, STAFFING_HASHES.workflow);
      assert.deepEqual(proof.methodActions, spec.actions);
      assert.equal(proof.productionCertified, false);
      assert.match(proof.independentReview, /^PENDING/);
    }
    for (const [path, sha] of [
      [STAFFING_ROUTE, STAFFING_HASHES.route],
      [STAFFING_PROOF, STAFFING_HASHES.proof],
      [STAFFING_CONTRACT, STAFFING_HASHES.contract],
      [STAFFING_WORKFLOW, STAFFING_HASHES.workflow],
    ]) {
      // The reviewed GET-only WFM permissions patch changes this route's
      // whole-file Git SHA. Reconstruct and hash the original source before
      // reusing the *historical* POST/PATCH proof; never silently re-credit
      // changed write handlers or accept an arbitrary manifest hash.
      if (path === STAFFING_ROUTE) {
        assert.equal(assertHistoricalDemandSourceCompatible(path, staffing, read), sha,
          "WRK-01 historical write source must reconstruct byte-for-byte");
      } else {
        assert.equal(blobSha(read(path)), sha,
          "WRK-01 co-located receipt requires byte-identical source: " + path);
      }
    }
  }
  assert.ok(manifest.acceptanceStatus?.startsWith("NOT ACCEPTED"),
    "Review-only method evidence must never certify tenant-wide isolation");
  assertLiveTenantCounts(assert, manifest);
  for (const spec of POST_1523_CREDIT_SPECS) {
    const method = manifest.allApiRouteFiles[spec.path]?.methods.find(m =>
      m.name + " " + manifest.allApiRouteFiles[spec.path].route === spec.key);
    assert.equal(method?.status, "COVERED", spec.key + ": missing credit");
    assert.equal(method.reason, REASON, spec.key + ": provisional status must be explicit");
    assert.deepEqual(method.testedBy, spec.evidence,
      spec.key + ": exact original receipt, four-part pins and pending review must be unchanged");
    assert.equal(method.testedBy.independentReview, REVIEW_PENDING);
    assert.equal(method.testedBy.productionCertified, false);
    const route = read(spec.path);
    const proof = read(spec.evidence.file);
    const workflow = read(spec.workflow);
    assert.equal(blobSha(route), spec.evidence.routeBlobSha,
      spec.key + ": changed route requires new CI proof and security review");
    assert.equal(blobSha(proof), spec.evidence.proofBlobSha,
      spec.key + ": changed PG16 HTTP proof requires new CI receipt");
    assert.equal(blobSha(workflow), spec.workflowBlobSha,
      spec.key + ": changed disposable workflow requires new CI receipt");
    assert.match(workflow, /postgres:16/, spec.key + ": disposable PG16 required");
    assert.ok(workflow.includes(spec.evidence.file),
      spec.key + ": workflow must execute the actual method proof");
    assert.equal(spec.evidence.postgresMajor, 16);
    assert.equal(spec.evidence.verifiedMainCommit, MAIN_AT_REVIEW);
    for (const field of ["line","ownPositiveLine","secondaryOwnPositiveLine",
      "foreignDenialLine","forgedSelectorLine","unchangedDbLine","victimIdOrderingLine"]) {
      sourceLine(proof, spec.evidence[field], spec.key + " " + field);
    }
    if (spec.key === "PUT benefits") {
      assert.match(sourceLine(proof, 90, spec.key), /method: "PUT"/);
      assert.match(sourceLine(proof, 101, spec.key), /await put\(actor, actor\.org\.id\)/);
      assert.match(sourceLine(proof, 131, spec.key), /Promise\.all\(\[put\(b, b\.org\.id\)/);
      assert.match(sourceLine(proof, 169, spec.key), /await put\(attacker, v\.org\.id\)/);
      assert.match(sourceLine(proof, 170, spec.key), /deny\.status, 403/);
      assert.match(sourceLine(proof, 172, spec.key), /await checkAllUnchanged\(before/);
      assert.match(sourceLine(proof, 180, spec.key), /await put\(a, invalid\)/);
      assert.match(sourceLine(proof, 181, spec.key), /response\.status, 400/);
      assert.match(sourceLine(proof, 147, spec.key), /row\.id > Math\.max/);
      assert.match(proof, /for \(const attacker of \[a, b\]\)/);
      assert.match(proof, /assertOwnedDefaultPlans\(after\[i\]\.plans/);
    } else if (spec.key === "PATCH self/performance/action-items") {
      assert.match(sourceLine(proof, 232, spec.key), /patch\(attacker\.self\.cookie, ownItem/);
      assert.match(sourceLine(proof, 235, spec.key), /200, "own status with forged irrelevant selectors"/);
      assert.match(sourceLine(proof, 242, spec.key), /patch\(attacker\.self\.cookie, ownItem/);
      assert.match(sourceLine(proof, 243, spec.key), /200, "own status completion"/);
      assert.match(sourceLine(proof, 200, spec.key), /expectStatus\(await patch\(attacker\.self\.cookie/);
      assert.match(sourceLine(proof, 201, spec.key), /404, "foreign higher-ID action item"/);
      assert.match(sourceLine(proof, 203, spec.key), /deepEqual\(await snapshot\(victim\.org\.id\), victimBaseline/);
      assert.match(sourceLine(proof, 206, spec.key), /expectStatus\(await patch\(attacker\.self\.cookie, victimId/);
      assert.match(sourceLine(proof, 209, spec.key), /404, "forged victim organization and employee"/);
      assert.match(sourceLine(proof, 175, spec.key), /victim\.org\.id > attacker\.org\.id/);
      assert.match(proof, /for \(const attacker of \[a, b\]\)/);
      assert.match(proof, /"audit insertion error rolls back status and event"/);
    } else if (spec.key === "POST workforce-planning/demand-handoff") {
      assert.match(sourceLine(proof, 271, spec.key), /POST workforce-planning\/demand-handoff/);
      assert.match(sourceLine(proof, 225, spec.key), /await post\(actor, bodyFor\(actor\)\)/);
      assert.match(sourceLine(proof, 246, spec.key), /await post\(actor, bodyFor\(actor, \{ requiredHeadcount: 2 \}\)\)/);
      assert.match(sourceLine(proof, 192, spec.key), /bodyFor\(victim\), 403, "foreign"/);
      assert.match(sourceLine(proof, 193, spec.key), /planId: victim\.planId/);
      assert.match(sourceLine(proof, 208, spec.key), /await assertOthersUnchanged\(before/);
      assert.match(sourceLine(proof, 142, spec.key), /victim\[field\] > attacker\[field\]/);
      assert.match(proof, /for \(const attacker of \[a, b\]\)/);
      assert.match(proof, /assertDeniedHandoff\(denied, status/);
      assert.match(proof, /assertOwnedHandoffWrite\(\{/);
      assert.match(proof, /legitimateCreates: 3, legitimateUpdates: 3/);
    }
  }
  return POST_1523_CREDIT_SPECS.length;
}
