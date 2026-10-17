import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {auditRoleProofQuery,executeAuditRoleProof,LEGACY_AUDIT_ROLE_PROOF_SQL,
 STRICT_AUDIT_ROLE_PROOF_SQL,STRICT_AUDIT_CHAIN_PROOF_KEYS,AUDIT_CHAIN_PROOF_KEYS} from "../src/lib/audit-role-proof";

const enabled={AUDIT_ROLE_ISOLATION_PROOF_ENABLED:"true"};
const passed=()=>Object.fromEntries(STRICT_AUDIT_CHAIN_PROOF_KEYS.map(key=>[key,true]));

test("flag-off sends exactly the prior eleven-field query without new behavior",async()=>{
 assert.equal(createHash("sha256").update(LEGACY_AUDIT_ROLE_PROOF_SQL).digest("hex"),"b80d73887982abb1154ce96ad24740f062a2d1c94f09fb3ee20cd68596babb8d");
 for(const value of [undefined,"","false","TRUE","1"]){
  const env={AUDIT_ROLE_ISOLATION_PROOF_ENABLED:value};
  assert.deepEqual(auditRoleProofQuery(env),{strict:false,query:LEGACY_AUDIT_ROLE_PROOF_SQL});
  let called=0;
  const legacy=Object.fromEntries(AUDIT_CHAIN_PROOF_KEYS.map(key=>[key,true]));
  assert.equal(await executeAuditRoleProof(async q=>{called++;assert.equal(q,LEGACY_AUDIT_ROLE_PROOF_SQL);return {rows:[legacy]};},env),true);
  assert.equal(called,1);
 }
});

test("strict dispatch executes the stronger query and requires every exact predicate",async()=>{
 assert.equal(await executeAuditRoleProof(async q=>{assert.equal(q,STRICT_AUDIT_ROLE_PROOF_SQL);return {rows:[passed()]};},enabled),true);
 for(const key of STRICT_AUDIT_CHAIN_PROOF_KEYS)for(const bad of [false,null,undefined,"true",1]){
  assert.equal(await executeAuditRoleProof(async()=>({rows:[{...passed(),[key]:bad}]}),enabled),false,key);
 }
 for(const rows of [[],[passed(),passed()],[null],[[]]]) assert.equal(await executeAuditRoleProof(async()=>({rows}),enabled),false);
 assert.equal(await executeAuditRoleProof(async()=>{throw Error("private backend error");},enabled),false);
});
