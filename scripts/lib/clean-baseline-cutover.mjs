// Shared steps for the clean-baseline cutover, used by the disposable rehearsal
// (scripts/qa/rehearse-clean-baseline-cutover.mjs) and the protected production
// runner (scripts/run-clean-baseline-cutover.mjs). Every function takes a query
// callback bound to ONE client, so callers control the transaction.
// Never creates or prints passwords; login roles are provisioned separately.
import { readFileSync } from "node:fs";
import { inventoryMigrationSources } from "./migration-receipt-audit.mjs";
import { cutoverSourceManifest } from "./reviewed-migration-runner.mjs";

export const GROUP_ROLES = Object.freeze([
  "payrollph_schema_owner", "payrollph_ledger_owner", "payrollph_audit_sealing", "payrollph_audit_maintenance",
]);
export const LOGIN_ROLES = Object.freeze([
  "payrollph_migrator", "payrollph_migration_planner", "payrollph_app", "payrollph_sealer_login",
]);
export const LEDGER_TABLES = Object.freeze([
  "payrollph_release_migration_receipts", "payrollph_migration_cutover", "payrollph_schema_migrations",
]);
// Branches that must never be the cutover target: the original production
// branch and the QA branch named by the 0133 companion.
export const FORBIDDEN_TARGET_BRANCHES = Object.freeze(["br-lucky-sound-b79i56jw", "br-green-hat-b77qj8fs"]);

/** Cutover prefix and manifest digest computed from the checked-out drizzle/. */
export function cutoverManifest(directory = "drizzle") {
  const inventory = inventoryMigrationSources(directory);
  const throughPrefix = Math.max(...inventory.files.map((file) => Number(file.prefix)));
  return { inventory, throughPrefix, manifest: cutoverSourceManifest(inventory, throughPrefix) };
}

/** The roles an operator must create before the cutover, with safe attributes. */
export async function assertCutoverRolesProvisioned(q) {
  const { rows } = await q(`SELECT rolname, rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
    FROM pg_catalog.pg_roles WHERE rolname = ANY($1::text[])`, [[...GROUP_ROLES, ...LOGIN_ROLES]]);
  const byName = new Map(rows.map((row) => [row.rolname, row]));
  const problems = [];
  for (const name of [...GROUP_ROLES, ...LOGIN_ROLES]) {
    const role = byName.get(name);
    if (!role) { problems.push(`${name}:missing`); continue; }
    if (role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolreplication || role.rolbypassrls) problems.push(`${name}:elevated`);
    if (GROUP_ROLES.includes(name) && role.rolcanlogin) problems.push(`${name}:must_be_nologin`);
    if (LOGIN_ROLES.includes(name) && !role.rolcanlogin) problems.push(`${name}:must_be_login`);
  }
  for (const name of ["payrollph_audit_sealing", "payrollph_audit_maintenance"]) {
    if (byName.get(name)?.rolinherit) problems.push(`${name}:must_be_noinherit`);
  }
  // PostgreSQL 16+ gives a CREATEROLE creator (Neon's neondb_owner) an admin-only
  // membership in each role it creates: it can grant the role but neither inherit
  // nor SET ROLE to it. Any membership that lets someone act as an audit group is refused.
  const members = await q(`SELECT r.rolname FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid = m.roleid
    WHERE r.rolname IN ('payrollph_audit_sealing','payrollph_audit_maintenance')
      AND (m.inherit_option OR m.set_option)`);
  if (members.rows.length) problems.push("audit_groups:must_have_no_members_before_cutover");
  if (problems.length) throw new Error("CUTOVER_ROLES_NOT_READY: " + problems.join(", "));
}

/** An empty public schema (no tables, sequences, views or functions). */
export async function assertPublicSchemaEmpty(q) {
  const { rows: [row] } = await q(`SELECT
    (SELECT count(*)::int FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p','S','v','m','f')) AS relations,
    (SELECT count(*)::int FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public') AS functions`);
  if (row.relations !== 0 || row.functions !== 0) {
    throw new Error(`CUTOVER_TARGET_NOT_EMPTY: ${row.relations} relations, ${row.functions} functions in public`);
  }
}

// The schema-only artifact (pg_dump --schema=public) carries no CREATE EXTENSION, but
// payroll_runs_no_overlapping_release and the MWE overlap constraint are gist
// exclusion constraints over integers and dates. btree_gist is a trusted
// extension, so a database owner can install it without superuser.
export const REQUIRED_EXTENSIONS = Object.freeze(["btree_gist"]);

