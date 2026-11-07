import assert from "node:assert/strict";
import test from "node:test";
import {assertOwnedEmailVerification} from "../scripts/qa/email-verify-owned-proof.mjs";

const expected={userId:11,workerId:12,organizationId:13,email:"fictional@example.invalid",tokenId:14,sessionId:"fictional-session"};
const own=()=>({account:{id:11,email:expected.email},worker:{id:12,organizationId:13,email:expected.email},
  token:{id:14,userId:11,usedAt:new Date("2026-11-06T00:00:00Z")},session:{id:expected.sessionId,userId:11,revokedAt:new Date("2026-11-06T00:00:00Z")}});
test("email verification requires persisted owned identities and consumed token/revoked session",()=>{
  assert.doesNotThrow(()=>assertOwnedEmailVerification(own(),expected));
  for(const change of [x=>{x.account.id=99;},x=>{x.worker.id=99;},x=>{x.worker.organizationId=99;}]){
    const x=own();change(x);assert.throws(()=>assertOwnedEmailVerification(x,expected),/accepts another employer's data/);
  }
  for(const change of [x=>{x.worker.email="foreign@example.invalid";},x=>{x.token.usedAt=null;},x=>{x.session.revokedAt=null;},x=>{x.token.userId=99;}]){
    const x=own();change(x);assert.throws(()=>assertOwnedEmailVerification(x,expected));
  }
});
