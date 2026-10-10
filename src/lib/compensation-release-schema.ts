import type { PoolClient } from "pg";

export type SchemaColumn = {
  column_name: string;
  data_type: string;
  is_nullable: "YES" | "NO";
  character_maximum_length: number | null;
  column_default: string | null;
};

export type SchemaConstraint = {
  contype: string;
  name: string;
  definition: string;
};

export type SchemaIndex = {
  indexname: string;
  indexdef: string;
};

export type CompensationOutboxSchemaSnapshot = {
  columns: SchemaColumn[];
  constraints: SchemaConstraint[];
  indexes: SchemaIndex[];
};

const expectedColumns: Record<string, {
  type: string;
  nullable: boolean;
  maxLength?: number;
}> = {
  id: { type: "integer", nullable: false },
  organization_id: { type: "integer", nullable: false },
  employee_id: { type: "integer", nullable: false },
  compensation_event_id: { type: "integer", nullable: false },
  trigger: { type: "character varying", nullable: false, maxLength: 64 },
  event_key: { type: "character varying", nullable: false, maxLength: 240 },
  context: { type: "jsonb", nullable: false },
  status: { type: "character varying", nullable: false, maxLength: 24 },
  attempts: { type: "integer", nullable: false },
  next_attempt_at: { type: "timestamp with time zone", nullable: false },
  lease_until: { type: "timestamp with time zone", nullable: true },
  last_error: { type: "text", nullable: true },
  dispatched_at: { type: "timestamp with time zone", nullable: true },
  created_at: { type: "timestamp with time zone", nullable: false },
  updated_at: { type: "timestamp with time zone", nullable: false },
};

const requiredForeignKeys = [
  ["organization_id", "organizations"],
  ["employee_id", "employees"],
  ["compensation_event_id", "compensation_events"],
] as const;

const requiredIndexes = [
  ["comp_automation_intent_key_unique", "organization_id, trigger, event_key", true],
  ["comp_automation_intent_retry_idx", "status, next_attempt_at", false],
  ["comp_automation_intent_source_idx", "organization_id, compensation_event_id", false],
] as const;

const requiredStates = ["pending", "retry", "leased", "dispatched", "needs_review"] as const;

function normalizedSql(source: string) {
  return source.toLowerCase().replaceAll('"', "").replace(/\bpublic\./g, "")
    .replace(/\s+/g, " ").trim();
}

/**
 * Pure, testable shape validator. Do not assume that CREATE TABLE IF NOT EXISTS
 * or a successful db:push proves the actual deployed schema is compatible.
 * Fail closed for missing columns, constraints, defaults, foreign keys and
 * idempotency/retry indexes. No worker may rely on schema compatibility alone
 * as evidence of employer payroll GA acceptance.
 */
export function validateCompensationOutboxSchema(snapshot: CompensationOutboxSchemaSnapshot) {
  const issues: string[] = [];
  if (snapshot.columns.length === 0) {
    return { schemaCompatible: false, issues: ["outbox_table_missing"], readOnly: true as const };
  }

  const columns = new Map(snapshot.columns.map((row) => [row.column_name, row]));
  for (const [name, expected] of Object.entries(expectedColumns)) {
    const actual = columns.get(name);
    if (!actual) {
      issues.push(`column_missing:${name}`);
      continue;
    }
    if (actual.data_type !== expected.type) issues.push(`column_type_mismatch:${name}`);
    if ((actual.is_nullable === "YES") !== expected.nullable) issues.push(`column_nullability_mismatch:${name}`);
    if (expected.maxLength !== undefined && actual.character_maximum_length !== expected.maxLength) {
      issues.push(`column_length_mismatch:${name}`);
    }
  }

  const defaults = [
    ["id", "nextval("],
    ["status", "'pending'"],
    ["attempts", "0"],
    ["next_attempt_at", "now()"],
    ["created_at", "now()"],
    ["updated_at", "now()"],
  ] as const;
  for (const [name, fragment] of defaults) {
    const value = columns.get(name)?.column_default?.toLowerCase() ?? "";
    if (!value.includes(fragment)) issues.push(`column_default_mismatch:${name}`);
  }

  const constraints = snapshot.constraints.map((row) => ({
    ...row,
    definition: normalizedSql(row.definition),
  }));
  if (!constraints.some((row) => row.contype === "p" && row.definition.includes("primary key (id)"))) {
    issues.push("primary_key_missing");
  }

  for (const [column, references] of requiredForeignKeys) {
    const fragment = `foreign key (${column}) references ${references}(id)`;
    if (!constraints.some((row) => row.contype === "f"
      && row.definition.includes(fragment)
      && row.definition.includes("on delete cascade"))) {
      issues.push(`foreign_key_missing_or_unsafe:${column}`);
    }
  }
  const statusCheck = constraints.find((row) =>
    row.contype === "c" && row.name === "comp_automation_intent_status_check");
  if (!statusCheck || !requiredStates.every((state) => statusCheck.definition.includes(`'${state}'`))) {
    issues.push("status_check_missing_or_incomplete");
  }

  const indexes = new Map(snapshot.indexes.map((row) =>
    [row.indexname, normalizedSql(row.indexdef)]));
  for (const [indexName, keyColumns, mustBeUnique] of requiredIndexes) {
    const definition = indexes.get(indexName) ?? "";
    if (!definition.includes(`(${keyColumns})`)
      || (mustBeUnique && !definition.includes("create unique index"))
      || (!mustBeUnique && !definition.includes("create index"))) {
      issues.push(`index_missing_or_unsafe:${indexName}`);
    }
  }

  return { schemaCompatible: issues.length === 0, issues, readOnly: true as const };
}

/**
 * Catalog-only inspection. Caller owns a read-only database transaction and
 * supplies an explicitly selected schema (normally public). No employer data,
 * SQL payloads, credentials, or worker configuration are returned.
 */
export async function inspectCompensationOutboxSchema(
  client: Pick<PoolClient, "query">,
  schema = "public",
): Promise<CompensationOutboxSchemaSnapshot> {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) {
    throw new Error("Invalid target PostgreSQL schema.");
  }
  const [columns, constraints, indexes] = await Promise.all([
    client.query<SchemaColumn>(`
      SELECT column_name, data_type, is_nullable, character_maximum_length, column_default
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'compensation_automation_intents'
      ORDER BY ordinal_position
    `, [schema]),
    client.query<SchemaConstraint>(`
      SELECT c.contype::text AS contype, c.conname AS name,
        pg_get_constraintdef(c.oid) AS definition
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
      JOIN pg_catalog.pg_namespace ns ON ns.oid = t.relnamespace
      WHERE ns.nspname = $1 AND t.relname = 'compensation_automation_intents'
      ORDER BY c.conname
    `, [schema]),
    client.query<SchemaIndex>(`
      SELECT indexname, indexdef FROM pg_catalog.pg_indexes
      WHERE schemaname = $1 AND tablename = 'compensation_automation_intents'
      ORDER BY indexname
    `, [schema]),
  ]);

  return { columns: columns.rows, constraints: constraints.rows, indexes: indexes.rows };
}
