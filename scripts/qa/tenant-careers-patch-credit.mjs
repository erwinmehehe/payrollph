import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const PATH = "src/app/api/careers/admin/route.ts";
export const CAREERS_PROOF_PINS = Object.freeze({
  "src/app/api/careers/admin/route.ts": "fc7920e19fc75389c5f5e7fe3cb4f90046028f00",
  "scripts/qa/tenant-edg01-careers-publication-http.mjs": "9f799cc2344561ab8f4a47a2c0ddc162335f8096",
  ".github/workflows/tenant-edg01-careers-publication-http.yml": "b84ba8d8001b1475c741809340dcb795943a96f7",
  "src/lib/careers-privacy-gates.ts": "f878db55d51c4f8a0a6ab4893ef8af5e80f4dff6",
  "src/lib/access.ts": "08d3481dbd20279a4a8aef64f0932f79bec48444",
  "src/lib/auth.ts": "b13275e0e09b629ddb679c55e7898da44c72ad20",
  "src/db/schema.ts": "3f504163c9847a99434a5e01a72c120dfd680a02",
  "src/lib/security-request.ts": "de996ebb7eb663aaebf65f8a963d955b8bc90c9d",
  "src/lib/rate-limit.ts": "05d7be3acb385e3542cf0ec3904a74796f0647b5",
  "src/lib/workflow-entity-hold.ts": "c907669dcff8cdbc969e7e6336779ff11065f07e",
  "src/lib/critical-release-flags.ts": "aa9867f795bbcbe9cfe42c6df7f64d0f0c4a9671",
  "scripts/qa/tenant-table-env.mjs": "05dcdcdbd513b0e257b6aefb5d9449117224b357",
  "scripts/qa/apply-isolated-baseline.mjs": "75b9e7f1b39a6ca5b2253086e519ae7d71229255",
  "scripts/qa/tenant-table-http.mjs": "31894982d768e34c1653be7c4335194f60233c6e",
  "scripts/qa/tenant-table-invariants.mjs": "52f9acded7750a722cb663b9eeb6ea0a709ecd9b",
  "src/db/index.ts": "7a5718d0a99ce5b3a7e94655aee7babd23c6e6",
  "docs/engineering/migration-proposals/careers-published.sql": "bd08b99cec0ed5a54342a760f2222fbe14b98ff8",
  "package-lock.json": "49a688969f37bd3fd690d313970221ff2d5f7fc2"
});
export const CAREERS_CREDIT_RECEIPT = Object.freeze({
  "file": "scripts/qa/tenant-edg01-careers-publication-http.mjs",
  "line": 200,
  "ownPositiveLine": 200,
  "foreignDenialLine": 220,
  "forgedSelectorLine": 224,
  "unchangedDbLine": 195,
  "victimIdOrderingLine": 159,
  "twoAttackerLine": 217,
  "auditRollbackLine": 278,
  "revokedMembershipDenialLine": 258,
  "scope": "Provisional one-method credit: two separately authenticated fictional owners, real third victim requisition ID > 6, three owned published SQL/audit transitions, two owned unpublished SQL/audit transitions, 20 refused real HTTP calls, wrong-org 403, forged victim job 409, denied changes leave all employer/payroll/audit snapshots unchanged, live company-wide membership and MFA checks, injected PostgreSQL audit INSERT rollback. No production careers activation or tenant-wide certification.",
  "postActions": [
    "publish",
    "unpublish"
  ],
  "attackerEmployers": 2,
  "ownedPublishes": 3,
  "ownedUnpublishes": 2,
  "verifiedDeniedCalls": 20,
  "victimRequisitionIdOverSix": true,
  "auditInsertRollback": true,
  "proofPullRequest": 1751,
  "verifiedPrHeadSha": "9d78cf39f82bc5f739e2927e19818b301ecaac56",
  "mergedProofCommit": "c2876177bce3278a34ec2323031d2102b6d80330",
  "workflowRunId": 41798531116,
  "workflowJobId": 126468332784,
  "evidence": "https://github.com/erwinmehehe/payrollph/actions/runs/41798531116/job/126468332784",
  "routeBlobSha": "fc7920e19fc75389c5f5e7fe3cb4f90046028f00",
  "proofBlobSha": "9f799cc2344561ab8f4a47a2c0ddc162335f8096",
  "workflowBlobSha": "b84ba8d8001b1475c741809340dcb795943a96f7",
  "postgresMajor": 16,
  "providerCalls": 0,
  "productionTested": false,
  "independentSecurityReview": "PENDING"
});

function gitBlobSha(data) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return createHash("sha1").update("blob " + bytes.length).update(Buffer.from([0])).update(bytes).digest("hex");
}

