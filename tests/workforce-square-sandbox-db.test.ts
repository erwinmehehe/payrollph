import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {and,eq} from "drizzle-orm";
import {db} from "../src/db";
import {
  organizations,worksites,users,auditEvents,
  workforceDemandImportBatches,workforceDemandObservationRevisions,
} from "../src/db/schema";
import {manilaCalendarDate} from "../src/lib/payroll-period-ui";
import {
  readSquareSandboxDay,selectSquareDemandRevisions,squareDayWindow,
  SQUARE_SANDBOX_SOURCE,
} from "../src/lib/workforce-square-sandbox";
import {loadOperationalDemandVersions,writeOperationalDemandImport}
  from "../src/lib/workforce-operational-demand-server";

const DAY=86_400_000;
const subtract=(date:string,days:number)=>new Date(Date.parse(date+"T00:00:00Z")-
  days*DAY).toISOString().slice(0,10);
test("isolated Postgres imports only aggregate counts, preserves older correction versions and tenant scope",async()=>{
  const mark=randomUUID().slice(0,8);
  const [org,foreign]=await db.insert(organizations).values([
    {name:"Sandbox source "+mark,legalName:"Fictional Square source "+mark},
    {name:"Other sandbox "+mark,legalName:"Foreign fictional org "+mark},
  ]).returning({id:organizations.id});
  let worksiteId=0,foreignSiteId=0,userId=0;
  try {
    const [site,other]=await db.insert(worksites).values([
      {organizationId:org.id,code:"SB"+mark,name:"Fictional Square merchant",
        timezone:"Asia/Manila"},
      {organizationId:foreign.id,code:"FO"+mark,name:"Unlinked fictional merchant",
        timezone:"Asia/Manila"},
    ]).returning({id:worksites.id});
    worksiteId=site.id;foreignSiteId=other.id;
    const [user]=await db.insert(users).values({
      name:"Synthetic sandbox operator",
      email:"sb-wfm-"+mark+"@example.invalid",
      passwordHash:"never-used",role:"owner",
    }).returning({id:users.id});
    userId=user.id;
    const day=subtract(manilaCalendarDate(),15);
    const now=new Date();
    const base={
      accessToken:"fictional-sandbox-token-no-secret",
      locationId:"SANDBOX987",workDate:day,
      intervalMinutes:30 as const,now,
    };
    const request=(count:number)=>(async()=>{
      return Response.json({payments:Array.from({length:count},(_,i)=>({
        id:"synthetic"+i,location_id:"SANDBOX987",
        created_at:day+"T09:12:00+08:00",status:"COMPLETED",
        card_details:{last_4:"0000",customer:"do-not-persist"},
      }))});
    }) as typeof fetch;
    const first=await readSquareSandboxDay({...base,request:request(2)});
    assert.equal(first.completedPayments,2);
    const initial=selectSquareDemandRevisions({
      aggregate:first,organizationId:org.id,worksiteId:site.id,existing:[],now,
    });
    assert.equal(initial.changedIntervals,48);
    const write=await writeOperationalDemandImport({
      batch:initial.batch!,actorUserId:user.id,actorName:user.name,
    });
    assert.equal(write.rowCount,48);
    const window=squareDayWindow(day,now);
    const query={
      organizationId:org.id,worksiteId:site.id,
      sourceKey:SQUARE_SANDBOX_SOURCE,metricKind:"transactions",
      intervalMinutes:30,from:new Date(window.start),to:new Date(window.end),limit:1001,
    };
    const history=await loadOperationalDemandVersions(query);
    assert.equal(history.length,48);
    assert.equal(history.find(row=>row.observedCount===2)?.revision,1);
    const again=selectSquareDemandRevisions({
      aggregate:first,organizationId:org.id,worksiteId:site.id,existing:history,now,
    });
    assert.equal(again.changedIntervals,0);
    assert.equal(again.batch,null);

    const corrected=await readSquareSandboxDay({...base,request:request(3)});
    const changed=selectSquareDemandRevisions({
      aggregate:corrected,organizationId:org.id,worksiteId:site.id,
      existing:history,now,
    });
    assert.equal(changed.changedIntervals,1);
    assert.equal(changed.batch!.rows[0].revision,2);
    await writeOperationalDemandImport({
      batch:changed.batch!,actorUserId:user.id,actorName:user.name,
    });
    const after=await loadOperationalDemandVersions(query);
    assert.equal(after.length,49,"Older counts must remain frozen as previous revisions");
    assert.equal(after.find(row=>row.revision===2)?.observedCount,3);
    assert.equal((await loadOperationalDemandVersions({...query,
      organizationId:foreign.id})).length,0);
    assert.equal((await loadOperationalDemandVersions({...query,
      worksiteId:other.id})).length,0);

    const imports=await db.select().from(workforceDemandImportBatches).where(and(
      eq(workforceDemandImportBatches.organizationId,org.id),
      eq(workforceDemandImportBatches.sourceKey,SQUARE_SANDBOX_SOURCE),
    ));
    assert.equal(imports.length,2);
    const audit=await db.select({metadata:auditEvents.metadata}).from(auditEvents).where(and(
      eq(auditEvents.organizationId,org.id),
      eq(auditEvents.action,"WFM aggregate operational demand imported"),
    ));
    assert.equal(audit.length,2);
    const raw=JSON.stringify({imports:imports.map(i=>i.idempotencyKey),audit});
    assert.ok(!raw.includes("card_details")&&!raw.includes("synthetic0")&&
      !raw.includes("customer")&&!raw.includes("fictional-sandbox-token"));
  }finally {
    // Immutable audit rows are removed only through the documented
    // cascade when the isolated synthetic organization is deleted below.
    await db.delete(workforceDemandObservationRevisions).where(
      eq(workforceDemandObservationRevisions.organizationId,org.id));
    await db.delete(workforceDemandImportBatches).where(
      eq(workforceDemandImportBatches.organizationId,org.id));
    if(worksiteId)await db.delete(worksites).where(eq(worksites.id,worksiteId));
    if(foreignSiteId)await db.delete(worksites).where(eq(worksites.id,foreignSiteId));
    if(userId)await db.delete(users).where(eq(users.id,userId));
    await db.delete(organizations).where(eq(organizations.id,org.id));
    await db.delete(organizations).where(eq(organizations.id,foreign.id));
  }
});
