import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { hashPassword } from "../../src/lib/crypto";
import { auditEvents, employees, organizations, payrollRuns,
  timePunches, userOrganizations, users } from "../../src/db/schema";

/** Same-source HTTP acceptance against ONLY the disposable localhost CI app. */
const BASE = "http://127.0.0.1:3000";
const API = "/api/attendance/offline-claims";
const results: string[] = [];
let outcome = "BLOCKED";
let errorCode = "none";
const password = "FictionalOnly!" + randomUUID().replaceAll("-", "").slice(0, 20);

function safety() {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.OFFLINE_CLAIM_CONNECTED_MODE, "isolated-ci-only");
  assert.equal(process.env.QA_URL, BASE);
  assert.equal(process.env.DEMO_MODE, "false");
  assert.equal(process.env.FACE_OFFLINE_PUNCH_UI_ENABLED, "true");
  assert.notEqual(process.env.MULTI_ENTITY_ENABLED, "true");
  for (const key of ["PAYMONGO_DISBURSEMENTS_ENABLED",
    "XENDIT_PAYOUTS_ENABLED","XENDIT_PAYOUTS_LIVE_APPROVED",
    "FINAL_PAY_MANUAL_RELEASE_ENABLED","WFM_PUNCH_EVIDENCE_ENABLED"]) {
    assert.notEqual(process.env[key], "true", "Forbidden disbursement/evidence flag: " + key);
  }
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "5432");
  assert.equal(url.pathname, "/app_db");
  assert.equal(url.username, "postgres");
}
type Json = Record<string, any>;
class Actor {
  cookie = "";
  constructor(readonly role: string) {}
  async request(method: string, path: string, value?: unknown) {
    const headers = new Headers();
    if (this.cookie) headers.set("cookie", this.cookie);
    if (method !== "GET") {
      headers.set("origin", BASE);
      headers.set("content-type","application/json");
      headers.set("sec-fetch-site","same-origin");
    }
    const response = await fetch(BASE + path, {
      method, headers, body: value === undefined ? undefined : JSON.stringify(value),
      signal: AbortSignal.timeout(30000),
    });
    const cookie = response.headers.get("set-cookie");
    if (cookie) this.cookie = cookie.split(";")[0];
    const body = await response.json().catch(() => ({})) as Json;
    return {status:response.status,body};
  }
}
async function main() {
  safety();
  assert.equal((await db.select({id:organizations.id}).from(organizations)).length,0,
    "Refuse to seed a database that already contains employers");
  assert.equal((await db.select({id:users.id}).from(users)).length,0,
    "Refuse to seed existing users");
  assert.equal((await db.select({id:timePunches.id}).from(timePunches)).length,0,
    "Refuse to use a database with attendance ledger entries");
  assert.equal((await db.select({id:payrollRuns.id}).from(payrollRuns)).length,0,
    "Refuse to use a database with payroll runs");

  const suffix = randomUUID().slice(0,10);
  const [orgA,orgB] = await db.insert(organizations).values([
    {name:"Fictional Offline Employer A " + suffix,legalName:"Fictional Offline Employer A " + suffix},
    {name:"Fictional Offline Employer B " + suffix,legalName:"Fictional Offline Employer B " + suffix},
  ]).returning();
  const [workerA,workerB] = await db.insert(employees).values([
    { organizationId:orgA.id,employeeNo:"OFA-"+suffix,firstName:"Fictional",lastName:"Alpha",
      title:"QA Worker",avatarInitials:"FA",basicRate:"20000.00",startDate:"2026-01-01" },
    { organizationId:orgB.id,employeeNo:"OFB-"+suffix,firstName:"Fictional",lastName:"Beta",
      title:"QA Worker",avatarInitials:"FB",basicRate:"20000.00",startDate:"2026-01-01" },
  ]).returning();
  const specs = [
    {key:"employeeA",role:"employee",organizationId:orgA.id,employeeId:workerA.id},
    {key:"employeeB",role:"employee",organizationId:orgB.id,employeeId:workerB.id},
    {key:"hrA",role:"hr",organizationId:orgA.id,employeeId:null},
    {key:"ownerB",role:"owner",organizationId:orgB.id,employeeId:null},
    {key:"payrollA",role:"payroll",organizationId:orgA.id,employeeId:null},
  ] as const;
  const names = specs.map(row => ({
    name:"Fictional " + row.key,
    email:row.key.toLowerCase() + "." + suffix + "@example.test",
    role:row.role, employeeId:row.employeeId,
    passwordHash:hashPassword(password), totpEnabled:false,
  }));
  const inserted = await db.insert(users).values(names).returning();
  await db.insert(userOrganizations).values(inserted.map((user,i)=>({
    userId:user.id,organizationId:specs[i].organizationId,
    role:specs[i].role,workerEmployeeId:specs[i].employeeId,
  })));
  const actors = new Map<string,Actor>();
  for (const spec of specs) {
    const actor = new Actor(spec.key);
    const loggedIn = await actor.request("POST","/api/auth/login",{
      email:names[specs.indexOf(spec)].email,password,
    });
    assert.equal(loggedIn.status,200,"Synthetic " + spec.key + " must use the real login route");
    assert.ok(actor.cookie,"Missing real session cookie for " + spec.key);
    actors.set(spec.key,actor);
  }
  results.push("five real fictional-account sessions across two isolated employers");
  const get = (role:string) => {
    const actor = actors.get(role);
    assert.ok(actor);
    return actor;
  };
  const employeeA = get("employeeA"),employeeB = get("employeeB"),
    hrA = get("hrA"),ownerB=get("ownerB"),payrollA=get("payrollA");
  const anon = new Actor("anonymous");
  assert.equal((await anon.request("GET",API+"?organizationId="+orgA.id)).status,401);
  assert.equal((await employeeB.request("GET",API+"?organizationId="+orgA.id)).status,403);
  assert.equal((await ownerB.request("GET",API+"?organizationId="+orgA.id)).status,403);
  assert.equal((await payrollA.request("GET",API+"?organizationId="+orgA.id)).status,403);
  assert.equal((await hrA.request("GET",API+"?organizationId="+orgA.id)).status,200);
  assert.equal((await employeeA.request("GET",API+"?organizationId="+orgA.id)).status,200);
  results.push("employee, payroll and unrelated employer cannot read HR or foreign claims");

  const baseClaim = {
    organizationId:orgA.id,employeeId:workerA.id,clientEventId:randomUUID(),
    actionType:"clock_in",claimedAt:new Date(Date.now()-120000).toISOString(),acknowledged:true,
  };
  assert.equal((await employeeB.request("POST",API,{...baseClaim,employeeId:workerB.id})).status,403);
  assert.equal((await employeeA.request("POST",API,{...baseClaim,employeeId:workerB.id})).status,422);
  assert.equal((await employeeA.request("POST",API,{...baseClaim,acknowledged:false})).status,422);
  assert.equal((await employeeA.request("POST",API,{...baseClaim,claimedAt:new Date(Date.now()+10*60000).toISOString()})).status,422);
  assert.equal((await employeeA.request("POST",API,{...baseClaim,claimedAt:new Date(Date.now()-8*86400000).toISOString()})).status,422);
  results.push("cross-employer, worker identity, consent, clock-skew and stale-time intake denials");

  const first = await employeeA.request("POST",API,baseClaim);
  assert.equal(first.status,201,"Valid offline claim must enter the unverified queue");
  assert.equal(first.body.verified,false);
  assert.equal(first.body.replayed,false);
  const claimId = Number(first.body.claimId);
  assert.ok(claimId>0);
  const replay = await employeeA.request("POST",API,baseClaim);
  assert.equal(replay.status,200);
  assert.equal(replay.body.replayed,true);
  assert.equal(Number(replay.body.claimId),claimId);
  assert.equal((await employeeA.request("POST",API,{...baseClaim,actionType:"clock_out"})).status,409);
  assert.equal((await employeeA.request("POST",API,{...baseClaim,claimedAt:new Date(Date.now()-240000).toISOString()})).status,409);
  const claimsA = await employeeA.request("GET",API+"?organizationId="+orgA.id);
  assert.equal(claimsA.status,200);
  assert.equal(claimsA.body.claims?.length,1);
  assert.equal(Number(claimsA.body.claims[0]?.id),claimId);
  assert.equal(claimsA.body.claims[0]?.status,"pending_review");
  assert.ok(!("submittedByUserId" in claimsA.body.claims[0]),
    "Employee route must not leak claimant IDs");
  results.push("unverified submission, exact replay, conflicting replay, worker-scoped history");

  const note = "Synthetic independent review; use governed correction only.";
  assert.equal((await hrA.request("PATCH",API,null)).status,400,
    "A null body must never crash the HR review route");
  assert.equal((await hrA.request("PATCH",API,[])).status,400,
    "An array body must never crash the HR review route");
  assert.equal((await employeeA.request("PATCH",API,{organizationId:orgA.id,id:claimId,action:"flag",note})).status,403);
  assert.equal((await ownerB.request("PATCH",API,{organizationId:orgA.id,id:claimId,action:"flag",note})).status,403);
  assert.equal((await payrollA.request("PATCH",API,{organizationId:orgA.id,id:claimId,action:"flag",note})).status,403);
  const checked = await hrA.request("PATCH",API,{organizationId:orgA.id,id:claimId,action:"flag",note});
  assert.equal(checked.status,200);
  assert.equal(checked.body.claim?.status,"flagged");
  assert.equal(checked.body.verified,false);
  assert.equal((await hrA.request("PATCH",API,{organizationId:orgA.id,id:claimId,action:"dismiss",note})).status,409);
  const second = await employeeA.request("POST",API,{...baseClaim,clientEventId:randomUUID(),actionType:"clock_out"});
  assert.equal(second.status,201);
  const dismissed = await hrA.request("PATCH",API,{organizationId:orgA.id,id:second.body.claimId,action:"dismiss",note});
  assert.equal(dismissed.status,200);
  assert.equal(dismissed.body.claim?.status,"dismissed");
  assert.equal((await employeeB.request("GET",API+"?organizationId="+orgB.id)).body.claims?.length,0);
  const hrQueue = await hrA.request("GET",API+"?organizationId="+orgA.id);
  assert.equal(hrQueue.status,200);
  assert.equal(hrQueue.body.claims?.length,2);
  assert.ok(hrQueue.body.claims.every((item:Json)=>item.employeeId===workerA.id));
  results.push("separate HR decisions, idempotent state transition and denied cross-tenant review");

  const audit = await db.select({action:auditEvents.action,metadata:auditEvents.metadata})
    .from(auditEvents).where(eq(auditEvents.organizationId,orgA.id));
  assert.equal(audit.filter(row=>row.action==="Offline attendance claim submitted (unverified)").length,2,
    "Replays must not create a duplicate submission audit");
  assert.equal(audit.filter(row=>row.action.includes("Offline attendance claim flagged")).length,1);
  assert.equal(audit.filter(row=>row.action.includes("Offline attendance claim dismissed")).length,1);
  assert.ok(audit.filter(row=>row.action.includes("Offline attendance claim submitted"))
    .every(row=>(row.metadata as Json)?.noAttendanceLedgerWrite===true));
  assert.equal((await db.select({id:timePunches.id}).from(timePunches)).length,0);
  assert.equal((await db.select({id:payrollRuns.id}).from(payrollRuns)).length,0);
  results.push("audit is atomic on new intake only; zero authoritative punches or payroll runs");

  // The browser fixture contains fictional credentials and is deleted before
  // any GitHub artifact upload. Report below includes no emails or DB IDs.
  mkdirSync("qa-artifacts",{recursive:true});
  writeFileSync("qa-artifacts/.offline-claims-synthetic-auth.json",JSON.stringify({
    password, employeeEmail:names[0].email, hrEmail:names[2].email,
    organizationId:orgA.id, otherOrganizationId:orgB.id, employeeId:workerA.id,
  }),{mode:0o600});
  outcome = "PASS";
}
async function run(): Promise<void> {
  try {
    await main();
  } catch (cause) {
    errorCode = cause instanceof Error ? cause.name : "HTTP_ACCEPTANCE_FAILED";
    throw cause;
  } finally {
    mkdirSync("qa-artifacts",{recursive:true});
    writeFileSync("qa-artifacts/offline-claims-http-acceptance.json",JSON.stringify({
      sourceSha:process.env.PR_HEAD_SHA ?? process.env.GITHUB_SHA ?? "local",
      githubRunId:process.env.GITHUB_RUN_ID ?? "local",
      kind:"offline-claims-connected-fictitious-employee-hr-two-tenant",
      result:outcome,errorCode,passedScenarios:results,
      productionData:false,realEmployer:false,independentHumanUat:"NOT_RUN",
      physicalDevice:"NOT_RUN",automaticPayrollOrAttendanceWrites:false,
      externalMoneyOrFiling:"PROHIBITED",
    },null,2)+"\n");
    await pool.end();
  }
}
void run().catch(error => {
  console.error(error instanceof Error ? error.message : "Synthetic acceptance failed");
  process.exitCode = 1;
});
