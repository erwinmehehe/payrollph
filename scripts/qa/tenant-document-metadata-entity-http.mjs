/**
 * Document metadata legal-employer isolation: synthetic empty PG16, localhost
 * Next HTTP, no providers, no payroll or production. ZERO method credits.
 */
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {readFileSync} from "node:fs";
const ORIGIN="http://127.0.0.1:3000";
const PINS={
  "src/app/api/documents/route.ts":"a6f3ff740d5d20d46e44f7a61669061cc63d359e",
  "src/app/api/hcm/documents/route.ts":"e2cefcefdd546a25827cb7b7cbdd20591fcce076",
  "src/lib/multi-entity-server.ts":"f38a8bb77a5026d581d4a92b22533fc879ea7e00",
};
function sha(data){const b=Buffer.isBuffer(data)?data:Buffer.from(data);
  return createHash("sha1").update("blob "+b.length+"\0").update(b).digest("hex");}
function requireDisposable() {
 const env=process.env;
 for(const [k,v] of Object.entries({
   CI:"true",GITHUB_ACTIONS:"true",NODE_ENV:"production",
   TENANT_DOCUMENT_METADATA_PROOF:"disposable-pg16-real-http",
   DATABASE_URL:"postgresql://postgres:postgres@127.0.0.1:5432/app_db",
   SECURITY_SMOKE_URL:ORIGIN,APP_BASE_URL:ORIGIN,TRUSTED_APP_ORIGINS:ORIGIN,
   MULTI_ENTITY_ENABLED:"true",EMPLOYEE_DOCUMENT_VAULT_ENABLED:"true",
   WORKER_ENABLED:"false",CENTRAL_SCHEDULER_ENABLED:"false",
   XENDIT_PAYOUTS_ENABLED:"false",XENDIT_BILLING_ENABLED:"false",
   PAYMONGO_DISBURSEMENTS_ENABLED:"false",DEMO_MODE:"false",
 })) assert.equal(env[k],v,"DOC_LIST_REFUSED: unsafe "+k);
 for(const k of ["NEON_DATABASE_URL","OPENAI_API_KEY","XENDIT_SECRET_KEY","PAYMONGO_SECRET_KEY",
   "R2_ACCESS_KEY_ID","R2_SECRET_ACCESS_KEY","S3_ACCESS_KEY_ID","S3_SECRET_ACCESS_KEY",
   "SMTP_PASSWORD","RESEND_API_KEY","WORKER_TOKEN","CRON_SECRET"])
   assert.ok(!env[k],"DOC_LIST_REFUSED: provider credential "+k);
 for(const [path,pin] of Object.entries(PINS))
   assert.equal(sha(readFileSync(path)),pin,"DOC_LIST_REFUSED: source changed "+path);
 const ledger=JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json","utf8"));
 for(const path of Object.keys(PINS).filter(x=>x.startsWith("src/app/api/"))) {
   const row=ledger.allApiRouteFiles[path];
   assert.equal(row.gitBlobSha,PINS[path]);
   assert.ok(row.methods.length===2&&row.methods.every(m=>
     m.status==="GAP"&&m.testedBy===null&&m.reviewedUncertified?.coverageCredits===0),
     "DOC_LIST_REFUSED: source-changed GET/POST must retain zero-credit hold");
 }
}
async function get(path,cookie,opts={}){
 const res=await fetch(new URL(path,ORIGIN),{
  headers:{...(cookie?{cookie}:{}),...(opts.header?{"x-legal-entity-id":opts.header}:{})},
  redirect:"manual",cache:"no-store",signal:AbortSignal.timeout(30000)});
 const text=await res.text();
 let json=null;try{json=JSON.parse(text)}catch{}
 return{status:res.status,text,json,headers:res.headers};
}
export async function proveDocumentMetadata(){
 requireDisposable();
 const [{db,pool},s,{and,asc,eq},fixture]=await Promise.all([
  import("../../src/db/index.ts"),import("../../src/db/schema.ts"),
  import("drizzle-orm"),import("./tenant-table-http.mjs"),
 ]);
 try{
  const version=Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
  assert.ok(version>=160000&&version<170000);
  for(const name of ["organizations","users","documents","userLegalEntityGrants","auditEvents"])
   assert.equal((await db.select().from(s[name]).limit(1)).length,0,"Database not empty "+name);
  const nonce=randomUUID().replaceAll("-","").slice(0,12);
  const filler=[];
  for(let i=0;i<7;i++)filler.push(await fixture.seedEmployer("DML_FILL_"+i,nonce,fixture.standaloneMakeSession));
  const a=await fixture.seedEmployer("DML_A",nonce,fixture.standaloneMakeSession);
  const b=await fixture.seedEmployer("DML_B",nonce,fixture.standaloneMakeSession);
  const victim=await fixture.seedEmployer("DML_VICTIM",nonce,fixture.standaloneMakeSession);
  for(const e of [a,b,victim])
   await db.insert(s.userLegalEntityGrants).values({organizationId:e.org.id,
     userId:e.owner.id,legalEntityId:e.entity.id});
  const [otherEntity]=await db.insert(s.legalEntities).values({
   organizationId:a.org.id,code:"DML_OTHER_"+nonce,legalName:"Fictional other employer",
   displayName:"Other legal employer",primaryEntity:false,active:true,
  }).returning();
  const [otherUnit]=await db.insert(s.orgUnits).values({
   organizationId:a.org.id,legalEntityId:otherEntity.id,
   type:"department",code:"DML_OTHER_"+nonce,name:"Other HR department",
  }).returning();
  const [otherWorker]=await db.insert(s.employees).values({
   organizationId:a.org.id,legalEntityId:otherEntity.id,orgUnitId:otherUnit.id,
   employeeNo:"DML_OTHER_"+nonce,firstName:"Foreign",lastName:"Employer",
   title:"Fictional",avatarInitials:"FE",basicRate:"20000.00",startDate:"2026-01-05",
  }).returning();
  const save=async(e,worker,mark)=>{
   const body=Buffer.from("FAKE FILE "+mark);
   const [doc]=await db.insert(s.documents).values({
    organizationId:e.org.id,employeeId:worker?.id??null,kind:"onboarding",
    fileName:mark+".pdf",mimeType:"application/pdf",byteSize:body.length,
    sha256:createHash("sha256").update(body).digest("hex"),scannedClean:true,
    sourceType:"upload",sourceKey:null,objectStorageKey:null,
    uploadedBy:e.owner.name,uploadedByUserId:e.owner.id,
    content:body.toString("base64"),
   }).returning();
   return doc;
  };
  for(const [i,e] of filler.entries())await save(e,e.worker,"DML_FILL_"+i+"_"+nonce);
  const ownA=await save(a,a.worker,"DML_A_"+nonce);
  const ownB=await save(b,b.worker,"DML_B_"+nonce);
  const ownVictim=await save(victim,victim.worker,"DML_VICTIM_"+nonce);
  const sameParentForeign=await save(a,otherWorker,"DML_FOREIGN_IN_A_"+nonce);
  const unassigned=await save(a,null,"DML_UNATTRIBUTED_"+nonce);
  assert.ok(ownVictim.id>ownA.id&&ownVictim.id>ownB.id&&ownVictim.id>6);
  assert.ok(sameParentForeign.id>ownA.id&&unassigned.id>sameParentForeign.id);
  const snapshot=async()=>({
   documents:await db.select().from(s.documents).orderBy(asc(s.documents.id)),
   employees:await db.select().from(s.employees).orderBy(asc(s.employees.id)),
   audit:await db.select().from(s.auditEvents).orderBy(asc(s.auditEvents.id)),
   grants:await db.select().from(s.userLegalEntityGrants).orderBy(asc(s.userLegalEntityGrants.id)),
  });
  const list=e=>"/api/documents?organizationId="+e.org.id;
  for(const e of [a,b,victim]){
   const res=await get(list(e),e.cookie);
   assert.equal(res.status,200,"Own staff metadata GET failed: "+res.text.slice(0,160));
   assert.ok(Array.isArray(res.json?.documents)&&res.json.documents.length>0,
     "Real own documents must be populated");
   const own=e===a?ownA:e===b?ownB:ownVictim;
   assert.ok(res.json.documents.some(d=>d.id===own.id),
     "Owned same-entity document row must be listed");
   assert.ok(!res.text.includes("DML_FOREIGN_IN_A_"),
     "Same-parent foreign legal employer metadata leaked");
   assert.ok(!res.text.includes("DML_UNATTRIBUTED_"),
     "Unattributed parent document must not be listed in scoped legal-employer response");
   assert.ok(!res.text.includes("DML_VICTIM_")||e===victim,
     "Victim parent employer documents must not leak");
   assert.match(res.headers.get("cache-control")??"",/no-store/i);
  }
  const before=await snapshot();
  const attackCases=[
   ["A query selects ungranted employer",list(a)+"&legalEntityId="+otherEntity.id,a.cookie,{}],
   ["A header selects ungranted employer",list(a),a.cookie,{header:String(otherEntity.id)}],
   ["A conflicting query selectors",list(a)+"&legalEntityId="+a.entity.id+
      "&legalEntityId="+otherEntity.id,a.cookie,{}],
   ["A attempts victim parent",list(victim),a.cookie,{}],
  ];
  let blocked=0;
  for(const [label,url,cookie,opts] of attackCases){
   const res=await get(url,cookie,opts);
   assert.ok([403,404].includes(res.status),label+" must refuse");
   for(const marker of ["DML_FOREIGN_IN_A_","DML_UNATTRIBUTED_","DML_VICTIM_"])
    assert.ok(!res.text.includes(marker),label+" exposed other employer metadata");
   assert.deepEqual(await snapshot(),before,label+" mutated protected SQL");
   blocked++;
  }
  const policy=await get("/api/hcm/documents?organizationId="+a.org.id,a.cookie);
  assert.equal(policy.status,503,"Unscoped HCM policy response must refuse in multi-entity mode");
  assert.equal(policy.json?.code,"HCM_DOCUMENT_LEGAL_EMPLOYER_SCOPE_PENDING");
  assert.ok(!policy.text.includes("DML_FOREIGN_IN_A_")&&!policy.text.includes("DML_A_"+nonce));
  assert.match(policy.headers.get("cache-control")??"",/no-store/i);
  assert.deepEqual(await snapshot(),before,"HCM refusal must not touch protected SQL");
  const revoked=await db.delete(s.userLegalEntityGrants).where(and(
   eq(s.userLegalEntityGrants.organizationId,a.org.id),
   eq(s.userLegalEntityGrants.userId,a.owner.id),
   eq(s.userLegalEntityGrants.legalEntityId,a.entity.id),
  )).returning();
  assert.equal(revoked.length,1);
  const afterRevoke=await snapshot();
  const staleSession=await get(list(a),a.cookie);
  assert.equal(staleSession.status,403,"Revoked employer grant must deny still-valid session");
  assert.ok(!staleSession.text.includes("DML_A_"+nonce));
  assert.deepEqual(await snapshot(),afterRevoke,"Revoked read must not change protected SQL");
  assert.equal((await get(list(a))).status,401);
  console.log(JSON.stringify({
    proof:"DOCUMENT_METADATA_SELECTED_LEGAL_EMPLOYER",
    pgMajor:16,localhost:true,principals:3,higherIdVictim:true,
    ownPopulatedListGets:3,realForeignSelectorDenials:blocked,
    unassignedDocumentExcluded:true,
    hcmUnattributedPolicy503:true,revokedGrantDenied:true,
    deniedSqlUnchanged:true,
    privacyReview:"PENDING",methodCredits:0,productionAccepted:false,
    externalProviders:0,moneyMoved:false,
  }));
 } finally{await pool.end()}
}
if(process.argv[1]?.endsWith("tenant-document-metadata-entity-http.mjs"))
 proveDocumentMetadata().catch(e=>{console.error(e);process.exitCode=1});
