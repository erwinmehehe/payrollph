import type { Pool, PoolClient } from "pg";
import { criticalReleaseFlagEnabled } from "./critical-release-flags";

/**
 * Catalog-only preflight for request-path legacy schema creators. This never
 * reads employee rows or changes the database. Passing is a structural subset
 * check, NOT proof of applied migration receipts, role isolation or approval
 * to process live payroll.
 */
export type RequestSchemaColumn = {
  name: string; type?: string; notNull?: boolean;
  defaultTokens?: readonly string[];
  defaultTextLiteral?: string;
  defaultNumericZero?: true;
};
export type RequestSchemaIndex = {
  name: string; tableName: string; keys: readonly string[];
  unique: boolean; predicateTokens?: readonly string[];
  // Key extraction via pg_get_indexdef(indexoid, n, true) omits sort flags;
  // require explicit ordering in the *full* PostgreSQL index definition.
  definitionTokens?: readonly string[];
};
export type RequestSchemaConstraint = {
  tableName: string; kind: "f" | "c" | "u" | "p"; tokens: readonly string[];
  name?: string;
  exactCheckDefinition?: string;
};
export type RequestSchemaSpec = {
  label: "leave" | "pay-basis" | "month-close" | "dole-reporting" | "separation"
    | "marketing" | "workforce-attendance" | "migration" | "outbox"
    | "remittance-correction" | "remittance-month-close";
  tables: readonly string[];
  columns: readonly RequestSchemaColumn[];
  indexes: readonly RequestSchemaIndex[];
  constraints: readonly RequestSchemaConstraint[];
};

export type RequestCatalogQuery = (sql: string, args?: unknown[]) =>
  Promise<{ rows: Record<string, unknown>[] }>;

