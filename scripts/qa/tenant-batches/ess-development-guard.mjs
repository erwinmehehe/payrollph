/**
 * Refuse any non-disposable or provider-enabled target before importing app/DB.
 * No production records, payroll, deployment or external HTTP are touched.
 */
export function requireDisposableDevelopmentPlans(env = process.env, mode = "prove") {
  if (!["seed", "prove"].includes(mode)) {
    throw new Error("ESS_DEVELOPMENT_REFUSED: unknown proof mode");
  }
  let database, app;
  try {
    database = new URL(env.DATABASE_URL);
    app = new URL(env.SECURITY_SMOKE_URL);
  } catch {
    throw new Error("ESS_DEVELOPMENT_REFUSED: explicit localhost targets required");
  }
  if (env.CI !== "true" || env.NODE_ENV !== "production" ||
      env.TENANT_SECOND_PASS_MODE !== "isolated-ci-only" ||
      env.WORKER_ENABLED !== "false" ||
      env.CENTRAL_SCHEDULER_ENABLED !== "false" ||
      app.href !== "http://127.0.0.1:3000/" ||
      database.protocol !== "postgresql:" ||
      database.hostname !== "127.0.0.1" ||
      database.port !== "5432" || database.pathname !== "/app_db" ||
      database.username !== "postgres" ||
      database.password !== "postgres" ||
      database.search !== "" || database.hash !== "" ||
      env.PAYMONGO_DISBURSEMENTS_ENABLED !== "false" ||
      env.XENDIT_PAYOUTS_ENABLED !== "false" ||
      env.PAYMONGO_SECRET_KEY || env.XENDIT_SECRET_KEY ||
      env.RESEND_API_KEY || env.STRIPE_SECRET_KEY ||
      env.WORKER_TOKEN === undefined) {
    throw new Error("ESS_DEVELOPMENT_REFUSED: disposable PG16/localhost and disabled providers/workers required");
  }
}
