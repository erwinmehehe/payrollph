import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CareersBoard } from "../src/components/careers-board";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";
import { resolveWorkflowUiFlags } from "../src/lib/workflow-ui-flags";
import { readFileSync } from "node:fs";
import { careersNoticeConfig, canManagePublicCareers } from "../src/lib/careers-privacy-gates";
import { careersContactFields, readCareersApplicationBody, MAX_PUBLIC_CAREERS_BODY_BYTES } from "../src/lib/careers-intake-body";
import { requireApplicantConsent } from "../src/lib/recruitment-applicant-privacy";
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

test("public notice/consent gates require #925, exact flags and a usable HTTPS versioned notice", () => {
  const enabled = {
    RECRUITMENT_JOURNEY_UI_ENABLED: "true",
    APPLICANT_PRIVACY_CONTROLS_ENABLED: "true",
    PUBLIC_INTAKE_PROOF_ENABLED: "true",
    MULTI_ENTITY_ENABLED: "false",
    CAREERS_PRIVACY_NOTICE_VERSION: "2026.10",
    CAREERS_PRIVACY_NOTICE_URL: "https://example.invalid/recruiting/privacy",
  };
  assert.deepEqual(careersNoticeConfig(enabled), {
    version: "2026.10", url: "https://example.invalid/recruiting/privacy",
  });
  for (const flag of ["RECRUITMENT_JOURNEY_UI_ENABLED",
    "APPLICANT_PRIVACY_CONTROLS_ENABLED", "PUBLIC_INTAKE_PROOF_ENABLED"]) {
    assert.equal(careersNoticeConfig({ ...enabled, [flag]: "false" }), null, flag);
  }
  assert.equal(careersNoticeConfig({ ...enabled, MULTI_ENTITY_ENABLED: "true" }), null);
  for (const url of ["http://example.invalid/privacy", "https://user:pass@example.invalid/privacy",
    "https://", "javascript:alert(1)", "https://example.invalid/privacy "]) {
    assert.equal(careersNoticeConfig({ ...enabled, CAREERS_PRIVACY_NOTICE_URL: url }), null, url);
  }
  assert.equal(careersNoticeConfig({ ...enabled, CAREERS_PRIVACY_NOTICE_VERSION: "" }), null);
  const consent = requireApplicantConsent({
    privacyAccepted: true, privacyNoticeVersion: "2026.10",
    privacyEvidenceReference: "careers-web:synthetic-source-0001",
  });
  assert.equal(consent.privacyNoticeVersion, "2026.10");
  assert.throws(() => requireApplicantConsent({
    privacyAccepted: false, privacyNoticeVersion: "2026.10",
    privacyEvidenceReference: "careers-web:synthetic-source-0001",
  }), /CANDIDATE_CONSENT_EVIDENCE_REQUIRED/);
});

test("public careers contact data is accepted intact or rejected, never truncated", () => {
  assert.deepEqual(careersContactFields({}), { phone: "", notes: "" });
  assert.deepEqual(careersContactFields({
    phone: " +63 912 345 6789 ",
    notes: " First line\nSecond line ",
  }), { phone: "+63 912 345 6789", notes: "First line\nSecond line" });
  assert.equal(careersContactFields({ phone: "1".repeat(32) })?.phone.length, 32);
  assert.equal(careersContactFields({ notes: "a".repeat(1000) })?.notes.length, 1000);
  for (const invalid of [
    { phone: "1".repeat(33) }, { notes: "a".repeat(1001) },
    { phone: 123456 }, { phone: [] }, { notes: ["message"] },
    { phone: "12\u0000" }, { phone: "123\n456" },
    { notes: "Valid\u0000message" },
  ]) {
    assert.equal(careersContactFields(invalid), null, JSON.stringify(invalid));
  }
  const route = readFileSync("src/app/api/careers/route.ts", "utf8");
  assert.match(route, /careersContactFields\(body\)/);
  assert.doesNotMatch(route, /\.slice\(0, (?:32|1000)\)/);
});

test("public JSON intake is bounded, type checked and rejects chunked oversized bodies", async () => {
  const req = (body: string, headers: Record<string, string> = { "content-type": "application/json" }) =>
    new Request("https://example.invalid/api/careers", { method: "POST", headers, body });
  const parsed = await readCareersApplicationBody(req('{"organizationId":1,"consent":true}'));
  assert.ok(!(parsed instanceof Response));
  if (!(parsed instanceof Response)) assert.equal(parsed.consent, true);
  for (const body of ["[]", "null", "invalid-json"]) {
    const response = await readCareersApplicationBody(req(body));
    assert.ok(response instanceof Response);
    assert.equal(response.status, 422);
  }
  assert.equal((await readCareersApplicationBody(req("{}", {"content-type":"text/plain"})) as Response).status, 415);
  assert.equal((await readCareersApplicationBody(req("{}", {
    "content-type":"application/json", "content-length":String(MAX_PUBLIC_CAREERS_BODY_BYTES+1),
  })) as Response).status, 413);
  const over = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_PUBLIC_CAREERS_BODY_BYTES - 10).fill(32));
      controller.enqueue(new Uint8Array(20).fill(32));
      controller.close();
    },
  });
  const huge = await readCareersApplicationBody(new Request("https://example.invalid/api/careers", {
    method:"POST",headers:{"content-type":"application/json"},body:over,duplex:"half",
  } as RequestInit));
  assert.ok(huge instanceof Response);
  assert.equal(huge.status, 413);
});

test("publication is company-wide HR only and uses a current-state CAS audit", () => {
  for (const role of ["owner", "admin", "hr"]) {
    assert.equal(canManagePublicCareers({ role, companyWide: true }), true);
    assert.equal(canManagePublicCareers({ role, companyWide: false }), false);
  }
  for (const role of ["bookkeeper", "payroll", "employee", "manager", "checker", "group_hr"]) {
    assert.equal(canManagePublicCareers({ role, companyWide: true }), false);
  }
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const admin = readFileSync("src/app/api/careers/admin/route.ts", "utf8");
  const recruit = readFileSync("src/app/api/recruitment/route.ts", "utf8");
  assert.doesNotMatch(schema, /careersPublished:\s*boolean\("careers_published"\)/,
    "A new Drizzle field would break flag-OFF legacy queries on pre-migration DBs");
  assert.match(admin, /req\.careers_published = \$\{body\.expectedPublished\}/);
  assert.match(admin, /req\.organization_id = \$\{organizationId\}/);
  assert.match(recruit, /privacyConsentRequired/);
  assert.match(recruit, /careersPublishingReady/);
  assert.match(recruit, /await tx\.insert\(auditEvents\)\.values\(/);
  const panel = readFileSync("src/components/recruitment-panel.tsx", "utf8");
  assert.match(panel, /privacyEvidenceReference/);
  assert.match(panel, /expectedPublished: req\.careersPublished === true/);
});
