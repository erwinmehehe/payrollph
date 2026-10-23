import { outboxDeliverySchemaSpec, verifyRequestSchemaReadOnlyFromPool } from "@/lib/request-schema-readonly";
import { pool } from "@/db";

/**
 * Outbox delivery never changes schema at request time. The schema comes only
 * from reviewed numbered migrations; this checks the catalog on every call and
 * fails closed if it is missing.
 */
export async function ensureOutboxDeliverySchema() {
  await verifyRequestSchemaReadOnlyFromPool(pool, outboxDeliverySchemaSpec);
}