const norm = (s: string) => s.toLowerCase().replace(/"/g, "")
  .replace(/\bpublic\./g, "").replace(/\s+/g, "");

function checkDefinitionShape(value: string): string {
  // pg_get_constraintdef may add redundant parentheses/whitespace across
  // supported PostgreSQL versions; no added OR TRUE or weakened comparison
  // may pass even if it contains the expected column names.
  return norm(value).replace(/[()]/g, "");
}

function isNumericZeroDefault(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return /^(?:'0(?:\.0+)?'|0(?:\.0+)?)(?:::numeric(?:\(\d+,\d+\))?)?$/.test(norm(value));
}

function safeIndex(actual: Record<string, unknown>, expected: RequestSchemaIndex) {
  const keys = actual.keys;
  const predicate = actual.predicate;
  const requiredDefinition = expected.definitionTokens ?? [];
  if (requiredDefinition.length &&
      (typeof actual.indexDefinition !== "string" ||
       !requiredDefinition.every(token => norm(actual.indexDefinition as string).includes(norm(token))))) {
    return false;
  }
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
      "a.attnotnull AS \"notNull\", " +
      "pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS \"columnDefault\" " +
      "FROM pg_catalog.pg_attribute a " +
      "LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum " +
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
      "pg_catalog.pg_get_expr(ind.indpred, ind.indrelid) AS predicate, " +
      "pg_catalog.pg_get_indexdef(ind.indexrelid) AS \"indexDefinition\" " +
      "FROM pg_catalog.pg_index ind " +
      "JOIN pg_catalog.pg_class idx ON idx.oid = ind.indexrelid " +
      "JOIN pg_catalog.pg_class tbl ON tbl.oid = ind.indrelid " +
      "JOIN pg_catalog.pg_namespace n ON n.oid = tbl.relnamespace " +
      "WHERE n.nspname = 'public' AND idx.relname = ANY($1::text[])",
      [spec.indexes.map(row => row.name)],
    );
    const constraints = await query(
      "SELECT t.relname AS \"tableName\", con.conname AS name, con.contype::text AS kind, " +
      "con.convalidated AS \"isValidated\", " +
      "con.condeferrable AS \"isDeferrable\", " +
      "pg_catalog.pg_get_constraintdef(con.oid) AS definition " +
      "FROM pg_catalog.pg_constraint con " +
      "JOIN pg_catalog.pg_class t ON t.oid = con.conrelid " +
      "JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace " +
      "WHERE n.nspname = 'public' AND t.relname = ANY($1::text[])",
      [[...spec.tables]],
    );
    const tableSet = new Set(tables.rows.map(row => String(row.name)));
    const colMap = new Map<string, Record<string, unknown>>();
    const indexMap = new Map<string, Record<string, unknown>>();
    for (const row of cols.rows) {
      if (typeof row.name === "string") colMap.set(row.name, row);
    }
    for (const row of indexes.rows) {
      if (typeof row.name === "string") indexMap.set(row.name, row);
    }
    const soundTables = spec.tables.every(table => tableSet.has(table));
    const soundColumns = spec.columns.every(required => {
      const actual = colMap.get(required.name);
      return actual && (required.type === undefined || norm(String(actual.type)) === norm(required.type))
        && (required.notNull === undefined || actual.notNull === required.notNull)
        && (required.defaultTokens === undefined ||
          (typeof actual.columnDefault === "string" &&
            required.defaultTokens.every(token => norm(String(actual.columnDefault)).includes(norm(token)))))
        && (required.defaultTextLiteral === undefined ||
          (typeof actual.columnDefault === "string" &&
            [
              "'" + required.defaultTextLiteral + "'",
              "'" + required.defaultTextLiteral + "'::text",
              "'" + required.defaultTextLiteral + "'::charactervarying",
            ].includes(norm(actual.columnDefault))))
        && (required.defaultNumericZero === undefined ||
          isNumericZeroDefault(actual.columnDefault));
    });
    const soundIndexes = spec.indexes.every(expected => {
      const actual = indexMap.get(expected.name);
      return actual && safeIndex(actual, expected);
    });
    const soundConstraints = spec.constraints.every(expected =>
      constraints.rows.some(row => row.tableName === expected.tableName &&
        row.kind === expected.kind && row.isValidated === true &&
        row.isDeferrable === false && typeof row.definition === "string" &&
        (expected.name === undefined || row.name === expected.name) &&
        (expected.exactCheckDefinition === undefined ||
          checkDefinitionShape(row.definition) === checkDefinitionShape(expected.exactCheckDefinition)) &&
        expected.tokens.every(token => norm(String(row.definition)).includes(norm(token)))),
    );
    if (!soundTables || !soundColumns || !soundIndexes || !soundConstraints) {
      throw new Error("REQUEST_SCHEMA_READONLY_" + spec.label.toUpperCase() + "_INCOMPATIBLE");
    }
  } finally {
    if (began) await query("ROLLBACK");
  }
}

/**
 * Every preflight owns exactly one pooled client. Any catalog/transaction
 * failure discards the client rather than returning a possibly open transaction.
 * No SQL from legacy schema repair paths is executed here.
 */
export async function verifyRequestSchemaReadOnlyFromPool(pool: Pool, spec: RequestSchemaSpec) {
  let client: PoolClient | null = null;
  let verified = false;
  try {
    client = await pool.connect();
    const connected = client;
    await verifyRequestSchemaReadOnly((sql, args) => connected.query(sql, args), spec);
    verified = true;
  } finally {
    client?.release(!verified);
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
    { tableName: "leave_request_interval_sets", kind: "c", tokens: ["status", "current", "superseded"] },
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
    { tableName: "employee_pay_profiles", kind: "u", tokens: ["employee_id"] },
    { tableName: "employee_pay_profiles", kind: "f", tokens: ["employee_id", "referencesemployees(id)", "ondeletecascade"] },
    { tableName: "employee_pay_revisions", kind: "f", tokens: ["employee_id", "referencesemployees(id)", "ondeletecascade"] },
    { tableName: "employee_pay_retro_adjustments", kind: "f", tokens: ["revision_id", "referencesemployee_pay_revisions(id)", "ondeletecascade"] },
    { tableName: "employee_pay_retro_adjustments", kind: "f", tokens: ["source_payroll_run_id", "referencespayroll_runs(id)", "ondeletecascade"] },
  ],
};


