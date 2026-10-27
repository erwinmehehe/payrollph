/**
 * Fail-closed disposable CI preflight. Call BEFORE importing db, route or HTTP
 * clients. This proof cannot contact a deployment, provider or production DB.
 */
export function requireDisposableYearEndPrior(env = process.env, phase = "prove") {
  if (phase !== "seed" && phase !== "prove")
    throw new Error("YEAR_END_PRIOR_REFUSED: unexpected proof phase");
  let db, app;
  try {
    db = new URL(env.DATABASE_URL);
    app = new URL(env.SECURITY_SMOKE_URL);
  } catch {
    throw new Error("YEAR_END_PRIOR_REFUSED: explicit URLs required");
  }
  const exactDatabase = db.href ===
    "postgresql://postgres:postgres@127.0.0.1:5432/app_db";
  if (env.CI !== "true" ||
      env.TENANT_SECOND_PASS_MODE !== "isolated-ci-only" ||
      env.NODE_ENV !== "production" ||
      env.WORKER_ENABLED !== "false" ||
      env.CENTRAL_SCHEDULER_ENABLED !== "false" ||
      env.YEAR_END_PRIOR_EVIDENCE_ENABLED !== "true" ||
      env.MULTI_ENTITY_ENABLED === "true" ||
      env.PAYMONGO_DISBURSEMENTS_ENABLED !== "false" ||
      env.XENDIT_PAYOUTS_ENABLED !== "false" ||
      env.PAYMONGO_SECRET_KEY || env.XENDIT_SECRET_KEY ||
      env.STRIPE_SECRET_KEY || env.RESEND_API_KEY ||
      app.href !== "http://127.0.0.1:3000/" ||
      !exactDatabase ||
      !/^[0-9a-fA-F]{64}$/.test(env.PII_ENCRYPTION_KEY ?? "") ||
      !/^[0-9a-fA-F]{64}$/.test(env.BANK_DATA_ENCRYPTION_KEY ?? "")) {
    throw new Error("YEAR_END_PRIOR_REFUSED: disposable localhost PG16 only, no workers, providers or live data");
  }
  return true;
}
