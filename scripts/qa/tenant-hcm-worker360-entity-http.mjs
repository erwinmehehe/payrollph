/**
 * Real logged-in Worker 360 API + SSR legal-employer proof against disposable
 * fictional PostgreSQL 16 and localhost Next only. Never real payroll/PII.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ORIGIN, AS_OF, requireIsolatedWorker360, assertDenied, assertReadOnly,
} from "./tenant-hcm-worker360-entity-contract.mjs";
const serialize = x => JSON.parse(JSON.stringify(x));
function url(orgId, workerId, {page=false, entity, duplicateEntity, duplicateWorker}={}) {
  const u = new URL(page ? "/hcm/worker-360" : "/api/hcm/worker-360", ORIGIN);
  u.searchParams.set("organizationId", String(orgId));
  u.searchParams.set("employeeId", String(workerId));
  if (duplicateWorker !== undefined)
    u.searchParams.append("employeeId", String(duplicateWorker));
  if (entity !== undefined) u.searchParams.append("legalEntityId", String(entity));
  if (duplicateEntity !== undefined)
    u.searchParams.append("legalEntityId", String(duplicateEntity));
  if (!page) u.searchParams.set("asOfDate", AS_OF);
  return u;
}
async function get(u, cookie, headerEntity) {
  const target = new URL(u);
  assert.equal(target.origin, ORIGIN, "No external HTTP destinations");
  assert.ok(["/api/hcm/worker-360","/hcm/worker-360","/api/account"].includes(target.pathname),
    "WORKER360_ENTITY_REFUSED: out-of-scope HTTP path");
  const response = await fetch(target, {
    method: "GET", redirect: "manual", cache: "no-store",
    headers: {
      ...(cookie ? {cookie} : {}),
      ...(headerEntity !== undefined ? {"x-legal-entity-id":String(headerEntity)} : {}),
    },
    signal:AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json=null;try{json=JSON.parse(text)}catch{}
  return {status:response.status,text,json,headers:response.headers};
}
export async function proveWorker360EntityIsolation() {
  // Must precede DB, auth, fixture import, or network access.
  requireIsolatedWorker360();
  const [{db,pool},s,{and,asc,eq},fixture] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
    import("drizzle-orm"), import("./tenant-table-http.mjs"),
  ]);
  try {
    const pg=Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(pg>=160000&&pg<170000,"WORKER360_ENTITY_REFUSED: PG16 required");
    for(const name of ["organizations","users","workerEmploymentEvents","userLegalEntityGrants"])
      assert.equal((await db.select().from(s[name]).limit(1)).length,0,
        "WORKER360_ENTITY_REFUSED: nonempty test database: "+name);
    const nonce=randomUUID().replaceAll("-","").slice(0,10);
    const filler=[];
    for(let i=0;i<7;i++)
      filler.push(await fixture.seedEmployer("W3F"+i,nonce,fixture.standaloneMakeSession));
    const a=await fixture.seedEmployer("W3A",nonce,fixture.standaloneMakeSession);
    const b=await fixture.seedEmployer("W3B",nonce,fixture.standaloneMakeSession);
    const victim=await fixture.seedEmployer("W3VICTIM",nonce,fixture.standaloneMakeSession);
    assert.ok(victim.org.id>Math.max(a.org.id,b.org.id,6));
    assert.ok(victim.worker.id>Math.max(a.worker.id,b.worker.id,6));
    assert.equal(new Set([a.cookie,b.cookie,victim.cookie]).size,3);
    for(const actor of [a,b,victim])
      await db.insert(s.userLegalEntityGrants).values({
        organizationId:actor.org.id,userId:actor.owner.id,legalEntityId:actor.entity.id,
      });

    async function seedHistory(organizationId,worker,entityId,unitId,marker) {
      const [profile]=await db.insert(s.jobProfiles).values({
        organizationId,title:"Fictional "+marker+" job profile",
      }).returning();
      const [position]=await db.insert(s.positions).values({
        organizationId,code:"W3-"+String(worker.id)+"-"+nonce,
        jobProfileId:profile.id,orgUnitId:unitId,legalEntityId:entityId,
      }).returning();
      const [assignment]=await db.insert(s.positionAssignments).values({
        organizationId,employeeId:worker.id,positionId:position.id,
        assignmentType:"primary",effectiveFrom:"2026-01-01",
      }).returning();
      const [event]=await db.insert(s.workerEmploymentEvents).values({
        organizationId,employeeId:worker.id,positionAssignmentId:assignment.id,
        effectiveDate:"2026-02-01",eventType:"hire",fromLegalEntityId:null,
        toLegalEntityId:entityId,reason:"Private "+marker+" source",
        metadata:{secret:"PRIVATE-"+marker},
      }).returning();
      return {position,assignment,event};
    }
    const ah=await seedHistory(a.org.id,a.worker,a.entity.id,a.unit.id,a.marker);
    const bh=await seedHistory(b.org.id,b.worker,b.entity.id,b.unit.id,b.marker);
    const vh=await seedHistory(victim.org.id,victim.worker,victim.entity.id,victim.unit.id,victim.marker);
    assert.ok(vh.event.id>Math.max(ah.event.id,bh.event.id));

    // A is authorized for the primary employer only. Its parent organization
    // also contains a second actual legal employer and worker.
    const secondaryMarker="W3-PRIVATE-SECOND-"+nonce;
    const [entity2]=await db.insert(s.legalEntities).values({
      organizationId:a.org.id,code:"W3SEC-"+nonce,
      legalName:"Fictional second legal employer "+nonce,
      displayName:secondaryMarker,primaryEntity:false,active:true,
    }).returning();
    const [unit2]=await db.insert(s.orgUnits).values({
      organizationId:a.org.id,legalEntityId:entity2.id,type:"department",
      code:"W3SEC-"+nonce,name:"Fictional secondary department",
    }).returning();
    const [worker2]=await db.insert(s.employees).values({
      organizationId:a.org.id,legalEntityId:entity2.id,orgUnitId:unit2.id,
      employeeNo:"W3-SEC-"+nonce,firstName:"PrivateSecondary",
      lastName:secondaryMarker,title:"Second legal employer worker",
      avatarInitials:"PS",basicRate:"99000.00",startDate:"2026-01-01",
    }).returning();
    const sh=await seedHistory(a.org.id,worker2,entity2.id,unit2.id,secondaryMarker);

    // Inconsistent/unattributed history must not be exposed just because the
    // worker's CURRENT legal employer is authorized.
    const [foreignTransfer,unknownLegacy]=await db.insert(s.workerEmploymentEvents).values([
      {organizationId:a.org.id,employeeId:a.worker.id,
        effectiveDate:"2026-03-01",eventType:"transfer",
        fromLegalEntityId:entity2.id,toLegalEntityId:a.entity.id,
        reason:"Private previous employer "+secondaryMarker},
      {organizationId:a.org.id,employeeId:a.worker.id,
        effectiveDate:"2026-04-01",eventType:"promotion",
        fromLegalEntityId:null,toLegalEntityId:null,
        reason:"Unknown employer source must not be guessed"},
    ]).returning();

    const tables=["employees","workerEmploymentEvents","positionAssignments",
      "auditEvents","payrollRuns","userLegalEntityGrants"];
    async function snapshot(){
      const result={};
      for(const name of tables)
        result[name]=serialize(await db.select().from(s[name]).orderBy(asc(s[name].id)));
      return result;
    }
    let ownApi=0,ownPages=0,denials=0;
    async function own(actor,worker,entityId,expectedEvent,forbiddenMarkers){
      const api=await get(url(actor.org.id,worker.id,{entity:entityId}),actor.cookie);
      assert.equal(api.status,200,actor.label+" populated own API: "+api.text.slice(0,160));
      assert.equal(api.json?.tenantId,actor.org.id);
      assert.equal(api.json?.worker?.id,worker.id);
      assert.ok(api.json?.worker?.name?.includes(worker.lastName));
      assert.equal(api.json?.employmentEvents?.preview?.items?.length,1);
      assert.equal(api.json.employmentEvents.preview.items[0].id,expectedEvent.id);
      assert.equal(api.json?.primaryAssignment?.selection?.status,"recorded");
      assert.ok(api.headers.get("cache-control")?.includes("no-store"));
      for(const mark of forbiddenMarkers)
        assert.ok(!api.text.includes(mark),actor.label+" own API leaked "+mark);
      const page=await get(url(actor.org.id,worker.id,{page:true,entity:entityId}),actor.cookie);
      assert.equal(page.status,200,actor.label+" own SSR: "+page.text.slice(0,160));
      assert.ok(page.text.includes("Worker 360"));
      for(const mark of forbiddenMarkers)
        assert.ok(!page.text.includes(mark),"SSR leaked "+mark);
      ownApi++;ownPages++;
    }
    async function deny(label,target,cookie,status,markers,header){
      const before=await snapshot();
      assertDenied(await get(target,cookie,header),status,markers,label);
      assertReadOnly(before,await snapshot(),label);
      denials++;
    }

    for(const actor of [a,b,victim]){
      const login=await get(new URL("/api/account",ORIGIN),actor.cookie);
      assert.equal(login.status,200,"Persistent real login required");
      assert.equal(login.json?.profile?.id,actor.owner.id);
    }
    const initialSnapshot=await snapshot();
    await own(a,a.worker,a.entity.id,ah.event,[secondaryMarker,b.marker,victim.marker]);
    const initial=await get(url(a.org.id,a.worker.id,{entity:a.entity.id}),a.cookie);
    const eventIds=initial.json.employmentEvents.preview.items.map(event=>event.id);
    assert.ok(!eventIds.includes(foreignTransfer.id) && !eventIds.includes(unknownLegacy.id));
    await own(b,b.worker,b.entity.id,bh.event,[a.marker,secondaryMarker,victim.marker]);
    await own(victim,victim.worker,victim.entity.id,vh.event,[a.marker,b.marker,secondaryMarker]);
    assertReadOnly(initialSnapshot,await snapshot(),"populated own HTTP responses");

    await deny("A second entity default",url(a.org.id,worker2.id),
      a.cookie,404,[secondaryMarker]);
    await deny("A second entity forged query",url(a.org.id,worker2.id,{entity:entity2.id}),
      a.cookie,404,[secondaryMarker]);
    await deny("A second entity forged header",url(a.org.id,worker2.id),
      a.cookie,404,[secondaryMarker],entity2.id);
    await deny("A foreign entity SSR",url(a.org.id,worker2.id,{page:true,entity:entity2.id}),
      a.cookie,404,[secondaryMarker]);
    await deny("A own worker unauthorized selector",url(a.org.id,a.worker.id,{entity:entity2.id}),
      a.cookie,404,[a.marker,secondaryMarker]);
    await deny("A conflicting entity header and query",url(a.org.id,a.worker.id,{entity:a.entity.id}),
      a.cookie,404,[a.marker,secondaryMarker],entity2.id);
    await deny("A duplicate entity selector",url(a.org.id,a.worker.id,{
      entity:a.entity.id,duplicateEntity:a.entity.id}),a.cookie,404,[a.marker,secondaryMarker]);
    await deny("A all-employers selector",url(a.org.id,a.worker.id,{entity:"all"}),
      a.cookie,404,[a.marker,secondaryMarker]);
    await deny("A duplicate worker ID",url(a.org.id,a.worker.id,{
      duplicateWorker:worker2.id}),a.cookie,400,[secondaryMarker]);
    // Foreign records must be refused even if the caller supplies an otherwise
    // legitimate own employer and an apparently valid legal-employer grant.
    // Neither surface accepts an employee or legal-employer ID in a path segment:
    // both identifiers are exclusively query parameters on these static routes.
    await deny("A victim worker forged inside own employer GET",
      url(a.org.id,victim.worker.id,{entity:a.entity.id}),
      a.cookie,404,[victim.marker]);
    await deny("A victim worker forged inside own employer SSR",
      url(a.org.id,victim.worker.id,{page:true,entity:a.entity.id}),
      a.cookie,404,[victim.marker]);
    await deny("B victim worker forged inside own employer GET",
      url(b.org.id,victim.worker.id,{entity:b.entity.id}),
      b.cookie,404,[victim.marker]);
    await deny("A foreign victim legal employer forged query",
      url(a.org.id,a.worker.id,{entity:victim.entity.id}),
      a.cookie,404,[a.marker,victim.marker]);
    await deny("A foreign victim legal employer forged SSR query",
      url(a.org.id,a.worker.id,{page:true,entity:victim.entity.id}),
      a.cookie,404,[a.marker,victim.marker]);
    await deny("A foreign victim legal employer forged header",
      url(a.org.id,a.worker.id),a.cookie,404,
      [a.marker,victim.marker],victim.entity.id);
    await deny("A foreign victim org",url(victim.org.id,victim.worker.id),
      a.cookie,403,[victim.marker]);
    await deny("B foreign A org",url(a.org.id,a.worker.id),
      b.cookie,403,[a.marker]);

    // A second real legal-entity grant is a legitimate positive selection,
    // not an implicit parent-company/all-employers authorization.
    await db.insert(s.userLegalEntityGrants).values({
      organizationId:a.org.id,userId:a.owner.id,legalEntityId:entity2.id,
    });
    const dualSnapshot=await snapshot();
    await own(a,worker2,entity2.id,sh.event,[b.marker,victim.marker]);
    await own(a,a.worker,a.entity.id,ah.event,[secondaryMarker]);
    await deny("B cannot select A second entity",
      url(a.org.id,worker2.id,{entity:entity2.id}),b.cookie,403,[secondaryMarker]);
    assertReadOnly(dualSnapshot,await snapshot(),"two expressly granted entities");

    // Grant revocation is immediately effective for the SAME authenticated session.
    await db.delete(s.userLegalEntityGrants).where(and(
      eq(s.userLegalEntityGrants.organizationId,a.org.id),
      eq(s.userLegalEntityGrants.userId,a.owner.id),
      eq(s.userLegalEntityGrants.legalEntityId,a.entity.id)));
    await deny("revoked primary entity API",
      url(a.org.id,a.worker.id,{entity:a.entity.id}),a.cookie,404,[a.marker]);
    await deny("revoked primary entity SSR",
      url(a.org.id,a.worker.id,{page:true,entity:a.entity.id}),a.cookie,404,[a.marker]);
    assert.equal((await get(url(a.org.id,worker2.id,{entity:entity2.id}),a.cookie)).status,200);
    await db.delete(s.userLegalEntityGrants).where(and(
      eq(s.userLegalEntityGrants.organizationId,a.org.id),
      eq(s.userLegalEntityGrants.userId,a.owner.id),
      eq(s.userLegalEntityGrants.legalEntityId,entity2.id)));
    await deny("all grants revoked",
      url(a.org.id,worker2.id,{entity:entity2.id}),a.cookie,404,[secondaryMarker]);
    assert.equal(ownApi,5);assert.equal(ownPages,5);assert.equal(denials,21);
    console.log(JSON.stringify({
      family:"WORKER360_LEGAL_EMPLOYER_HISTORY",
      evidence:"real-authenticated-localhost-next-and-fictional-PG16",
      employers:3,fillers:filler.length,legalEmployersInA:2,
      ownedNonemptyApi:ownApi,ownedSSR:ownPages,foreignAndRevokedDenials:denials,
      transferredAndUnattributedHistoryExcluded:true,
      unchangedSqlOnEveryDenial:true,
      sourceCredits:0,productionActivated:false,
      externalProviders:0,moneyMoved:false,independentPrivacyReview:"PENDING",
    }));
  }finally{await pool.end()}
}
if(process.argv[1]?.replaceAll("\\","/").endsWith("/tenant-hcm-worker360-entity-http.mjs"))
  proveWorker360EntityIsolation().catch(e=>{console.error(e);process.exitCode=1});
