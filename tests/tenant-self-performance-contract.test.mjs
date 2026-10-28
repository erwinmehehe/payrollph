import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {
  ENDPOINT,METHODS,ROUTE_PATH,ROUTE_BLOB_SHA,requireDisposablePerformance,
  assertOwnRead,assertOwnPost,assertOwnPatch,assertDenied,assertNoLeak,
  assertUnchanged,assertOneAuditAdded,
} from "../scripts/qa/tenant-self-performance-contract.mjs";

const safe={
  GITHUB_ACTIONS:"true",CI:"true",NODE_ENV:"production",
  TENANT_SECOND_PASS_MODE:"isolated-ci-only",TENANT_SELF_PERFORMANCE_MODE:"fictional-only",
  DATABASE_URL:"postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL:"http://127.0.0.1:3000",DEMO_MODE:"false",
  WORKER_ENABLED:"false",CENTRAL_SCHEDULER_ENABLED:"false",
  PAYMONGO_DISBURSEMENTS_ENABLED:"false",XENDIT_PAYOUTS_ENABLED:"false",
  XENDIT_BILLING_ENABLED:"false",HCM_OVERPAYMENT_PREVIEW_ENABLED:"false",
  PAYROLL_OVERPAYMENT_REVIEW_ENABLED:"false",
  WORKER_TOKEN:"ci-worker-token-fictional-self-performance",
};
const actor={
  marker:"TTBL-ATTA-SYNTHETIC",label:"ATTA",
  org:{id:21},worker:{id:40},self:{userId:70,name:"Fictional A self"},
  profile:{
    marker:"TTBL-ATTA-SYNTHETIC",
    cycle:{id:101},template:{id:102},cycleTemplate:{id:103},
    review:{id:104},item:{id:105},goal:{id:106},meeting:{id:107},
    seedAgenda:{id:108},sharedAction:{id:109},sharedFeedback:{id:110},
  },
};
function ownGet(){
  const json={
    reviews:[{id:104,organizationId:21,employeeId:40,selfScore:null,
      cycle:{id:101,organizationId:21},
      items:[{id:105,template:{id:102},cycleTemplate:{id:103}}]}],
    goals:[{id:106,employeeId:40,organizationId:21}],
    oneOnOnes:[{id:107,status:"scheduled",
      agenda:"TTBL-ATTA-SYNTHETIC shared 1:1 agenda",
      agendaContributions:[{id:108}],
      actionItems:[{id:109}]}],
    feedback:[{id:110}],
  };
  return {status:200,json,text:JSON.stringify(json)};
}
const mutate=(base,change)=>{
  const copy=structuredClone(base);
  change(copy);
  copy.text=JSON.stringify(copy.json);
  return copy;
};
function ownPost(){
  const json={id:120,organizationId:21,employeeId:40,
    oneOnOneId:107,authorUserId:70,authorEmployeeId:40,
    authorName:"Fictional A self",content:"FICTIONAL owned upcoming agenda note"};
  return {status:201,json,text:JSON.stringify(json)};
}
function ownPatch(){
  const json={id:104,organizationId:21,employeeId:40,cycleId:101,
    selfScore:"4.50",employeeReflection:"FICTIONAL own reflection",
    items:[{id:105,reviewId:104,selfScore:"4.00",
      employeeComment:"FICTIONAL own item comment"}]};
  return {status:200,json,text:JSON.stringify(json)};
}

