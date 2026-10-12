import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {and,eq} from "drizzle-orm";
import {db} from "../src/db";
import {organizations,worksites,users,
  workforceDemandImportBatches,workforceDemandObservationRevisions}
  from "../src/db/schema";
import {readLoyversePosDay,prepareLoyverseRevisions,
  loyverseReceiptWindow,LOYVERSE_WFM_SOURCE}
  from "../src/lib/workforce-loyverse-pos";
import {loadOperationalDemandVersions,writeOperationalDemandImport}
  from "../src/lib/workforce-operational-demand-server";

const store="11111111-1111-4111-8111-111111111111";
test("disposable PG16: POS corrections keep both source versions; no cross-tenant access",async()=>{
  const mark=randomUUID().slice(0,8);
  const orgs=await db.insert(organizations).values([
    {name:"Fictional PH source "+mark,legalName:"Fictional PH source "+mark},
    {name:"Other fictional source "+mark,legalName:"Other fictional source "+mark},
  ]).returning({id:organizations.id});
  const [org,other]=orgs;
  let site=0,otherSite=0,actor=0;
  try{
    const sites=await db.insert(worksites).values([
      {organizationId:org.id,code:"PH"+mark,name:"Synthetic Philippine store",
        timezone:"Asia/Manila"},
      {organizationId:other.id,code:"OT"+mark,name:"Other synthetic store",
        timezone:"Asia/Manila"},
    ]).returning({id:worksites.id});
    site=sites[0].id;otherSite=sites[1].id;
    const [user]=await db.insert(users).values({
      name:"Fictional source admin",email:"loyverse-test-"+mark+"@example.invalid",
      passwordHash:"not-used",role:"owner",
    }).returning({id:users.id});
    actor=user.id;
    const now=new Date();
    const day=new Date(Date.now()+8*3600_000-15*86_400_000)
      .toISOString().slice(0,10);
    const request=(qty:number)=>(async(u:RequestInfo|URL)=>{
      if(String(u).includes("/stores"))return Response.json({
        stores:[{id:store,country:"PH",deleted_at:null}],
      });
      return Response.json({receipts:Array.from({length:qty},(_,i)=>({
        receipt_number:"fictional"+i,store_id:store,receipt_type:"SALE",
        source:"point of sale",created_at:day+"T09:00:00+08:00",
        receipt_date:day+"T09:00:00+08:00",cancelled_at:null,
      }))});
    }) as typeof fetch;
    const conf={accessToken:"fictional-access-value",storeId:store,
      workDate:day,intervalMinutes:30 as const,now};
    const first=await readLoyversePosDay({...conf,request:request(2)});
    assert.equal(first.countedSales,2);
    const initial=prepareLoyverseRevisions({aggregate:first,organizationId:org.id,
      worksiteId:site,existing:[],now});
    assert.equal(initial.changed,48);
    const imported=await writeOperationalDemandImport({
      batch:initial.batch!,actorUserId:actor,actorName:"Fictional source admin",
    });
    assert.equal(imported.rowCount,48);
    const range=loyverseReceiptWindow(day,now);
    const query={organizationId:org.id,worksiteId:site,
      sourceKey:LOYVERSE_WFM_SOURCE,metricKind:"transactions",
      intervalMinutes:30,from:new Date(range.start),to:new Date(range.end),limit:1001};
    const history=await loadOperationalDemandVersions(query);
    assert.equal(history.length,48);
    assert.equal(prepareLoyverseRevisions({aggregate:first,
      organizationId:org.id,worksiteId:site,existing:history,now}).changed,0);
    const newer=await readLoyversePosDay({...conf,request:request(3)});
    const changed=prepareLoyverseRevisions({aggregate:newer,
      organizationId:org.id,worksiteId:site,existing:history,now});
    assert.equal(changed.changed,1);
    assert.equal(changed.batch?.rows[0].revision,2);
    await writeOperationalDemandImport({batch:changed.batch!,actorUserId:actor,
      actorName:"Fictional source admin"});
    const versions=await loadOperationalDemandVersions(query);
    assert.equal(versions.length,49);
    assert.equal(versions.find(v=>v.revision===2)?.observedCount,3);
    assert.equal((await loadOperationalDemandVersions({...query,
      organizationId:other.id})).length,0);
    assert.equal((await loadOperationalDemandVersions({...query,
      worksiteId:otherSite})).length,0);
    const imports=await db.select().from(workforceDemandImportBatches).where(and(
      eq(workforceDemandImportBatches.organizationId,org.id),
      eq(workforceDemandImportBatches.sourceKey,LOYVERSE_WFM_SOURCE),
    ));
    assert.equal(imports.length,2);
    assert.ok(!JSON.stringify(imports).includes("fictional0"));
  }finally{
    // Audit rows remain append-only; synthetic organization cascade cleans
    // its audit receipts without direct audit deletion.
    await db.delete(workforceDemandObservationRevisions).where(
      eq(workforceDemandObservationRevisions.organizationId,org.id));
    await db.delete(workforceDemandImportBatches).where(
      eq(workforceDemandImportBatches.organizationId,org.id));
    if(site)await db.delete(worksites).where(eq(worksites.id,site));
    if(otherSite)await db.delete(worksites).where(eq(worksites.id,otherSite));
    if(actor)await db.delete(users).where(eq(users.id,actor));
    await db.delete(organizations).where(eq(organizations.id,org.id));
    await db.delete(organizations).where(eq(organizations.id,other.id));
  }
});