/**
 * Fail-closed preflight for a standalone real-HTTP employee availability proof.
 * Only disposable localhost PostgreSQL/Next are permitted. Never point this at
 * a hosted deployment, a developer's populated DB, or financial providers.
 */
export function requireDisposableSelfAvailability(env = process.env) {
  let app, database;
  try {
    app = new URL(env.SECURITY_SMOKE_URL ?? "");
    database = new URL(env.DATABASE_URL ?? "");
  } catch {
    throw new Error("SELF_AVAILABILITY_PROOF_REFUSED: explicit local app and PostgreSQL URLs required");
  }
  const valid =
    env.CI === "true" &&
    env.TENANT_SECOND_PASS_MODE === "isolated-ci-only" &&
    env.NODE_ENV === "production" &&
    env.WFM_EMPLOYEE_AVAILABILITY_ENABLED === "true" &&
    app.href === "http://127.0.0.1:3000/" &&
    database.protocol === "postgresql:" &&
    database.hostname === "127.0.0.1" &&
    database.port === "5432" &&
    database.pathname === "/app_db" &&
    database.username === "postgres" &&
    env.PAYMONGO_DISBURSEMENTS_ENABLED === "false" &&
    env.XENDIT_PAYOUTS_ENABLED === "false" &&
    !env.PAYMONGO_SECRET_KEY &&
    !env.XENDIT_SECRET_KEY &&
    !env.RESEND_API_KEY;
  if (!valid) {
    throw new Error("SELF_AVAILABILITY_PROOF_REFUSED: disposable localhost app_db, synthetic flag and zero provider access required");
  }
  return true;
}
