import assert from 'node:assert/strict';
import test from 'node:test';
import {assertXenditPostProofTarget,assertXenditBlockedProofTarget,syntheticXenditTarget,assertSyntheticXenditRequest,
  SYNTHETIC_XENDIT_KEY,assertXenditSeedTarget} from '../scripts/qa/tenant-xendit-post-proof-target.mjs';
const safe={
  CI:'true',GITHUB_ACTIONS:'true',NODE_ENV:'production',TENANT_XENDIT_POST_PROOF:'fictional-loopback-pg16-only',TENANT_XENDIT_PROFILE:'enabled',
  TENANT_XENDIT_PROFILE_APPROVAL:'synthetic-only-user-approved',
  BUILD_BLOCK_ACCEPTANCE_MODE:'synthetic-postgres-only',DATABASE_URL:'postgresql://postgres:postgres@127.0.0.1:5432/app_db',
  APP_BASE_URL:'https://payroll.example.test',TRUSTED_APP_ORIGINS:'https://payroll.example.test',
  SECURITY_SMOKE_URL:'http://127.0.0.1:3000',XENDIT_TENANT_LOOPBACK_ORIGIN:'http://127.0.0.1:3013',
  XENDIT_PAYOUT_SECRET_KEY:SYNTHETIC_XENDIT_KEY,XENDIT_PAYOUT_CALLBACK_TOKEN:'fictional-xendit-callback-no-network',
  XENDIT_PAYOUT_BUSINESS_ID:'biz_fictional_tenant_proof',XENDIT_PAYOUTS_ENABLED:'true',
  XENDIT_PAYOUTS_LIVE_APPROVED:'true',PAYROLL_PAYOUT_PROVIDER:'xendit',
  XENDIT_PAYOUT_ALLOWED_ORGANIZATION_ID:'7',XENDIT_PAYOUT_ALLOWED_LEGAL_ENTITY_ID:'8',
  REQUIRE_PRIVILEGED_MFA:'true',DEMO_MODE:'false',FINAL_PAY_SIGNED_REVIEW_ENABLED:'false',
  EXACT_THIRTEENTH_CENTAVOS_ENABLED:'false',PAYMONGO_DISBURSEMENTS_ENABLED:'false',
  XENDIT_BILLING_ENABLED:'false',PAYROLL_CALCULATION_HISTORY_ENABLED:'false',NEXT_CSP_ENABLED:'false',
  WORKER_ENABLED:'false',CENTRAL_SCHEDULER_ENABLED:'false',
};
test('pure profile validation cannot authorize a production target, key, unapproved profile or unrelated flag',()=>{
  assert.doesNotThrow(()=>assertXenditPostProofTarget(safe));
  for(const patch of [
    {CI:'false'},{GITHUB_ACTIONS:'false'},{TENANT_XENDIT_PROFILE_APPROVAL:undefined},
    {DATABASE_URL:'postgresql://postgres:postgres@remote.invalid/app_db'},
    {DATABASE_URL:'postgresql://postgres:postgres@127.0.0.1:5432/real_payroll'},
    {APP_BASE_URL:'https://production.invalid'},{SECURITY_SMOKE_URL:'https://production.invalid'},
    {XENDIT_TENANT_LOOPBACK_ORIGIN:'https://api.xendit.co'},{XENDIT_PAYOUT_SECRET_KEY:'some-other-key'},
    {XENDIT_PAYOUT_ALLOWED_ORGANIZATION_ID:'1e0'},{XENDIT_PAYOUT_ALLOWED_LEGAL_ENTITY_ID:'0'},
    {FINAL_PAY_SIGNED_REVIEW_ENABLED:'true'},{PAYROLL_CALCULATION_HISTORY_ENABLED:'true'},
    {PAYMONGO_DISBURSEMENTS_ENABLED:'true'},{XENDIT_BILLING_ENABLED:'true'},
    {WORKER_ENABLED:'true'},{RESEND_API_KEY:'unexpected'},{NEON_DATABASE_URL:'unexpected'},
  ])assert.throws(()=>assertXenditPostProofTarget({...safe,...patch}),/XENDIT_PROOF_REFUSED/);
});
test('seed refuses non-disposable databases, enabled payout gates and provider credentials',()=>{
  const seed={...safe,TENANT_XENDIT_SEED:'empty-fictional-pg16-only',
    XENDIT_PAYOUTS_ENABLED:'false',XENDIT_PAYOUTS_LIVE_APPROVED:'false',XENDIT_PAYOUT_SECRET_KEY:undefined};
  assert.doesNotThrow(()=>assertXenditSeedTarget(seed));
  for(const patch of [{CI:'false'},{GITHUB_ACTIONS:'false'},{TENANT_XENDIT_SEED:undefined},
    {DATABASE_URL:'postgresql://postgres:postgres@remote.invalid/app_db'},
    {XENDIT_PAYOUTS_ENABLED:'true'},{XENDIT_PAYOUTS_LIVE_APPROVED:'true'},
    {XENDIT_PAYOUT_SECRET_KEY:SYNTHETIC_XENDIT_KEY},{RESEND_API_KEY:'unexpected'},
    {WORKER_ENABLED:'true'},{FINAL_PAY_SIGNED_REVIEW_ENABLED:'true'}])
    assert.throws(()=>assertXenditSeedTarget({...seed,...patch}),/XENDIT_SEED_REFUSED/);
});
test('provider-OFF historical recovery server cannot silently enable submission',()=>{
  const blocked={...safe,TENANT_XENDIT_PROFILE:'blocked',XENDIT_PAYOUTS_ENABLED:'false',
    XENDIT_PAYOUTS_LIVE_APPROVED:'false',PAYROLL_PAYOUT_PROVIDER:'paymongo',
    SECURITY_SMOKE_URL:'http://127.0.0.1:3003'};
  assert.doesNotThrow(()=>assertXenditBlockedProofTarget(blocked));
  assert.throws(()=>assertXenditBlockedProofTarget({...blocked,XENDIT_PAYOUTS_ENABLED:'true'}));
  assert.throws(()=>assertXenditBlockedProofTarget({...blocked,SECURITY_SMOKE_URL:'https://live.invalid'}));
});
test('every accepted provider request is mapped to one exact loopback origin',()=>{
  assert.equal(syntheticXenditTarget('https://api.xendit.co/v3/payouts','POST'),'http://127.0.0.1:3013/v3/payouts');
  assert.equal(syntheticXenditTarget('https://api.xendit.co/v3/payouts/po-fictional-123','GET'),
    'http://127.0.0.1:3013/v3/payouts/po-fictional-123');
  for(const[url,method]of [
    ['https://api.xendit.co/v3/payouts','GET'],['https://api.xendit.co/v3/payouts','DELETE'],
    ['https://other.invalid/v3/payouts','POST'],['http://api.xendit.co/v3/payouts','POST'],
    ['https://user:pass@api.xendit.co/v3/payouts','POST'],
    ['https://api.xendit.co/v3/payouts?redirect=evil','POST'],
    ['https://api.xendit.co/v3/payouts#secret','POST'],
    ['https://api.xendit.co/v3/payouts/%2fsecret','GET'],
  ])assert.throws(()=>syntheticXenditTarget(url,method));
});
test('provider transport refuses credentials or redirect handling outside the reviewed fake request',()=>{
  const make=(key=SYNTHETIC_XENDIT_KEY,redirect='error')=>new Request('https://api.xendit.co/v3/payouts',{
    method:'POST',headers:{authorization:'Basic '+Buffer.from(key+':').toString('base64')},redirect,
  });
  assert.equal(assertSyntheticXenditRequest(make()),'http://127.0.0.1:3013/v3/payouts');
  assert.throws(()=>assertSyntheticXenditRequest(make('other-key')));
  assert.throws(()=>assertSyntheticXenditRequest(make(SYNTHETIC_XENDIT_KEY,'follow')));
});
