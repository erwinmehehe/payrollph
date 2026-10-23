/** No database module is imported until this guard succeeds. */
export function assertMoneyProofTarget(env) {
  const fail = () => { throw new Error("Money proof requires disposable localhost payroll_mny01_test and port 3011; providers must be disabled."); };
  let app, database;
  try { app = new URL(env.MONEY_PROOF_URL); database = new URL(env.DATABASE_URL); } catch { return fail(); }
  if (env.MONEY_PROOF_MODE !== "disposable-only" ||
      app.protocol !== "http:" || app.hostname !== "127.0.0.1" || app.port !== "3011" ||
      app.pathname !== "/" || app.search || app.hash || app.username || app.password ||
      database.protocol !== "postgresql:" || database.hostname !== "127.0.0.1" ||
      database.port !== "5432" || database.pathname !== "/payroll_mny01_test" ||
      database.search || database.hash ||
      ["PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED", "PAYROLL_UNDERPAYMENT_POSTING_ENABLED"].some(k => env[k] === "true") ||
      ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY", "RESEND_API_KEY",
        "POSTMARK_SERVER_TOKEN", "SMTP_URL", "SMTP_HOST"].some(k => Boolean(env[k]))) fail();
}
