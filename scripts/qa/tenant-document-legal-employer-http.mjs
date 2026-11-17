/**
 * Source-current private document same-parent legal-employer proof.
 * Fixture-only, localhost-only PostgreSQL 16. Never touches real storage,
 * payouts, identity providers, customers, or the deployed application.
 *
 * Zero credits until exact-head CI completes and a reviewer accepts it.
 */
import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";

const URL_ROOT = "http://127.0.0.1:3000";
const ROUTE = "src/app/api/documents/[id]/route.ts";
const PINS = Object.freeze({
  [ROUTE]: "fd26ef35efebbb3e66a4bba37b2bbf9548da1ca6",
  "src/lib/private-document-tenant-lookup.ts": "746c735d3c5475636eb8b37297443305906386e9",
  "src/lib/multi-entity-server.ts": "f38a8bb77a5026d581d4a92b22533fc879ea7e00",
});
function sha(bytes) {
  const b=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
  return createHash("sha1").update("blob "+b.length+"\0").update(b).digest("hex");
}
function requireDisposable(env=process.env) {
  for (const [k,v] of Object.entries({
    CI:"true",GITHUB_ACTIONS:"true",NODE_ENV:"production",
    TENANT_DOCUMENT_ENTITY_PROOF:"disposable-pg16-real-http",
    TENANT_SECOND_PASS_MODE:"isolated-ci-only",
    DATABASE_URL:"postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL:URL_ROOT,
    APP_BASE_URL:URL_ROOT,
    TRUSTED_APP_ORIGINS:URL_ROOT,
    MULTI_ENTITY_ENABLED:"true", EMPLOYEE_DOCUMENT_VAULT_ENABLED:"true",
    DEMO_MODE:"false",WORKER_ENABLED:"false",CENTRAL_SCHEDULER_ENABLED:"false",
    XENDIT_PAYOUTS_ENABLED:"false",XENDIT_BILLING_ENABLED:"false",
    PAYMONGO_DISBURSEMENTS_ENABLED:"false",
  })) assert.equal(env[k],v,"DOCUMENT_ENTITY_REFUSED: unsafe "+k);
  for (const k of ["NEON_DATABASE_URL","OPENAI_API_KEY","PAYMONGO_SECRET_KEY","XENDIT_SECRET_KEY",
    "S3_ACCESS_KEY_ID","S3_SECRET_ACCESS_KEY","R2_ACCESS_KEY_ID","R2_SECRET_ACCESS_KEY",
    "SMTP_PASSWORD","RESEND_API_KEY","WORKER_TOKEN","CRON_SECRET"])
    assert.ok(!env[k],"DOCUMENT_ENTITY_REFUSED: external secret "+k);
  for (const [file,pin] of Object.entries(PINS))
    assert.equal(sha(readFileSync(file)),pin,"DOCUMENT_ENTITY_REFUSED: changed source "+file);
  const ledger=JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json","utf8"));
  const record=ledger.allApiRouteFiles[ROUTE]?.methods?.find(x=>x.name==="GET");
  assert.deepEqual({status:record?.status,credits:record?.reviewedUncertified?.coverageCredits,proof:record?.testedBy},
    {status:"GAP",credits:0,proof:null},
    "Source-only real HTTP may not auto-promote a stale or unreviewed private-document method");
  return true;
}

