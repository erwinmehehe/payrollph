import { statutoryMonthCloseSchemaSpec, verifyRequestSchemaReadOnlyFromPool } from "@/lib/request-schema-readonly";
import { ensureStatutoryRemittanceCorrectionSchema } from "@/lib/statutory-remittance-correction-schema";
import { pool } from "@/db";

/**
 * Remittance month close never changes schema at request time. It depends on
 * the correction tables, so both catalogs are checked on every call; either
 * missing fails closed.
 */
export async function ensureStatutoryRemittanceMonthCloseSchema() {
  await ensureStatutoryRemittanceCorrectionSchema();
  await verifyRequestSchemaReadOnlyFromPool(pool, statutoryMonthCloseSchemaSpec);
}
