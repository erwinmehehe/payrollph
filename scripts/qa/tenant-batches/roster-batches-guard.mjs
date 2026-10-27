/**
 * Fail-closed preflight: never load the application, database or HTTP client
 * before verifying that this test uses disposable localhost resources only.
 */
export function requireDisposableRosterBatch(env = process.env, stage = "prove") {
  let app, database;
  try {
    app = new URL(env.SECURITY_SMOKE_URL);
    database = new URL(env.DATABASE_URL);
  } catch {
    throw new Error("ROSTER_BATCH_PROOF_REFUSED: explicit localhost targets required");
  }
  if (env.CI !== "true" ||
      env.TENANT_SECOND_PASS_MODE !== "isolated-ci-only" ||
      env.NODE_ENV !== "production" ||
      app.href !== "http://127.0.0.1:3000/" ||
      database.protocol !== "postgresql:" ||
      database.hostname !== "127.0.0.1" ||
      database.port !== "5432" ||
      database.pathname !== "/app_db" ||
      database.username !== "postgres" ||
      database.search || database.hash ||
      env.WORKER_ENABLED !== "false" ||
      env.CENTRAL_SCHEDULER_ENABLED !== "false" ||
      env.PAYMONGO_DISBURSEMENTS_ENABLED !== "false" ||
      env.XENDIT_PAYOUTS_ENABLED !== "false" ||
      env.PAYMONGO_SECRET_KEY || env.XENDIT_SECRET_KEY ||
      env.RESEND_API_KEY ||
      env.WFM_BULK_ROSTER_PUBLISH_ENABLED !== "true") {
    throw new Error("ROSTER_BATCH_PROOF_REFUSED: disposable PG16, localhost and disabled providers/workers required");
  }
  if (stage !== "seed" && stage !== "prove") {
    throw new Error("ROSTER_BATCH_PROOF_REFUSED: unknown proof stage");
  }
  if (stage === "prove") {
    const raw = env.WFM_BULK_ROSTER_ALLOWED_ORGANIZATION_IDS;
    if (typeof raw !== "string" ||
        !/^[1-9][0-9]{0,9}(,[1-9][0-9]{0,9}){2}$/.test(raw)) {
      throw new Error("ROSTER_BATCH_PROOF_REFUSED: exactly three explicit fictional employer IDs required");
    }
    const ids = raw.split(",").map(Number);
    if (new Set(ids).size !== 3 ||
        ids.some(id => !Number.isSafeInteger(id) || id > 2147483647)) {
      throw new Error("ROSTER_BATCH_PROOF_REFUSED: duplicate or invalid employer IDs");
    }
    return ids;
  }
  return null;
}
