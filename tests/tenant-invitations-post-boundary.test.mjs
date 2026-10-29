import assert from "node:assert/strict";
import {test} from "node:test";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {requireDisposableInvitations,proveOwnInvitationRead,proveOwnInvitationPost,proveUnchanged} from "../scripts/qa/tenant-invitations-post-boundary.mjs";
const env={GITHUB_ACTIONS:"true",CI:"true",NODE_ENV:"production",TENANT_SECOND_PASS_MODE:"isolated-ci-only",DATABASE_URL:"postgresql://postgres:postgres@127.0.0.1:5432/app_db",SECURITY_SMOKE_URL:"http://127.0.0.1:3000",WORKER_ENABLED:"false",CENTRAL_SCHEDULER_ENABLED:"false",PAYMONGO_DISBURSEMENTS_ENABLED:"false",XENDIT_PAYOUTS_ENABLED:"false",XENDIT_BILLING_ENABLED:"false",DEMO_MODE:"false",SMTP_URL:"smtp://127.0.0.1:2525",MAIL_FROM:"PayrollPH QA <no-reply@example.invalid>"};
test("refuse non-disposable environment and providers",()=>{
 assert.doesNotThrow(()=>requireDisposableInvitations(env));
 for(const [k,v] of Object.entries(env)){
  assert.throws(()=>requireDisposableInvitations({...env,[k]:v==="false"?"true":"false"}));
  assert.throws(()=>requireDisposableInvitations({...env,[k]:undefined}));
 }
 for(const k of ["PAYMONGO_SECRET_KEY","XENDIT_SECRET_KEY","RESEND_API_KEY","POSTMARK_SERVER_TOKEN","STRIPE_SECRET_KEY"])
  assert.throws(()=>requireDisposableInvitations({...env,[k]:"fake-provider"}));
});
test("real own-positive contract must not accept empty or another employer",()=>{
 const actor={invitationId:12,email:"alpha@example.invalid",owner:{name:"Alpha",email:"owner@example.invalid"}};
 const response={status:200,json:{invitations:[{id:12,email:actor.email,invitedBy:"Alpha",accepted:false}],members:[{email:"owner@example.invalid"}]}};
 assert.doesNotThrow(()=>proveOwnInvitationRead(response,actor));
 assert.throws(()=>proveOwnInvitationRead({...response,json:{...response.json,invitations:[]}},actor));
 assert.throws(()=>proveOwnInvitationRead(response,{...actor,invitationId:13}));
 assert.throws(()=>proveUnchanged({invites:[1]},{invites:[2]},"denial"));
});
test("route still checks employer authorization before any POST insert",()=>{
 const route=readFileSync("src/app/api/invitations/route.ts","utf8");
 const pos=route.indexOf("export async function POST");
 const rest=route.slice(pos);
 assert.ok(rest.indexOf("assertOrganizationRole(")<rest.indexOf("createInvitation("));
 assert.match(rest,/ORG_ADMIN_ROLES/);
 const runner=readFileSync("scripts/qa/tenant-invitations-post-boundary.mjs","utf8");
 assert.ok(runner.indexOf("requireDisposableInvitations();")<runner.indexOf('import("../../src/db/index.ts")'));
 assert.match(runner,/coverageCredits:0/);
});

