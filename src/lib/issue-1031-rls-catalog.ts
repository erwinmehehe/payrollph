/**
 * #1031 read-only catalog RLS evidence. PostgreSQL row security and policies
 * are NOT modeled by the Drizzle source manifest. Never infer RLS expected
 * state from an absent schema declaration, or turn catalog facts into PASS.
 * Pure mapper: no connection, queries or mutation.
 */
import { createHash } from "node:crypto";
import { EVIDENCE } from "./issue-1031-full-schema-diff";

export const RLS_UNMODELED = "UNMODELED_REQUIRES_DBA_EXPECTATION" as const;

export type RlsCatalogRow = {
  table_name: string;
  rls_enabled: boolean;
  rls_forced: boolean;
  policy_name: string | null;
  policy_command: string | null;
  policy_permissive: boolean | null;
  policy_roles: string[] | null;
  using_expression: string | null;
  with_check_expression: string | null;
};

type Policy = {
  name: string;
  command: string;
  permissive: boolean;
  roles: string[];
  using: string | null;
  withCheck: string | null;
};

const validName = (name: unknown): name is string =>
  typeof name === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name);
function requireEvidence(condition: unknown): asserts condition {
  if (!condition) throw new Error("ISSUE1031_INVALID_RLS_CATALOG_EVIDENCE");
}

export function summarizeRlsPolicyCoverage(sourceTables: readonly string[], rows: readonly RlsCatalogRow[]) {
  requireEvidence(Array.isArray(sourceTables) && Array.isArray(rows));
  const sourceNames = new Set<string>();
  for (const name of sourceTables) {
    requireEvidence(validName(name) && !sourceNames.has(name));
    sourceNames.add(name);
  }
  const seen = new Map<string, { enabled: boolean; forced: boolean; policies: Map<string, Policy> }>();
  const emptyPolicyTables = new Set<string>();
  for (const row of rows) {
    requireEvidence(row && validName(row.table_name) &&
      typeof row.rls_enabled === "boolean" && typeof row.rls_forced === "boolean");
    const entry = seen.get(row.table_name) ?? {
      enabled: row.rls_enabled, forced: row.rls_forced, policies: new Map<string, Policy>(),
    };
    requireEvidence(entry.enabled === row.rls_enabled && entry.forced === row.rls_forced);
    if (row.policy_name === null) {
      requireEvidence(!seen.has(row.table_name));
      emptyPolicyTables.add(row.table_name);
      requireEvidence(row.policy_command === null && row.policy_permissive === null &&
        row.policy_roles === null && row.using_expression === null &&
        row.with_check_expression === null && entry.policies.size === 0);
    } else {
      requireEvidence(!emptyPolicyTables.has(row.table_name));
      requireEvidence(validName(row.policy_name) && !entry.policies.has(row.policy_name) &&
        typeof row.policy_command === "string" &&
        ["*", "r", "a", "w", "d"].includes(row.policy_command) &&
        typeof row.policy_permissive === "boolean" &&
        Array.isArray(row.policy_roles) && row.policy_roles.length > 0 &&
        row.policy_roles.every((name: string) => validName(name) || name === "PUBLIC") &&
        (row.using_expression === null || typeof row.using_expression === "string") &&
        (row.with_check_expression === null || typeof row.with_check_expression === "string"));
      entry.policies.set(row.policy_name, {
        name: row.policy_name, command: row.policy_command,
        permissive: row.policy_permissive, roles: [...row.policy_roles].sort(),
        using: row.using_expression, withCheck: row.with_check_expression,
      });
    }
    seen.set(row.table_name, entry);
  }
  const names = [...new Set([...sourceNames, ...seen.keys()])].sort();
  const tables = names.map((name) => {
    const entry = seen.get(name);
    if (!entry) return {
      table: name, sourceDeclared: true, catalogPresent: false,
      rlsEnabled: null, rlsForced: null, policyCount: null, policyDigest: null,
      coverage: "MISSING_TABLE" as const,
    };
    const policies = [...entry.policies.values()].sort((a, b) => a.name.localeCompare(b.name));
    // Hash expressions and database-role identifiers. Public reports must
    // never echo raw USING/WITH CHECK text or deployed-role names.
    const digest = createHash("sha256").update(JSON.stringify(policies)).digest("hex");
    return {
      table: name, sourceDeclared: sourceNames.has(name), catalogPresent: true,
      rlsEnabled: entry.enabled, rlsForced: entry.forced,
      policyCount: policies.length, policyDigest: digest,
      coverage: RLS_UNMODELED,
    };
  });
  return {
    evidenceScope: EVIDENCE,
    rlsCoverage: RLS_UNMODELED,
    reviewedPolicyManifestPresent: false,
    policyParityVerified: false,
    approvedForDeployment: false,
    expectedSourceTables: sourceNames.size,
    observedCatalogTables: seen.size,
    missingSourceTables: tables.filter((t) => !t.catalogPresent).length,
    extraCatalogTables: tables.filter((t) => !t.sourceDeclared).length,
    tables,
  };
}
