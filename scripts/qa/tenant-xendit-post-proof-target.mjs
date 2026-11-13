/** Pure, fail-closed target policy. This module never enables a live flag. */
import assert from 'node:assert/strict';
export const SYNTHETIC_XENDIT_KEY='xnd_synthetic_loopback_no_network';
export const SYNTHETIC_XENDIT_ORIGIN='http://127.0.0.1:3013';
export const SYNTHETIC_APP_ORIGIN='https://payroll.example.test';
const OFF=['FINAL_PAY_SIGNED_REVIEW_ENABLED','EXACT_THIRTEENTH_CENTAVOS_ENABLED',
  'PAYMONGO_DISBURSEMENTS_ENABLED','XENDIT_BILLING_ENABLED',
  'PAYROLL_CALCULATION_HISTORY_ENABLED','NEXT_CSP_ENABLED','WORKER_ENABLED','CENTRAL_SCHEDULER_ENABLED'];
const FORBIDDEN=['NEON_DATABASE_URL','VERCEL','PAYMONGO_SECRET_KEY','XENDIT_SECRET_KEY',
  'RESEND_API_KEY','POSTMARK_SERVER_TOKEN','SMTP_URL','SMTP_PASSWORD','OPENAI_API_KEY',
  'CRON_SECRET','WORKER_TOKEN','MALWARE_SCAN_URL','MALWARE_SCAN_TOKEN','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY'];
export function assertXenditPostProofTarget(env){
  for(const[k,v]of Object.entries({CI:'true',GITHUB_ACTIONS:'true',NODE_ENV:'production',
    TENANT_XENDIT_POST_PROOF:'fictional-loopback-pg16-only',TENANT_XENDIT_PROFILE:'enabled',
    TENANT_XENDIT_PROFILE_APPROVAL:'synthetic-only-user-approved',
    BUILD_BLOCK_ACCEPTANCE_MODE:'synthetic-postgres-only',
    DATABASE_URL:'postgresql://postgres:postgres@127.0.0.1:5432/app_db',
    APP_BASE_URL:SYNTHETIC_APP_ORIGIN,TRUSTED_APP_ORIGINS:SYNTHETIC_APP_ORIGIN,
    XENDIT_TENANT_LOOPBACK_ORIGIN:SYNTHETIC_XENDIT_ORIGIN,
    XENDIT_PAYOUT_SECRET_KEY:SYNTHETIC_XENDIT_KEY,
    XENDIT_PAYOUT_CALLBACK_TOKEN:'fictional-xendit-callback-no-network',
    XENDIT_PAYOUT_BUSINESS_ID:'biz_fictional_tenant_proof',
    XENDIT_PAYOUTS_ENABLED:'true',XENDIT_PAYOUTS_LIVE_APPROVED:'true',
    PAYROLL_PAYOUT_PROVIDER:'xendit',REQUIRE_PRIVILEGED_MFA:'true',DEMO_MODE:'false'})){
    assert.equal(env[k],v,'XENDIT_PROOF_REFUSED: unsafe '+k);
  }
  assert.ok(['http://127.0.0.1:3000','http://127.0.0.1:3001','http://127.0.0.1:3002'].includes(env.SECURITY_SMOKE_URL),
    'XENDIT_PROOF_REFUSED: registered localhost app required');
  for(const key of ['XENDIT_PAYOUT_ALLOWED_ORGANIZATION_ID','XENDIT_PAYOUT_ALLOWED_LEGAL_ENTITY_ID'])
    assert.ok(/^[1-9]\d*$/.test(env[key]??'')&&Number.isSafeInteger(Number(env[key])),
      'XENDIT_PROOF_REFUSED: real preseeded fixture identity required: '+key);
  for(const key of OFF)assert.equal(env[key],'false','XENDIT_PROOF_REFUSED: unrelated gate '+key);
  for(const key of FORBIDDEN)assert.ok(!env[key],'XENDIT_PROOF_REFUSED: forbidden provider/production credential '+key);
}
export function assertXenditBlockedProofTarget(env){
  for(const[k,v]of Object.entries({TENANT_XENDIT_PROFILE:'blocked',XENDIT_PAYOUTS_ENABLED:'false',
    XENDIT_PAYOUTS_LIVE_APPROVED:'false',PAYROLL_PAYOUT_PROVIDER:'paymongo',
    SECURITY_SMOKE_URL:'http://127.0.0.1:3003'}))assert.equal(env[k],v,'XENDIT_BLOCKED_PROOF_REFUSED: '+k);
  // Validate all shared target/key/egress constraints without changing the real
  // environment. This server really retains both payout gates OFF.
  assertXenditPostProofTarget({...env,TENANT_XENDIT_PROFILE:'enabled',XENDIT_PAYOUTS_ENABLED:'true',
    XENDIT_PAYOUTS_LIVE_APPROVED:'true',PAYROLL_PAYOUT_PROVIDER:'xendit',
    SECURITY_SMOKE_URL:'http://127.0.0.1:3000'});
}
export function assertXenditSeedTarget(env){
  for(const[k,v]of Object.entries({CI:'true',GITHUB_ACTIONS:'true',
    TENANT_XENDIT_SEED:'empty-fictional-pg16-only',
    DATABASE_URL:'postgresql://postgres:postgres@127.0.0.1:5432/app_db',
    XENDIT_PAYOUTS_ENABLED:'false',XENDIT_PAYOUTS_LIVE_APPROVED:'false'}))
    assert.equal(env[k],v,'XENDIT_SEED_REFUSED: unsafe '+k);
  for(const key of OFF)assert.equal(env[key],'false','XENDIT_SEED_REFUSED: unsafe '+key);
  for(const key of [...FORBIDDEN,'XENDIT_PAYOUT_SECRET_KEY'])
    assert.ok(!env[key],'XENDIT_SEED_REFUSED: forbidden '+key);
}
export function syntheticXenditTarget(input,method='GET'){
  const url=new URL(input);
  assert.equal(url.origin,'https://api.xendit.co','Unregistered Xendit proof destination');
  assert.ok(!url.username&&!url.password&&!url.search&&!url.hash,'Ambiguous provider URL refused');
  assert.ok((method==='POST'&&url.pathname==='/v3/payouts')||
    (method==='GET'&&/^\/v3\/payouts\/po-[A-Za-z0-9-]{8,90}$/.test(url.pathname)),
    'Unregistered provider method or payout selector');
  return SYNTHETIC_XENDIT_ORIGIN+url.pathname;
}
export function assertSyntheticXenditRequest(request){
  const expected='Basic '+Buffer.from(SYNTHETIC_XENDIT_KEY+':').toString('base64');
  assert.equal(request.headers.get('authorization'),expected,'Non-synthetic credential refused');
  assert.equal(request.redirect,'error','Provider redirect must fail closed');
  return syntheticXenditTarget(request.url,request.method);
}
