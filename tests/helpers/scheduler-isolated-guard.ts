/**
 * Synthetic process-recovery rehearsal hard stop.
 * This test suite must never connect to a deployed or customer database.
 */
export function assertIsolatedSchedulerRehearsal(
  env: Readonly<Record<string, string | undefined>>,
): void {
  if (env.CI !== "true" || env.SCHEDULER_REHEARSAL_MODE !== "isolated-ci-only") {
    throw new Error("Scheduler rehearsal requires explicit isolated CI authorization.");
  }
  for (const flag of [
    "CENTRAL_SCHEDULER_ENABLED",
    "WORKER_ENABLED",
    "PAYROLL_SCHEDULER_DISPATCH_ENABLED",
    "PAYMONGO_DISBURSEMENTS_ENABLED",
    "XENDIT_PAYOUTS_ENABLED",
  ]) {
    if (env[flag] === "true") {
      throw new Error("Scheduler rehearsal refuses an enabled runtime or payment integration.");
    }
  }
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL ?? "");
  } catch {
    throw new Error("Scheduler rehearsal requires the fixed isolated PostgreSQL test database.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      url.hostname !== "127.0.0.1" ||
      url.port !== "5432" ||
      url.pathname !== "/app_db" ||
      url.username !== "postgres" ||
      url.password !== "postgres" ||
      url.search !== "" || url.hash !== "") {
    throw new Error("Scheduler rehearsal refused an unapproved database target.");
  }
}
