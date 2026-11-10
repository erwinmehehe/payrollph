import assert from 'node:assert/strict';

export const OFF_FLAGS = [
  'FINAL_PAY_SIGNED_REVIEW_ENABLED', 'EXACT_THIRTEENTH_CENTAVOS_ENABLED',
  'PAYROLL_CALCULATION_HISTORY_ENABLED', 'NEXT_CSP_ENABLED',
  'PAYMONGO_DISBURSEMENTS_ENABLED', 'XENDIT_PAYOUTS_ENABLED', 'XENDIT_BILLING_ENABLED',
  'WORKER_ENABLED', 'CENTRAL_SCHEDULER_ENABLED',
];
export function requireApprovalTypesTarget(env = process.env) {
  assert.equal(env.TENANT_APPROVAL_TYPES_MODE, 'fictional-disposable-pg16');
  const ci = env.GITHUB_ACTIONS === 'true' && env.CI === 'true'
    && env.DATABASE_URL === 'postgresql://postgres:postgres@127.0.0.1:5432/app_db'
    && env.SECURITY_SMOKE_URL === 'http://127.0.0.1:3000';
  const local = env.GITHUB_ACTIONS !== 'true'
    && env.DATABASE_URL === 'postgresql://postgres:postgres@127.0.0.1:55436/app_db'
    && env.SECURITY_SMOKE_URL === 'http://127.0.0.1:3310';
  assert.ok(ci || local, 'Only dedicated local ports or the actual disposable GitHub job');
  assert.equal(env.NODE_ENV, 'production');
  assert.equal(env.DEMO_MODE, 'false');
  for (const flag of OFF_FLAGS) assert.equal(env[flag], 'false', flag + ' must remain OFF');
  for (const secret of ['PAYMONGO_SECRET_KEY', 'XENDIT_SECRET_KEY', 'XENDIT_PAYOUT_SECRET_KEY',
    'RESEND_API_KEY', 'POSTMARK_SERVER_TOKEN', 'SMTP_URL', 'STRIPE_SECRET_KEY']) {
    assert.ok(!env[secret], 'No real provider credential: ' + secret);
  }
}

export function assertTypedDecision(response, { task, employer, status }) {
  assert.equal(response.status, 200, 'own typed approval must succeed: ' + response.text?.slice(0, 240));
  assert.equal(response.json?.id, task.id, "accepts another employer's data");
  assert.equal(response.json.organizationId, employer.org.id, "accepts another employer's data");
  assert.equal(response.json.status, status);
  assert.equal(response.json.decidedBy, employer.owner.name);
  assert.equal(response.json.webhookDeliveries, 0);
  return response.json;
}
