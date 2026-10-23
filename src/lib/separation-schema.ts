import { pool } from "@/db";
import { cachedRequestSchemaVerifier, separationSchemaSpec } from "@/lib/request-schema-readonly";

/**
 * Final-pay records never create or alter schema at request time. The schema
 * comes only from reviewed numbered migrations; this checks the catalog and
 * fails closed if it is missing.
 */
export const ensureSeparationSchema = cachedRequestSchemaVerifier(pool, separationSchemaSpec);