/**
 * Employer-scoped payroll certification snapshots must not be created or
 * widened during a request. Existing v1/v2 migrations require DBA proof.
 */
export const payrollMonthCloseSchemaSpec: RequestSchemaSpec = {
  label: "month-close",
  tables: ["payroll_month_closures"],
  columns: [
    { name: "payroll_month_closures.id", type: "integer", notNull: true },
    { name: "payroll_month_closures.organization_id", type: "integer", notNull: true },
    { name: "payroll_month_closures.legal_entity_id", type: "integer", notNull: true },
    { name: "payroll_month_closures.applicable_month", type: "character varying(7)", notNull: true },
    { name: "payroll_month_closures.status", type: "character varying(24)", notNull: true, defaultTextLiteral: "certified" },
    { name: "payroll_month_closures.snapshot_hash", type: "character varying(64)", notNull: true },
    { name: "payroll_month_closures.evidence_snapshot", type: "jsonb", notNull: true },
    { name: "payroll_month_closures.certified_by_name", type: "character varying(120)", notNull: true },
    { name: "payroll_month_closures.certified_at", type: "timestamp with time zone", notNull: true, defaultTokens: ["now()"] },
  ],
  indexes: [
    { name: "payroll_month_closure_snapshot_unique", tableName: "payroll_month_closures",
      keys: ["organization_id", "legal_entity_id", "applicable_month", "snapshot_hash"], unique: true },
    { name: "payroll_month_closure_status_idx", tableName: "payroll_month_closures",
      keys: ["organization_id", "legal_entity_id", "applicable_month", "status"], unique: false },
  ],
  constraints: [
    { tableName: "payroll_month_closures", kind: "p", tokens: ["primarykey(id)"] },
    { tableName: "payroll_month_closures", kind: "f",
      tokens: ["foreignkey(organization_id)", "referencesorganizations(id)", "ondeletecascade"] },
    { tableName: "payroll_month_closures", kind: "f",
      tokens: ["foreignkey(legal_entity_id)", "referenceslegal_entities(id)", "ondeleterestrict"] },
  ],
};

/**
 * DOLE reporting certificates and submission receipts require the same
 * reviewed-schema boundary as monthly payroll certification. They must not be
 * created opportunistically when an employer opens Compliance Center.
 */
export const doleReportingSchemaSpec: RequestSchemaSpec = {
  label: "dole-reporting",
  tables: ["dole_reporting_profiles", "dole_compliance_submissions"],
  columns: [
    { name: "dole_reporting_profiles.organization_id", type: "integer", notNull: true },
    { name: "dole_reporting_profiles.establishment_address", type: "text", notNull: true },
    { name: "dole_reporting_profiles.principal_business", type: "character varying(240)", notNull: true },
    { name: "dole_reporting_profiles.contact_name", type: "character varying(160)", notNull: true },
    { name: "dole_reporting_profiles.contact_position", type: "character varying(160)", notNull: true },
    { name: "dole_reporting_profiles.contact_phone", type: "character varying(48)", notNull: true },
    { name: "dole_compliance_submissions.id", type: "integer", notNull: true },
    { name: "dole_compliance_submissions.organization_id", type: "integer", notNull: true },
    { name: "dole_compliance_submissions.report_type", type: "character varying(48)", notNull: true },
    { name: "dole_compliance_submissions.report_year", type: "integer", notNull: true },
    { name: "dole_compliance_submissions.report_hash", type: "character varying(64)", notNull: true },
    { name: "dole_compliance_submissions.status", type: "character varying(24)", notNull: true, defaultTextLiteral: "submitted" },
    { name: "dole_compliance_submissions.portal_reference", type: "character varying(160)", notNull: true },
    { name: "dole_compliance_submissions.submitted_at", type: "timestamp with time zone", notNull: true },
    { name: "dole_compliance_submissions.recorded_by_name", type: "character varying(120)", notNull: true },
  ],
  indexes: [
    { name: "dole_compliance_submission_snapshot_unique", tableName: "dole_compliance_submissions",
      keys: ["organization_id", "report_type", "report_year", "report_hash"], unique: true },
    { name: "dole_compliance_submission_year_idx", tableName: "dole_compliance_submissions",
      keys: ["organization_id", "report_year", "report_type"], unique: false },
  ],
  constraints: [
    { tableName: "dole_reporting_profiles", kind: "p", tokens: ["primarykey(organization_id)"] },
    { tableName: "dole_reporting_profiles", kind: "f",
      tokens: ["foreignkey(organization_id)", "referencesorganizations(id)", "ondeletecascade"] },
    { tableName: "dole_compliance_submissions", kind: "p", tokens: ["primarykey(id)"] },
    { tableName: "dole_compliance_submissions", kind: "f",
      tokens: ["foreignkey(organization_id)", "referencesorganizations(id)", "ondeletecascade"] },
  ],
};