export async function installRequiredExtensions(q) {
  for (const name of REQUIRED_EXTENSIONS) await q(`CREATE EXTENSION IF NOT EXISTS ${name} WITH SCHEMA public`);
  const { rows } = await q("SELECT extname FROM pg_catalog.pg_extension WHERE extname = ANY($1::text[])", [[...REQUIRED_EXTENSIONS]]);
  const missing = REQUIRED_EXTENSIONS.filter((name) => !rows.some((row) => row.extname === name));
  if (missing.length) throw new Error("CUTOVER_EXTENSION_MISSING: " + missing.join(", "));
}

/**
 * Strip statements a non-superuser database owner (Neon's neondb_owner) cannot
 * run or does not need: psql-only \restrict lines, comments on the public
 * schema or extensions, and re-creating the always-present public schema.
 */
export function prepareSchemaDump(sql) {
  return sql.split("\n").filter((line) => !/^\\(un)?restrict\b/.test(line)).join("\n")
    .replace(/^COMMENT ON (SCHEMA public|EXTENSION [a-z_]+) IS [^;]*;\s*$/gim, "")
    .replace(/^CREATE SCHEMA public;\s*$/gim, "");
}

/** Install the 0133-equivalent v2 audit guards via the reviewed companion. */
export async function installV2AuditGuards(q, { branchId, databaseName, isolatedTestIdentity = null }) {
  if (!/^br-[a-z0-9-]{6,60}$/.test(branchId ?? "")) throw new Error("CUTOVER_BRANCH_ID_INVALID");
  if (!/^[A-Za-z0-9_]{1,63}$/.test(databaseName ?? "")) throw new Error("CUTOVER_DATABASE_NAME_INVALID");
  // The reviewed companion pins one database name ('neondb'); like the branch, bind the
  // verified target's name in memory. The file itself stays unchanged.
  const pinned = "current_database() IS DISTINCT FROM 'neondb'";
  const source = readFileSync("docs/sql/issue908-audit-trigger-boundary-REVIEW_ONLY.sql", "utf8");
  if (source.split(pinned).length !== 2) throw new Error("CUTOVER_COMPANION_DATABASE_PIN_NOT_FOUND");
  const companion = source
    .replace(pinned, `current_database() IS DISTINCT FROM '${databaseName}'`)
    .replaceAll("__ISSUE908_ISOLATED_BRANCH__", branchId);
  if (isolatedTestIdentity) {
    // Disposable test databases have no Neon settings; emulate them for this transaction only.
    await q("SELECT set_config('neon.project_id', $1, true), set_config('neon.branch_id', $2, true)",
      [isolatedTestIdentity.projectId, branchId]);
  }
  await q(companion);
}

/**
 * Least-privilege ownership and grants. `bootstrapOwner` is the role that
 * created the schema (postgres in rehearsal, neondb_owner on Neon).
 */
