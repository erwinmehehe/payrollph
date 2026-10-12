/**
 * Types for the shared runtime guard consumed by drizzle.config.ts.
 * The implementation is the adjacent .mjs file, not a second policy.
 */
export function assertIsolatedDbPushTarget(
  databaseUrl: string | undefined,
  env?: Record<string, string | undefined>,
): { hostname: string; databaseName: string; isolated: true };