/**
 * Final-pay/separation integrity: all eighteen columns that the legacy helper
 * previously added during requests must already exist with correct types.
 * The reviewer separation rule and actor FK semantics are release-critical.
 */
export const separationSchemaSpec: RequestSchemaSpec = {
  label: "separation",
  tables: ["separation_records"],
  columns: [
    { name: "separation_records.organization_id", type: "integer", notNull: true },
    { name: "separation_records.employee_id", type: "integer", notNull: true },
    { name: "separation_records.thirteenth_entitlement", type: "numeric(12,2)", notNull: true, defaultNumericZero: true },
    { name: "separation_records.thirteenth_paid_ytd", type: "numeric(12,2)", notNull: true, defaultNumericZero: true },
    { name: "separation_records.basic_salary_earned_ytd", type: "numeric(14,2)", notNull: true, defaultNumericZero: true },
    { name: "separation_records.historical_basic_salary_earned", type: "numeric(14,2)", notNull: true, defaultNumericZero: true },
    { name: "separation_records.unpaid_basic_salary", type: "numeric(12,2)", notNull: true, defaultNumericZero: true },
    { name: "separation_records.separation_pay", type: "numeric(12,2)", notNull: true, defaultNumericZero: true },
    { name: "separation_records.retirement_pay", type: "numeric(12,2)", notNull: true, defaultNumericZero: true },
    { name: "separation_records.other_benefits", type: "numeric(12,2)", notNull: true, defaultNumericZero: true },
    { name: "separation_records.final_statutory_deductions", type: "numeric(12,2)", notNull: true, defaultNumericZero: true },
    { name: "separation_records.gross_final_pay", type: "numeric(12,2)", notNull: true, defaultNumericZero: true },
    { name: "separation_records.final_pay_due_date", type: "date", notNull: false },
    { name: "separation_records.computation_snapshot", type: "jsonb", notNull: true, defaultTokens: ["{}", "jsonb"] },
    { name: "separation_records.approved_at", type: "timestamp with time zone", notNull: false },
    { name: "separation_records.released_at", type: "timestamp with time zone", notNull: false },
    { name: "separation_records.release_reference", type: "character varying(160)", notNull: false },
    { name: "separation_records.prepared_by_user_id", type: "integer", notNull: false },
    { name: "separation_records.approved_by_user_id", type: "integer", notNull: false },
    { name: "separation_records.released_by_user_id", type: "integer", notNull: false },
  ],
  indexes: [
    { name: "separation_records_org_status_idx",
      tableName: "separation_records",
      keys: ["organization_id", "status", "id"], unique: false },
  ],
  constraints: [
    { tableName: "separation_records", kind: "p", tokens: ["primarykey(id)"] },
    { tableName: "separation_records", kind: "f",
      tokens: ["foreignkey(organization_id)", "referencesorganizations(id)", "ondeletecascade"] },
    { tableName: "separation_records", kind: "f",
      tokens: ["foreignkey(employee_id)", "referencesemployees(id)", "ondeletecascade"] },
    { tableName: "separation_records", kind: "f",
      tokens: ["foreignkey(prepared_by_user_id)", "referencesusers(id)", "ondeletesetnull"] },
    { tableName: "separation_records", kind: "f",
      tokens: ["foreignkey(approved_by_user_id)", "referencesusers(id)", "ondeletesetnull"] },
    { tableName: "separation_records", kind: "f",
      tokens: ["foreignkey(released_by_user_id)", "referencesusers(id)", "ondeletesetnull"] },
    { tableName: "separation_records", kind: "c",
      name: "separation_review_identity_separation_check",
      exactCheckDefinition:
        "CHECK (prepared_by_user_id IS NULL OR approved_by_user_id IS NULL OR prepared_by_user_id <> approved_by_user_id)",
      tokens: ["prepared_by_user_id", "approved_by_user_id", "<>"] },
  ],
};


