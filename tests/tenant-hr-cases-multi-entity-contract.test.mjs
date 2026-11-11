import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {
  ORIGIN,PINS,blob,verifyPins,requireDisposableMultiHr,
  assertDenied,assertSnapshotsEqual,
} from "../scripts/qa/tenant-hr-cases-multi-entity-contract.mjs";
const safe={
  CI:"true",GITHUB_ACTIONS:"true",NODE_ENV:"production",
  TENANT_HR_LEGAL_EMPLOYER_PROOF:"fictional-pg16-multi-entity-only",
  BUILD_BLOCK_ACCEPTANCE_MODE:"synthetic-postgres-only",
  DATABASE_URL:"postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL:ORIGIN,SECURITY_SMOKE_URL:ORIGIN,
  TRUSTED_APP_ORIGINS:ORIGIN,EMPLOYEE_HR_CASES_ENABLED:"true",
  MULTI_ENTITY_ENABLED:"true",EMPLOYEE_DOCUMENT_VAULT_ENABLED:"false",
  DEMO_MODE:"false",WORKER_ENABLED:"false",
  CENTRAL_SCHEDULER_ENABLED:"false",
  XENDIT_PAYOUTS_ENABLED:"false",XENDIT_BILLING_ENABLED:"false",
  PAYMONGO_DISBURSEMENTS_ENABLED:"false",
  FINAL_PAY_SIGNED_REVIEW_ENABLED:"false",PAYROLL_CALCULATION_HISTORY_ENABLED:"false",
};
test("multi-entity real HTTP can run only on empty fictional PG16 localhost",()=>{
  assert.equal(requireDisposableMultiHr(safe),true);
  for(const [key,value] of Object.entries({
    CI:"false",GITHUB_ACTIONS:"false",NODE_ENV:"development",
    TENANT_HR_LEGAL_EMPLOYER_PROOF:"live",
    BUILD_BLOCK_ACCEPTANCE_MODE:"production",
    DATABASE_URL:"postgresql://postgres:postgres@neon.invalid:5432/app_db",
    APP_BASE_URL:"https://real.invalid",SECURITY_SMOKE_URL:"https://real.invalid",
    MULTI_ENTITY_ENABLED:"false",EMPLOYEE_HR_CASES_ENABLED:"false",
    EMPLOYEE_DOCUMENT_VAULT_ENABLED:"true",
    XENDIT_PAYOUTS_ENABLED:"true",PAYMONGO_DISBURSEMENTS_ENABLED:"true",
    WORKER_ENABLED:"true",CRON_SECRET:"fake",OPENAI_API_KEY:"fake",
    SMTP_PASSWORD:"fake",NEON_DATABASE_URL:"postgresql://fake@fake.invalid/a",
  }))assert.throws(()=>requireDisposableMultiHr({...safe,[key]:value}),
    /HR_ENTITY_REFUSED/,key);
});
test("exact-source legal employer, API, feature flag, DB fixture pins cannot drift",()=>{
  assert.equal(Object.keys(PINS).length,7);
  for(const [path,sha] of Object.entries(PINS)){
    assert.match(sha,/^[a-f0-9]{40}$/);
    assert.equal(blob(readFileSync(path)),sha,path);
  }
  assert.equal(verifyPins(),true);
  assert.notEqual(blob("legitimate"),blob("legitimate altered"));
});
test("negative controls fail when foreign case, private marker or session leaks",()=>{
  const denied={status:404,text:'{"error":"Case not found."}',
    headers:new Headers({"cache-control":"private, no-store"})};
  assert.doesNotThrow(()=>assertDenied(denied,404,["PRIVATE-LEGAL-ENTITY"],"safe"));
  assert.throws(()=>assertDenied({...denied,status:200},404,[],"status"));
  assert.throws(()=>assertDenied({...denied,text:'{"cases":[{"id":1}]}'},404,[],"case"));
  assert.throws(()=>assertDenied({...denied,text:'{"error":"PRIVATE-LEGAL-ENTITY"}'},
    404,["PRIVATE-LEGAL-ENTITY"],"marker"));
  assert.throws(()=>assertDenied({...denied,headers:new Headers({
    "set-cookie":"__Host-linaw_session=leak"
  })},404,[],"session"));
  const before={cases:[{id:1,status:"open"}],messages:[],audit:[]};
  assert.doesNotThrow(()=>assertSnapshotsEqual(structuredClone(before),before,"unchanged"));
  assert.throws(()=>assertSnapshotsEqual({cases:[],messages:[],audit:[]},before,"changed"));
});
test("real HTTP tests own legal employer and refuses all cross-employer mutation",()=>{
  const source=readFileSync("scripts/qa/tenant-hr-cases-multi-entity-http.mjs","utf8");
  const guard=source.indexOf("requireDisposableMultiHr();");
  const pins=source.indexOf("verifyPins();");
  const imports=source.indexOf('import("../../src/db/index.ts")');
  assert.ok(guard>=0&&pins>guard&&imports>pins,
    "Do not load app/db before safety and exact-source preflight");
  for(const phrase of [
    "SHOW server_version_num","const [secondaryEntity]",
    "legalEmployersInA:2","assert.equal(ownReads,3)",
    "assert.equal(ownWrites,2)","assert.equal(blocked,12)",
    "A cannot PATCH real second legal employer case",
    "revoked entity grant denies PATCH",
    "A conflicting header and query selectors",
    "A query selects ungranted second legal employer",
    "assertSnapshotsEqual(await snapshot(),before,label)",
    "providerCalls:0,COEUploads:0,moneyMoved:false",
    "newMethodCredits:0",
  ])assert.ok(source.includes(phrase),"lost proof action: "+phrase);
  assert.match(source,/await fetch\(url,/);
  assert.match(source,/await db\.insert\(s\.employeeHrCases\)/);
  assert.match(source,/assert\.equal\(after\.auditEvents\.length,before\.auditEvents\.length\+1/);
});