test("refuse all nonlocal, provider-enabled, money-enabled or hosted runner environments",()=>{
  assert.doesNotThrow(()=>requireDisposablePerformance(safe));
  const mutations=[
    {GITHUB_ACTIONS:"false"},{CI:"false"},{NODE_ENV:"development"},
    {TENANT_SECOND_PASS_MODE:""},{TENANT_SELF_PERFORMANCE_MODE:""},
    {DATABASE_URL:"postgresql://postgres:postgres@localhost:5432/app_db"},
    {DATABASE_URL:"postgresql://postgres:postgres@127.0.0.1:5432/live"},
    {DATABASE_URL:"postgresql://postgres:postgres@127.0.0.1:5432/app_db?sslmode=require"},
    {SECURITY_SMOKE_URL:"http://localhost:3000"},
    {SECURITY_SMOKE_URL:"http://127.0.0.1:3000/victim"},
    {SECURITY_SMOKE_URL:"https://payroll.example.test"},
    {DEMO_MODE:"true"},{WORKER_ENABLED:"true"},
    {CENTRAL_SCHEDULER_ENABLED:"true"},
    {PAYMONGO_DISBURSEMENTS_ENABLED:"true"},
    {XENDIT_PAYOUTS_ENABLED:"true"},
    {XENDIT_BILLING_ENABLED:"true"},
    {HCM_OVERPAYMENT_PREVIEW_ENABLED:"true"},
    {PAYROLL_OVERPAYMENT_REVIEW_ENABLED:"true"},
    {WORKER_TOKEN:"production-token"},
    {PAYMONGO_SECRET_KEY:"fake"},{XENDIT_SECRET_KEY:"fake"},
    {XENDIT_PAYOUT_SECRET_KEY:"fake"},{RESEND_API_KEY:"fake"},
    {POSTMARK_SERVER_TOKEN:"fake"},{SMTP_URL:"smtp://local"},
    {STRIPE_SECRET_KEY:"fake"},{DATABASE_URL_DIRECT:"fake"},
    {VERCEL_ENV:"production"},{NEON_DATABASE_URL:"fake"},
  ];
  for(const x of mutations){
    assert.throws(()=>requireDisposablePerformance({...safe,...x}),
      /PERFORMANCE_TENANT_REFUSED/,JSON.stringify(x));
  }
  for(const [name,value] of Object.entries(safe)){
    assert.throws(()=>requireDisposablePerformance({...safe,[name]:undefined}),
      /PERFORMANCE_TENANT_REFUSED/,name);
  }
});

test("three exact reviewed methods retain source SHA and earned real-HTTP method proofs",()=>{
  assert.equal(ENDPOINT,"/api/self/performance");
  assert.deepEqual(METHODS,["GET","POST","PATCH"]);
  assert.equal(ROUTE_PATH,"src/app/api/self/performance/route.ts");
  const manifest=JSON.parse(readFileSync(new URL(
    "../scripts/qa/tenant-isolation-coverage-manifest.json",import.meta.url),"utf8"));
  const entry=manifest.allApiRouteFiles[ROUTE_PATH];
  assert.ok(entry);
  assert.equal(entry.gitBlobSha,ROUTE_BLOB_SHA);
  assert.equal(entry.route,"self/performance");
  assert.deepEqual(entry.methods.map(x=>x.name),METHODS);
  for(const method of entry.methods){
    assert.equal(method.status,"COVERED","only method-specific reviewed proof may grant credit");
    assert.equal(method.testedBy?.prNumber,1513);
    assert.equal(method.testedBy?.workflowRunId,40620797757);
    assert.equal(method.testedBy?.routeBlobSha,ROUTE_BLOB_SHA);
    assert.ok(method.testedBy?.forgedSelectorLine>0);
    assert.ok(method.testedBy?.unchangedDbLine>0);
  }
  const runner=readFileSync(new URL("../scripts/qa/tenant-self-performance-http.mjs",import.meta.url),"utf8");
  assert.ok(runner.indexOf("requireDisposablePerformance();")>=0);
  assert.ok(runner.indexOf("requireDisposablePerformance();")<
    runner.indexOf('import("../../src/db/index.ts")'),
    "environment guard must run before DB import");
  for(const marker of [
    'seedEmployer("ATTA")','seedEmployer("ATTB")','seedEmployer("VICTIM")',
    "performanceOneOnOnes","performanceOneOnOneAgendaContributions",
    "performanceReviews","performanceReviewItems","performanceFeedback",
    "assertOwnRead","assertOwnPost","assertOwnPatch",
    "assertDenied","assertUnchanged","fakeForeignLink",
    "revoked membership","coverageCredits:0",
  ])assert.ok(runner.includes(marker),"missing evidence: "+marker);
});

test("populated own GET rejects empty, incorrect, swapped, private or leaked data",()=>{
  const read=ownGet();
  assert.equal(assertOwnRead(read,actor,["TTBL-VICTIM"]).reviews[0].id,104);
  for(const mutation of [
    x=>{x.status=204;},
    x=>{x.json.reviews=[];},
    x=>{x.json.goals=[];},
    x=>{x.json.oneOnOnes=[];},
    x=>{x.json.feedback=[];},
    x=>{x.json.reviews[0].id=999;},
    x=>{x.json.reviews[0].organizationId=999;},
    x=>{x.json.reviews[0].employeeId=999;},
    x=>{x.json.reviews[0].cycle.id=999;},
    x=>{x.json.reviews[0].items=[];},
    x=>{x.json.reviews[0].items[0].id=999;},
    x=>{x.json.reviews[0].items[0].template.id=999;},
    x=>{x.json.reviews[0].items[0].cycleTemplate.id=999;},
    x=>{x.json.goals[0].employeeId=999;},
    x=>{x.json.oneOnOnes[0].id=999;},
    x=>{x.json.oneOnOnes[0].agendaContributions=[];},
    x=>{x.json.oneOnOnes[0].actionItems=[{id:109},{id:999}];},
    x=>{x.json.oneOnOnes[0].privateManagerNotes="hidden";},
    x=>{x.json.feedback[0].id=999;},
    x=>{x.json.otherPrivateRecords=[];},
  ])assert.throws(()=>assertOwnRead(mutate(read,mutation),actor),
    "must reject modified own positive");
  assertOwnRead(mutate(read,x=>{x.json.reviews[0].selfScore="4.50";}),actor,[],1,"4.50");
  assert.throws(()=>assertOwnRead(read,actor,[],2));
  assert.throws(()=>assertOwnRead(read,actor,[],1,"4.50"));
  assert.throws(()=>assertOwnRead(mutate(read,x=>{
    x.json.goals[0].title="TTBL-VICTIM private";
  }),actor,["TTBL-VICTIM"]));
  assert.throws(()=>assertNoLeak({text:"SECRET-MANAGER-TTBL-ATTA-SYNTHETIC"},[
    "SECRET-MANAGER-TTBL-ATTA-SYNTHETIC"]));
});

