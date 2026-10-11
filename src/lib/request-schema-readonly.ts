/**
 * Catalog-only preflight for request-path legacy schema creators. This never
 * reads employee rows or changes the database. Passing is a structural subset
 * check, NOT proof of applied migration receipts, role isolation or approval
 * to process live payroll.
 */
export type RequestSchemaColumn = { name: string; type?: string; notNull?: boolean };
export type RequestSchemaIndex = {
  name: string; tableName: string; keys: readonly string[];
  unique: boolean; predicateTokens?: readonly string[];
};
export type RequestSchemaConstraint = {
  tableName: string; kind: "f" | "c"; tokens: readonly string[];
};
export type RequestSchemaSpec = {
  label: "leave" | "pay-basis";
  tables: readonly string[];
  columns: readonly RequestSchemaColumn[];
  indexes: readonly RequestSchemaIndex[];
  constraints: readonly RequestSchemaConstraint[];
};

export type RequestCatalogQuery = (sql: string, args?: unknown[]) =>
  Promise<{ rows: Record<string, unknown>[] }>;

const norm = (s: string) => s.toLowerCase().replace(/"/g, "")
  .replace(/\bpublic\./g, "").replace(/\s+/g, "");

function safeIndex(actual: Record<string, unknown>, expected: RequestSchemaIndex) {
  const keys = actual.keys;
  const predicate = actual.predicate;
  if (actual.tableName !== expected.tableName || actual.isUnique !== expected.unique ||
      actual.isValid !== true || actual.isReady !== true ||
      !Array.isArray(keys) || keys.length !== expected.keys.length) return false;
  if (!expected.keys.every((item, i) => typeof keys[i] === "string" &&
      norm(keys[i]) === norm(item))) return false;
  const tokens = expected.predicateTokens ?? [];
  if (!tokens.length) return predicate == null;
  return typeof predicate === "string" &&
    tokens.every(token => norm(predicate).includes(norm(token)));
}

/**
 * The query callback must use one reserved DB client, never a transaction pool
 * that rotates connections. A failed ROLLBACK is propagated; the caller MUST
 * discard the connection instead of returning an open transaction to the pool.
 */
export async function verifyRequestSchemaReadOnly(
  query: RequestCatalogQuery, spec: RequestSchemaSpec,
) {
  let began = false;
  try {
    await query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    began = true;
    await query("SET LOCAL statement_timeout = '7000ms'");
    await query("SET LOCAL lock_timeout = '2000ms'");
    await query("SET LOCAL search_path = pg_catalog");
    const transaction = await query("SELECT current_setting('transaction_read_only') = 'on' AS ready");
    if (transaction.rows[0]?.ready !== true) throw new Error("REQUEST_SCHEMA_READONLY_TX_REQUIRED");

    const tables = await query(
      "SELECT c.relname AS name FROM pg_catalog.pg_class c " +
      "JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace " +
      "WHERE n.nspname = 'public' AND c.relkind IN ('r','p') " +
      "AND c.relname = ANY($1::text[])",
      [[...spec.tables]],
    );
    const cols = await query(
      "SELECT c.relname || '.' || a.attname AS name, " +
      "pg_catalog.format_type(a.atttypid, a.atttypmod) AS type, " +
      "a.attnotnull AS \"notNull\" FROM pg_catalog.pg_attribute a " +
      "JOIN pg_catalog.pg_class c ON c.oid = a.attrelid " +
      "JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace " +
      "WHERE n.nspname = 'public' AND c.relkind IN ('r','p') " +
      "AND a.attnum > 0 AND NOT a.attisdropped " +
      "AND (c.relname || '.' || a.attname) = ANY($1::text[])",
      [spec.columns.map(row => row.name)],
    );
    const indexes = await query(
      "SELECT idx.relname AS name, tbl.relname AS \"tableName\", " +
      "ind.indisunique AS \"isUnique\", ind.indisvalid AS \"isValid\", ind.indisready AS \"isReady\", " +
      "ARRAY(SELECT pg_catalog.pg_get_indexdef(ind.indexrelid, p.n, true) " +
      "FROM pg_catalog.generate_series(1, ind.indnkeyatts) AS p(n) ORDER BY p.n) AS keys, " +
      "pg_catalog.pg_get_expr(ind.indpred, ind.indrelid) AS predicate " +
      "FROM pg_catalog.pg_index ind " +
      "JOIN pg_catalog.pg_class idx ON idx.oid = ind.indexrelid " +
      "JOIN pg_catalog.pg_class tbl ON tbl.oid = ind.indrelid " +
      "JOIN pg_catalog.pg_namespace n ON n.oid = tbl.relnamespace " +
      "WHERE n.nspname = 'public' AND idx.relname = ANY($1::text[])",
      [spec.indexes.map(row => row.name)],
    );
    const constraints = await query(
      "SELECT t.relname AS \"tableName\", con.contype::text AS kind, " +
      "pg_catalog.pg_get_constraintdef(con.oid) AS definition " +
      "FROM pg_catalog.pg_constraint con " +
      "JOIN pg_catalog.pg_class t ON t.oid = con.conrelid " +
      "JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace " +
      "WHERE n.nspname = 'public' AND t.relname = ANY($1::text[])",
      [[...spec.tables]],
    );
    const tableSet = new Set(tables.rows.map(row => row.name));
    const colMap = new Map(cols.rows.map(row => [row.name, row]));
    const indexMap = new Map(indexes.rows.map(row => [row.name, row]));
    const soundTables = spec.tables.every(table => tableSet.has(table));
    const soundColumns = spec.columns.every(required => {
      const actual = colMap.get(required.name);
      return actual && (required.type === undefined || norm(String(actual.type)) === norm(required.type))
        && (required.notNull === undefined || actual.notNull === required.notNull);
    });
    const soundIndexes = spec.indexes.every(expected => {
      const actual = indexMap.get(expected.name);
      return actual && safeIndex(actual, expected);
    });
    const soundConstraints = spec.constraints.every(expected =>
      constraints.rows.some(row => row.tableName === expected.tableName &&
        row.kind === expected.kind && typeof row.definition === "string" &&
        expected.tokens.every(token => norm(String(row.definition)).includes(norm(token)))),
    );
    if (!soundTables || !soundColumns || !soundIndexes || !soundConstraints) {
      throw new Error("REQUEST_SCHEMA_READONLY_" + spec.label.toUpperCase() + "_INCOMPATIBLE");
    }
  } finally {
    if (began) await query("ROLLBACK");
  }
}

export const leaveSchemaSpec: RequestSchemaSpec = {
  label: "leave",
  tables: ["leave_policies", "leave_request_interval_sets", "leave_request_intervals"],
  columns: [
    { name: "leave_policies.pay_treatment", type: "character varying(24)", notNull: true },
    { name: "leave_policies.paid_percentage", type: "numeric(5,2)", notNull: true },
    { name: "leave_request_interval_sets.organization_id", type: "integer", notNull: true },
    { name: "leave_request_interval_sets.leave_request_id", type: "integer", notNull: true },
    { name: "leave_request_interval_sets.revision", type: "integer", notNull: true },
    { name: "leave_request_interval_sets.status", type: "character varying(16)", notNull: true },
    { name: "leave_request_intervals.organization_id", type: "integer", notNull: true },
    { name: "leave_request_intervals.interval_set_id", type: "integer", notNull: true },
    { name: "leave_request_intervals.work_date", type: "date", notNull: true },
    { name: "leave_request_intervals.kind", type: "character varying(20)", notNull: true },
    { name: "leave_request_intervals.timezone", type: "character varying(64)", notNull: true },
    { name: "leave_request_intervals.ends_next_day", type: "boolean", notNull: true },
  ],
  indexes: [
    { name: "leave_interval_set_revision_unique", tableName: "leave_request_interval_sets", keys: ["leave_request_id", "revision"], unique: true },
    { name: "leave_interval_set_current_unique", tableName: "leave_request_interval_sets", keys: ["leave_request_id"], unique: true, predicateTokens: ["status", "current"] },
    { name: "leave_interval_sets_org_request_idx", tableName: "leave_request_interval_sets", keys: ["organization_id", "leave_request_id"], unique: false },
    { name: "leave_request_intervals_set_date_idx", tableName: "leave_request_intervals", keys: ["interval_set_id", "work_date"], unique: false },
    { name: "leave_request_intervals_org_date_idx", tableName: "leave_request_intervals", keys: ["organization_id", "work_date"], unique: false },
  ],
  constraints: [
    { tableName: "leave_request_interval_sets", kind: "f", tokens: ["leave_request_id", "referencesleave_requests(id)", "ondeletecascade"] },
    { tableName: "leave_request_intervals", kind: "f", tokens: ["interval_set_id", "referencesleave_request_interval_sets(id)", "ondeletecascade"] },
    { tableName: "leave_request_intervals", kind: "c", tokens: ["kind", "start_local_time", "end_local_time", "ends_next_day"] },
  ],
};

export const payBasisSchemaSpec: RequestSchemaSpec = {
  label: "pay-basis",
  tables: ["employee_pay_profiles", "employee_pay_revisions", "employee_pay_retro_adjustments"],
  columns: [
    { name: "employee_pay_profiles.employee_id", type: "integer", notNull: true },
    { name: "employee_pay_profiles.organization_id", type: "integer", notNull: true },
    { name: "employee_pay_profiles.pay_basis", type: "character varying(16)", notNull: true },
    { name: "employee_pay_profiles.rate_amount", type: "numeric(12,2)", notNull: true },
    { name: "employee_pay_profiles.standard_work_days_per_month", type: "numeric(6,2)", notNull: true },
    { name: "employee_pay_profiles.standard_hours_per_day", type: "numeric(5,2)", notNull: true },
    { name: "employee_pay_revisions.employee_id", type: "integer", notNull: true },
    { name: "employee_pay_revisions.organization_id", type: "integer", notNull: true },
    { name: "employee_pay_revisions.effective_date", type: "date", notNull: true },
    { name: "employee_pay_retro_adjustments.organization_id", type: "integer", notNull: true },
    { name: "employee_pay_retro_adjustments.employee_id", type: "integer", notNull: true },
    { name: "employee_pay_retro_adjustments.revision_id", type: "integer", notNull: true },
    { name: "employee_pay_retro_adjustments.source_payroll_run_id", type: "integer", notNull: true },
    { name: "employee_pay_retro_adjustments.amount", type: "numeric(12,2)", notNull: true },
  ],
  indexes: [
    { name: "employee_pay_profiles_org_idx", tableName: "employee_pay_profiles", keys: ["organization_id"], unique: false },
    { name: "employee_pay_revisions_org_employee_idx", tableName: "employee_pay_revisions", keys: ["organization_id", "employee_id"], unique: false },
    { name: "employee_pay_revisions_employee_effective_idx", tableName: "employee_pay_revisions", keys: ["employee_id", "effective_date"], unique: true },
    { name: "employee_pay_retro_org_employee_idx", tableName: "employee_pay_retro_adjustments", keys: ["organization_id", "employee_id"], unique: false },
    { name: "employee_pay_retro_revision_run_idx", tableName: "employee_pay_retro_adjustments", keys: ["revision_id", "source_payroll_run_id"], unique: true },
  ],
  constraints: [
    { tableName: "employee_pay_profiles", kind: "f", tokens: ["employee_id", "referencesemployees(id)", "ondeletecascade"] },
    { tableName: "employee_pay_revisions", kind: "f", tokens: ["employee_id", "referencesemployees(id)", "ondeletecascade"] },
    { tableName: "employee_pay_retro_adjustments", kind: "f", tokens: ["revision_id", "referencesemployee_pay_revisions(id)", "ondeletecascade"] },
    { tableName: "employee_pay_retro_adjustments", kind: "f", tokens: ["source_payroll_run_id", "referencespayroll_runs(id)", "ondeletecascade"] },
  ],
};
