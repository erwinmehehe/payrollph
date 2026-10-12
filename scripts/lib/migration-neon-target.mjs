/**
 * Fail closed before connecting: this is the expected NEON production target.
 * A database name is not sufficient when restore/snapshot swaps endpoints.
 * Configuration is supplied by protected GitHub production environment vars.
 */
export function requirePinnedNeonMigrationTarget(env) {
  const expectedNeonIdentity = {
    projectId: env.EXPECTED_PRODUCTION_NEON_PROJECT_ID,
    branchId: env.EXPECTED_PRODUCTION_NEON_BRANCH_ID,
    endpointId: env.EXPECTED_PRODUCTION_NEON_ENDPOINT_ID,
  };
  if (!/^[a-z0-9-]{1,60}$/.test(expectedNeonIdentity.projectId ?? "") ||
      !/^br-[a-z0-9-]{6,60}$/.test(expectedNeonIdentity.branchId ?? "") ||
      !/^ep-[a-z0-9-]{6,60}$/.test(expectedNeonIdentity.endpointId ?? "")) {
    throw new Error("REVIEWED_MIGRATION_NEON_TARGET_PIN_REQUIRED");
  }
  let parsed;
  try { parsed = new URL(env.MIGRATION_TARGET_DATABASE_URL ?? ""); }
  catch { throw new Error("REVIEWED_MIGRATION_NEON_CONNECTION_URL_INVALID"); }
  const hostname = parsed.hostname;
  const neonDirectHost = /^ep-[a-z0-9-]+\.c-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/;
  let databaseName;
  try { databaseName = decodeURIComponent(parsed.pathname.slice(1)); }
  catch { throw new Error("REVIEWED_MIGRATION_NEON_CONNECTION_URL_INVALID"); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) ||
      !neonDirectHost.test(hostname) ||
      !hostname.startsWith(expectedNeonIdentity.endpointId + ".") ||
      (parsed.port !== "" && parsed.port !== "5432") ||
      parsed.hash || !parsed.username || !parsed.password ||
      databaseName !== env.EXPECTED_PRODUCTION_DATABASE_NAME) {
    throw new Error("REVIEWED_MIGRATION_NEON_CONNECTION_TARGET_MISMATCH");
  }
  // Internal Postgres session neon.project_id/branch_id/endpoint_id must be
  // independently verified *inside* the migration transaction as well.
  return expectedNeonIdentity;
}