test("strict SMTP allowlist cannot be replaced by remote delivery or weaker provider flags",()=>{
 for(const smtp of ["smtps://127.0.0.1:465","smtp://smtp.example.com:2525","smtp://localhost:2525","smtp://127.0.0.1:2526"]){
  assert.throws(()=>requireDisposableInvitations({...env,SMTP_URL:smtp}));
 }
 assert.throws(()=>requireDisposableInvitations({...env,XENDIT_BILLING_ENABLED:"true"}));
 assert.throws(()=>requireDisposableInvitations({...env,MAIL_FROM:"Somebody <real@example.com>"}));
});
test("owned POST requires a real SMTP token-hash, delivered outbox and actor audit",()=>{
 const employer={org:{id:41},unit:{id:15},owner:{name:"A owner"},marker:"TTBL-ATTA-abc123"};
 const email=(employer.marker+"-foreign@example.invalid").toLowerCase();
 const token="AbCdEfGhIjKlMnOpQrStUvWxYz012345";
 const response={status:201,json:{
  id:122,email,role:"employee",inviteToken:undefined,
  delivery:{configured:true,delivered:true,queued:false,provider:"smtp"}
 }};
 const saved={id:122,organizationId:41,orgUnitId:15,
  invitedBy:"A owner",email,role:"employee",acceptedAt:null,
  expiresAt:new Date(Date.now()+60000),tokenHash:createHash("sha256").update(token).digest("hex")};
 const mail={recipient:email,raw:"From: sender@example.invalid\nTo: "+email+
   "\n\nhttps://payroll.example.test/invite?token="+token};
 const outbox={organizationId:41,recipient:email,purpose:"invitation",
  status:"sent",deliveryStatus:"accepted",provider:"smtp",
  sentAt:new Date(),body:"[redacted after delivery attempt]"};
 const audits=[{organizationId:41,actor:"A owner",action:"Invitation created",
  resource:email,metadata:{role:"employee",deliveryConfigured:true,delivered:true}}];
 const prove=(r=response,i=saved,m=mail,o=outbox,a=audits)=>
  proveOwnInvitationPost(r,employer,i,m,o,a);
 assert.equal(prove(),true);
 assert.throws(()=>prove({...response,status:403}));
 assert.throws(()=>prove({...response,json:{...response.json,inviteToken:token}}));
 assert.throws(()=>prove({...response,json:{...response.json,delivery:{...response.json.delivery,delivered:false}}}));
 assert.throws(()=>prove(response,{...saved,organizationId:42}));
 assert.throws(()=>prove(response,{...saved,orgUnitId:777}));
 assert.throws(()=>prove(response,{...saved,tokenHash:"0".repeat(64)}));
 assert.throws(()=>prove(response,saved,{...mail,recipient:"victim@example.invalid"}));
 assert.throws(()=>prove(response,saved,mail,{...outbox,status:"queued"}));
 assert.throws(()=>prove(response,saved,mail,outbox,[]));
 assert.throws(()=>prove(response,saved,mail,outbox,[...audits,...audits]));
});

test("real disposable PG16 runner exercises unit-visible read, eight privilege denials, own write and revoked session",()=>{
 const runner=readFileSync("scripts/qa/tenant-invitations-post-boundary.mjs","utf8");
 for(const proof of [
  "const unitRead=await http.standaloneRequest(",
  "row.orgUnitId===a.unit.id",
  "const unitDeniedCases=[",
  "sibling-unit employee",
  "company-wide employee",
  "unit admin invitation",
  "unit owner invitation",
  "unit bookkeeper invitation",
  "const unitVictimGet=await http.standaloneRequest(",
  "const unitVictimPost=await http.standaloneRequest(",
  "const unitPositive=await http.standaloneRequest(",
  "unitSaved?.orgUnitId,a.unit.id",
  "smtp.captured.filter(mail=>mail.recipient===ownUnitEmail)",
  "await db.update(s.userOrganizations).set({active:false})",
  "revoked unit administrator cannot issue invites",
  "methodFullyCovered:false,coverageCredits:0",
 ])assert.ok(runner.includes(proof),"missing unit-isolation proof: "+proof);
 const start=runner.indexOf("const unitDeniedCases=[");
 const positive=runner.indexOf("const unitPositive=await http.standaloneRequest(");
 const revoke=runner.indexOf("await db.update(s.userOrganizations).set({active:false})");
 assert.ok(start>0&&positive>start&&revoke>positive,
   "privilege denial, own success and revocation must execute in one live session sequence");
});

