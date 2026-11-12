import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { requireFullOidcEnv, assertCallbackDenied, APP, CANONICAL_APP, TLS_DIR } from '../scripts/qa/tenant-oidc-full-contract.mjs';
const env = { CI:'true', GITHUB_ACTIONS:'true', RUNNER_OS:'Linux', NODE_ENV:'production',
  OIDC_FULL_HTTP_PROOF:'isolated-pg16-real-https-idp-only',
  DATABASE_URL:'postgresql://postgres:postgres@127.0.0.1:5432/app_db',
  SECURITY_SMOKE_URL:APP, APP_BASE_URL:CANONICAL_APP, NODE_EXTRA_CA_CERTS:TLS_DIR+'/ca.crt' };
for (const key of ['WORKER_ENABLED','CENTRAL_SCHEDULER_ENABLED','XENDIT_BILLING_ENABLED',
  'XENDIT_PAYOUTS_ENABLED','PAYMONGO_DISBURSEMENTS_ENABLED','FINAL_PAY_SIGNED_REVIEW_ENABLED',
  'EXACT_THIRTEENTH_CENTAVOS_ENABLED','PAYROLL_CALCULATION_HISTORY_ENABLED','NEXT_CSP_ENABLED','DEMO_MODE']) env[key]='false';
test('full proof requires exact isolated CI target and every disabled capability', () => {
  requireFullOidcEnv(env);
  for (const key of Object.keys(env)) assert.throws(() => requireFullOidcEnv({...env,[key]:'wrong'}), /OIDC_FULL_REFUSED/);
});
test('credentials and TLS/preload bypasses are refused', () => {
  for (const key of ['NEON_DATABASE_URL','NODE_OPTIONS','NODE_TLS_REJECT_UNAUTHORIZED','OPENAI_API_KEY',
    'PAYMONGO_SECRET_KEY','XENDIT_SECRET_KEY','XENDIT_PAYOUT_SECRET_KEY','RESEND_API_KEY',
    'SMTP_URL','SMTP_PASSWORD','CRON_SECRET','WORKER_TOKEN'])
    assert.throws(() => requireFullOidcEnv({...env,[key]:'fictional-forbidden'}), /OIDC_FULL_REFUSED/);
});
test('denial cannot be a redirect, wrong status, malformed error or session issuance', () => {
  const r={status:403,json:{error:'Refused'},text:'Refused',headers:new Headers()};
  assertCallbackDenied(r,403);
  for(const bad of [{...r,status:302},{...r,json:{}},{...r,headers:new Headers({'set-cookie':'__Host-linaw_session=forbidden'})}])
    assert.throws(()=>assertCallbackDenied(bad,403));
});
test('dedicated workflow retains exact head, real PG16, local network containment and verified TLS', () => {
  const workflow=readFileSync(new URL('../.github/workflows/tenant-oidc-full-http.yml',import.meta.url),'utf8');
  for(const token of ['github.event.pull_request.head.sha','postgres:16','93.184.216.2 ! -o lo -j REJECT',
    'ip addr add 93.184.216.2/32 dev lo','verify_hostname oidc.payrollph.invalid','NODE_EXTRA_CA_CERTS:',
    'npm run build','node --import tsx scripts/qa/tenant-oidc-full-http.mjs']) assert.ok(workflow.includes(token),token);
  assert.ok(!workflow.includes('NODE_TLS_REJECT_UNAUTHORIZED'));
});
