import { assertMoneyProofTarget } from './money-proof-target.mjs';

export function assertPaymongoHttpProofTarget(env) {
  if (env.CI !== 'true' || env.GITHUB_ACTIONS !== 'true' || env.PAYMONGO_HTTP_PROOF !== 'loopback-only'
    || env.PAYMONGO_SECRET_KEY !== 'sk_test_synthetic_no_network'
    || env.PAYMONGO_WALLET_ID !== 'wallet_synthetic'
    || env.PAYMONGO_DISBURSEMENTS_ENABLED !== 'true'
    || env.PAYROLL_PAYOUT_PROVIDER !== 'paymongo') {
    throw new Error('PayMongo HTTP proof requires explicit isolated CI and exact synthetic credentials.');
  }
  assertMoneyProofTarget({ ...env, PAYMONGO_SECRET_KEY: undefined, PAYMONGO_DISBURSEMENTS_ENABLED: 'false' });
}

export function syntheticPaymongoUrl(input) {
  const u = new URL(input);
  if (u.origin !== 'https://api.paymongo.com' || u.username || u.password || u.hash
    || !/^\/v2\/(?:batch_transfers(?:\/batch_tr_[A-Za-z0-9_-]+)?|wallets\/wallet_synthetic|transfers\/receiving_institutions)$/.test(u.pathname)) {
    throw new Error('Unregistered outbound fetch forbidden by PayMongo HTTP proof.');
  }
  return 'http://127.0.0.1:3012' + u.pathname + u.search;
}
