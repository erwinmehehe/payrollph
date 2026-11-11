import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {verifyWorkspaceReadinessCredit} from "../scripts/qa/tenant-workspace-readiness-credit.mjs";
const manifest=JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json","utf8"));
const expected=[
"GET jobs/cron","GET jobs/dispatch-readiness","GET jobs/status",
"POST jobs/tick","POST webhooks/drain","POST hcm/work-items/escalate","GET capabilities","GET readiness",
"GET readiness/billing","GET readiness/database-target","GET readiness/deployment",
"GET readiness/pilot-status"
];
test("only twelve approved methods use the token-only class; zero tenant proof credits",()=>{
  const seen=Object.values(manifest.allApiRouteFiles).flatMap(x=>x.methods.map(m=>({key:m.name+" "+x.route,m})))
    .filter(x=>x.m.status==="PRIVILEGED-OPERATIONS-TOKEN-ONLY");
  assert.deepEqual(seen.map(x=>x.key).sort(),expected.sort());
  for(const {key,m} of seen){
    assert.equal(m.testedBy,null,key);
    assert.equal(m.privilegedOperation.methodCoverageCredits,0,key);
    assert.equal(m.privilegedOperation.evidenceLabel,"SOLO_VERIFIED_DEV_RECOVERY");
    assert.equal(m.privilegedOperation.exactHeadPg16Http,"PENDING");
    assert.equal(m.privilegedOperation.productionCertified,false);
  }
  const workspace=manifest.allApiRouteFiles["src/app/api/readiness/workspace/route.ts"].methods.find(x=>x.name==="GET");
  // This tenant-scoped readiness GET has its own real own/foreign/unchanged
  // PostgreSQL receipt; it must never borrow any token-only classification.
  assert.equal(workspace.status,"COVERED","readiness GET earns only a separate method-specific receipt");
  assert.equal(verifyWorkspaceReadinessCredit(manifest),1);
  assert.equal(workspace.testedBy?.independentSecurityReview,"PENDING");
  assert.equal(workspace.testedBy?.productionTested,false);
  const source=readFileSync("src/app/api/readiness/workspace/route.ts","utf8");
  assert.match(source,/getSessionUser/);
  assert.match(source,/assertOrganizationRole/);
  assert.match(source,/tenantReadinessUnavailable\(organizationId\)/);
});
test("negative-only harness cannot make any valid operation request",()=>{
  const src=readFileSync("scripts/qa/tenant-privileged-token-only-http.mjs","utf8");
  assert.match(src,/image|SHOW server_version_num/);
  assert.match(src,/methods:SPEC\.length,deniedCases:SPEC\.length\*4,authorizedCalls:0/);
  assert.match(src,/CENTRAL_SCHEDULER_ENABLED:"false"/);
  assert.doesNotMatch(src,/await tickScheduler\(|await drainWebhookRetries\(/);
});
