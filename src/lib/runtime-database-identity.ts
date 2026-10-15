/**
 * Sanitize the immutable target metadata returned by the deployed server's
 * own PostgreSQL session. Never include a connection URL, host, password,
 * tenant row, SQL error or provider stack trace in the response.
 */
export type RuntimeDatabaseIdentity = {
  databaseName: string;
  projectId: string;
  branchId: string;
  endpointId: string;
  roleName: string;
  inRecovery: boolean;
};

export function normalizeRuntimeDatabaseIdentity(value: unknown): RuntimeDatabaseIdentity {
  if (!value || typeof value !== "object") {
    throw new Error("READINESS_DATABASE_IDENTITY_NOT_AVAILABLE");
  }
  const row = value as Record<string, unknown>;
  function identifier(key: string, pattern: RegExp): string {
    const item = row[key];
    if (typeof item !== "string" || !pattern.test(item)) {
      throw new Error("READINESS_DATABASE_IDENTITY_NOT_AVAILABLE");
    }
    return item;
  }
  if (typeof row.inRecovery !== "boolean") {
    throw new Error("READINESS_DATABASE_IDENTITY_NOT_AVAILABLE");
  }
  return {
    databaseName: identifier("databaseName", /^[A-Za-z0-9_]{1,63}$/),
    projectId: identifier("projectId", /^[a-z0-9-]{1,60}$/),
    branchId: identifier("branchId", /^br-[a-z0-9-]{4,58}$/),
    endpointId: identifier("endpointId", /^ep-[a-z0-9-]{4,58}$/),
    roleName: identifier("roleName", /^[A-Za-z_][A-Za-z0-9_]{0,62}$/),
    inRecovery: row.inRecovery,
  };
}
