// Never import application/database modules before this disposable-only preflight.
export function requireDisposableLeavePreview(env = process.env) {
  let database, app;
  try { database = new URL(env.DATABASE_URL); app = new URL(env.SECURITY_SMOKE_URL); }
  catch { throw new Error('LEAVE_PREVIEW_PROOF_REFUSED: explicit localhost targets required'); }
  if (env.CI !== 'true' || env.TENANT_SECOND_PASS_MODE !== 'isolated-ci-only' ||
      env.NODE_ENV !== 'production' || database.protocol !== 'postgresql:' ||
      database.hostname !== '127.0.0.1' || database.port !== '5432' || database.pathname !== '/app_db' ||
      app.href !== 'http://127.0.0.1:3000/' || env.PAYMONGO_DISBURSEMENTS_ENABLED !== 'false' ||
      env.XENDIT_PAYOUTS_ENABLED !== 'false' || env.PAYMONGO_SECRET_KEY || env.XENDIT_SECRET_KEY || env.RESEND_API_KEY) {
    throw new Error('LEAVE_PREVIEW_PROOF_REFUSED: disposable local database/server and disabled providers required');
  }
}
