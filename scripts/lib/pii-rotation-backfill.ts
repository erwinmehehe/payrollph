import type { QueryResult, QueryResultRow } from "pg";
import {
  planGovernmentIdRewrap, planProfilePhotoRewrap, requireDedicatedPiiKey,
  type PiiRewrapDecision,
} from "./pii-rotation-policy";

/**
 * S-2 operator migration engine. All identifiers are a source-controlled fixed
 * allowlist. Tenant ID, cursor, values, and CAS originals are SQL parameters.
 * Neither importing this module nor dry-running it changes stored rows.
 */
const PAGE_SIZE = 100;
export const PII_ROTATION_STORES = [
  { label: "employee government IDs", table: "employees", id: "id",
    fields: ["tin", "tin_branch_code", "sss_no", "philhealth_no", "pagibig_no"] },
  { label: "contractor government IDs", table: "contractors", id: "id",
    fields: ["tin"] },
  { label: "ESS identifier requests", table: "ess_identifier_requests", id: "id",
    fields: ["proposed_encrypted"] },
  { label: "ESS optional identifiers", table: "ess_other_identifiers", id: "id",
    fields: ["encrypted_value"] },
  { label: "ESS encrypted photos", table: "ess_employee_photos", id: "employee_id",
    fields: ["sealed_photo"] },
] as const;

export function validatePiiRotationOperator(
  env: NodeJS.ProcessEnv,
  apply: boolean,
): { organizationId: number; expectedDatabase: string } {
  requireDedicatedPiiKey(env);
  const organizationId = Number(env.PII_ROTATION_ORGANIZATION_ID);
  const expectedDatabase = env.EXPECTED_PRODUCTION_DATABASE_NAME;
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    throw new Error("PII_ROTATION_ORGANIZATION_ID must name one approved tenant.");
  }
  if (!expectedDatabase || !/^[A-Za-z0-9_]{1,63}$/.test(expectedDatabase)) {
    throw new Error("EXPECTED_PRODUCTION_DATABASE_NAME must be DBA-verified.");
  }
  if (apply && (
    env.PII_ROTATION_CONFIRMATION !== "APPLY_APPROVED_PII_ROTATION" ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{7,120}$/.test(env.PII_ROTATION_APPROVAL_REF ?? "")
  )) {
    throw new Error("Apply requires an approval reference and explicit confirmation.");
  }
  return { organizationId, expectedDatabase };
}

type Store = typeof PII_ROTATION_STORES[number];
type Row = QueryResultRow & { [key: string]: unknown };
export type PiiRotationDatabase = {
  query<T extends QueryResultRow = QueryResultRow>(
    statement: string, params?: unknown[],
  ): Promise<QueryResult<T>>;
};
export type PiiRotationSummary = {
  store: string;
  scanned: number;
  alreadyCurrent: number;
  rewrapped: number;
  empty: number;
  conflicts: number;
};

export async function scanPiiRotationStore(
  database: PiiRotationDatabase,
  store: Store,
  organizationId: number,
  env: NodeJS.ProcessEnv,
  apply: boolean,
): Promise<PiiRotationSummary> {
  requireDedicatedPiiKey(env);
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    throw new Error("PII rewrap must be restricted to one approved tenant.");
  }
  let cursor = 0;
  const summary: PiiRotationSummary = {
    store: store.label, scanned: 0, alreadyCurrent: 0, rewrapped: 0,
    empty: 0, conflicts: 0,
  };
  for (;;) {
    const isPhoto = store.table === "ess_employee_photos";
    const columns: string[] = [store.id, ...store.fields,
      ...(isPhoto ? ["byte_size", "content_sha256"] : [])];
    const page = await database.query<Row>(
      `SELECT ${columns.map(column => '"' + column + '"').join(", ")} FROM "${store.table}"
       WHERE organization_id = $1 AND "${store.id}" > $2
       ORDER BY "${store.id}" ASC LIMIT $3`,
      [organizationId, cursor, PAGE_SIZE],
    );
    if (page.rows.length > PAGE_SIZE) throw new Error("PII rotation page exceeded limit.");
    for (const row of page.rows) {
      const id = row[store.id];
      if (!Number.isSafeInteger(id) || typeof id !== "number" || id <= cursor) {
        throw new Error("PII rotation cursor must advance monotonically.");
      }
      cursor = id;
      summary.scanned++;
      for (const column of store.fields) {
        const original = row[column];
        const photoMeta = {
          byteSize: Number(row.byte_size),
          contentSha256: String(row.content_sha256),
        };
        const decision: PiiRewrapDecision = isPhoto
          ? planProfilePhotoRewrap(original, photoMeta, env)
          : planGovernmentIdRewrap(original, env);
        if (decision.status === "empty") {
          summary.empty++;
          continue;
        }
        if (decision.status === "already-current") {
          summary.alreadyCurrent++;
          continue;
        }
        if (decision.status !== "rewrap") throw new Error("Unknown PII rewrap decision.");
        summary.rewrapped++;
        if (!apply) continue;

        const changed = await database.query(
          `UPDATE "${store.table}" SET "${column}" = $1
           WHERE organization_id = $2 AND "${store.id}" = $3 AND "${column}" = $4
           ${isPhoto ? 'AND "byte_size" = $5 AND "content_sha256" = $6' : ""}
           RETURNING "${store.id}"`,
          isPhoto
            ? [decision.replacement, organizationId, id, original,
              photoMeta.byteSize, photoMeta.contentSha256]
            : [decision.replacement, organizationId, id, original],
        );
        if (changed.rowCount !== 1) {
          summary.conflicts++;
          throw new Error("Stored PII changed during rewrap; stop and repeat dry-run.");
        }
      }
    }
    if (page.rows.length < PAGE_SIZE) break;
  }
  return summary;
}

export async function scanAllPiiRotationStores(
  database: PiiRotationDatabase,
  organizationId: number,
  env: NodeJS.ProcessEnv,
  apply: boolean,
  report: (summary: PiiRotationSummary) => void = () => {},
) {
  requireDedicatedPiiKey(env);
  const summaries: PiiRotationSummary[] = [];
  for (const store of PII_ROTATION_STORES) {
    const summary = await scanPiiRotationStore(database, store, organizationId, env, apply);
    summaries.push(summary);
    report(summary);
  }
  return summaries;
}
