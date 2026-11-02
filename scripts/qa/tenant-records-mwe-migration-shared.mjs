import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";

const e=process.env;
if(!(e.GITHUB_ACTIONS==="true"&&e.CI==="true"&&
  e.NODE_ENV==="production"&&e.DEMO_MODE==="false"&&
  e.TENANT_SECOND_PASS_MODE==="isolated-ci-only"&&
  e.TENANT_EMPLOYEE_RECORD_PROOF==="fictional-pg16-http"&&
  e.DATABASE_URL==="postgresql://postgres:postgres@127.0.0.1:5432/app_db"&&
  e.SECURITY_SMOKE_URL==="http://127.0.0.1:3000"&&
  ["PAYMONGO_DISBURSEMENTS_ENABLED","XENDIT_PAYOUTS_ENABLED","XENDIT_BILLING_ENABLED",
   "WORKER_ENABLED","CENTRAL_SCHEDULER_ENABLED","NEXT_CSP_ENABLED","DOCUMENT_UPLOADS_ENABLED"]
    .every(k=>e[k]==="false")&&
  ["PAYMONGO_SECRET_KEY","XENDIT_SECRET_KEY","XENDIT_PAYOUT_SECRET_KEY",
   "SMTP_URL","RESEND_API_KEY","POSTMARK_SERVER_TOKEN","OPENAI_API_KEY"]
    .every(k=>!e[k])))
  throw Error("RECORD_WRITES_PROOF_REFUSED: fictional localhost PG16 only, provider/CSP flags OFF");
export const [{db,pool},S,orm,fixture]=await Promise.all([
  import("../../src/db/index.ts"),import("../../src/db/schema.ts"),
  import("drizzle-orm"),import("./tenant-table-http.mjs")]);
export const {eq,asc,sql}=orm;
export const {seedEmployer,addWorker,standaloneMakeSession,standaloneRequest}=fixture;
export const assertions=[];
export function prove(test,msg){assert.ok(test,msg);assertions.push(msg);}
export function exact(r,code,msg){
  assert.equal(r.status,code,msg+" expected "+code+" got "+r.status+": "+String(r.text).slice(0,300));
  assertions.push(msg+" "+code);
  return r;
}
export const http=(path,method,cookie,body)=>
  standaloneRequest(path,{method,cookie,body});
export async function denial(r,code,victim,msg){
  exact(r,code,msg);
  const raw=r.text+" "+[...r.headers].map(([k,v])=>k+":"+v).join(" ");
  prove(!raw.includes(victim.marker),msg+" response/headers exclude victim marker");
}
export async function snapshot(orgId){
  const tables={
    organizations:S.organizations,subscriptions:S.subscriptions,
    employees:S.employees,employeePayProfiles:S.employeePayProfiles,
    employeeMweClassifications:S.employeeMweClassifications,
    userOrganizations:S.userOrganizations,importBatches:S.importBatches,
    historicalPayrollEntries:S.historicalPayrollEntries,leaveBalances:S.leaveBalances,
    employeeLoans:S.employeeLoans,payrollRuns:S.payrollRuns,
    approvalTasks:S.approvalTasks,auditEvents:S.auditEvents,
  };
  const out={};
  for(const [name,t] of Object.entries(tables))
    out[name]=await db.select().from(t).where(eq(name==="organizations"?t.id:t.organizationId,orgId))
      .orderBy(asc(t.id));
  out.payrollEntries=await db.select().from(S.payrollEntries)
    .innerJoin(S.payrollRuns,eq(S.payrollRuns.id,S.payrollEntries.payrollRunId))
    .where(eq(S.payrollRuns.organizationId,orgId)).orderBy(asc(S.payrollEntries.id));
  return out;
}
export async function bootstrap(){
  assert.equal((await db.select().from(S.organizations).limit(1)).length,0,
    "refuse a nonempty Postgres instance");
  const tag=randomUUID().replaceAll("-","").slice(0,9);
  const a=await seedEmployer("ATTA",tag,standaloneMakeSession);
  const b=await seedEmployer("ATTB",tag,standaloneMakeSession);
  // Only disposable test DB SQL. Actual victim org identity must exceed 6.
  await db.execute(sql.raw("SELECT setval(pg_get_serial_sequence('organizations','id'),6,true)"));
  const victim=await seedEmployer("VICTIM",tag,standaloneMakeSession);
  prove(victim.org.id>6&&victim.org.id>b.org.id,"real PG victim organization ID is higher than attackers and >6");
  for(const actor of [a,b,victim]){
    await db.insert(S.subscriptions).values({
      organizationId:actor.org.id,plan:"Scale",status:"active",
      seatLimit:50,provider:null,amountCents:0,currency:"PHP",
    });
    const [requester]=await db.insert(S.users).values({
      name:actor.marker+" HR requester",
      email:actor.marker.toLowerCase()+"-mwe-requester@example.invalid",
      passwordHash:"fictional-only",role:"hr",active:true,
    }).returning();
    await db.insert(S.userOrganizations).values({
      organizationId:actor.org.id,userId:requester.id,role:"hr",active:true,
    });
    actor.requester=requester;
  }
  return {attackers:[a,b],victim};
}
