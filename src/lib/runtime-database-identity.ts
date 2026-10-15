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

// Fixed-name public catalog objects only; this never establishes whether an
// individual migration ran, whether a column type matches source, or release approval.
export type RuntimeCompensationTableEvidence = Readonly<{
  compensationTablesPresent: number;
  compensationTablesExpected: 6;
  migrationLedgerTablesPresent: number;
  migrationLedgerTablesExpected: 3;
  evidenceScope: "CATALOG_TABLE_PRESENCE_ONLY_NOT_MIGRATION_APPROVAL";
}>;

export function normalizeRuntimeCompensationTableEvidence(value: unknown): RuntimeCompensationTableEvidence {
  if (!value || typeof value !== "object") throw new Error("READINESS_SCHEMA_EVIDENCE_NOT_AVAILABLE");
  const row = value as Record<string, unknown>;
  const count = (key: string, upper: number): number => {
    const value = row[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > upper) {
      throw new Error("READINESS_SCHEMA_EVIDENCE_NOT_AVAILABLE");
    }
    return value;
  };
  return {
    compensationTablesPresent: count("compensationTablesPresent", 6),
    compensationTablesExpected: 6,
    migrationLedgerTablesPresent: count("migrationLedgerTablesPresent", 3),
    migrationLedgerTablesExpected: 3,
    evidenceScope: "CATALOG_TABLE_PRESENCE_ONLY_NOT_MIGRATION_APPROVAL",
  };
}
