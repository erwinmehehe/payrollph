import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const manifest=JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json","utf8"));
const expected=[
"GET jobs/cron","GET jobs/dispatch-readiness","GET jobs/status",
"POST jobs/tick","POST webhooks/drain","GET capabilities","GET readiness",
"GET readiness/billing","GET readiness/database-target","GET readiness/deployment",
"GET readiness/pilot-status"
];
test("only eleven approved methods use the token-only class; zero tenant proof credits",()=>{
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
  assert.equal(workspace.status,"GAP","tenant-scoped 503 is not operator-only proof");
  assert.equal(workspace.testedBy,null);
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
