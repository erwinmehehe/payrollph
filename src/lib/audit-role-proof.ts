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
  "runtimeNoMembership", "runtimeSessionMatches", "runtimeNoDefinerAccess", "chainInsertProtected", "truncateProtected", "auditFunctionBodiesTrusted"] as const;

// Exact pg_proc.prosrc bodies from immutable 0109 and reviewed forward 0133.
// A same-OID CREATE OR REPLACE FUNCTION must not appear audit-ready.
// Two vetted legacy/forward hashes are retained for the disposable PG16/18 matrix;
// unknown bodies or function metadata always fail closed in strict mode.
export const AUDIT_ALLOWED_FUNCTION_BODY_SHA256 = {
  mutationGuard: "0aa3f9e7c61a2cf2fb6b5f9baff3ddecfc36b90c4b67f0cc0a92ef5843e7792d",
  insertGuard: "3e691148ddc849d33e88196509cbd6cdef68765c228918d51c08dba02562f79b",
  truncateGuard: "018e7b61b38e18b20f035a3b3b4e6d13d2c9b304a80506130a8d5e6386f6f2ee",
  sealerForward: "dd45de4468bc03feb6b783e0149a2cbc00502e7b8c010b3ab492f1e08b413dbb",
  sealerLegacy: "a3fdfe906078dbeca40ff222098fcf4dce58091f45a313c2c88968edda22244f",
  rowHashForward: "e2fe56f51f4bc5b1496dc98f922808bcf822e260b5c3406fc341168e97b93e73",
  rowHashLegacy: "c68b878d2e33b2f297c337940ca52798b5eeb24bbfce6f29e81c5aed72b2cadc",
} as const;

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
  AND tgenabled IN ('O','A') AND NOT tgisinternal AND tgqual IS NULL AND tgnargs=0) AS "truncateProtected",
 -- Check original function bodies, not just OIDs: CREATE OR REPLACE keeps the OID.
 -- prosrc is the original SQL/PLpgSQL source (stable across supported PG16/18).
 -- A benign formatting edit also fails closed until separately reviewed/pinned.
 (SELECT count(DISTINCT pinned.signature)=5
  FROM (VALUES
   ('public.audit_events_protect_v2()', '${AUDIT_ALLOWED_FUNCTION_BODY_SHA256.mutationGuard}', 'plpgsql', 'v', 'trigger', ARRAY['search_path=pg_catalog']::text[]),
   ('public.audit_events_insert_guard_v2()', '${AUDIT_ALLOWED_FUNCTION_BODY_SHA256.insertGuard}', 'plpgsql', 'v', 'trigger', ARRAY['search_path=pg_catalog']::text[]),
   ('public.audit_events_reject_truncate_v2()', '${AUDIT_ALLOWED_FUNCTION_BODY_SHA256.truncateGuard}', 'plpgsql', 'v', 'trigger', ARRAY['search_path=pg_catalog']::text[]),
   ('public.seal_audit_events(integer)', '${AUDIT_ALLOWED_FUNCTION_BODY_SHA256.sealerForward}', 'plpgsql', 'v', 'integer', ARRAY['search_path=pg_catalog']::text[]),
   ('public.seal_audit_events(integer)', '${AUDIT_ALLOWED_FUNCTION_BODY_SHA256.sealerLegacy}', 'plpgsql', 'v', 'integer', NULL::text[]),
   ('public.audit_event_row_hash(text,bigint,integer,integer,text,text,text,jsonb,timestamptz)', '${AUDIT_ALLOWED_FUNCTION_BODY_SHA256.rowHashForward}', 'sql', 's', 'text', ARRAY['search_path=pg_catalog']::text[]),
   ('public.audit_event_row_hash(text,bigint,integer,integer,text,text,text,jsonb,timestamptz)', '${AUDIT_ALLOWED_FUNCTION_BODY_SHA256.rowHashLegacy}', 'sql', 's', 'text', NULL::text[])
  ) AS pinned(signature, body_sha256, language_name, volatility, result_type, config)
  JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(pinned.signature)
  JOIN pg_catalog.pg_language l ON l.oid=p.prolang
  WHERE l.lanname=pinned.language_name AND p.prokind='f' AND NOT p.prosecdef
   AND p.provolatile::text=pinned.volatility AND p.prorettype=pg_catalog.to_regtype(pinned.result_type)
   AND p.proconfig IS NOT DISTINCT FROM pinned.config
   AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')=pinned.body_sha256
 ) AS "auditFunctionBodiesTrusted"
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
