/**
 * This guard applies only to the convenience 'db:push' command.
 * Production and remote Neon schema changes require the reviewed,
 * checksum-backed migration runner and separate DBA approval.
 */
export function assertIsolatedDbPushTarget(databaseUrl, env = {}) {
  if (typeof databaseUrl !== "string" || !databaseUrl.trim() ||
      databaseUrl !== databaseUrl.trim()) {
    throw new Error("DB_PUSH_REQUIRES_EXPLICIT_LOCAL_DATABASE_URL");
  }
  let url;
  try { url = new URL(databaseUrl); }
  catch { throw new Error("DB_PUSH_DATABASE_URL_INVALID"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      (url.port !== "" && url.port !== "5432") ||
      url.search || url.hash ||
      !url.username || !/^\/[A-Za-z0-9_]{1,63}$/.test(url.pathname)) {
    throw new Error("DB_PUSH_REMOTE_OR_UNVERIFIED_TARGET_REFUSED");
  }
  const databaseName = url.pathname.slice(1);
  if (["postgres", "template0", "template1", "neondb"].includes(databaseName)) {
    throw new Error("DB_PUSH_SYSTEM_OR_PRODUCTION_DATABASE_NAME_REFUSED");
  }
  if ((env.CI === "true" || env.GITHUB_ACTIONS === "true") &&
      (env.CI !== "true" || env.GITHUB_ACTIONS !== "true" ||
       databaseName !== "app_db" || url.hostname !== "127.0.0.1")) {
    throw new Error("DB_PUSH_CI_MUST_USE_SYNTHETIC_LOOPBACK_APP_DB");
  }
  return { hostname: url.hostname, databaseName, isolated: true };
}
