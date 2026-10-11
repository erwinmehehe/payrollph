/**
 * Hard boundary for the *only* database this migration rehearsal may touch.
 * No production/staging URL, restored employer copy, or external hostname is
 * accepted. The CI workflow provides all required values without secrets.
 */
export function assertIsolatedMigrationTarget(env = process.env) {
  if (env.CI !== "true" || env.GITHUB_ACTIONS !== "true" ||
      env.MIGRATION_REHEARSAL_MODE !== "isolated-ci-only") {
    throw new Error("MIGRATION_REHEARSAL_CI_ONLY");
  }
  let target;
  try { target = new URL(env.DATABASE_URL ?? ""); }
  catch { throw new Error("MIGRATION_REHEARSAL_DISPOSABLE_DB_ONLY"); }
  if (!["postgresql:", "postgres:"].includes(target.protocol) ||
      !["localhost", "127.0.0.1"].includes(target.hostname) ||
      target.port !== "5432" ||
      target.pathname !== "/app_db" ||
      target.username !== "postgres" ||
      target.search || target.hash) {
    throw new Error("MIGRATION_REHEARSAL_DISPOSABLE_DB_ONLY");
  }
  return target.toString();
}