/** These add-on specifications prevent request-time DDL in independently
 * approved read-only mode. They are structural checks, not migration receipts. */
export const marketingLeadSchemaSpec: RequestSchemaSpec = {
  label: "marketing",
  tables: ["marketing_leads"],
  columns: [
    { name: "marketing_leads.id", type: "integer", notNull: true },
    { name: "marketing_leads.kind", type: "character varying(32)", notNull: true },
    { name: "marketing_leads.name", type: "character varying(120)", notNull: true },
    { name: "marketing_leads.email", type: "character varying(180)", notNull: true },
    { name: "marketing_leads.company", type: "character varying(160)", notNull: true },
    { name: "marketing_leads.source_path", type: "character varying(120)", notNull: true },
    { name: "marketing_leads.attribution", type: "jsonb", notNull: true, defaultTokens: ["{}", "jsonb"] },
    { name: "marketing_leads.status", type: "character varying(24)", notNull: true, defaultTextLiteral: "new" },
    { name: "marketing_leads.notification_status", type: "character varying(24)", notNull: true, defaultTextLiteral: "not-configured" },
    { name: "marketing_leads.notification_attempts", type: "integer", notNull: true, defaultNumericZero: true },
    { name: "marketing_leads.notification_outbox_id", type: "integer" },
  ],
  indexes: [
    { name: "marketing_leads_status_created_idx", tableName: "marketing_leads", keys: ["status", "created_at"], unique: false, definitionTokens: ["(status, created_at DESC)"] },
    { name: "marketing_leads_kind_created_idx", tableName: "marketing_leads", keys: ["kind", "created_at"], unique: false, definitionTokens: ["(kind, created_at DESC)"] },
  ],
  constraints: [
    { tableName: "marketing_leads", kind: "p", tokens: ["primarykey(id)"] },
    { tableName: "marketing_leads", kind: "c", name: "marketing_leads_kind_check",
      tokens: ["kind", "demo", "trial-access", "payroll-outsourcing"] },
    { tableName: "marketing_leads", kind: "c", name: "marketing_leads_status_check",
      tokens: ["status", "new", "contacted", "qualified", "closed"] },
    { tableName: "marketing_leads", kind: "c", name: "marketing_leads_notification_status_check",
      tokens: ["notification_status", "not-configured", "queued", "sent", "failed"] },
  ],
};

/** Explicit read-only callers keep main's index contract with the rollout off.
 * Canonical numbered-SQL ordering is adopted only with the reviewed cutover.
 * Clone the two static tokens; never mutate the shared canonical specification.
 */
