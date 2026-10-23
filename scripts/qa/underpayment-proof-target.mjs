import { assertMoneyProofTarget } from './money-proof-target.mjs';

// Only this separate disposable proof may enable ledger posting. Provider
// enablement, secrets, hosted targets and URL overrides remain forbidden.
export function assertUnderpaymentProofTarget(env) {
  if (env.UNDERPAYMENT_PROOF_MODE !== 'isolated-posting'
    || !['true', 'false'].includes(env.PAYROLL_UNDERPAYMENT_POSTING_ENABLED)) {
    throw new Error('Select isolated-posting and an explicit posting flag state.');
  }
  assertMoneyProofTarget({ ...env, PAYROLL_UNDERPAYMENT_POSTING_ENABLED: 'false' });
}
