import assert from "node:assert/strict";
import test from "node:test";
import {createHash,randomBytes} from "node:crypto";
import {readFileSync,realpathSync} from "node:fs";
import {basename,dirname,resolve} from "node:path";
import {and,eq,sql} from "drizzle-orm";

const mode=process.env.FIRST_PAYROLL_CONNECTED_ACCEPTANCE_MODE;
const local=mode==="isolated-local-only";
const ci=process.env.CI==="true"&&process.env.GITHUB_ACTIONS==="true";
const ready=(()=>{
  if(!local&&!ci)return false;
  const url=new URL(process.env.DATABASE_URL??"");
  assert.equal(url.hostname,"127.0.0.1");assert.equal(url.pathname,"/app_db");
  if(local)assert.match(url.port,/^54\d{3}$/);else assert.equal(url.port,"5432");
  return true;
})();
if(mode&&!local)throw Error("Unknown connected first payroll acceptance mode");

test("real private-invite signup enters onboarding and obeys expiry without fabricated email verification",{skip:!ready},async()=>{
  const {db,pool}=await import("../src/db");
  if(local){
    assert.equal(process.platform,"win32");
    const fixture=resolve(process.env.FIRST_PAYROLL_LOCAL_FIXTURE_DIR??"");
    const outputRoot=resolve(import.meta.dirname,"../../../outputs");
    assert.equal(dirname(dirname(fixture)),outputRoot);assert.equal(basename(fixture),"data");
    assert.match(basename(dirname(fixture)),/^first-payroll-connected-[a-z0-9-]+$/);
    assert.equal(realpathSync(fixture).toLowerCase(),fixture.toLowerCase());
    assert.equal(readFileSync(resolve(fixture,"SYNTHETIC_ONLY"),"utf8"),"empty-fictional-fixture\n");
    const actual=await pool.query("SELECT current_setting('data_directory') AS dir");
    assert.equal(resolve(actual.rows[0].dir).toLowerCase(),fixture.toLowerCase());
  }
  const {organizations,subscriptions,users,userOrganizations}=await import("../src/db/schema");
  const {saasSignupVerifications}=await import("../src/lib/saas-billing-schema");
  const {isSelfServeOrganization,requireSaasPaidWrites}=await import("../src/lib/saas-workspace-access");
  const {POST}=await import("../src/app/api/signup/route");
  const suffix=randomBytes(8).toString("hex"),email=`first-payroll-${suffix}@example.test`;
  const code=randomBytes(32).toString("hex"),digest=(value:string)=>createHash("sha256").update(value).digest("hex");
  const settings={PUBLIC_SIGNUP_MODE:"pilot",APP_BASE_URL:"https://first-payroll.example.test",
    TRUSTED_APP_ORIGINS:"https://first-payroll.example.test",PRIVATE_PILOT_INVITE_ENABLED:"true",
    PRIVATE_PILOT_INVITE_EMAIL_SHA256:digest(email),PRIVATE_PILOT_INVITE_CODE_SHA256:digest(code),
    PRIVATE_PILOT_INVITE_EXPIRES_AT:new Date(Date.now()+3600000).toISOString(),
    FIRST_PAYROLL_CONNECTED_ENABLED:"true",PUBLIC_INTAKE_PROOF_ENABLED:"false"};
  const previous=Object.fromEntries(Object.keys(settings).map(key=>[key,process.env[key]]));
  Object.assign(process.env,settings);
  let organizationId:number|undefined,userId:number|undefined;
  const request=(invite=code)=>new Request("https://first-payroll.example.test/api/signup",{method:"POST",
    headers:{origin:"https://first-payroll.example.test","content-type":"application/json"},
    body:JSON.stringify({name:"Fictional Owner",company:"Fictional First Payroll "+suffix,email,
      password:"FictionalOnly!"+randomBytes(16).toString("hex"),acceptTerms:true,privatePilotInviteCode:invite})});
  try{
    const rejected=await POST(request("wrong-invite"));assert.equal(rejected.status,422);
    assert.equal((await db.select().from(users).where(eq(users.email,email))).length,0);
    const created=await POST(request());assert.equal(created.status,201);
    assert.equal((await created.json()).activated,true);
    const [owner]=await db.select().from(users).where(eq(users.email,email));assert.ok(owner?.active);userId=owner.id;
    const [membership]=await db.select().from(userOrganizations).where(eq(userOrganizations.userId,userId));
    organizationId=membership.organizationId;assert.equal(membership.role,"owner");
    assert.equal((await db.select().from(saasSignupVerifications).where(eq(saasSignupVerifications.organizationId,organizationId))).length,0,
      "Invitation activation must not manufacture email-verification evidence");
    assert.equal(await isSelfServeOrganization(organizationId,{FIRST_PAYROLL_CONNECTED_ENABLED:"false"}),false);
    assert.equal(await isSelfServeOrganization(organizationId),true,"Invited pilot must enter the same first-payroll journey");
    assert.equal(await requireSaasPaidWrites(organizationId),null,"Active pilot needs no payment");
    const duplicate=await POST(request());assert.equal(duplicate.status,202);
    assert.equal((await db.select().from(users).where(eq(users.email,email))).length,1);
    assert.equal((await db.select().from(userOrganizations).where(eq(userOrganizations.userId,userId))).length,1);
    await db.update(subscriptions).set({trialEndsAt:new Date("2000-01-01T00:00:00Z")})
      .where(eq(subscriptions.organizationId,organizationId));
    const expired=await requireSaasPaidWrites(organizationId);assert.equal(expired?.status,402);
    assert.equal((await expired!.json()).code,"PILOT_EXPIRED");
    process.env.FIRST_PAYROLL_CONNECTED_ENABLED="false";
    assert.equal(await requireSaasPaidWrites(organizationId),null,"Flag-off retains the existing legacy gate");
    process.env.FIRST_PAYROLL_CONNECTED_ENABLED="true";
    await db.update(subscriptions).set({provider:null}).where(eq(subscriptions.organizationId,organizationId));
    assert.equal(await isSelfServeOrganization(organizationId),false,"Legacy subscriptions are not newly enrolled pilots");
    assert.equal((await db.execute(sql`SELECT count(*)::int AS n FROM employees WHERE organization_id=${organizationId}`)).rows[0].n,0);
    assert.equal((await db.execute(sql`SELECT count(*)::int AS n FROM payroll_runs WHERE organization_id=${organizationId}`)).rows[0].n,0);
  }finally{
    for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    if(organizationId)await db.delete(organizations).where(eq(organizations.id,organizationId));
    if(userId)await db.delete(users).where(and(eq(users.id,userId),eq(users.email,email)));
    if(local)await pool.end();
  }
});
