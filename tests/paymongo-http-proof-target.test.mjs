import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPaymongoHttpProofTarget, syntheticPaymongoUrl } from '../scripts/qa/paymongo-http-proof-target.mjs';
const safe = { CI: 'true', GITHUB_ACTIONS: 'true', PAYMONGO_HTTP_PROOF: 'loopback-only',
  PAYMONGO_SECRET_KEY: 'sk_test_synthetic_no_network', PAYMONGO_WALLET_ID: 'wallet_synthetic',
  PAYMONGO_DISBURSEMENTS_ENABLED: 'true', PAYROLL_PAYOUT_PROVIDER: 'paymongo',
  MONEY_PROOF_MODE: 'disposable-only', MONEY_PROOF_URL: 'http://127.0.0.1:3011',
  DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:5432/payroll_mny01_test' };
test('HTTP proof refuses hosted data, real credentials and provider escape routes', () => {
  assert.doesNotThrow(() => assertPaymongoHttpProofTarget(safe));
  for (const change of [{ CI: 'false' }, { GITHUB_ACTIONS: '' }, { PAYMONGO_HTTP_PROOF: '' },
    { PAYMONGO_SECRET_KEY: 'sk_live_not_allowed' }, { XENDIT_PAYOUTS_ENABLED: 'true' },
    { DATABASE_URL: 'postgresql://u:p@database.example:5432/payroll_mny01_test' },
    { DATABASE_URL: safe.DATABASE_URL + '?host=database.example' }]) {
    assert.throws(() => assertPaymongoHttpProofTarget({ ...safe, ...change }));
  }
  assert.equal(syntheticPaymongoUrl('https://api.paymongo.com/v2/batch_transfers'), 'http://127.0.0.1:3012/v2/batch_transfers');
  for (const url of ['https://evil.example/v2/batch_transfers', 'http://api.paymongo.com/v2/batch_transfers',
    'https://api.paymongo.com.evil.example/v2/batch_transfers', 'https://api.paymongo.com/v1/payments',
    'https://user:secret@api.paymongo.com/v2/batch_transfers', 'https://api.paymongo.com/v2/batch_transfers#fragment']) {
    assert.throws(() => syntheticPaymongoUrl(url));
  }
});
