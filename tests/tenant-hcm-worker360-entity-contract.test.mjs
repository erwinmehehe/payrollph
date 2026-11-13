import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {
  ORIGIN, requireIsolatedWorker360, assertDenied, assertReadOnly,
} from "../scripts/qa/tenant-hcm-worker360-entity-contract.mjs";
const safe = {
  CI:"true",GITHUB_ACTIONS:"true",NODE_ENV:"production",
  TENANT_WORKER360_ENTITY_PROOF:"fictional-pg16-only",
  BUILD_BLOCK_ACCEPTANCE_MODE:"synthetic-postgres-only",
  DATABASE_URL:"postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL:ORIGIN,SECURITY_SMOKE_URL:ORIGIN,TRUSTED_APP_ORIGINS:ORIGIN,
  HCM_WORKER_360_ENABLED:"true",HCM_ENTERPRISE_PLAN_GATE_ENABLED:"false",
  MULTI_ENTITY_ENABLED:"true",DEMO_MODE:"false",REQUIRE_PRIVILEGED_MFA:"true",
  EMPLOYEE_DOCUMENT_VAULT_ENABLED:"false",WORKER_ENABLED:"false",
  CENTRAL_SCHEDULER_ENABLED:"false",PAYMONGO_DISBURSEMENTS_ENABLED:"false",
  XENDIT_PAYOUTS_ENABLED:"false",XENDIT_BILLING_ENABLED:"false",
  FINAL_PAY_SIGNED_REVIEW_ENABLED:"false",
};
test("Worker 360 HTTP proof refuses live DB, credentials and feature-off shortcuts",()=>{
  assert.equal(requireIsolatedWorker360(safe),true);
  for(const [name,value] of Object.entries({
    CI:"false",GITHUB_ACTIONS:"false",NODE_ENV:"development",
    TENANT_WORKER360_ENTITY_PROOF:"live",
    BUILD_BLOCK_ACCEPTANCE_MODE:"production",
    DATABASE_URL:"postgresql://example.invalid/live",
    APP_BASE_URL:"https://example.invalid",MULTI_ENTITY_ENABLED:"false",
    HCM_WORKER_360_ENABLED:"false",WORKER_ENABLED:"true",
    OPENAI_API_KEY:"fake",NEON_DATABASE_URL:"postgresql://example.invalid/db",
    XENDIT_SECRET_KEY:"fake",SMTP_PASSWORD:"fake",
  }))assert.throws(()=>requireIsolatedWorker360({...safe,[name]:value}),
      /WORKER360_ENTITY_REFUSED/,name);
});
test("synthetic CI embargo path reverts to original production gate",async()=>{
  const {HOLD_PATH,HOLD_BLOB_SHA,blob,applyIsolatedShim,restoreProductionHold} =
    await import("../scripts/qa/tenant-hcm-worker360-entity-build-hold.mjs");
  const original=readFileSync(HOLD_PATH,"utf8");
  assert.equal(blob(original),HOLD_BLOB_SHA);
  assert.match(original,/return !isolatedSalaryPreviewProof;/);
  const synthetic=applyIsolatedShim(original);
  assert.notEqual(synthetic,original);
  assert.match(synthetic,/Ephemeral CI-compiled Worker 360 proof only/);
  assert.match(synthetic,/env.TENANT_WORKER360_ENTITY_PROOF === "fictional-pg16-only"/);
  assert.equal(restoreProductionHold(synthetic),original);
  assert.throws(()=>applyIsolatedShim(original+"// unauthorized drift"),/WORKER360_ENTITY_REFUSED/);
  assert.throws(()=>restoreProductionHold(synthetic+"// unauthorized drift"),/WORKER360_ENTITY_REFUSED/);
});
test("denial and unchanged SQL controls reject false-positive proofs",()=>{
  const denied={status:404,text:'{"error":"Worker not found."}',
    json:{error:"Worker not found."},
    headers:new Headers({"cache-control":"private, no-store"})};
  assert.doesNotThrow(()=>assertDenied(denied,404,["SECRET"],"safe"));
  assert.throws(()=>assertDenied({...denied,status:200},404,[],"wrong status"));
  assert.throws(()=>assertDenied({...denied,json:{worker:{id:7}}},404,[],"worker leak"));
  assert.throws(()=>assertDenied({...denied,text:"SECRET"},404,["SECRET"],"marker leak"));
  assert.throws(()=>assertDenied({...denied,headers:new Headers({
    "set-cookie":"__Host-linaw_session=attacker",
  })},404,[],"session leak"));
  assert.doesNotThrow(()=>assertReadOnly([{id:1}],structuredClone([{id:1}]),"read"));
  assert.throws(()=>assertReadOnly([{id:1}],[{id:2}],"mutation"));
});
test("real HTTP runner has owned, foreign, revoked and historical source controls",()=>{
  const s=readFileSync("scripts/qa/tenant-hcm-worker360-entity-http.mjs","utf8");
  assert.ok(s.indexOf("requireIsolatedWorker360();")>=0);
  assert.ok(s.indexOf("requireIsolatedWorker360();")<
    s.indexOf('import("../../src/db/index.ts")'),
    "Environment guard must precede DB imports");
  for(const phrase of [
    "SHOW server_version_num","W3-PRIVATE-SECOND-",
    "A second entity forged query","A second entity forged header",
    "A victim worker forged inside own employer GET",
    "A victim worker forged inside own employer SSR",
    "B victim worker forged inside own employer GET",
    "A foreign victim legal employer forged query",
    "A foreign victim legal employer forged SSR query",
    "A foreign victim legal employer forged header",
    "A foreign entity SSR","A duplicate entity selector",
    "A duplicate worker ID","revoked primary entity SSR",
    "all grants revoked","foreignTransfer","unknownLegacy",
    "assertReadOnly(before,await snapshot(),label)",
    "assert.equal(ownApi,5)","assert.equal(ownPages,5)",
    "assert.equal(denials,21)",
    "sourceCredits:0,productionActivated:false",
  ])assert.ok(s.includes(phrase),"Missing real negative proof: "+phrase);
  assert.ok(s.includes("api.json.employmentEvents.preview.items[0].id"));
  assert.ok(s.includes("assert.equal(page.status,200"));
});
