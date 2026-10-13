import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CareersBoard } from "../src/components/careers-board";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";
import { resolveWorkflowUiFlags } from "../src/lib/workflow-ui-flags";
test("public careers is default OFF, exact-true and blocked for multi-entity",()=>{
 for(const value of [undefined,"","1","TRUE","true "])
  assert.equal(criticalReleaseFlagEnabled("recruitmentJourney",{RECRUITMENT_JOURNEY_UI_ENABLED:value}),false);
 assert.equal(resolveWorkflowUiFlags({RECRUITMENT_JOURNEY_UI_ENABLED:"true",MULTI_ENTITY_ENABLED:"false"}).recruitmentJourney,true);
 assert.equal(resolveWorkflowUiFlags({RECRUITMENT_JOURNEY_UI_ENABLED:"true",MULTI_ENTITY_ENABLED:"true"}).recruitmentJourney,false);
});
test("public careers SSR shows only supplied explicitly published job records",()=>{
 const empty=renderToStaticMarkup(createElement(CareersBoard,{organizationId:1,organizationName:"Synthetic Employer",jobs:[]}));
 assert.match(empty,/No published openings/);
 const html=renderToStaticMarkup(createElement(CareersBoard,{organizationId:1,organizationName:"Synthetic Employer",jobs:[{id:4,title:"Payroll Analyst",department:"Finance",employmentType:"Full-time",description:"Test role"}]}));
 assert.match(html,/Payroll Analyst/);assert.match(html,/Apply for this role/);
 assert.doesNotMatch(html,/bank account/i);
});
test("public and admin careers deny disabled and multi-entity requests before DB access",async()=>{
 process.env.DATABASE_URL??="postgresql://local:local@127.0.0.1:1/offline";
 const prev=[process.env.RECRUITMENT_JOURNEY_UI_ENABLED,process.env.MULTI_ENTITY_ENABLED];
 try{
  const [pub,admin]=await Promise.all([import("../src/app/api/careers/route"),import("../src/app/api/careers/admin/route")]);
  process.env.RECRUITMENT_JOURNEY_UI_ENABLED="false";process.env.MULTI_ENTITY_ENABLED="false";
  assert.equal((await pub.GET(new Request("https://example.test/api/careers?organizationId=1"))).status,404);
  process.env.RECRUITMENT_JOURNEY_UI_ENABLED="true";process.env.MULTI_ENTITY_ENABLED="true";
  for(const [method,fn] of [["GET",pub.GET],["POST",pub.POST],["PATCH",admin.PATCH]] as const){
    const path=method==="PATCH"?"/api/careers/admin":"/api/careers";
    const out=await fn(new Request("https://example.test"+path+"?organizationId=1",{method,...(method==="GET"?{}:{headers:{"content-type":"application/json"},body:"{}"})}));
    assert.equal(out.status,403);assert.equal((await out.json()).code,"ENTITY_WORKFLOW_DEFERRED");
  }
 }finally{
  if(prev[0]===undefined)delete process.env.RECRUITMENT_JOURNEY_UI_ENABLED;else process.env.RECRUITMENT_JOURNEY_UI_ENABLED=prev[0];
  if(prev[1]===undefined)delete process.env.MULTI_ENTITY_ENABLED;else process.env.MULTI_ENTITY_ENABLED=prev[1];
 }
});

test("careers API fails closed without independently enabled applicant privacy", async () => {
 const saved = [process.env.RECRUITMENT_JOURNEY_UI_ENABLED, process.env.MULTI_ENTITY_ENABLED,
  process.env.APPLICANT_PRIVACY_CONTROLS_ENABLED, process.env.PUBLIC_INTAKE_PROOF_ENABLED];
 try {
  process.env.RECRUITMENT_JOURNEY_UI_ENABLED = "true";
  process.env.MULTI_ENTITY_ENABLED = "false";
  process.env.APPLICANT_PRIVACY_CONTROLS_ENABLED = "false";
  process.env.PUBLIC_INTAKE_PROOF_ENABLED = "true";
  const pub = await import("../src/app/api/careers/route");
  const admin = await import("../src/app/api/careers/admin/route");
  const request = new Request("https://example.test/api/careers?organizationId=1");
  assert.equal((await pub.GET(request)).status, 404);
  assert.equal((await pub.POST(new Request(request.url, {method:"POST",body:"{}",headers:{"content-type":"application/json"}}))).status, 404);
  assert.equal((await admin.PATCH(new Request("https://example.test/api/careers/admin",{method:"PATCH",body:"{}",headers:{"content-type":"application/json"}}))).status, 404);
 } finally {
  for(const [index,key] of ["RECRUITMENT_JOURNEY_UI_ENABLED","MULTI_ENTITY_ENABLED",
   "APPLICANT_PRIVACY_CONTROLS_ENABLED","PUBLIC_INTAKE_PROOF_ENABLED"].entries()){
   if(saved[index]===undefined) delete process.env[key]; else process.env[key]=saved[index];
  }
 }
});
test("careers UI visibly links notice version for documented consent",()=>{
 const html=renderToStaticMarkup(createElement(CareersBoard,{organizationId:1,
  organizationName:"Synthetic Employer",jobs:[{id:4,title:"Payroll Analyst",
  department:"Finance",employmentType:"Full-time",description:"Test role"}],
  privacyNoticeVersion:"v1-2026",privacyNoticeUrl:"https://example.test/privacy"}));
 assert.match(html,/recruitment privacy notice/);
 assert.match(html,/v1-2026/);
 assert.match(html,/https:\/\/example.test\/privacy/);
});
