import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {
  isVerifiedPunchReviewQueue,isVerifiedPunchDecisionReceipt,readVerifiedPunchReviewQueue,
} from "../src/lib/workforce-punch-review-read";

const row = {
  id: 18, organizationId: 12, employeeId: 9, requestedByUserId: 27,
  clientPunchId: "00000000-0000-4000-8000-000000000001",
  name: "Synthetic Worker", actionType: "clock_in", workDate: "2026-10-18",
  deviceOccurredAt: "2026-10-17T23:55:00.000Z",
  serverReceivedAt: "2026-10-17T23:58:00.000Z",
  receivedSource: "offline", status: "pending", flags: ["offline-synced"],
  photoEvidenceId: null,
} as const;
const queue = {organizationId:12,submissions:[row]};
const fake = (body:unknown,status=200):typeof fetch =>
  (async()=>Response.json(body,{status})) as typeof fetch;

test("authorized exact-scope queue and genuine empty queue validate",()=>{
  assert.equal(isVerifiedPunchReviewQueue(queue,12),true);
  assert.equal(isVerifiedPunchReviewQueue({organizationId:12,submissions:[]},12),true);
  assert.equal(isVerifiedPunchReviewQueue(queue,13),false);
  assert.equal(isVerifiedPunchReviewQueue({organizationId:0,submissions:[]},0),false);
});

test("foreign, incomplete, duplicate and falsified actionable rows fail closed",()=>{
  const failures:unknown[]=[
    {}, [], {organizationId:12}, {organizationId:12,submissions:null},
    {organizationId:11,submissions:[]},
    {...queue,submissions:[{...row,organizationId:13}]},
    {...queue,submissions:[{...row,employeeId:0}]},
    {...queue,submissions:[{...row,requestedByUserId:null}]},
    {...queue,submissions:[{...row,name:"  "}]},
    {...queue,submissions:[{...row,status:"approved"}]},
    {...queue,submissions:[{...row,actionType:"change_pay"}]},
    {...queue,submissions:[{...row,receivedSource:"manual"}]},
    {...queue,submissions:[{...row,workDate:"2026-02-30"}]},
    {...queue,submissions:[{...row,deviceOccurredAt:"2026-02-30T23:55:00.000Z"}]},
    {...queue,submissions:[{...row,serverReceivedAt:"2026-10-18T00:00:00+00:00"}]},
    {...queue,submissions:[{...row,flags:null}]},
    {...queue,submissions:[{...row,flags:["unknown-risk-label"]}]},
    {...queue,submissions:[{...row,photoEvidenceId:"other-tenant-photo"}]},
    {...queue,submissions:[{...row,clientPunchId:"not-a-uuid"}]},
    {...queue,submissions:[row,row]},
    {organizationId:12,submissions:Array.from({length:101},(_,i)=>({...row,id:i+1}))},
  ];
  for(const bad of failures)
    assert.equal(isVerifiedPunchReviewQueue(bad,12),false,JSON.stringify(bad).slice(0,180));
});

test("GET 404 / 403, HTML, JSON invalid and another employer are not empty success",async()=>{
  const sent:Array<{url:string;init?:RequestInit}>=[];
  const controller=new AbortController();
  const request=(async (url:string|URL|Request,init?:RequestInit)=>{
    sent.push({url:String(url),init});
    return Response.json(queue);
  }) as typeof fetch;
  assert.deepEqual(await readVerifiedPunchReviewQueue(12,request,controller.signal),queue);
  assert.equal(sent[0].url,"/api/web-bundy/review?organizationId=12");
  assert.equal(sent[0].init?.cache,"no-store");
  assert.equal(sent[0].init?.signal,controller.signal);
  await assert.rejects(()=>readVerifiedPunchReviewQueue(-1,request),/valid employer/);
  assert.equal(sent.length,1,"Invalid scope must not fetch");
  for(const status of [403,404,503])
    await assert.rejects(()=>readVerifiedPunchReviewQueue(12,fake({error:"not available"},status)),/unavailable/);
  await assert.rejects(()=>readVerifiedPunchReviewQueue(12,fake({})),/incomplete/);
  await assert.rejects(()=>readVerifiedPunchReviewQueue(12,fake({organizationId:13,submissions:[]})),/another employer/);
  const login=(async()=>new Response("<html>Login</html>",{status:200,headers:{"content-type":"text/html"}})) as typeof fetch;
  await assert.rejects(()=>readVerifiedPunchReviewQueue(12,login),/unreadable/);
  assert.deepEqual(await readVerifiedPunchReviewQueue(12,fake({organizationId:12,submissions:[]})),
    {organizationId:12,submissions:[]});
});

