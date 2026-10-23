import { migrationSchemaSpec, verifyRequestSchemaReadOnlyFromPool } from "@/lib/request-schema-readonly";
import { pool } from "@/db";

/**
 * Migration Center never changes schema at request time. The schema comes only
 * from reviewed numbered migrations; this checks the catalog on every call and
 * fails closed if it is missing.
 */
export async function ensureMigrationSchema() {
  await verifyRequestSchemaReadOnlyFromPool(pool, migrationSchemaSpec);
}
