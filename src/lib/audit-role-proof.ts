import { criticalReleaseFlagEnabled } from "./critical-release-flags";

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
export const STRICT_AUDIT_CHAIN_PROOF_KEYS = [...AUDIT_CHAIN_PROOF_KEYS,
  "runtimeNoMembership", "runtimeSessionMatches", "runtimeNoDefinerAccess", "chainInsertProtected", "truncateProtected"] as const;

export const LEGACY_AUDIT_ROLE_PROOF_SQL = `
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
    `;

export function auditChainProtectionProven(row: unknown, strict = false): boolean {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  const proof = row as Record<string, unknown>;
  return (strict ? STRICT_AUDIT_CHAIN_PROOF_KEYS : AUDIT_CHAIN_PROOF_KEYS).every(key => proof[key] === true);
}

export const STRICT_AUDIT_ROLE_PROOF_SQL = `
WITH objects AS (
 SELECT to_regclass('public.audit_events') AS audit,
  to_regclass('public.audit_chain_heads') AS heads,
  to_regprocedure('public.audit_events_protect_v2()') AS protect,
  to_regprocedure('public.audit_events_insert_guard_v2()') AS insert_guard,
  to_regprocedure('public.seal_audit_events(integer)') AS sealer
), self AS (SELECT * FROM pg_catalog.pg_roles WHERE rolname=current_user)
SELECT
 EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid=o.audit AND relkind='r') AS "auditTablePresent",
 EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid=o.heads AND relkind='r') AS "chainHeadsPresent",
 EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=o.protect AND prorettype='pg_catalog.trigger'::regtype) AS "protectFunctionPresent",
 o.sealer IS NOT NULL AS "sealerFunctionPresent",
 to_regprocedure('public.audit_event_row_hash(text,bigint,integer,integer,text,text,text,jsonb,timestamptz)') IS NOT NULL AS "hashFunctionPresent",
 EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid=o.audit
  AND tgname='audit_events_protect_mutation' AND tgfoid=o.protect AND tgtype=27
  AND tgenabled IN ('O','A') AND NOT tgisinternal AND tgqual IS NULL AND tgnargs=0) AS "protectionTriggerEnabled",
 COALESCE((SELECT rolcanlogin AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit) FROM self),false) AS "runtimeNotElevated",
 NOT EXISTS(SELECT 1 FROM pg_catalog.pg_shdepend WHERE refclassid='pg_catalog.pg_authid'::regclass
  AND refobjid=(SELECT oid FROM self) AND deptype='o') AS "runtimeNotObjectOwner",
 o.audit IS NOT NULL AND NOT (
  pg_catalog.has_table_privilege(current_user,o.audit,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  OR pg_catalog.has_any_column_privilege(current_user,o.audit,'UPDATE,REFERENCES')
  OR CASE WHEN current_setting('server_version_num')::int>=170000 THEN pg_catalog.has_table_privilege(current_user,o.audit,'MAINTAIN') ELSE false END
 ) AS "runtimeAuditMutationDenied",
 o.heads IS NOT NULL AND NOT (
  pg_catalog.has_table_privilege(current_user,o.heads,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  OR pg_catalog.has_any_column_privilege(current_user,o.heads,'INSERT,UPDATE,REFERENCES')
  OR CASE WHEN current_setting('server_version_num')::int>=170000 THEN pg_catalog.has_table_privilege(current_user,o.heads,'MAINTAIN') ELSE false END
 ) AS "runtimeHeadMutationDenied",
 NOT pg_catalog.has_database_privilege(current_user,current_database(),'CREATE')
 AND NOT pg_catalog.has_parameter_privilege(current_user,'session_replication_role','SET')
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema')
  AND nspname !~ '^pg_(toast|temp)' AND pg_catalog.has_schema_privilege(current_user,oid,'CREATE')) AS "runtimeNoDdlPrivileges",
 NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=(SELECT oid FROM self)) AS "runtimeNoMembership",
 current_user=session_user AS "runtimeSessionMatches",
 NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_(toast|temp)'
   AND pg_catalog.has_function_privilege(current_user,p.oid,'EXECUTE')) AS "runtimeNoDefinerAccess",
 EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid=o.audit
  AND tgname='audit_events_insert_guard_v2' AND tgfoid=o.insert_guard AND tgtype=7
  AND tgenabled IN ('O','A') AND NOT tgisinternal AND tgqual IS NULL AND tgnargs=0) AS "chainInsertProtected",
 EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid=o.audit
  AND tgname='audit_events_reject_truncate_v2' AND tgfoid=to_regprocedure('public.audit_events_reject_truncate_v2()') AND tgtype=34
  AND tgenabled IN ('O','A') AND NOT tgisinternal AND tgqual IS NULL AND tgnargs=0) AS "truncateProtected"
FROM objects o`;

export function auditRoleProofQuery(env: Readonly<Record<string,string|undefined>> = process.env) {
  const strict = criticalReleaseFlagEnabled("auditRoleIsolationProof", env);
  return {strict, query: strict ? STRICT_AUDIT_ROLE_PROOF_SQL : LEGACY_AUDIT_ROLE_PROOF_SQL};
}

export async function executeAuditRoleProof(
  execute: (query: string) => Promise<{rows: unknown[]}>,
  env: Readonly<Record<string,string|undefined>> = process.env,
): Promise<boolean> {
  try {
    const {strict,query}=auditRoleProofQuery(env);
    const result=await execute(query);
    return result.rows?.length===1 && auditChainProtectionProven(result.rows[0],strict);
  } catch {return false;}
}