async function getDocument({id,cookie,query="",headerEntityId}={}) {
  const url=new URL("/api/documents/"+id+(query?"?"+query:""),URL_ROOT);
  const headers={...(cookie?{cookie}:{}),
    ...(headerEntityId===undefined?{}:{"x-legal-entity-id":String(headerEntityId)})};
  const response=await fetch(url,{headers,redirect:"manual",cache:"no-store",
    signal:AbortSignal.timeout(30000)});
  const bytes=Buffer.from(await response.arrayBuffer());
  return {status:response.status,bytes,text:bytes.toString("utf8"),headers:response.headers};
}
function opaque404(response,missing,label,forbidden=[]) {
  assert.equal(response.status,404,label+" expected opaque 404");
  assert.equal(response.text,missing.text,label+" foreign and unknown bytes must be identical");
  assert.ok(!response.headers.get("location"),label+" must not sign a private object URL");
  for (const marker of forbidden) {
    assert.ok(!response.text.includes(marker),label+" leaked protected content");
    assert.ok(!response.text.includes(encodeURIComponent(marker)),label+" leaked encoded content");
  }
}
export async function proveDocumentLegalEmployer() {
  requireDisposable();
  const [{db,pool},s,{and,asc,eq},fixture]=await Promise.all([
    import("../../src/db/index.ts"),import("../../src/db/schema.ts"),
    import("drizzle-orm"),import("./tenant-table-http.mjs"),
  ]);
  try {
    const version=Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(version>=160000&&version<170000,"Only PostgreSQL 16");
    for(const name of ["organizations","documents","users","userLegalEntityGrants","auditEvents","employeeEntityAssignments","entityTransferRequests"])
      assert.equal((await db.select().from(s[name]).limit(1)).length,0,
        "Non-empty database is not disposable: "+name);
    const nonce=randomUUID().replaceAll("-","").slice(0,10);
    const fillers=[];
    for(let i=0;i<7;i++)
      fillers.push(await fixture.seedEmployer("DOC_FILLER_"+i,nonce,fixture.standaloneMakeSession));
    const a=await fixture.seedEmployer("DOC_A",nonce,fixture.standaloneMakeSession);
    const b=await fixture.seedEmployer("DOC_B",nonce,fixture.standaloneMakeSession);
    const victim=await fixture.seedEmployer("DOC_C",nonce,fixture.standaloneMakeSession);
    assert.ok(victim.org.id>Math.max(a.org.id,b.org.id,6));
    assert.equal(new Set([a.cookie,b.cookie,victim.cookie]).size,3);
    for (const x of [a,b,victim])
      await db.insert(s.userLegalEntityGrants).values({
        organizationId:x.org.id,userId:x.owner.id,legalEntityId:x.entity.id,
      });
    const [otherEntity]=await db.insert(s.legalEntities).values({
      organizationId:a.org.id,code:"DOC_ENTITY_"+nonce,legalName:"Fictional other employer",
      displayName:"Fictional second legal employer",primaryEntity:false,active:true,
    }).returning();
    const [otherUnit]=await db.insert(s.orgUnits).values({
      organizationId:a.org.id,legalEntityId:otherEntity.id,
      type:"department",code:"DOC_UNIT_"+nonce,name:"Other legal employer unit",
    }).returning();
    const [otherWorker]=await db.insert(s.employees).values({
      organizationId:a.org.id,legalEntityId:otherEntity.id,orgUnitId:otherUnit.id,
      employeeNo:"DOC_OTHER_"+nonce,firstName:"Other",lastName:"Employer-"+nonce,
      title:"Synthetic HR worker",avatarInitials:"OW",
      basicRate:"21000.00",startDate:"2026-01-05",
    }).returning();
    const makeDocument=async ({org,worker,owner,marker})=>{
      const data=Buffer.from("SYNTHETIC-DOCUMENT-"+marker,"utf8");
      const [row]=await db.insert(s.documents).values({
        organizationId:org.id,employeeId:worker?.id??null,
        kind:"coe",fileName:marker+".txt",mimeType:"text/plain",
        byteSize:data.length,sha256:createHash("sha256").update(data).digest("hex"),
        scannedClean:true,sourceType:"upload",sourceKey:null,objectStorageKey:null,
        uploadedBy:owner.name,uploadedByUserId:owner.id,content:data.toString("base64"),
      }).returning();
      return {row,data,marker};
    };
    // Employer IDs and document IDs use separate PostgreSQL sequences. Seed
    // real filler documents too, preserving the higher-ID victim control.
    for(const [i,x] of fillers.entries())
      await makeDocument({org:x.org,worker:x.worker,owner:x.owner,marker:"DOC_FILLER_"+i+"_"+nonce});
    const ownA=await makeDocument({org:a.org,worker:a.worker,owner:a.owner,marker:"DOC_A_"+nonce});
    const ownB=await makeDocument({org:b.org,worker:b.worker,owner:b.owner,marker:"DOC_B_"+nonce});
    const ownC=await makeDocument({org:victim.org,worker:victim.worker,owner:victim.owner,marker:"DOC_C_"+nonce});
    const foreign=await makeDocument({org:a.org,worker:otherWorker,owner:a.owner,
      marker:"DOC_SAME_PARENT_OTHER_"+nonce});
    const unattributed=await makeDocument({org:a.org,worker:null,owner:a.owner,
      marker:"DOC_NO_ENTITY_"+nonce});
    assert.ok(ownC.row.id>ownA.row.id&&ownC.row.id>ownB.row.id&&ownC.row.id>6);
    assert.ok(foreign.row.id>ownA.row.id);
    const snapshot=async()=>({
      documents:await db.select().from(s.documents).orderBy(asc(s.documents.id)),
      employees:await db.select().from(s.employees).orderBy(asc(s.employees.id)),
      audits:await db.select().from(s.auditEvents).orderBy(asc(s.auditEvents.id)),
      assignments:await db.select().from(s.employeeEntityAssignments).orderBy(asc(s.employeeEntityAssignments.id)),
      transfers:await db.select().from(s.entityTransferRequests).orderBy(asc(s.entityTransferRequests.id)),
    });
    async function ownPositive(actor,doc) {
      const res=await getDocument({id:doc.row.id,cookie:actor.cookie});
      assert.equal(res.status,200,"Owned clean PDF/text must return real bytes");
      assert.deepEqual(res.bytes,doc.data,"Owned body must contain exact persisted bytes");
      assert.match(res.headers.get("cache-control")||"",/no-store/);
      const audits=await db.select().from(s.auditEvents).where(and(
        eq(s.auditEvents.organizationId,actor.org.id),
        eq(s.auditEvents.resource,String(doc.row.id)),
      ));
      assert.ok(audits.some(x=>x.action==="Employee document viewed"),
        "Owned read requires persisted audit before release");
    }
    await ownPositive(a,ownA);
    await ownPositive(b,ownB);
    await ownPositive(victim,ownC);
    const absent=await getDocument({id:2147483647,cookie:a.cookie});
    assert.equal(absent.status,404);
    const blocked=[
      ["same parent, other legal employer",{id:foreign.row.id,cookie:a.cookie},[foreign.marker]],
      ["forged employer query",{id:foreign.row.id,cookie:a.cookie,
        query:"legalEntityId="+otherEntity.id},[foreign.marker]],
      ["forged employer header",{id:foreign.row.id,cookie:a.cookie,
        headerEntityId:otherEntity.id},[foreign.marker]],
      ["conflicting employer selectors",{id:foreign.row.id,cookie:a.cookie,
        query:"legalEntityId="+a.entity.id,headerEntityId:otherEntity.id},[foreign.marker]],
      ["duplicated employer selectors",{id:foreign.row.id,cookie:a.cookie,
        query:"legalEntityId="+a.entity.id+"&legalEntityId="+otherEntity.id},[foreign.marker]],
      ["unattributed parent document",{id:unattributed.row.id,cookie:a.cookie},[unattributed.marker]],
      ["foreign parent employer",{id:ownC.row.id,cookie:a.cookie},[ownC.marker]],
      ["independent attacker to parent A",{id:ownA.row.id,cookie:b.cookie},[ownA.marker]],
    ];
    let rejected=0;
    for(const [label,params,forbidden] of blocked){
      const before=await snapshot();
      const response=await getDocument(params);
      opaque404(response,absent,label,forbidden);
      assert.deepEqual(await snapshot(),before,label+" must not mutate documents, employees or audit");
      rejected++;
    }
    // A CURRENT employer grant cannot confer access to a legacy attachment
    // from an earlier legal employer; the file lacks issuance-time ownership.
    const [oldAssignment]=await db.insert(s.employeeEntityAssignments).values({
      organizationId:a.org.id,employeeId:a.worker.id,legalEntityId:otherEntity.id,
      effectiveFrom:"2025-01-01",effectiveUntil:"2025-12-31",
    }).returning();
    assert.ok(oldAssignment?.id);
    const beforeAmbiguousAssignment=await snapshot();
    const oldEmployerDocument=await getDocument({id:ownA.row.id,cookie:a.cookie});
    opaque404(oldEmployerDocument,absent,"historical different legal-employer assignment",[ownA.marker]);
    assert.deepEqual(await snapshot(),beforeAmbiguousAssignment,
      "Old legal-entity assignment denial must not modify documents, employees or audit");

    const [bOldEmployer]=await db.insert(s.legalEntities).values({
      organizationId:b.org.id,code:"DOC_PREV_"+nonce,
      legalName:"Fictional prior B legal employer",
      displayName:"B previous legal employer",primaryEntity:false,active:true,
    }).returning();
    const [appliedTransfer]=await db.insert(s.entityTransferRequests).values({
      organizationId:b.org.id,employeeId:b.worker.id,
      fromLegalEntityId:bOldEmployer.id,toLegalEntityId:b.entity.id,
      effectiveDate:"2025-12-31",status:"applied",
      reason:"Synthetic historical transfer acceptance",
      serviceStartDate:"2025-01-01",
      continuityNote:"Only synthetic historic document ambiguity is tested",
      requestedByUserId:b.owner.id,
    }).returning();
    assert.ok(appliedTransfer?.id);
    const beforeTransferredWorker=await snapshot();
    const transferredDocument=await getDocument({id:ownB.row.id,cookie:b.cookie});
    opaque404(transferredDocument,absent,"applied employee legal-entity transfer",[ownB.marker]);
    assert.deepEqual(await snapshot(),beforeTransferredWorker,
      "Applied transfer denial must not modify protected documents or audit");

    const [deleted]=await db.delete(s.userLegalEntityGrants).where(and(
      eq(s.userLegalEntityGrants.organizationId,a.org.id),
      eq(s.userLegalEntityGrants.userId,a.owner.id),
      eq(s.userLegalEntityGrants.legalEntityId,a.entity.id),
    )).returning();
    assert.ok(deleted,"Must actually revoke source employer grant in PostgreSQL");
    const prior=await snapshot();
    const deniedAfterRevoke=await getDocument({id:ownA.row.id,cookie:a.cookie});
    opaque404(deniedAfterRevoke,absent,"revoked entity grant same session",[ownA.marker]);
    assert.deepEqual(await snapshot(),prior,"Revoked grant must not expose bytes or change SQL");
    const anonymous=await getDocument({id:ownA.row.id});
    assert.equal(anonymous.status,401,"Missing login must not bypass scoped document GET");
    console.log(JSON.stringify({
      proof:"DOCUMENT_SAME_PARENT_LEGAL_EMPLOYER",
      environment:"localhost-disposable-PG16",
      independentLoginSessions:3,realHigherIdVictim:true,
      positiveCleanDocumentBytes:3,
      deniedOwnParentOtherLegalEmployerAndForged:rejected,
      sameSessionGrantRevocationDenied:true,
      ambiguousHistoricalAssignmentDenied:true,
      appliedLegalEmployerTransferDenied:true,
      identicalAbsentAndForeign404:true,
      verifiedAuditBeforeOwnBytes:true,
      deniedDatabaseUnchanged:true,
      signedObjectUrlFlow:"NOT_TESTED",
      featureOffFlow:"NOT_TESTED",
      reviewer:"PENDING",
      methodCredits:0,productionAccepted:false,
      storageProviderCalls:0,payments:0,
    }));
  } finally {await pool.end()}
}
if(process.argv[1]?.endsWith("tenant-document-legal-employer-http.mjs"))
  proveDocumentLegalEmployer().catch(e=>{console.error(e);process.exitCode=1});
