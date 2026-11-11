/**
 * Real, fictional PostgreSQL 16 + production-mode localhost HTTP proof.
 * Reproduces cross-employer login identity disclosure in worker-profile GET:
 * another employer's login points at an A worker without belonging to A.
 * No providers, production DB, payroll operations or method credits.
 */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";

const APP="http://127.0.0.1:3000";
const DB="postgresql://postgres:postgres@127.0.0.1:5432/app_db";
export function requireDisposableWorkerProfileEnv(env=process.env) {
  const required={
    CI:"true",GITHUB_ACTIONS:"true",NODE_ENV:"production",
    HCM_WORKER_PROFILE_IDENTITY_PROOF:"fictional-pg16-only",
    BUILD_BLOCK_ACCEPTANCE_MODE:"synthetic-postgres-only",
    DATABASE_URL:DB,APP_BASE_URL:APP,SECURITY_SMOKE_URL:APP,
    TRUSTED_APP_ORIGINS:APP,DEMO_MODE:"false",REQUIRE_PRIVILEGED_MFA:"true",
    WORKER_ENABLED:"false",CENTRAL_SCHEDULER_ENABLED:"false",
    PAYMONGO_DISBURSEMENTS_ENABLED:"false",XENDIT_PAYOUTS_ENABLED:"false",
    XENDIT_BILLING_ENABLED:"false",OPENAI_AUTOMATION_DRAFT_ENABLED:"false",
  };
  for(const [key,expect] of Object.entries(required)) assert.equal(env[key],expect,"WORKER_PROFILE_PROOF_REFUSED: "+key);
  for(const secret of [
    "NEON_DATABASE_URL","DATABASE_URL_PRODUCTION","PAYMONGO_SECRET_KEY","XENDIT_SECRET_KEY",
    "RESEND_API_KEY","OPENAI_API_KEY","STRIPE_SECRET_KEY","SMTP_URL","SMTP_PASSWORD",
  ]) assert.ok(!env[secret],"WORKER_PROFILE_PROOF_REFUSED: "+secret);
  return true;
}