test("POST acceptance requires exact employer/employee/id, status, date and verified final receipt",()=>{
  const approved={ok:true,organizationId:12,
    submission:{id:row.id,organizationId:12,employeeId:row.employeeId,status:"approved"},
    approvedWorkDate:"2026-10-18"};
  assert.equal(isVerifiedPunchDecisionReceipt(approved,12,row,"approved"),true);
  const rejected={...approved,submission:{...approved.submission,status:"rejected"},approvedWorkDate:null};
  assert.equal(isVerifiedPunchDecisionReceipt(rejected,12,row,"rejected"),true);
  assert.equal(isVerifiedPunchDecisionReceipt({...approved,warning:"Exception reconciliation needs follow-up."},12,row,"approved"),true);
  const invalid:unknown[]=[
    {},{...approved,ok:false},{...approved,organizationId:13},
    {...approved,submission:{...approved.submission,id:55}},
    {...approved,submission:{...approved.submission,employeeId:77}},
    {...approved,submission:{...approved.submission,organizationId:13}},
    {...approved,submission:{...approved.submission,status:"pending"}},
    {...approved,submission:{...approved.submission,status:"rejected"}},
    {...approved,approvedWorkDate:null},{...approved,approvedWorkDate:"2026-02-30"},
    {...approved,warning:{}},
  ];
  for(const bad of invalid)
    assert.equal(isVerifiedPunchDecisionReceipt(bad,12,row,"approved"),false,JSON.stringify(bad));
  assert.equal(isVerifiedPunchDecisionReceipt({...rejected,approvedWorkDate:"2026-10-18"},12,row,"rejected"),false);
});

test("route preserves transaction guards and response scope; UI blocks unverified approval",()=>{
  const route=readFileSync("src/app/api/web-bundy/review/route.ts","utf8");
  const ui=readFileSync("src/components/workspace/punch-evidence-review-panel.tsx","utf8");
  assert.match(route,/return Response\.json\(\{organizationId,submissions:/);
  assert.match(route,/organizationId:workforcePunchSubmissions\.organizationId/);
  assert.match(route,/employeeId:workforcePunchSubmissions\.employeeId/);
  assert.match(route,/pg_advisory_xact_lock\(6109/);
  assert.match(route,/attendanceMutationLock\(locks,date,"capture"\)/);
  assert.match(route,/if\(fresh\.requestedByUserId===context\.user!\.id\)/);
  assert.match(ui,/PunchEvidenceReviewView key=\{organizationId\}/);
  assert.match(ui,/controller\.abort\(\)/);
  assert.match(ui,/snapshot\?\.version===version/);
  assert.match(ui,/readVerifiedPunchReviewQueue\(organizationId,fetch,controller\.signal\)/);
  assert.match(ui,/isVerifiedPunchDecisionReceipt\(body,organizationId,row,decision\)/);
  assert.match(ui,/const actionable=!loading&&!error&&!outcomeError&&busy===null&&rows!==null/);
  assert.match(ui,/actionable&&rows\.length===0&&<p>No pending enhanced punches/);
  assert.doesNotMatch(ui,/setRows\(body\.submissions\?\?\[\]\)/);
  assert.doesNotMatch(ui,/response\.status===404/);
});