export async function applyOwnershipAndGrants(q, { databaseName, bootstrapOwner }) {
  if (!/^[A-Za-z0-9_]{1,63}$/.test(databaseName) || !/^[A-Za-z0-9_]{1,63}$/.test(bootstrapOwner)) throw new Error("CUTOVER_IDENTIFIER_INVALID");
  // A CREATEROLE owner (not superuser) may only reassign to roles it can SET ROLE to.
  const { rows: [self] } = await q("SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user");
  if (!self.rolsuper) {
    await q("GRANT payrollph_schema_owner, payrollph_ledger_owner TO CURRENT_USER WITH INHERIT FALSE, SET TRUE");
  }
  await q("GRANT payrollph_schema_owner TO payrollph_migrator");
  // Migrator sessions run as the schema owner, so objects created by reviewed migrations belong to it.
  await q("ALTER ROLE payrollph_migrator SET role = 'payrollph_schema_owner'");
  await q(`REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    GRANT USAGE, CREATE ON SCHEMA public TO payrollph_schema_owner;
    GRANT USAGE ON SCHEMA public TO payrollph_migration_planner, payrollph_app, payrollph_audit_sealing, payrollph_audit_maintenance`);
  await q(`GRANT CONNECT ON DATABASE ${databaseName} TO payrollph_migrator, payrollph_migration_planner, payrollph_app, payrollph_sealer_login`);
  // Grant while the bootstrap owner still owns the objects: its membership in the
  // schema owner is SET-only, so after the transfer it could no longer grant.
  // PostgreSQL keeps these grants (re-attributed to the new owner) on transfer.
  // Runtime DML only; no DDL, no TRUNCATE, append-only audit trail.
  await q(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO payrollph_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO payrollph_app;
    REVOKE UPDATE, DELETE ON public.audit_events FROM payrollph_app;
    REVOKE INSERT, UPDATE, DELETE ON public.audit_chain_heads FROM payrollph_app;
    GRANT SELECT ON public.audit_events TO payrollph_audit_sealing, payrollph_audit_maintenance;
    GRANT UPDATE(chain_seq, prev_hash, row_hash) ON public.audit_events TO payrollph_audit_sealing;
    GRANT SELECT, INSERT, UPDATE ON public.audit_chain_heads TO payrollph_audit_sealing;
    GRANT UPDATE, DELETE ON public.audit_events TO payrollph_audit_maintenance`);
  const objects = (await q(`SELECT c.relkind, quote_ident(c.relname) AS name FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p','S','v','m') AND pg_catalog.pg_get_userbyid(c.relowner) = $1
      AND NOT (c.relname = ANY($2::text[]))
      -- serial/identity sequences follow their table's owner
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.objid = c.oid AND d.classid = 'pg_catalog.pg_class'::regclass AND d.deptype IN ('a','i'))
    ORDER BY c.relkind DESC`, [bootstrapOwner, [...LEDGER_TABLES]])).rows;
  for (const o of objects) {
    const kind = o.relkind === "S" ? "SEQUENCE" : o.relkind === "v" ? "VIEW" : o.relkind === "m" ? "MATERIALIZED VIEW" : "TABLE";
    await q(`ALTER ${kind} public.${o.name} OWNER TO payrollph_schema_owner`);
  }
  const functions = (await q(`SELECT p.oid::regprocedure::text AS sig FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND pg_catalog.pg_get_userbyid(p.proowner) = $1 AND p.prokind = 'f'`, [bootstrapOwner])).rows;
  for (const f of functions) await q(`ALTER FUNCTION ${f.sig} OWNER TO payrollph_schema_owner`);
  return { tablesAndSequencesReowned: objects.length, functionsReowned: functions.length };
}

/** Ledgers from the DBA templates, a baseline-included receipt per file, and the cutover row. */
export async function createLedgersAndCutover(q, { evidenceRef, reviewedBy, directory = "drizzle" }) {
  const { throughPrefix, manifest } = cutoverManifest(directory);
  await q(readFileSync("docs/engineering/production-migration-receipt-journal-template.sql", "utf8"));
  await q(readFileSync("docs/engineering/reviewed-migration-cutover-template.sql", "utf8").split("-- DBA inserts ONE")[0]);
  // Record receipts and grant before handing the tables to the ledger owner, for
  // the same reason as above: the bootstrap owner's membership is SET-only.
  for (const file of manifest.files) {
    await q(`INSERT INTO public.payrollph_release_migration_receipts (migration_path, source_sha256, disposition, evidence_ref, reviewed_by)
      VALUES ($1, $2, 'baseline-included', $3, $4)`, [file.path, file.sha256, evidenceRef, reviewedBy]);
  }
  await q(`INSERT INTO public.payrollph_migration_cutover (id, historical_prefix, historical_manifest_sha256, evidence_ref, reviewed_by, reviewed_at)
    VALUES (1, $1, $2, $3, $4, now())`, [throughPrefix, manifest.digest, evidenceRef, reviewedBy]);
  for (const table of LEDGER_TABLES) {
    await q(`REVOKE ALL ON public.${table} FROM PUBLIC, payrollph_app`);
    await q(`GRANT SELECT ON public.${table} TO payrollph_migration_planner, payrollph_schema_owner`);
  }
  await q("GRANT INSERT ON public.payrollph_schema_migrations TO payrollph_schema_owner");
  // A new owner needs CREATE on the schema at transfer time (superusers skip this
  // check); grant it only for the transfer, so the ledger owner cannot add objects.
  await q("GRANT USAGE, CREATE ON SCHEMA public TO payrollph_ledger_owner");
  for (const table of LEDGER_TABLES) await q(`ALTER TABLE public.${table} OWNER TO payrollph_ledger_owner`);
  await q("REVOKE CREATE ON SCHEMA public FROM payrollph_ledger_owner");
  return { throughPrefix, receipts: manifest.files.length, duplicatePrefixGroups: manifest.duplicatePrefixes.length, manifestSha256: manifest.digest };
}

/** Membership is granted only after the companion verified the audit groups had none. */
export async function grantSealerMembership(q) {
  await q("GRANT payrollph_audit_sealing TO payrollph_sealer_login");
}
