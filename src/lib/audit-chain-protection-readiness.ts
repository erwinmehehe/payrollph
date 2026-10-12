import { sql } from "drizzle-orm";
import { db } from "@/db";

// #908: a hash-chain source file or passing synthetic test is NOT evidence
// that protection actually exists under the deployed database session.
// This metadata-only probe does not read private audit or payroll rows.
export const AUDIT_CHAIN_PROOF_KEYS = [
  "auditTablePresent",
  "chainHeadsPresent",
  "protectFunctionPresent",
  "sealerFunctionPresent",
  "hashFunctionPresent",
  "protectionTriggerEnabled",
  "runtimeNotElevated",
  "runtimeNotObjectOwner",
  "runtimeAuditMutationDenied",
  "runtimeHeadMutationDenied",
  "runtimeNoDdlPrivileges",
] as const;

export function auditChainProtectionProven(row: unknown): boolean {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  const proof = row as Record<string, unknown>;
  // Strict true, never truthy strings, partial responses or false nulls.
  return AUDIT_CHAIN_PROOF_KEYS.every((key) => proof[key] === true);
}

export async function auditChainRuntimeProtectionReady(): Promise<boolean> {
  try {
    const result = await db.execute(sql`
      SELECT
        (to_regclass('public.audit_events') IS NOT NULL) AS "auditTablePresent",
        (to_regclass('public.audit_chain_heads') IS NOT NULL) AS "chainHeadsPresent",
        (to_regprocedure('public.audit_events_protect()') IS NOT NULL) AS "protectFunctionPresent",
        (to_regprocedure('public.seal_audit_events(integer)') IS NOT NULL) AS "sealerFunctionPresent",
        (to_regprocedure('public.audit_event_row_hash(text,bigint,integer,integer,text,text,text,jsonb,timestamptz)') IS NOT NULL)
          AS "hashFunctionPresent",
        EXISTS (
          SELECT 1 FROM pg_catalog.pg_trigger t
          WHERE t.tgrelid = to_regclass('public.audit_events')
            AND t.tgname = 'audit_events_protect_mutation'
            AND t.tgenabled = 'O'
            AND NOT t.tgisinternal
        ) AS "protectionTriggerEnabled",
        NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = current_user
            AND (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)
        ) AS "runtimeNotElevated",
        NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_class c
          WHERE c.oid IN (to_regclass('public.audit_events'), to_regclass('public.audit_chain_heads'))
            AND pg_catalog.pg_get_userbyid(c.relowner) = current_user
        ) AND NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_proc p
          WHERE p.oid IN (
            to_regprocedure('public.audit_events_protect()'),
            to_regprocedure('public.seal_audit_events(integer)')
          )
            AND pg_catalog.pg_get_userbyid(p.proowner) = current_user
        ) AS "runtimeNotObjectOwner",
        CASE WHEN to_regclass('public.audit_events') IS NULL THEN false
          ELSE NOT (
            pg_catalog.has_table_privilege(current_user, 'public.audit_events', 'UPDATE')
            OR pg_catalog.has_table_privilege(current_user, 'public.audit_events', 'DELETE')
            OR pg_catalog.has_table_privilege(current_user, 'public.audit_events', 'TRUNCATE')
          ) END AS "runtimeAuditMutationDenied",
        CASE WHEN to_regclass('public.audit_chain_heads') IS NULL THEN false
          ELSE NOT (
            pg_catalog.has_table_privilege(current_user, 'public.audit_chain_heads', 'INSERT')
            OR pg_catalog.has_table_privilege(current_user, 'public.audit_chain_heads', 'UPDATE')
            OR pg_catalog.has_table_privilege(current_user, 'public.audit_chain_heads', 'DELETE')
            OR pg_catalog.has_table_privilege(current_user, 'public.audit_chain_heads', 'TRUNCATE')
          ) END AS "runtimeHeadMutationDenied",
        NOT pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE')
          AND NOT pg_catalog.has_database_privilege(current_user, current_database(), 'CREATE')
          AS "runtimeNoDdlPrivileges"
    `);
    return result.rows?.length === 1 && auditChainProtectionProven(result.rows[0]);
  } catch {
    // Missing 0109 objects, inaccessible catalogs or unknown privileges MUST
    // block pilot readiness rather than be silently treated as healthy.
    return false;
  }
}
