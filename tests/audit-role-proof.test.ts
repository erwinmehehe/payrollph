import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import test from "node:test";
import {auditRoleProofQuery,executeAuditRoleProof,LEGACY_AUDIT_ROLE_PROOF_SQL,
 STRICT_AUDIT_ROLE_PROOF_SQL,STRICT_AUDIT_CHAIN_PROOF_KEYS,AUDIT_CHAIN_PROOF_KEYS,
 AUDIT_ALLOWED_FUNCTION_BODY_SHA256} from "../src/lib/audit-role-proof";

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


// Pin original pg_proc.prosrc bodies, not pg_get_functiondef formatting.
test("strict approved function hashes match exact 0109/0133 source",()=>{
 const specs=[
  ["../drizzle/0133_audit_missing_foundation_forward.sql","audit_events_protect_v2",AUDIT_ALLOWED_FUNCTION_BODY_SHA256.mutationGuard],
  ["../drizzle/0133_audit_missing_foundation_forward.sql","audit_events_insert_guard_v2",AUDIT_ALLOWED_FUNCTION_BODY_SHA256.insertGuard],
  ["../drizzle/0133_audit_missing_foundation_forward.sql","audit_events_reject_truncate_v2",AUDIT_ALLOWED_FUNCTION_BODY_SHA256.truncateGuard],
  ["../drizzle/0133_audit_missing_foundation_forward.sql","seal_audit_events",AUDIT_ALLOWED_FUNCTION_BODY_SHA256.sealerForward],
  ["../drizzle/0109_tamper_evident_audit_chain.sql","seal_audit_events",AUDIT_ALLOWED_FUNCTION_BODY_SHA256.sealerLegacy],
  ["../drizzle/0133_audit_missing_foundation_forward.sql","audit_event_row_hash",AUDIT_ALLOWED_FUNCTION_BODY_SHA256.rowHashForward],
  ["../drizzle/0109_tamper_evident_audit_chain.sql","audit_event_row_hash",AUDIT_ALLOWED_FUNCTION_BODY_SHA256.rowHashLegacy],
 ] as const;
 for(const [file,name,want] of specs){
  const source=readFileSync(new URL(file,import.meta.url),"utf8");
  const declaration=new RegExp("CREATE (?:OR REPLACE )?FUNCTION (?:public\\.)?"+name+"\\(","i");
  const begin=source.search(declaration);
  assert.ok(begin>=0,file+": missing "+name);
  const match=source.slice(begin).match(/\bAS (\$[A-Za-z0-9_]*\$)([\s\S]*?)\1\s*;/);
  assert.ok(match,file+": body "+name);
  assert.equal(createHash("sha256").update(match[2]).digest("hex"),want,file+": "+name);
  assert.ok(STRICT_AUDIT_ROLE_PROOF_SQL.includes("'"+want+"'"),file+": digest must be used by strict query");
 }
 assert.match(STRICT_AUDIT_ROLE_PROOF_SQL,/count\(DISTINCT pinned\.signature\)=5/);
 assert.match(STRICT_AUDIT_ROLE_PROOF_SQL,/p\.proconfig IS NOT DISTINCT FROM pinned\.config/);
 assert.match(STRICT_AUDIT_ROLE_PROOF_SQL,/sha256\(pg_catalog\.convert_to\(p\.prosrc,'UTF8'\)\)/);
});
