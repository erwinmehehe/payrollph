#!/usr/bin/env bash
# Run on an authorized DBA workstation with direct production Neon credentials.
# Never put the admin URL or role password in GitHub or chat.
set -euo pipefail
umask 077
: "${ADMIN_DIRECT_DATABASE_URL:?Set privately to direct Neon neondb URL}"
: "${BACKUP_PG_PASSWORD:?Set privately to a newly generated strong password}"
command -v psql >/dev/null || { echo 'psql is required' >&2; exit 1; }
readonly_role=payrollph_backup_ro
exists="$(psql "$ADMIN_DIRECT_DATABASE_URL" -XAtq -v ON_ERROR_STOP=1 -c "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'payrollph_backup_ro')" | tr -d '\r\n')"
if [[ "$exists" != f ]]; then
  echo "STOP: backup role already exists; inspect it instead of rotating its password" >&2
  exit 2
fi
# The password is read only from the local protected process environment.
psql "$ADMIN_DIRECT_DATABASE_URL" -Xq -v ON_ERROR_STOP=1 <<'SQL'
\getenv fresh_password BACKUP_PG_PASSWORD
BEGIN;
SELECT format('CREATE ROLE payrollph_backup_ro LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT', :'fresh_password') \gexec
GRANT CONNECT ON DATABASE neondb TO payrollph_backup_ro;
GRANT USAGE ON SCHEMA public TO payrollph_backup_ro;
GRANT USAGE ON SCHEMA neon_auth TO payrollph_backup_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO payrollph_backup_ro;
-- Neon Auth is managed separately: grant only current tables; no mutation/DDL.
GRANT SELECT ON ALL TABLES IN SCHEMA neon_auth TO payrollph_backup_ro;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO payrollph_backup_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public GRANT SELECT ON TABLES TO payrollph_backup_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public GRANT SELECT ON SEQUENCES TO payrollph_backup_ro;
COMMIT;
SQL
verified="$(psql "$ADMIN_DIRECT_DATABASE_URL" -XAtq -v ON_ERROR_STOP=1 <<'SQL'
SELECT CASE WHEN
  EXISTS (SELECT 1 FROM pg_roles WHERE rolname='payrollph_backup_ro'
    AND rolcanlogin AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
  AND NOT has_schema_privilege('payrollph_backup_ro','public','CREATE')
  AND NOT has_schema_privilege('payrollph_backup_ro','neon_auth','CREATE')
  AND has_schema_privilege('payrollph_backup_ro','public','USAGE')
  AND has_schema_privilege('payrollph_backup_ro','neon_auth','USAGE')
  AND NOT has_database_privilege('payrollph_backup_ro',current_database(),'CREATE')
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','neon_auth') AND c.relkind IN ('r','p')
      AND (NOT has_table_privilege('payrollph_backup_ro',c.oid,'SELECT')
        OR has_table_privilege('payrollph_backup_ro',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')))
THEN 'BACKUP_RO_CAPABILITIES_VERIFIED' ELSE 'DENIED' END;
SQL
)"
if [[ "$verified" != BACKUP_RO_CAPABILITIES_VERIFIED ]]; then
  echo 'BACKUP_ROLE_PRIVILEGE_CHECK_FAILED' >&2
  exit 1
fi
echo "Verified limited production backup reader; test TLS verify-full, RLS and exact pg_dump before any archive."