export function marketingLeadSchemaForRuntime(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RequestSchemaSpec {
  if (criticalReleaseFlagEnabled("requestSchemaReadonly", env)) return marketingLeadSchemaSpec;
  return {
    ...marketingLeadSchemaSpec,
    indexes: marketingLeadSchemaSpec.indexes.map(index => ({
      ...index,
      definitionTokens: index.definitionTokens?.map(token => token.replace(" DESC)", " DESC NULLS LAST)")),
    })),
  };
}

export const workforceAttendanceSchemaSpec: RequestSchemaSpec = {
  label: "workforce-attendance",
  tables: ["workforce_attendance_lock_policies", "workforce_attendance_period_locks"],
  columns: [
    { name: "workforce_attendance_lock_policies.organization_id", type: "integer", notNull: true },
    { name: "workforce_attendance_lock_policies.require_payroll_cutoff_lock", type: "boolean", notNull: true, defaultTokens: ["false"] },
    { name: "workforce_attendance_period_locks.id", type: "integer", notNull: true },
    { name: "workforce_attendance_period_locks.organization_id", type: "integer", notNull: true },
    { name: "workforce_attendance_period_locks.period_start", type: "date", notNull: true },
    { name: "workforce_attendance_period_locks.period_end", type: "date", notNull: true },
    { name: "workforce_attendance_period_locks.lock_type", type: "character varying(24)", notNull: true, defaultTextLiteral: "attendance" },
    { name: "workforce_attendance_period_locks.status", type: "character varying(16)", notNull: true, defaultTextLiteral: "locked" },
    { name: "workforce_attendance_period_locks.reason", type: "character varying(240)", notNull: true },
    { name: "workforce_attendance_period_locks.locked_by", type: "character varying(120)", notNull: true },
  ],
  indexes: [
    { name: "workforce_attendance_period_locks_period_unique", tableName: "workforce_attendance_period_locks",
      keys: ["organization_id", "period_start", "period_end", "lock_type"], unique: true },
    { name: "workforce_attendance_period_locks_active_idx", tableName: "workforce_attendance_period_locks",
      keys: ["organization_id", "status", "period_start", "period_end"], unique: false },
  ],
  constraints: [
    { tableName: "workforce_attendance_lock_policies", kind: "p", tokens: ["primarykey(organization_id)"] },
    { tableName: "workforce_attendance_lock_policies", kind: "f", tokens: ["organization_id", "referencesorganizations(id)", "ondeletecascade"] },
    { tableName: "workforce_attendance_period_locks", kind: "p", tokens: ["primarykey(id)"] },
    { tableName: "workforce_attendance_period_locks", kind: "f", tokens: ["organization_id", "referencesorganizations(id)", "ondeletecascade"] },
    { tableName: "workforce_attendance_period_locks", kind: "c", name: "workforce_attendance_period_locks_date_check", tokens: ["period_end", ">=", "period_start"] },
    { tableName: "workforce_attendance_period_locks", kind: "c", name: "workforce_attendance_period_locks_type_check", tokens: ["lock_type", "attendance", "payroll_cutoff"] },
    { tableName: "workforce_attendance_period_locks", kind: "c", name: "workforce_attendance_period_locks_status_check", tokens: ["status", "locked", "unlocked"] },
  ],
};

export const migrationSchemaSpec: RequestSchemaSpec = {
  label: "migration",
  tables: ["import_batches", "historical_payroll_entries"],
  columns: [
    { name: "import_batches.source_system", type: "character varying(64)", notNull: true, defaultTextLiteral: "generic" },
    { name: "import_batches.import_kind", type: "character varying(40)", notNull: true, defaultTextLiteral: "employees" },
    { name: "historical_payroll_entries.id", type: "integer", notNull: true },
    { name: "historical_payroll_entries.organization_id", type: "integer", notNull: true },
    { name: "historical_payroll_entries.employee_id", type: "integer", notNull: true },
    { name: "historical_payroll_entries.import_batch_id", type: "integer", notNull: false },
    { name: "historical_payroll_entries.source_system", type: "character varying(64)", notNull: true, defaultTextLiteral: "generic" },
    { name: "historical_payroll_entries.source_reference", type: "character varying(180)", notNull: true },
    { name: "historical_payroll_entries.pay_date", type: "date", notNull: true },
    { name: "historical_payroll_entries.gross_pay", type: "numeric(14,2)", notNull: true },
    { name: "historical_payroll_entries.basic_salary", type: "numeric(14,2)", notNull: false },
    { name: "historical_payroll_entries.net_pay", type: "numeric(14,2)", notNull: true },
    { name: "historical_payroll_entries.thirteenth_month", type: "numeric(14,2)", notNull: true, defaultNumericZero: true },
  ],
  indexes: [
    { name: "historical_payroll_source_unique", tableName: "historical_payroll_entries",
      keys: ["organization_id", "employee_id", "source_system", "source_reference"], unique: true },
  ],
  constraints: [
    { tableName: "historical_payroll_entries", kind: "p", tokens: ["primarykey(id)"] },
    { tableName: "historical_payroll_entries", kind: "f", tokens: ["organization_id", "referencesorganizations(id)", "ondeletecascade"] },
    { tableName: "historical_payroll_entries", kind: "f", tokens: ["employee_id", "referencesemployees(id)", "ondeletecascade"] },
    { tableName: "historical_payroll_entries", kind: "f", tokens: ["import_batch_id", "referencesimport_batches(id)", "ondeletesetnull"] },
  ],
};

export const outboxDeliverySchemaSpec: RequestSchemaSpec = {
  label: "outbox",
  tables: ["outbox"],
  columns: [
    { name: "outbox.organization_id", type: "integer" },
    { name: "outbox.dedupe_key", type: "character varying(200)", notNull: false },
    { name: "outbox.provider_message_id", type: "character varying(200)", notNull: false },
    { name: "outbox.delivery_status", type: "character varying(32)", notNull: false },
    { name: "outbox.delivery_detail", type: "text", notNull: false },
    { name: "outbox.delivery_updated_at", type: "timestamp with time zone", notNull: false },
    { name: "outbox.metadata", type: "jsonb", notNull: true, defaultTokens: ["{}", "jsonb"] },
    { name: "outbox.attempts", type: "integer", notNull: true, defaultNumericZero: true },
    { name: "outbox.max_attempts", type: "integer", notNull: true, defaultTokens: ["4"] },
    { name: "outbox.last_attempt_at", type: "timestamp with time zone", notNull: false },
    { name: "outbox.next_attempt_at", type: "timestamp with time zone", notNull: false },
  ],
  indexes: [
    { name: "outbox_dedupe_key_unique", tableName: "outbox", keys: ["dedupe_key"], unique: true, predicateTokens: ["dedupe_key", "IS NOT NULL"] },
    { name: "outbox_org_created_idx", tableName: "outbox", keys: ["organization_id", "created_at"], unique: false },
    { name: "outbox_retry_idx", tableName: "outbox", keys: ["status", "next_attempt_at"], unique: false },
  ],
  constraints: [],
};

export const statutoryCorrectionSchemaSpec: RequestSchemaSpec = {
  label: "remittance-correction",
  tables: ["statutory_remittance_correction_requests"],
  columns: [
    { name: "statutory_remittance_correction_requests.id", type: "integer", notNull: true },
    { name: "statutory_remittance_correction_requests.organization_id", type: "integer", notNull: true },
    { name: "statutory_remittance_correction_requests.target_type", type: "character varying(32)", notNull: true },
    { name: "statutory_remittance_correction_requests.batch_id", type: "integer", notNull: true },
    { name: "statutory_remittance_correction_requests.member_id", type: "integer", notNull: false },
    { name: "statutory_remittance_correction_requests.original_snapshot", type: "jsonb", notNull: true },
    { name: "statutory_remittance_correction_requests.proposed_snapshot", type: "jsonb", notNull: true },
    { name: "statutory_remittance_correction_requests.status", type: "character varying(24)", notNull: true, defaultTextLiteral: "pending" },
    { name: "statutory_remittance_correction_requests.requested_by_user_id", type: "integer", notNull: false },
    { name: "statutory_remittance_correction_requests.decided_by_user_id", type: "integer", notNull: false },
  ],
  indexes: [
    { name: "statutory_remittance_corrections_status_idx", tableName: "statutory_remittance_correction_requests",
      keys: ["organization_id", "status", "created_at"], unique: false },
    { name: "statutory_remittance_corrections_batch_idx", tableName: "statutory_remittance_correction_requests",
      keys: ["organization_id", "batch_id"], unique: false },
    { name: "statutory_remittance_corrections_member_idx", tableName: "statutory_remittance_correction_requests",
      keys: ["organization_id", "member_id"], unique: false },
  ],
  constraints: [
    { tableName: "statutory_remittance_correction_requests", kind: "p", tokens: ["primarykey(id)"] },
    { tableName: "statutory_remittance_correction_requests", kind: "f", tokens: ["organization_id", "referencesorganizations(id)", "ondeletecascade"] },
    { tableName: "statutory_remittance_correction_requests", kind: "f", tokens: ["batch_id", "referencesstatutory_remittance_batches(id)", "ondeletecascade"] },
    { tableName: "statutory_remittance_correction_requests", kind: "f", tokens: ["member_id", "referencesstatutory_remittance_members(id)", "ondeletecascade"] },
    { tableName: "statutory_remittance_correction_requests", kind: "f", tokens: ["requested_by_user_id", "referencesusers(id)", "ondeletesetnull"] },
    { tableName: "statutory_remittance_correction_requests", kind: "f", tokens: ["decided_by_user_id", "referencesusers(id)", "ondeletesetnull"] },
  ],
};

export const statutoryMonthCloseSchemaSpec: RequestSchemaSpec = {
  label: "remittance-month-close",
  tables: ["statutory_remittance_month_closures"],
  columns: [
    { name: "statutory_remittance_month_closures.id", type: "integer", notNull: true },
    { name: "statutory_remittance_month_closures.organization_id", type: "integer", notNull: true },
    { name: "statutory_remittance_month_closures.legal_entity_id", type: "integer", notNull: true },
    { name: "statutory_remittance_month_closures.applicable_month", type: "character varying(7)", notNull: true },
    { name: "statutory_remittance_month_closures.status", type: "character varying(24)", notNull: true, defaultTextLiteral: "certified" },
    { name: "statutory_remittance_month_closures.snapshot_hash", type: "character varying(64)", notNull: true },
    { name: "statutory_remittance_month_closures.certified_by_user_id", type: "integer", notNull: false },
    { name: "statutory_remittance_month_closures.certified_by_name", type: "character varying(120)", notNull: true },
    { name: "statutory_remittance_month_closures.invalidated_at", type: "timestamp with time zone", notNull: false },
    { name: "statutory_remittance_month_closures.invalidation_reason", type: "character varying(280)", notNull: false },
  ],
  indexes: [
    { name: "statutory_remittance_month_closure_snapshot_unique", tableName: "statutory_remittance_month_closures",
      keys: ["organization_id", "legal_entity_id", "applicable_month", "snapshot_hash"], unique: true },
    { name: "statutory_remittance_month_closure_status_idx", tableName: "statutory_remittance_month_closures",
      keys: ["organization_id", "legal_entity_id", "status"], unique: false },
  ],
  constraints: [
    { tableName: "statutory_remittance_month_closures", kind: "p", tokens: ["primarykey(id)"] },
    { tableName: "statutory_remittance_month_closures", kind: "f", tokens: ["organization_id", "referencesorganizations(id)", "ondeletecascade"] },
    { tableName: "statutory_remittance_month_closures", kind: "f", tokens: ["legal_entity_id", "referenceslegal_entities(id)", "ondeleterestrict"] },
  ],
};
