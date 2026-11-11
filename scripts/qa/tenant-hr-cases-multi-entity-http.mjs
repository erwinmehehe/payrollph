/**
 * HR-case legal-employer regression: real localhost HTTP + ephemeral PG16.
 * Must prove both valid staff use and same-organization foreign-entity denial.
 * No production data, COE storage, email, external providers or money.
 */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {
  ORIGIN, requireDisposableMultiHr, verifyPins,
  assertDenied, assertSnapshotsEqual,
} from "./tenant-hr-cases-multi-entity-contract.mjs";

const plain=x=>JSON.parse(JSON.stringify(x));
const PATH="/api/hr-cases";
async function http({cookie,method="GET",orgId,caseId,action="status",entityId,headerEntityId,
  workerId,marker}){
  const url=new URL(PATH,ORIGIN);
  if(method==="GET"){
    url.searchParams.set("organizationId",String(orgId));
    if(entityId!==undefined)url.searchParams.set("legalEntityId",String(entityId));
  } else if(entityId!==undefined){
    url.searchParams.set("legalEntityId",String(entityId));
  }
  const headers={
    ...(cookie?{cookie}:{}),
    ...(headerEntityId!==undefined?{"x-legal-entity-id":String(headerEntityId)}:{}),
    ...(method==="PATCH"?{"content-type":"application/json",origin:ORIGIN,"sec-fetch-site":"same-origin"}:{}),
  };
  const response=await fetch(url,{method,redirect:"manual",cache:"no-store",headers,
    ...(method==="PATCH"?{body:JSON.stringify({
      id:caseId,action,status:"in_progress",
      organizationId:orgId,employeeId:workerId,message:marker??"Fictional staff note",
    })}:{}),
    signal:AbortSignal.timeout(30000),
  });
  const text=await response.text();
  let json=null;try{json=JSON.parse(text)}catch{ /* redirect/HTML is not JSON */ }
  return{status:response.status,text,json,headers:response.headers};
}

