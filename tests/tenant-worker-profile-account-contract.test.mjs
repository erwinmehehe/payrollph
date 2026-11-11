import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {requireDisposableWorkerProfileEnv} from "../scripts/qa/tenant-worker-profile-account-http.mjs";

const base="http://127.0.0.1:3000";
const safe={
  CI:"true",GITHUB_ACTIONS:"true",NODE_ENV:"production",
  HCM_WORKER_PROFILE_IDENTITY_PROOF:"fictional-pg16-only",
  BUILD_BLOCK_ACCEPTANCE_MODE:"synthetic-postgres-only",
  DATABASE_URL:"postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL:base,SECURITY_SMOKE_URL:base,TRUSTED_APP_ORIGINS:base,
  DEMO_MODE:"false",REQUIRE_PRIVILEGED_MFA:"true",
  WORKER_ENABLED:"false",CENTRAL_SCHEDULER_ENABLED:"false",
  PAYMONGO_DISBURSEMENTS_ENABLED:"false",XENDIT_PAYOUTS_ENABLED:"false",
  XENDIT_BILLING_ENABLED:"false",OPENAI_AUTOMATION_DRAFT_ENABLED:"false",
};

function assertWorkerProfileQueryIsEmployerBound(source){
  const start=source.indexOf("      id: users.id,");
  const end=source.indexOf("      id: separationRecords.id,",start);
  assert.ok(start>0&&end>start,"Missing selected linked-login lookup in worker-profile");
  const query=source.slice(start,end);
  assert.match(query,/\.from\(users\)/);
  assert.match(query,/\.innerJoin\(userOrganizations, and\(/);
  assert.match(query,/eq\(userOrganizations\.userId, users\.id\)/);
  assert.match(query,/eq\(userOrganizations\.organizationId, organizationId\)/);
  assert.match(query,/eq\(users\.employeeId, employeeId\)/);
  assert.match(query,/isNull\(userOrganizations\.workerEmployeeId\)/);
  assert.match(query,/eq\(userOrganizations\.workerEmployeeId, employeeId\)/);
  assert.doesNotMatch(query,/\.from\(users\)\.where\(eq\(users\.employeeId, employeeId\)\)/);
  assert.match(source,/eq\(employees\.organizationId, organizationId\)/);
  assert.match(source,/assertOrganizationRole\(/);
  assert.match(source,/assertScope\(access, employee\.orgUnitId\)/);
}

test("worker-profile linked logins require a real selected-employer membership",()=>{
  const source=readFileSync("src/app/api/hcm/worker-profile/route.ts","utf8");
  assert.doesNotThrow(()=>assertWorkerProfileQueryIsEmployerBound(source));
  const oldLookup=source.slice(0,source.indexOf("      id: users.id,"))+
    source.slice(source.indexOf("      id: users.id,")).replace(
      /\.from\(users\)[\s\S]*?\.where\(eq\(users\.employeeId, employeeId\)\)/,
      ".from(users).where(eq(users.employeeId, employeeId))");
  assert.throws(()=>assertWorkerProfileQueryIsEmployerBound(oldLookup),
    /innerJoin/,"Old broad account lookup must fail this contract");
  const unscoped=source.replace("eq(userOrganizations.organizationId, organizationId)",
    "eq(userOrganizations.userId, users.id)");
  assert.throws(()=>assertWorkerProfileQueryIsEmployerBound(unscoped),
    /organizationId/,"Dropping employer predicate must fail");
});

test("disposable proof blocks production, workers, providers and borrowed evidence",()=>{
  assert.equal(requireDisposableWorkerProfileEnv(safe),true);
  for(const patch of [
    {CI:"false"},{GITHUB_ACTIONS:"false"},{NODE_ENV:"development"},
    {DATABASE_URL:"postgresql://prod.example.com/private"},
    {DATABASE_URL:"postgresql://postgres:postgres@127.0.0.1:5432/prod"},
    {APP_BASE_URL:"https://example.invalid"},
    {SECURITY_SMOKE_URL:"https://example.invalid"},
    {WORKER_ENABLED:"true"},{CENTRAL_SCHEDULER_ENABLED:"true"},
    {PAYMONGO_DISBURSEMENTS_ENABLED:"true"},
    {XENDIT_BILLING_ENABLED:"true"},
    {OPENAI_API_KEY:"fake-test-token"},
    {NEON_DATABASE_URL:"postgresql://prod.example.com/private"},
    {HCM_WORKER_PROFILE_IDENTITY_PROOF:"production"},
  ]) assert.throws(()=>requireDisposableWorkerProfileEnv({...safe,...patch}),
    /WORKER_PROFILE_PROOF_REFUSED/,JSON.stringify(patch));
});

test("real PG16 HTTP challenge includes positive, leaked-identity and unchanged SQL assertions",()=>{
  const script=readFileSync("scripts/qa/tenant-worker-profile-account-http.mjs","utf8");
  const wf=readFileSync(".github/workflows/tenant-worker-profile-account-qa.yml","utf8");
  for(const marker of [
    'seedEmployer("ATTA"','seedEmployer("ATTB"','seedEmployer("VICTIM"',
    'account("OWN-A"','account("OWN-B"','account("OWN-V"',
    'account("PRIVATE-B-ACCOUNT"','account("PRIVATE-V-ACCOUNT"',
    'account("PRIVATE-V-ON-B"','account("MISMATCH-A"',
    "users.employee_id","linked.membership&&linked.membership.id",
    'own(await call(A,A.org.id,A.worker.id)',
    'own(await call(B,B.org.id,B.worker.id)',
    'own(await call(V,V.org.id,V.worker.id)',
    "foreignOrg.status,403","foreignWorker.status,404","reversed.status,403",
    "protectedRows(),before","foreignUnrelatedLoginsExcluded:3",
    "newMethodCredits:0","independentlyAccepted:false","productionCertified:false",
  ]) assert.ok(script.includes(marker),"Missing adversarial real-HTTP assertion: "+marker);
  assert.ok(script.indexOf("requireDisposableWorkerProfileEnv();")<
    script.indexOf('import("../../src/db/index.ts")'),"No DB import before preflight");
  assert.match(wf,/image: postgres:16/);
  assert.match(wf,/node --import tsx scripts\/qa\/tenant-worker-profile-account-http\.mjs/);
  assert.match(wf,/ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  assert.ok(wf.indexOf("run: npm run db:push")<wf.indexOf("run: node scripts/qa/apply-isolated-baseline.mjs"));
  assert.doesNotMatch(wf,/continue-on-error|secrets\./);
});