export function verifyCareersPatchCredit(manifest, read = readFileSync) {
  const route = manifest.allApiRouteFiles[PATH];
  assert.equal(route?.gitBlobSha, CAREERS_PROOF_PINS[PATH], "Careers route/source review drift");
  const matches = route.methods.filter(method => method.name === "PATCH");
  assert.equal(matches.length, 1, "Only one careers-admin PATCH method may be promoted");
  const method = matches[0];
  assert.equal(method.status, "COVERED", "Careers PATCH must not claim unsupported credit");
  assert.equal(method.reviewedUncertified, undefined, "Stale zero-credit exception not allowed");
  assert.deepEqual(method.testedBy, CAREERS_CREDIT_RECEIPT, "Exact executed PG16 proof receipt required");
  for (const [file, hash] of Object.entries(CAREERS_PROOF_PINS)) {
    assert.equal(gitBlobSha(read(file)), hash, "Executed careers route, workflow or dependency drift: " + file);
  }
  const lines = read(CAREERS_CREDIT_RECEIPT.file).toString("utf8").split("\n");
  for (const [field, token] of [
    ["ownPositiveLine", "const response = await patch(e, e.org.id, e.job.id, published, !published);"],
    ["foreignDenialLine", "await expectDenied(() => patch(attacker, victim.org.id, victim.job.id, false, true),"],
    ["forgedSelectorLine", "await expectDenied(() => patch(attacker, attacker.org.id, victim.job.id, false, true),"],
    ["unchangedDbLine", "assertUnchanged(before, await snapshotAll(), label);"],
    ["victimIdOrderingLine", "assert.ok(victim.job.id > 6,"],
    ["twoAttackerLine", "for (const attacker of [a, b]) {"],
    ["auditRollbackLine", "assertUnchanged(rollbackBefore, await snapshotAll(),"],
    ["revokedMembershipDenialLine", "revoked employer membership denies publication"]
  ]) assert.ok(lines[method.testedBy[field] - 1]?.includes(token),
    "Real HTTP four-part method proof anchor changed: " + field);
  const script = lines.join("\n");
  for(const token of [
    "const persistedVictimJob = await db.select",
    "assertPublicationTransition(before[i], after[i], {",
    "const rollbackHttp = await patch(victim, victim.org.id,",
    "assert.equal(rollbackHttp.status, 500,",
    "realOwnedPublishes: 3", "realOwnedUnpublishes: 2",
    "verifiedDeniedCalls: denials", "assert.equal(denials, 20);",
    "victimRequisitionIdOverSix: true, auditInsertRollback: true",
    "EDG01_CAREERS_PUBLICATION_REAL_HTTP"
  ]) assert.ok(script.includes(token), "Missing proven careers positive or victim safeguard: " + token);
  const workflow = read(".github/workflows/tenant-edg01-careers-publication-http.yml").toString("utf8");
  for(const token of ["postgres:16", "npm run db:push", "--migrate", "--prove",
    "MULTI_ENTITY_ENABLED: 'false'", "WORKER_ENABLED: 'false'",
    "CENTRAL_SCHEDULER_ENABLED: 'false'", "npm run build", "-H 127.0.0.1"])
    assert.ok(workflow.includes(token),"Disposable Careers proof safety gate missing: "+token);
  const routeSource=read(PATH).toString("utf8");
  const start=routeSource.indexOf("db.transaction(async tx =>");
  const grant=routeSource.indexOf("const liveGrant = await tx.execute",start);
  const update=routeSource.indexOf("update job_requisitions as req",grant);
  assert.ok(start>0 && grant>start && update>grant,"Commit-time tenant grant must precede publication write");
  const liveGrant=routeSource.slice(grant,update);
  for(const token of ["uo.organization_id = ${organizationId}","uo.active = true",
    "u.active = true","uo.org_unit_id is null","for share of uo, u"])
    assert.ok(liveGrant.includes(token),"Live company-wide employer proof missing: "+token);
  assert.ok(routeSource.includes("req.organization_id = ${organizationId}") &&
            routeSource.includes("req.careers_published = ${body.expectedPublished}"),
      "Owned requisition compare-and-swap must remain tenant bound");
  const all=Object.values(manifest.allApiRouteFiles).flatMap(x=>x.methods);
  assert.equal(all.length,manifest.metrics.methods);
  assert.equal(all.filter(x=>x.status==="COVERED").length,manifest.metrics.coveredAfter);
  assert.equal(all.filter(x=>x.status==="GAP").length,manifest.metrics.gap);
  assert.match(manifest.acceptanceStatus,/^NOT ACCEPTED:/);
  assert.equal(method.testedBy.independentSecurityReview,"PENDING");
  assert.equal(method.testedBy.productionTested,false);
  assert.equal(method.testedBy.providerCalls,0);
  return 1;
}
