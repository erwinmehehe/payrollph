import { sql } from "drizzle-orm";

/**
 * Attest the actual PostgreSQL session serving a public fictional demo.
 * A customer can rename their employer "Loom & Local"; a name is NOT a
 * database-identity proof. This explicitly requires a separately provisioned
 * Neon project/branch/endpoint, database and role pinned by the operator.
 *
 * There is no permissive default: legacy production/demo connections without
 * independent provisioning evidence cannot create or alter demo records.
 * Read on the SAME database session/transaction that seeds the demo fixture.
 */
export const PUBLIC_DEMO_DATABASE_IDENTITY_SQL = sql`
  select
    pg_catalog.current_setting('neon.project_id', true)::text as "projectId",
    pg_catalog.current_setting('neon.branch_id', true)::text as "branchId",
    pg_catalog.current_setting('neon.endpoint_id', true)::text as "endpointId",
    pg_catalog.current_database()::text as "databaseName",
    current_user::text as "roleName",
    pg_catalog.pg_is_in_recovery() as "inRecovery"
`;

function pinned(value: string | undefined): value is string {
  return typeof value === "string" &&
    value.length >= 3 && value.length <= 128 &&
    /^[A-Za-z0-9_.-]+$/.test(value);
}

/** No matching branch/role = NO production demo writes, even if org names match. */
export function verifiedPublicDemoDatabaseIdentity(
  identity: unknown,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (env.PUBLIC_DEMO_DATABASE_ATTESTED !== "true" ||
      !identity || typeof identity !== "object" || Array.isArray(identity)) return false;
  const actual = identity as Record<string, unknown>;
  const pins = [
    ["projectId", env.PUBLIC_DEMO_NEON_PROJECT_ID],
    ["branchId", env.PUBLIC_DEMO_NEON_BRANCH_ID],
    ["endpointId", env.PUBLIC_DEMO_NEON_ENDPOINT_ID],
    ["databaseName", env.PUBLIC_DEMO_DATABASE_NAME],
    ["roleName", env.PUBLIC_DEMO_DATABASE_ROLE],
  ] as const;
  return actual.inRecovery === false &&
    pins.every(([field, expected]) => pinned(expected) && actual[field] === expected);
}
