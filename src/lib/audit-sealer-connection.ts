import type { ClientConfig } from "pg";
import { criticalReleaseFlagEnabled } from "./critical-release-flags";
import { pinVerifiedPgTls } from "./pg-tls-policy";

type Env = Readonly<Record<string, string | undefined>>;
type SealerClient = {
  connect(): Promise<unknown>;
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<unknown>;
};

const rejection = () => new Error("AUDIT_SEALER_BOUNDARY_NOT_READY");

/** Separate credential; never falls back to the runtime database login. */
export function auditSealerConfig(env: Env): ClientConfig {
  try {
    if (!env.AUDIT_SEALER_DATABASE_URL || !env.DATABASE_URL) throw rejection();
    const dedicated = new URL(env.AUDIT_SEALER_DATABASE_URL);
    const app = new URL(env.DATABASE_URL);
    for (const u of [dedicated, app]) {
      if (!["postgres:", "postgresql:"].includes(u.protocol) || !u.hostname || !u.username
        || !u.password || !u.pathname || u.pathname === "/" || u.hash) throw rejection();
      // No startup role, search_path, TLS or host override through URL options.
      for (const key of u.searchParams.keys()) if (key !== "sslmode") throw rejection();
    }
    if (dedicated.hostname !== app.hostname || (dedicated.port || "5432") !== (app.port || "5432")
      || dedicated.pathname !== app.pathname || dedicated.username === app.username) throw rejection();
    return {
      connectionString: pinVerifiedPgTls(dedicated.href, env.NODE_ENV === "production"),
      connectionTimeoutMillis: 5000,
      statement_timeout: 15000,
      application_name: "linaw-audit-sealer",
    };
  } catch { throw rejection(); }
}

// Evaluate the actual login BEFORE SET ROLE. A role name in a secret is not proof.
const SEALER_LOGIN_PROOF = `SELECT current_user=session_user
 AND (SELECT rolcanlogin AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit)
      FROM pg_catalog.pg_roles WHERE rolname=session_user)
 AND (SELECT count(*)=1 FROM pg_catalog.pg_auth_members WHERE member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user))
 AND EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid
   WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)
     AND r.rolname='payrollph_audit_sealing' AND NOT m.admin_option
     AND NOT (r.rolcanlogin OR r.rolinherit OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls))
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE member='payrollph_audit_sealing'::regrole)
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_shdepend WHERE refclassid='pg_catalog.pg_authid'::regclass
   AND refobjid IN (session_user::regrole,'payrollph_audit_sealing'::regrole) AND deptype='o')
 AND NOT pg_catalog.has_table_privilege(session_user,'public.audit_events','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
 AND NOT pg_catalog.has_any_column_privilege(session_user,'public.audit_events','INSERT,UPDATE,REFERENCES')
 AND NOT pg_catalog.has_table_privilege(session_user,'public.audit_chain_heads','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
 AND NOT pg_catalog.has_any_column_privilege(session_user,'public.audit_chain_heads','INSERT,UPDATE,REFERENCES')
 AND NOT pg_catalog.has_database_privilege(session_user,current_database(),'CREATE')
 AND NOT pg_catalog.has_parameter_privilege(session_user,'session_replication_role','SET')
 AND CASE WHEN current_setting('server_version_num')::int>=170000 THEN
   NOT pg_catalog.has_table_privilege(session_user,'public.audit_events','MAINTAIN')
   AND NOT pg_catalog.has_table_privilege(session_user,'public.audit_chain_heads','MAINTAIN') ELSE true END
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema')
   AND nspname !~ '^pg_(toast|temp)' AND pg_catalog.has_schema_privilege(session_user,oid,'CREATE'))
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_(toast|temp)'
     AND pg_catalog.has_function_privilege(session_user,p.oid,'EXECUTE'))
 AS ready`;

const SEALER_GROUP_PROOF = `SELECT current_user='payrollph_audit_sealing'
 AND NOT pg_catalog.has_table_privilege(current_user,'public.audit_events','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
 AND NOT pg_catalog.has_any_column_privilege(current_user,'public.audit_events','INSERT,REFERENCES')
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.audit_events'::regclass
   AND attnum>0 AND NOT attisdropped AND attname NOT IN ('chain_seq','prev_hash','row_hash')
   AND pg_catalog.has_column_privilege(current_user,attrelid,attnum,'UPDATE'))
 AND NOT pg_catalog.has_table_privilege(current_user,'public.audit_chain_heads','DELETE,TRUNCATE,REFERENCES,TRIGGER')
 AND NOT pg_catalog.has_any_column_privilege(current_user,'public.audit_chain_heads','REFERENCES')
 AND NOT pg_catalog.has_database_privilege(current_user,current_database(),'CREATE')
 AND NOT pg_catalog.has_parameter_privilege(current_user,'session_replication_role','SET')
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema')
   AND nspname !~ '^pg_(toast|temp)' AND pg_catalog.has_schema_privilege(current_user,oid,'CREATE'))
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_(toast|temp)'
     AND pg_catalog.has_function_privilege(current_user,p.oid,'EXECUTE'))
 AND CASE WHEN current_setting('server_version_num')::int>=170000 THEN
   NOT pg_catalog.has_table_privilege(current_user,'public.audit_events','MAINTAIN')
   AND NOT pg_catalog.has_table_privilege(current_user,'public.audit_chain_heads','MAINTAIN') ELSE true END
 AS ready`;

export async function dispatchAuditSealing(
  legacy: () => Promise<number>,
  createClient: (config: ClientConfig) => SealerClient,
  maxRows: number,
  env: Env = process.env,
): Promise<number> {
  if (!criticalReleaseFlagEnabled("auditRoleIsolationProof", env)) return legacy();
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 10000) throw rejection();
  const config = auditSealerConfig(env);
  let client: SealerClient | undefined;
  let transaction = false;
  try {
    client = createClient(config);
    await client.connect();
    const proof = await client.query(SEALER_LOGIN_PROOF);
    if (proof.rows.length !== 1 || proof.rows[0]?.ready !== true) throw rejection();
    await client.query("BEGIN"); transaction = true;
    await client.query("SET LOCAL ROLE payrollph_audit_sealing");
    const group = await client.query(SEALER_GROUP_PROOF);
    if (group.rows.length !== 1 || group.rows[0]?.ready !== true) throw rejection();
    const result = await client.query("SELECT public.seal_audit_events($1) AS sealed", [maxRows]);
    const sealed = result.rows[0]?.sealed;
    if (result.rows.length !== 1 || typeof sealed !== "number" || !Number.isSafeInteger(sealed) || sealed < 0 || sealed > maxRows) throw rejection();
    await client.query("COMMIT"); transaction = false;
    return sealed;
  } catch {
    if (transaction) { try { await client?.query("ROLLBACK"); } catch { /* retain sanitized failure */ } }
    throw rejection();
  } finally {
    // Never propagate pg errors containing connection or query details.
    try { await client?.end(); } catch { /* connection is discarded */ }
  }
}