test("real own POST and PATCH require correct employee, employer, source and actor",()=>{
  const post=ownPost();
  assert.equal(assertOwnPost(post,actor,post.json.content).id,120);
  for(const mutation of [
    x=>{x.status=202;},x=>{x.json.id=null;},
    x=>{x.json.organizationId=99;},
    x=>{x.json.employeeId=99;},x=>{x.json.oneOnOneId=99;},
    x=>{x.json.authorUserId=99;},x=>{x.json.authorEmployeeId=99;},
    x=>{x.json.authorName="victim";},x=>{x.json.content="other";},
  ])assert.throws(()=>assertOwnPost(mutate(post,mutation),actor,post.json.content));
  const patch=ownPatch();
  const input={selfScore:"4.50",itemScore:"4.00",
    employeeReflection:"FICTIONAL own reflection",employeeComment:"FICTIONAL own item comment"};
  assert.equal(assertOwnPatch(patch,actor,input).id,104);
  for(const mutation of [
    x=>{x.status=204;},x=>{x.json.id=900;},
    x=>{x.json.organizationId=900;},x=>{x.json.employeeId=900;},
    x=>{x.json.cycleId=900;},x=>{x.json.selfScore="1.00";},
    x=>{x.json.employeeReflection="victim";},
    x=>{x.json.items=[];},x=>{x.json.items[0].id=900;},
    x=>{x.json.items[0].reviewId=900;},
    x=>{x.json.items[0].selfScore="1.00";},
    x=>{x.json.items[0].employeeComment="other";},
  ])assert.throws(()=>assertOwnPatch(mutate(patch,mutation),actor,input));
});

test("denial contract rejects wrong HTTP code, private response, or victim marker",()=>{
  const denied={status:404,json:{error:"not found"},text:'{"error":"not found"}'};
  assertDenied(denied,404,["TTBL-VICTIM"]);
  assert.throws(()=>assertDenied(denied,403));
  assert.throws(()=>assertDenied(mutate(denied,x=>{x.json.reviews=[];}),404));
  assert.throws(()=>assertDenied({...denied,text:"TTBL-VICTIM PRIVATE"},404,["TTBL-VICTIM"]));
  assert.throws(()=>assertDenied({...denied,json:{message:"missing"}},404));
});

test("snapshot, exact actor audit and one-added-event invariants reject false positives",()=>{
  const before={audit:[],payroll:[],reviews:[{id:104}],agenda:[],memberships:[]};
  const after=structuredClone(before);
  after.audit.push({organizationId:21,actor:actor.self.name,
    action:"Employee contributed 1:1 agenda item",
    metadata:{oneOnOneId:107,agendaContributionId:120,employeeId:40}});
  assert.equal(assertOneAuditAdded(before,after,actor,
    "Employee contributed 1:1 agenda item","oneOnOneId",107).metadata.agendaContributionId,120);
  for(const mutation of [
    x=>{x.audit=[];},x=>{x.audit.push({...x.audit[0]});},
    x=>{x.audit[0].organizationId=999;},x=>{x.audit[0].actor="other";},
    x=>{x.audit[0].action="other";},x=>{x.audit[0].metadata.oneOnOneId=999;},
  ]){const changed=structuredClone(after);mutation(changed);
    assert.throws(()=>assertOneAuditAdded(before,changed,actor,
      "Employee contributed 1:1 agenda item","oneOnOneId",107));}
  assertUnchanged(before,structuredClone(before),"negative control");
  assert.throws(()=>assertUnchanged(before,after,"unexpected mutation"));
});