export async function proveMultiEntityHrCases() {
  requireDisposableMultiHr();
  verifyPins();
  const [{db,pool},s,{and,asc,eq},fixture]=await Promise.all([
    import("../../src/db/index.ts"),import("../../src/db/schema.ts"),
    import("drizzle-orm"),import("./tenant-table-http.mjs"),
  ]);
  try{
    const version=Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(version>=160000&&version<170000,"PG16 required");
    for(const t of ["organizations","users","employeeHrCases","userLegalEntityGrants"])
      assert.equal((await db.select().from(s[t]).limit(1)).length,0,
        "Refuse any nonempty external fixture: "+t);
    const nonce=randomUUID().replaceAll("-","").slice(0,10);
    const filler=[];
    for(let i=0;i<7;i++)
      filler.push(await fixture.seedEmployer("HEF"+i,nonce,fixture.standaloneMakeSession));
    const a=await fixture.seedEmployer("HEA",nonce,fixture.standaloneMakeSession);
    const b=await fixture.seedEmployer("HEB",nonce,fixture.standaloneMakeSession);
    const victim=await fixture.seedEmployer("HEVICTIM",nonce,fixture.standaloneMakeSession);
    assert.ok(victim.org.id>Math.max(a.org.id,b.org.id,6));
    assert.ok(victim.owner.id>Math.max(a.owner.id,b.owner.id,6));
    assert.equal(new Set([a.cookie,b.cookie,victim.cookie]).size,3);

    for(const x of [a,b,victim]) {
      const [grant]=await db.insert(s.userLegalEntityGrants).values({
        organizationId:x.org.id,userId:x.owner.id,legalEntityId:x.entity.id,
      }).returning();
      assert.equal(grant.legalEntityId,x.entity.id);
    }
    const [secondaryEntity]=await db.insert(s.legalEntities).values({
      organizationId:a.org.id,code:"SEC-"+nonce,
      legalName:"Fictional second legal employer "+nonce,
      displayName:"Separate employer "+nonce,
      primaryEntity:false,active:true,
    }).returning();
    const [secondaryUnit]=await db.insert(s.orgUnits).values({
      organizationId:a.org.id,legalEntityId:secondaryEntity.id,
      type:"department",code:"SEC-"+nonce,name:"Fictional separate department",
    }).returning();
    const secondaryMarker=a.marker+"-PRIVATE-LEGAL-ENTITY";
    const [secondaryWorker]=await db.insert(s.employees).values({
      organizationId:a.org.id,legalEntityId:secondaryEntity.id,
      orgUnitId:secondaryUnit.id,employeeNo:"SECOND-"+nonce,
      firstName:"Private",lastName:secondaryMarker,title:"Fictional worker",
      avatarInitials:"PW",basicRate:"20000.00",startDate:"2026-01-05",
    }).returning();
    assert.ok(secondaryEntity.id>a.entity.id);
    async function newCase(actor,employee,marker){
      const [row]=await db.insert(s.employeeHrCases).values({
        organizationId:actor.org.id,employeeId:employee.id,
        createdByUserId:actor.owner.id,caseType:"general",
        subject:marker+" Private case",description:marker+" synthetic confidential HR case",
        assignedRole:"hr",status:"open",slaDueAt:new Date(Date.now()+86400000),
      }).returning();
      await db.insert(s.employeeHrCaseMessages).values({
        organizationId:actor.org.id,caseId:row.id,
        actorUserId:actor.owner.id,visibility:"internal",
        body:marker+" private internal note",
      });
      return row;
    }
    const aCase=await newCase(a,a.worker,a.marker);
    const bCase=await newCase(b,b.worker,b.marker);
    const cCase=await newCase(victim,victim.worker,victim.marker);
    const secondaryCase=await newCase(a,secondaryWorker,secondaryMarker);
    assert.ok(cCase.id>aCase.id&&cCase.id>bCase.id);
    assert.ok(secondaryCase.id>aCase.id);
    const otherEntityCases=await db.select().from(s.employeeHrCases)
      .where(and(eq(s.employeeHrCases.organizationId,a.org.id),
        eq(s.employeeHrCases.employeeId,secondaryWorker.id)));
    assert.equal(otherEntityCases.length,1);

    const protectedTables=[
      "employees","employeeHrCases","employeeHrCaseMessages","auditEvents",
      "payrollRuns","documents","userLegalEntityGrants","sessions",
    ];
    async function snapshot(){
      const result={};
      for(const name of protectedTables)
        result[name]=plain(await db.select().from(s[name]).orderBy(asc(s[name].id)));
      return result;
    }
    let ownReads=0,ownWrites=0,blocked=0,sqlChecks=0;
    async function ownRead(actor,caseRow,forbiddenMarkers){
      const res=await http({cookie:actor.cookie,orgId:actor.org.id});
      assert.equal(res.status,200,actor.label+" GET must succeed: "+res.text.slice(0,170));
      assert.equal(res.json?.organizationId,actor.org.id);
      assert.ok(Array.isArray(res.json.cases)&&res.json.cases.length>0);
      const own=res.json.cases.find(x=>x.id===caseRow.id);
      assert.ok(own&&own.organizationId===actor.org.id,"real own legal employer case missing");
      assert.ok(Array.isArray(own.messages)&&own.messages.some(x=>
        String(x.body).includes(actor.marker+" private internal note")),
        "real persisted own private note missing");
      for(const mark of forbiddenMarkers)
        assert.ok(!res.text.includes(mark),"GET exposed foreign legal employer: "+mark);
      assert.ok(res.headers.get("cache-control")?.includes("no-store"));
      ownReads++;
    }
    async function ownPatch(actor,caseRow,workerId,foreignCaseRow){
      const before=await snapshot();
      const res=await http({method:"PATCH",cookie:actor.cookie,
        orgId:actor.org.id,caseId:caseRow.id,workerId,
        action:"status",entityId:actor.entity.id});
      assert.equal(res.status,200,actor.label+" own PATCH failed: "+res.text.slice(0,160));
      assert.equal(res.json?.case?.id,caseRow.id);
      assert.equal(res.json?.case?.status,"in_progress");
      const after=await snapshot();
      assert.equal(after.auditEvents.length,before.auditEvents.length+1,
        "own PATCH requires persisted scoped audit");
      assert.equal(after.employeeHrCases.find(x=>x.id===caseRow.id)?.status,"in_progress");
      assert.deepEqual(after.employeeHrCases.find(x=>x.id===foreignCaseRow.id),
        before.employeeHrCases.find(x=>x.id===foreignCaseRow.id),
        "own PATCH modified foreign legal employer case");
      assert.deepEqual(after.employeeHrCaseMessages,before.employeeHrCaseMessages,
        "status PATCH must not mutate private HR notes");
      ownWrites++;
    }
    async function refuse(label,params,expected,forbiddenMarkers){
      const before=await snapshot();
      const res=await http(params);
      assertDenied(res,expected,forbiddenMarkers,label);
      assertSnapshotsEqual(await snapshot(),before,label);
      blocked++;sqlChecks++;
    }
    const foreignMarkers=[secondaryMarker,victim.marker,b.marker];
    await ownRead(a,aCase,foreignMarkers);
    await ownRead(b,bCase,[a.marker,victim.marker,secondaryMarker]);
    await ownRead(victim,cCase,[a.marker,b.marker,secondaryMarker]);
    await ownPatch(a,aCase,a.worker.id,secondaryCase);
    await ownPatch(b,bCase,b.worker.id,cCase);

    await refuse("A query selects ungranted second legal employer",
      {cookie:a.cookie,orgId:a.org.id,entityId:secondaryEntity.id},
      403,[secondaryMarker,victim.marker]);
    await refuse("A header selects ungranted second legal employer",
      {cookie:a.cookie,orgId:a.org.id,headerEntityId:secondaryEntity.id},
      403,[secondaryMarker,victim.marker]);
    await refuse("A conflicting header and query selectors",
      {cookie:a.cookie,orgId:a.org.id,entityId:a.entity.id,
        headerEntityId:secondaryEntity.id},
      403,[secondaryMarker,victim.marker]);
    await refuse("A forged all-employers selector",
      {cookie:a.cookie,orgId:a.org.id,entityId:"all"},
      403,[secondaryMarker,victim.marker]);
    await refuse("A cannot read victim organization",
      {cookie:a.cookie,orgId:victim.org.id},403,[victim.marker]);
    await refuse("B cannot read A organization",
      {cookie:b.cookie,orgId:a.org.id},403,[a.marker,secondaryMarker]);
    await refuse("A cannot PATCH real second legal employer case",
      {cookie:a.cookie,method:"PATCH",orgId:a.org.id,
        caseId:secondaryCase.id,workerId:secondaryWorker.id,entityId:a.entity.id},
      404,[secondaryMarker]);
    await refuse("A cannot PATCH second employer via forged query",
      {cookie:a.cookie,method:"PATCH",orgId:a.org.id,
        caseId:secondaryCase.id,workerId:secondaryWorker.id,entityId:secondaryEntity.id},
      404,[secondaryMarker]);
    await refuse("A cannot PATCH victim employer case",
      {cookie:a.cookie,method:"PATCH",orgId:victim.org.id,
        caseId:cCase.id,workerId:victim.worker.id,entityId:a.entity.id},
      404,[victim.marker]);
    await refuse("B cannot PATCH A case",
      {cookie:b.cookie,method:"PATCH",orgId:a.org.id,
        caseId:aCase.id,workerId:a.worker.id,entityId:b.entity.id},
      404,[a.marker]);

    // Same authenticated session must lose its legal-entity access after
    // explicit grant revocation, not fall back to all parent-company workers.
    const grantRows=await db.delete(s.userLegalEntityGrants).where(and(
      eq(s.userLegalEntityGrants.organizationId,a.org.id),
      eq(s.userLegalEntityGrants.userId,a.owner.id),
      eq(s.userLegalEntityGrants.legalEntityId,a.entity.id),
    )).returning();
    assert.equal(grantRows.length,1);
    await refuse("revoked entity grant denies GET",
      {cookie:a.cookie,orgId:a.org.id},403,[a.marker,secondaryMarker]);
    await refuse("revoked entity grant denies PATCH",
      {cookie:a.cookie,method:"PATCH",orgId:a.org.id,
        caseId:aCase.id,workerId:a.worker.id,entityId:a.entity.id},
      404,[a.marker,secondaryMarker]);

    assert.equal(ownReads,3);
    assert.equal(ownWrites,2);
    assert.equal(blocked,12);
    assert.equal(sqlChecks,12);
    console.log(JSON.stringify({
      family:"HR_CASES_MULTI_ENTITY_LEGAL_EMPLOYER",
      evidence:"fictional-postgresql16-real-localhost-http",
      tenants:3,fillerEmployers:filler.length,legalEmployersInA:2,
      realOwnedCaseAndNoteGets:ownReads,persistedOwnedStatusPatches:ownWrites,
      deniedForeignEntityOrRevoked:blocked,
      unchangedSqlChecks:sqlChecks,higherIdVictim:true,
      providerCalls:0,COEUploads:0,moneyMoved:false,
      newMethodCredits:0,independentSecurityReview:"PENDING",
      productionAccepted:false,
    }));
  }finally{await pool.end()}
}
if(process.argv[1]?.replaceAll("\\","/").endsWith("/tenant-hr-cases-multi-entity-http.mjs"))
  proveMultiEntityHrCases().catch(e=>{console.error(e);process.exitCode=1});
