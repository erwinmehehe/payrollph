import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireDisposableLeavePreview } from '../scripts/qa/tenant-leave-preview-guard.mjs';

const good = { CI: 'true', TENANT_SECOND_PASS_MODE: 'isolated-ci-only', NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/app_db',
  SECURITY_SMOKE_URL: 'http://127.0.0.1:3000', PAYMONGO_DISBURSEMENTS_ENABLED: 'false', XENDIT_PAYOUTS_ENABLED: 'false' };
test('leave preview proof refuses non-disposable targets and enabled providers', () => {
  assert.doesNotThrow(() => requireDisposableLeavePreview(good));
  for (const bad of [{ DATABASE_URL: 'postgresql://localhost:5432/app_db' },
    { DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/other' },
    { SECURITY_SMOKE_URL: 'https://example.com' }, { CI: 'false' },
    { PAYMONGO_DISBURSEMENTS_ENABLED: 'true' }, { RESEND_API_KEY: 'fictional' }]) {
    assert.throws(() => requireDisposableLeavePreview({ ...good, ...bad }), /LEAVE_PREVIEW_PROOF_REFUSED/);
  }
});
