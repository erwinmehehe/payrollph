import { pool } from "@/db";
import { cachedRequestSchemaVerifier, doleReportingSchemaSpec } from "@/lib/request-schema-readonly";

/**
 * Opening a compliance dashboard never creates tables, rewrites indexes or
 * backfills evidence. The schema comes only from reviewed numbered migrations;
 * this checks the catalog and fails closed if it is missing.
 */
export const ensureDoleReportingSchema = cachedRequestSchemaVerifier(pool, doleReportingSchemaSpec);
