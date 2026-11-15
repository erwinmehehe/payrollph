import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {load} from 'js-yaml';
import {assertOwnedOidcStart,assertDeniedOidcStart,requireOidcBatchEnv} from '../scripts/qa/tenant-oidc-batch-contract.mjs';
import {IDP_ORIGIN} from '../scripts/qa/tenant-oidc-full-contract.mjs';
import {collectOidcBatchInputs} from '../scripts/qa/tenant-oidc-batch-inputs.mjs';
const e={label:'OWN',client:'fictional-own-client',email:'worker@own.example.invalid'};
function response(){
 const state='a'.repeat(64),url=new URL(IDP_ORIGIN+'/OWN/authorize');
 for(const[k,v]of Object.entries({client_id:e.client,login_hint:e.email,
  redirect_uri:'https://payroll.example.test/api/auth/sso/callback',response_type:'code',
  code_challenge_method:'S256',state,nonce:'fictional-nonce',code_challenge:'fictional-challenge'}))url.searchParams.set(k,v);
 return{status:302,headers:new Headers({location:url.toString(),'cache-control':'no-store',
  'set-cookie':'linaw_oidc_browser_state='+state+'; Path=/api/auth/sso/callback; HttpOnly; Secure; SameSite=Lax'})};
}
test('owned start requires exact provider, email, browser state and callback binding',()=>{
 assert.doesNotThrow(()=>assertOwnedOidcStart(response(),e));
 for(const other of [{...e,label:'VICTIM'},{...e,client:'foreign-client'},{...e,email:'victim@foreign.example.invalid'}])
  assert.throws(()=>assertOwnedOidcStart(response(),other),"accepts another employer's data");
});
test('fake success, insecure cookies and substituted browser state do not discriminate',()=>{
 for(const mutate of [r=>r.status=200,r=>r.headers.delete('set-cookie'),r=>r.headers.delete('cache-control'),
  r=>r.headers.set('set-cookie','__Host-linaw_session=not-allowed'),
  r=>r.headers.set('set-cookie','linaw_oidc_browser_state=wrong; Path=/api/auth/sso/callback; HttpOnly; Secure; SameSite=Lax'),
  r=>r.headers.set('location','https://foreign.example.invalid/authorize')]){
  const r=response();mutate(r);assert.throws(()=>assertOwnedOidcStart(r,e));
 }
});
test('foreign start refusal cannot redirect, issue credentials, return 200 or disclose a victim marker',()=>{
 const denied=()=>({status:403,text:'{"error":"not verified"}',json:{error:'not verified'},headers:new Headers()});
 assert.doesNotThrow(()=>assertDeniedOidcStart(denied(),403,['private-victim']));
 for(const mutate of [r=>r.status=200,r=>r.text='private-victim',r=>r.headers.set('location',IDP_ORIGIN),
  r=>r.headers.set('set-cookie','linaw_oidc_browser_state=bad')]){
  const r=denied();mutate(r);assert.throws(()=>assertDeniedOidcStart(r,403,['private-victim']));
 }
});
test('recovery workflow preserves real TLS/PKCE transport, exact-head checkout and isolated flags',()=>{
 const w=load(readFileSync('.github/workflows/tenant-oidc-batch-http.yml','utf8')),job=w.jobs['full-idp-http'];
 assert.equal(job.services.postgres.image,'postgres:16');
 assert.equal(job.env.OIDC_RECOVERY_BATCH_MODE,'fictional-pg16-start-callback-only');
 assert.equal(job.env.OIDC_SSO_RUNTIME_MODE,'enabled');
 for(const k of ['WORKER_ENABLED','CENTRAL_SCHEDULER_ENABLED','XENDIT_BILLING_ENABLED','XENDIT_PAYOUTS_ENABLED',
  'PAYMONGO_DISBURSEMENTS_ENABLED','FINAL_PAY_SIGNED_REVIEW_ENABLED','EXACT_THIRTEENTH_CENTAVOS_ENABLED',
  'PAYROLL_CALCULATION_HISTORY_ENABLED','NEXT_CSP_ENABLED'])assert.equal(job.env[k],'false');
 assert.equal(job.steps[0].with.ref,'${{ github.event.pull_request.head.sha || github.sha }}');
 assert.equal(job.steps[0].with['persist-credentials'],false);
 const commands=job.steps.map(x=>x.run??'').join('\n');
 for(const marker of ['sudo iptables -I OUTPUT','sudo ip addr add','openssl verify','npm run db:push',
  'apply-isolated-baseline.mjs','npm run build','tenant-oidc-batch-http.mjs'])assert.ok(commands.includes(marker));
 assert.ok(!commands.includes('NODE_TLS_REJECT_UNAUTHORIZED=0'));
 assert.ok(commands.includes('OIDC_SSO_RUNTIME_MODE=blocked'));
 const safe={...job.env,CI:'true',GITHUB_ACTIONS:'true',RUNNER_OS:'Linux',NODE_ENV:'production'};
 assert.doesNotThrow(()=>requireOidcBatchEnv(safe));
 for(const patch of [{OIDC_RECOVERY_BATCH_MODE:undefined},{GITHUB_ACTIONS:'false'},
  {DATABASE_URL:'postgresql://postgres:postgres@remote.invalid/app_db'},{NODE_TLS_REJECT_UNAUTHORIZED:'0'},
  {XENDIT_PAYOUTS_ENABLED:'true'},{OIDC_SSO_RUNTIME_MODE:'blocked'}])assert.throws(()=>requireOidcBatchEnv({...safe,...patch}));
});
test('source closure includes explicit schema/subprocess and SQL inputs, not just literal imports',()=>{
 const inputs=collectOidcBatchInputs();
 for(const path of ['scripts/qa/apply-audit-0109-isolated.mjs','scripts/qa/apply-source-baseline-supplement.mjs',
  'drizzle/0109_tamper_evident_audit_chain.sql','docs/sql/source-baseline-supplement.sql','drizzle.config.ts',
  'scripts/strict-db-push.mjs','src/lib/saas-billing-schema.ts','src/lib/oidc-sso-runtime.ts',
  'scripts/qa/tenant-oidc-batch-inputs.mjs'])assert.ok(inputs.pins[path],path);
 assert.ok(inputs.sqlInventory.length>100);
 assert.ok(inputs.sqlInventory.every(path=>inputs.pins[path]));
});