async function main(){
  // Require this guard before importing application/database modules.
  requireDisposableWorkerProfileEnv();
  const [{db,pool},s,orm,fixture]=await Promise.all([
    import("../../src/db/index.ts"),import("../../src/db/schema.ts"),
    import("drizzle-orm"),import("./tenant-table-http.mjs"),
  ]);
  const {and,asc,eq,inArray}=orm;
  try{
    const version=Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(version>=160000&&version<170000,"WORKER_PROFILE_PROOF_REFUSED: PostgreSQL 16 only");
    for(const table of [s.organizations,s.users,s.employees,s.auditEvents]) {
      assert.equal((await db.select().from(table).limit(1)).length,0,"WORKER_PROFILE_PROOF_REFUSED: preexisting non-fictional records");
    }
    const nonce=randomUUID().replaceAll("-","").slice(0,12);
    const A=await fixture.seedEmployer("ATTA",nonce,fixture.standaloneMakeSession);
    const B=await fixture.seedEmployer("ATTB",nonce,fixture.standaloneMakeSession);
    const V=await fixture.seedEmployer("VICTIM",nonce,fixture.standaloneMakeSession);
    for(const field of ["org","worker","unit","entity"])
      assert.ok(V[field].id>A[field].id&&V[field].id>B[field].id,
        "Existing higher-ID victim is required: "+field);
    const otherAWorker=await fixture.addWorker(A,"UNRELATED");

    async function account(label,employee,memberships){
      const [user]=await db.insert(s.users).values({
        email:("worker-profile-"+label+"-"+nonce+"@example.invalid").toLowerCase(),
        name:"WP-SCOPE-"+label+"-"+nonce,role:"employee",employeeId:employee.id,
        passwordHash:"fictional-not-a-login-password",
      }).returning();
      await db.insert(s.userOrganizations).values(memberships.map(m=>({
        userId:user.id,organizationId:m.org.id,role:"employee",active:m.active!==false,
        workerEmployeeId:m.workerEmployeeId??null,
      })));
      return user;
    }
    // Positive A/B/V identities, plus an archived A member and a legitimate
    // shared A+B user. Null legacy links and exact tenant worker links work.
    const aLogin=await account("OWN-A",A.worker,[
      {org:A.org,workerEmployeeId:A.worker.id}]);
    const bLogin=await account("OWN-B",B.worker,[
      {org:B.org,workerEmployeeId:B.worker.id}]);
    const vLogin=await account("OWN-V",V.worker,[
      {org:V.org,workerEmployeeId:V.worker.id}]);
    const archivedA=await account("ARCHIVED-A",A.worker,[{org:A.org,active:false}]);
    const sharedAB=await account("SHARED-A-B",A.worker,[{org:A.org},{org:B.org}]);
    // An inconsistent users.employee_id (no scoped FK) must not let
    // unrelated B/V accounts appear in A's linked login evidence.
    const foreignB=await account("PRIVATE-B-ACCOUNT",A.worker,[{org:B.org}]);
    const foreignV=await account("PRIVATE-V-ACCOUNT",A.worker,[{org:V.org}]);
    const foreignVForB=await account("PRIVATE-V-ON-B",B.worker,[{org:V.org}]);
    // Even an A membership cannot override an explicit conflicting
    // per-membership worker pointer; never misreport this account as A.worker.
    const mismatch=await account("MISMATCH-A",A.worker,[
      {org:A.org,workerEmployeeId:otherAWorker.id}]);
    const privateIds=[foreignB.id,foreignV.id,foreignVForB.id];
    async function protectedRows(){
      return {
        users:await db.select().from(s.users)
          .where(inArray(s.users.id,privateIds)).orderBy(asc(s.users.id)),
        memberships:await db.select().from(s.userOrganizations)
          .where(inArray(s.userOrganizations.userId,privateIds))
          .orderBy(asc(s.userOrganizations.id)),
        workers:await db.select().from(s.employees)
          .where(inArray(s.employees.organizationId,[A.org.id,B.org.id,V.org.id]))
          .orderBy(asc(s.employees.id)),
        audits:await db.select().from(s.auditEvents)
          .where(inArray(s.auditEvents.organizationId,[A.org.id,B.org.id,V.org.id]))
          .orderBy(asc(s.auditEvents.id)),
      };
    }
    const before=await protectedRows();
    const path=(orgId,employeeId)=>"/api/hcm/worker-profile?organizationId="+orgId+"&employeeId="+employeeId;
    async function call(actor,orgId,employeeId){
      return fixture.standaloneRequest(path(orgId,employeeId),{cookie:actor.cookie});
    }
    function own(response,actor,expected,forbidden){
      assert.equal(response.status,200,"Own worker-profile GET must succeed");
      assert.equal(response.json?.employee?.id,actor.worker.id,
        "Real persisted same-employer worker is required");
      assert.equal(response.json?.employee?.organizationId,actor.org.id);
      const identities=response.json?.identities;
      assert.ok(Array.isArray(identities)&&identities.length===expected.length,
        "Identities must contain precisely this employer's worker-linked accounts");
      const ids=identities.map(row=>row.user?.id).sort((a,b)=>a-b);
      assert.deepEqual(ids,expected.map(x=>x.id).sort((a,b)=>a-b));
      for(const linked of identities){
        assert.ok(linked.membership&&linked.membership.id,
          "No linked identity without a real selected-employer membership");
      }
      const body=response.text;
      for(const bad of forbidden){
        assert.ok(!body.includes(bad.email),"Private foreign login email leaked");
        assert.ok(!body.includes(bad.name),"Private foreign login name leaked");
        assert.ok(!ids.includes(bad.id),"Foreign login ID leaked");
      }
      return identities;
    }
    const identitiesA=own(await call(A,A.org.id,A.worker.id),A,
      [aLogin,archivedA,sharedAB],[foreignB,foreignV,foreignVForB,mismatch]);
    assert.ok(identitiesA.some(x=>x.user.id===archivedA.id&&x.membership.active===false),
      "Do not lose archived A membership needed for separation history");
    const bOwn=own(await call(B,B.org.id,B.worker.id),B,[bLogin],
      [foreignB,foreignV,foreignVForB,aLogin,mismatch]);
    const vOwn=own(await call(V,V.org.id,V.worker.id),V,[vLogin],
      [foreignB,foreignV,foreignVForB,aLogin,mismatch]);
    assert.equal(bOwn.length,1);assert.equal(vOwn.length,1);
    const foreignOrg=await call(A,V.org.id,V.worker.id);
    assert.equal(foreignOrg.status,403,
      "A owner cannot fetch existing higher-ID V employer worker");
    const foreignWorker=await call(A,A.org.id,V.worker.id);
    assert.equal(foreignWorker.status,404,
      "A owner cannot forge existing higher-ID V worker under A employer");
    const reversed=await call(B,A.org.id,A.worker.id);
    assert.equal(reversed.status,403,"B owner cannot request A employer");
    for(const response of [foreignOrg,foreignWorker,reversed]){
      for(const privateAccount of [foreignB,foreignV,foreignVForB]) {
        assert.ok(!response.text.includes(privateAccount.email));
        assert.ok(!response.text.includes(privateAccount.name));
      }
    }
    assert.deepEqual(await protectedRows(),before,
      "GETs or denied requests changed foreign login, membership, worker or audit SQL");
    console.log("TENANT_WORKER_PROFILE_ACCOUNT_PG16_PASS "+JSON.stringify({
      fictionalPostgres16:true,realHttp:true,employers:3,
      highIdVictim:true,ownPopulatedReads:3,foreignEmployerDenials:2,
      foreignWorkerIdDenials:1,foreignUnrelatedLoginsExcluded:3,
      inconsistentMembershipBindingExcluded:true,
      archivedEmployerIdentityRetained:true,sharedEmployerIdentityRetained:true,
      foreignSqlAndAuditUnchanged:true,providerCalls:0,newMethodCredits:0,
      independentlyAccepted:false,productionCertified:false,
    }));
  }finally{await pool.end()}
}

if(process.argv[1]?.endsWith("tenant-worker-profile-account-http.mjs")){
  main().catch(e=>{console.error("TENANT_WORKER_PROFILE_ACCOUNT_PG16_FAIL",e?.stack??String(e));process.exitCode=1});
}
