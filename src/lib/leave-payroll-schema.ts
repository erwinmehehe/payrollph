import { pool } from "@/db";
import { cachedRequestSchemaVerifier, leaveSchemaSpec } from "@/lib/request-schema-readonly";

/**
 * Leave payroll never creates tables or "repairs" historical leave evidence at
 * request time. The schema comes only from reviewed numbered migrations; this
 * checks the catalog and fails closed if it is missing.
 */
export const ensureLeavePayrollSchema = cachedRequestSchemaVerifier(pool, leaveSchemaSpec);
