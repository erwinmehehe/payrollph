/**
 * Structural production release canary. Never queries payroll records or changes
 * the database. Passing does NOT certify applied migration receipts or authorize
 * live payroll, employee access, or bank payouts.
 */
export const requiredReleaseTables = [
  "organizations", "users", "employees", "payroll_runs", "payroll_entries", "audit_events",
  // drizzle/0100 — controlled compensation automation delivery
  "compensation_automation_intents",
  // drizzle/0106 — verified employer onboarding and billing
  "saas_signup_verifications", "saas_billing_checkouts", "saas_billing_state", "saas_billing_events",
  // drizzle/0109 — append-only audit and tamper-evident sealing
  "audit_chain_heads",
  // drizzle/0110 — durable provider event inbox
  "provider_events",
] as const;

export const requiredReleaseColumns = [
  "saas_signup_verifications.organization_id",
  "saas_signup_verifications.token_hash",
  "saas_signup_verifications.verified_at",
  "saas_billing_checkouts.reference_id",
  "saas_billing_state.subscription_id",
  "audit_events.chain_seq",
  "audit_events.prev_hash",
  "audit_events.row_hash",
  "provider_events.event_id",
  "provider_events.organization_id",
  "compensation_automation_intents.event_key",
] as const;

export const requiredReleaseIndexes = [
  "saas_billing_one_open_checkout",
  "audit_events_chain_seq_unique",
  "provider_events_provider_event_id_unique",
  "comp_automation_intent_key_unique",
] as const;


/**
 * PostgreSQL catalog signature of a present index. A reused index name on the
 * wrong table, invalid CONCURRENTLY-created index, non-unique replacement, or
 * a changed partial predicate must NOT pass the payroll release canary.
 */

/**
 * The same parameterized PostgreSQL query is used by production's read-only
 * check and by an isolated PostgreSQL 16 catalog regression test.
 * Parameters: reviewed index names; fixed schema name ("public" in production).
 */
export const releaseIndexCatalogSql = `
  SELECT idx.relname AS name, tbl.relname AS "tableName",
    ind.indisunique AS "isUnique", ind.indisvalid AS "isValid",
    ind.indisready AS "isReady",
    ARRAY(
      SELECT pg_catalog.pg_get_indexdef(ind.indexrelid, pos.n, true)
      FROM pg_catalog.generate_series(1, ind.indnkeyatts) AS pos(n)
      ORDER BY pos.n
    ) AS keys,
    pg_catalog.pg_get_expr(ind.indpred, ind.indrelid) AS predicate
  FROM pg_catalog.pg_index ind
  JOIN pg_catalog.pg_class idx ON idx.oid = ind.indexrelid
  JOIN pg_catalog.pg_class tbl ON tbl.oid = ind.indrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = tbl.relnamespace
  WHERE n.nspname = $2::text AND idx.relname = ANY($1::text[])
`;

export type ReleaseIndexMetadata = {
  name: string;
  tableName: string;
  isUnique: boolean;
  isValid: boolean;
  isReady: boolean;
  keys: readonly string[];
  predicate: string | null;
};

type IndexExpectation = {
  tableName: string;
  keys: readonly string[];
  predicateTokens: readonly string[];
};

const releaseIndexExpectations: Record<(typeof requiredReleaseIndexes)[number], IndexExpectation> = {
  saas_billing_one_open_checkout: {
    tableName: "saas_billing_checkouts",
    keys: ["organization_id"],
    predicateTokens: ["status", "creating", "awaiting_payment", "review_required"],
  },
  audit_events_chain_seq_unique: {
    tableName: "audit_events",
    keys: ["coalesce(organization_id, 0)", "chain_seq"],
    predicateTokens: ["chain_seq", "is not null"],
  },
  provider_events_provider_event_id_unique: {
    tableName: "provider_events",
    keys: ["provider", "event_id"],
    predicateTokens: [],
  },
  comp_automation_intent_key_unique: {
    tableName: "compensation_automation_intents",
    keys: ["organization_id", "trigger", "event_key"],
    predicateTokens: [],
  },
};

function normalizeIndexExpression(expression: string) {
  let normalized = expression.toLowerCase().replace(/"/g, "").replace(/\s+/g, "");
  // PostgreSQL may deparse expressions with an extra wrapper pair.
  if (normalized.startsWith("(") && normalized.endsWith(")")) {
    normalized = normalized.slice(1, -1);
  }
  return normalized;
}

/** Only validated signatures are supplied to the existing inventory evaluator. */
export function validatedReleaseIndexes(rows: readonly ReleaseIndexMetadata[]): string[] {
  return requiredReleaseIndexes.filter((name) => {
    const shape = releaseIndexExpectations[name];
    const actual = rows.find((row) => row.name === name);
    if (!actual || actual.tableName !== shape.tableName
      || !actual.isUnique || !actual.isValid || !actual.isReady
      || !Array.isArray(actual.keys) || actual.keys.length !== shape.keys.length) {
      return false;
    }
    if (shape.keys.some((expected, i) =>
      normalizeIndexExpression(actual.keys[i]) !== normalizeIndexExpression(expected))) {
      return false;
    }
    if (shape.predicateTokens.length === 0) return actual.predicate === null;
    if (!actual.predicate) return false;
    const predicate = normalizeIndexExpression(actual.predicate);
    return shape.predicateTokens.every((token) =>
      predicate.includes(normalizeIndexExpression(token)));
  });
}

export const requiredReleaseFunctions = ["seal_audit_events(integer)"] as const;
export const requiredReleaseTriggers = ["audit_events.audit_events_protect_mutation"] as const;

export type ReleaseSchemaInventory = {
  tables: readonly string[];
  columns: readonly string[];
  indexes: readonly string[];
  functions: readonly string[];
  triggers: readonly string[];
};

export function evaluateReleaseSchemaInventory(inventory: ReleaseSchemaInventory) {
  const found = {
    tables: new Set(inventory.tables),
    columns: new Set(inventory.columns),
    indexes: new Set(inventory.indexes),
    functions: new Set(inventory.functions),
    triggers: new Set(inventory.triggers),
  };
  const missing = {
    tables: requiredReleaseTables.filter((name) => !found.tables.has(name)),
    columns: requiredReleaseColumns.filter((name) => !found.columns.has(name)),
    indexes: requiredReleaseIndexes.filter((name) => !found.indexes.has(name)),
    functions: requiredReleaseFunctions.filter((name) => !found.functions.has(name)),
    triggers: requiredReleaseTriggers.filter((name) => !found.triggers.has(name)),
  };
  return {
    schemaCompatible: Object.values(missing).every((items) => items.length === 0),
    missing,
    readOnly: true as const,
    migrationReceiptsVerified: false as const,
    payrollGaApproved: false as const,
  };
}
