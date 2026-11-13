import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { assertUnderpaymentProofTarget } from '../scripts/qa/underpayment-proof-target.mjs';
const safe = { UNDERPAYMENT_PROOF_MODE: 'isolated-posting', MONEY_PROOF_MODE: 'disposable-only',
  MONEY_PROOF_URL: 'http://127.0.0.1:3011',
  DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:5432/payroll_mny01_test',
  PAYROLL_UNDERPAYMENT_POSTING_ENABLED: 'true' };
test('isolated ledger posting requires explicit posture and retains provider/target refusals', () => {
  assert.doesNotThrow(() => assertUnderpaymentProofTarget(safe));
  assert.doesNotThrow(() => assertUnderpaymentProofTarget({ ...safe, PAYROLL_UNDERPAYMENT_POSTING_ENABLED: 'false' }));
  for (const change of [{ UNDERPAYMENT_PROOF_MODE: '' }, { MONEY_PROOF_MODE: '' },
    { PAYROLL_UNDERPAYMENT_POSTING_ENABLED: undefined }, { PAYROLL_UNDERPAYMENT_POSTING_ENABLED: 'TRUE' },
    { DATABASE_URL: 'postgresql://user:pass@host.example:5432/payroll_mny01_test' },
    { DATABASE_URL: safe.DATABASE_URL + '?host=host.example' },
    { XENDIT_PAYOUTS_ENABLED: 'true' }, { PAYMONGO_DISBURSEMENTS_ENABLED: 'true' },
    { XENDIT_PAYOUT_SECRET_KEY: 'not-allowed' }, { PAYMONGO_SECRET_KEY: 'not-allowed' }]) {
    assert.throws(() => assertUnderpaymentProofTarget({ ...safe, ...change }));
  }
});

test('run-oracle callers conceal foreign payouts while preserving member role and treasury denials',()=>{
  for(const file of ['scripts/qa/underpayment-posting-http.mjs','scripts/qa/treasury-isolation-http.mjs']){
    const source=readFileSync(file,'utf8');
    assert.ok(source.includes("undefined, 404, 'foreign payout status'"),file);
    assert.ok(!source.includes("undefined, 403, 'foreign payout status'"),file);
  }
  const treasury=readFileSync('scripts/qa/treasury-isolation-http.mjs','utf8');
  assert.ok(treasury.includes("undefined, 403, 'revoked treasury assignment retained session'"));
  const underpayment=readFileSync('scripts/qa/underpayment-posting-http.mjs','utf8');
  assert.ok(underpayment.includes("403, 'employee cannot submit payout'"));
});
