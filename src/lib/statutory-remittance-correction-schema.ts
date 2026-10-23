import { statutoryCorrectionSchemaSpec, verifyRequestSchemaReadOnlyFromPool } from "@/lib/request-schema-readonly";
import { pool } from "@/db";

/**
 * Remittance corrections never change schema at request time. The schema comes
 * only from reviewed numbered migrations; this checks the catalog on every call
 * and fails closed if it is missing.
 */
export async function ensureStatutoryRemittanceCorrectionSchema() {
  await verifyRequestSchemaReadOnlyFromPool(pool, statutoryCorrectionSchemaSpec);
}
