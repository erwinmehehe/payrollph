/**
 * SOLO_VERIFIED_DEV_RECOVERY candidate: one parameterized denial-only HTTP
 * proof over eleven approved privileged operations. No valid operation token
 * is ever sent; this MUST NOT execute any scheduler tick, drain or provider.
 * Real Next HTTP + disposable PostgreSQL 16, never production resources.
 */
import assert from "node:assert/strict";
import test from "node:test";

const BASE = "http://127.0.0.1:3000";
const TOKENS = Object.freeze({
  CRON_SECRET: "fictional-cron-authority-aaaaaaaaaaaaaaaaaaaa",
  WORKER_TOKEN: "fictional-worker-authority-bbbbbbbbbbbbbbbbbbbb",
  SCHEDULER_MONITOR_TOKEN: "fictional-monitor-authority-cccccccccccccccccc",
  READINESS_TOKEN: "fictional-readiness-authority-dddddddddddddddddd",
  HEALTH_TOKEN: "fictional-health-authority-eeeeeeeeeeeeeeeeeeee",
});
const SPEC = Object.freeze([
  ["GET","jobs/cron","authorization","CRON_SECRET",401],
  ["GET","jobs/dispatch-readiness","x-worker-token","WORKER_TOKEN",401],
  ["GET","jobs/status","x-scheduler-monitor-token","SCHEDULER_MONITOR_TOKEN",401],
  ["POST","jobs/tick","x-worker-token","WORKER_TOKEN",401],
  ["POST","webhooks/drain","x-worker-token","WORKER_TOKEN",401],
  ["GET","capabilities","x-readiness-token","READINESS_TOKEN",404],
  ["GET","readiness","x-readiness-token","READINESS_TOKEN",401],
  ["GET","readiness/billing","x-health-token","HEALTH_TOKEN",404],
  ["GET","readiness/database-target","x-readiness-token","READINESS_TOKEN",404],
  ["GET","readiness/deployment","x-readiness-token","READINESS_TOKEN",404],
  ["GET","readiness/pilot-status","x-readiness-token","READINESS_TOKEN",404],
]);
const FORBIDDEN = [
 "deploymentSha","deploymentEnvironment","databaseName","projectId","branchId",
 "endpointId","roleName","schemaPresence","metrics","pilotReady","criticalBlockers",
 "launchBlockers","jobs","results","drained","schedulerState","jobName",
 "financial","payroll","applicant","marketingLeads","fictional-tenant-private-marker"
];
function refuse(why) { throw Error("TOKEN_ONLY_REFUSED: " + why); }
function guard() {
  for(const [key,want] of Object.entries({
    CI:"true",GITHUB_ACTIONS:"true",NODE_ENV:"production",
    TENANT_PRIVILEGED_MODE:"fictional-pg16-negative-only",
    TENANT_SECOND_PASS_MODE:"isolated-ci-only",
    SECURITY_SMOKE_URL:BASE, CENTRAL_SCHEDULER_ENABLED:"false",
    WORKER_ENABLED:"false", PAYMONGO_DISBURSEMENTS_ENABLED:"false",
    XENDIT_PAYOUTS_ENABLED:"false", XENDIT_BILLING_ENABLED:"false",
    FINAL_PAY_SIGNED_REVIEW_ENABLED:"false",
    EXACT_THIRTEENTH_CENTAVOS_ENABLED:"false",
    PAYROLL_CALCULATION_HISTORY_ENABLED:"false",
    NEXT_CSP_ENABLED:"false",
    PAYMONGO_SECRET_KEY:"",XENDIT_SECRET_KEY:"",XENDIT_PAYOUT_SECRET_KEY:"",
    RESEND_API_KEY:"",POSTMARK_SERVER_TOKEN:"",SMTP_URL:"",STRIPE_SECRET_KEY:"",
  })) if(process.env[key] !== want) refuse(key+" cannot depart from disposable test profile");
  for(const [key,value] of Object.entries(TOKENS))
    if(process.env[key] !== value) refuse(key+" must be a fictional isolated test credential");
  let db;
  try {db=new URL(process.env.DATABASE_URL);}catch{refuse("isolated DB URL missing");}
  if(db.protocol!=="postgresql:" || db.hostname!=="127.0.0.1" ||
    db.port!=="5432" || db.pathname!=="/app_db" ||
    db.username!=="postgres" || db.password!=="postgres" ||
    db.search || db.hash) refuse("database must be disposable PostgreSQL localhost");
}
async function request(method,route,headers) {
  const response=await fetch(BASE+"/api/"+route,{
    method,headers,redirect:"manual",cache:"no-store",
    ...(method==="POST"?{body:"{}"}:{})
  });
  const text=await response.text();
  return {status:response.status,text,headers:response.headers};
}
function deny(response,status,label) {
  assert.equal(response.status,status,label+": existing denial status must be retained");
  assert.ok(response.text.length<=500,label+": unexpected report-sized denial");
  for(const field of FORBIDDEN) assert.ok(!response.text.includes(field),
    label+": denied response leaked restricted report/tenant/infrastructure material");
  assert.ok(!response.headers.get("location"),label+": denied operations cannot redirect to a report");
}
test("eleven privileged operations refuse missing/wrong/header/type credentials over real HTTP and disposable PG16", async t=>{
  guard(); // refusal occurs before any DB import or HTTP
  const {pool}=await import("../../src/db/index.ts");
  try{
    const result=await pool.query("SHOW server_version_num");
    assert.equal(Math.floor(Number(result.rows[0].server_version_num)/10000),16,
      "actual disposable PostgreSQL 16 required");
    for(const [method,route,header,secret,status] of SPEC){
      await t.test(method+" /api/"+route, async()=>{
        const good=TOKENS[secret];
        const format=(v)=>header==="authorization"?"Bearer "+v:v;
        const cases=[
          ["missing token",{}],
          ["wrong token",{[header]:format("fictional-wrong-token-value-ffffffffffffffff")}],
          ["wrong header name",{"x-unrelated-credential":format(good)}],
        ];
        const other=secret==="WORKER_TOKEN"?"SCHEDULER_MONITOR_TOKEN":"WORKER_TOKEN";
        cases.push(["wrong token type",{[header]:format(TOKENS[other])}]);
        for(const [name,headers] of cases){
          const reply=await request(method,route,headers);
          deny(reply,status,route+" "+name);
        }
      });
    }
    // No authorized requests were sent; no worker, tick, drain or provider call occurred.
    console.log(JSON.stringify({
      label:"SOLO_VERIFIED_DEV_RECOVERY",postgresMajor:16,
      methods:SPEC.length,deniedCases:SPEC.length*4,authorizedCalls:0,
      schedulerTicks:0,drainCalls:0,providerCalls:0,
      methodCoverageCredits:0,independentReview:"PENDING",productionCertified:false
    }));
  }finally{await pool.end();}
});
