import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {requireDisposableInvitations,proveOwnInvitationRead,proveUnchanged} from "../scripts/qa/tenant-invitations-post-boundary.mjs";
const env={GITHUB_ACTIONS:"true",CI:"true",NODE_ENV:"production",TENANT_SECOND_PASS_MODE:"isolated-ci-only",DATABASE_URL:"postgresql://postgres:postgres@127.0.0.1:5432/app_db",SECURITY_SMOKE_URL:"http://127.0.0.1:3000",WORKER_ENABLED:"false",CENTRAL_SCHEDULER_ENABLED:"false",PAYMONGO_DISBURSEMENTS_ENABLED:"false",XENDIT_PAYOUTS_ENABLED:"false"};
test("refuse non-disposable environment and providers",()=>{
 assert.doesNotThrow(()=>requireDisposableInvitations(env));
 for(const [k,v] of Object.entries(env)){
  assert.throws(()=>requireDisposableInvitations({...env,[k]:v==="false"?"true":"false"}));
  assert.throws(()=>requireDisposableInvitations({...env,[k]:undefined}));
 }
 for(const k of ["PAYMONGO_SECRET_KEY","XENDIT_SECRET_KEY","RESEND_API_KEY","STRIPE_SECRET_KEY"])
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
