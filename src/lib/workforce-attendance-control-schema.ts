import { workforceAttendanceSchemaSpec, verifyRequestSchemaReadOnlyFromPool } from "@/lib/request-schema-readonly";
import { pool } from "@/db";

/**
 * Attendance locks never change schema at request time. The schema comes only
 * from reviewed numbered migrations; this checks the catalog on every call and
 * fails closed if it is missing.
 */
export async function ensureWorkforceAttendanceControlSchema() {
  await verifyRequestSchemaReadOnlyFromPool(pool, workforceAttendanceSchemaSpec);
}
