import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { PINNED_NEON } from "../lib/historical-dba-evidence.mjs";
import { CATALOG_AUDITOR_GUARD_SQL, assertCatalogAuditorPrivilegeBoundary } from "../lib/production-catalog-auditor-gate.mjs";

// Synthetic Neon identity settings below are test inputs on vanilla PostgreSQL.
// They never attest an actual Neon endpoint, deployment role or production grant.
test("actual PG16/18 login: catalog-only guard rejects effective write, ownership and role escalation", async t => {
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.CATALOG_AUDITOR_ACCEPTANCE_MODE, "isolated-postgres-only");
  const url = "postgresql://postgres:postgres@127.0.0.1:5432/neondb";
  assert.equal(process.env.DATABASE_URL, url);
  for (const key of ["PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED"]) assert.equal(process.env[key], "false");
  const admin = new pg.Client({ connectionString: url });
  const password = randomBytes(32).toString("hex");
  // Use an actual restricted login, not SET ROLE on an administrator connection.
  const readerUrl = new URL(url);
  readerUrl.username = "qa_catalog_reader";
  readerUrl.password = password;
  const login = new pg.Client({ connectionString: readerUrl.href });
  await admin.connect();
  let loginConnected = false;
  try {
    const { rows: [preflight] } = await admin.query(`SELECT current_database() AS db,
      current_setting('server_version_num')::int AS version,
      (SELECT count(*)::int FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n
        ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema')
        AND n.nspname !~ '^pg_(toast|temp)' AND c.relkind IN ('r','p','v','m','f','S')) AS objects,
      (SELECT count(*)::int FROM pg_catalog.pg_roles WHERE rolname LIKE 'qa_catalog_%') AS roles`);
    assert.equal(preflight.db, "neondb");
    assert.ok([16, 18].includes(Math.floor(preflight.version / 10000)));
    assert.equal(preflight.objects, 0, "Refuse an existing application database");
    assert.equal(preflight.roles, 0, "Refuse preexisting fixture roles");
    await admin.query(`CREATE ROLE qa_catalog_reader LOGIN PASSWORD '${password}'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`);
    await admin.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      CREATE SCHEMA qa_catalog_fixture; CREATE SCHEMA qa_catalog_auth;
      GRANT USAGE ON SCHEMA qa_catalog_fixture,qa_catalog_auth TO qa_catalog_reader;
      CREATE TABLE qa_catalog_fixture.employees(id integer, salary numeric);
      INSERT INTO qa_catalog_fixture.employees VALUES(1,24000);
      CREATE TABLE qa_catalog_auth.identities(id integer, token text);
      CREATE SEQUENCE qa_catalog_fixture.evidence_ids;
      CREATE TABLE public.payrollph_release_migration_receipts(id integer);
      CREATE TABLE public.payrollph_migration_cutover(id integer);
      CREATE TABLE public.payrollph_schema_migrations(id integer)`);
    await login.connect();
    loginConnected = true;

    async function check({ denied = false, field, requireJournals = false, client = login, readOnly = true, branch = PINNED_NEON.branchId, setRole = false } = {}) {
      await client.query(readOnly ? "BEGIN TRANSACTION READ ONLY" : "BEGIN");
      try {
        await client.query("SET LOCAL search_path = pg_catalog");
        if (setRole) await client.query("SET LOCAL ROLE qa_catalog_reader");
        for (const [key, value] of [["neon.project_id", PINNED_NEON.projectId], ["neon.branch_id", branch], ["neon.endpoint_id", PINNED_NEON.endpointId]]) {
          await client.query("SELECT pg_catalog.set_config($1,$2,true)", [key, value]);
        }
        const { rows: [flags] } = await client.query(CATALOG_AUDITOR_GUARD_SQL,
          ["neondb", PINNED_NEON.projectId, PINNED_NEON.branchId, PINNED_NEON.endpointId]);
        if (field) assert.equal(flags[field], false, field);
        const invoke = () => assertCatalogAuditorPrivilegeBoundary(client, { expectedDatabase: "neondb", requireJournals });
        if (denied) await assert.rejects(invoke, /P0_4_CATALOG_AUDITOR_NOT_LEAST_PRIVILEGED/);
        else assert.equal((await invoke()).catalogOnly, true);
      } finally { await client.query("ROLLBACK"); }
    }

    async function changed(name, apply, reset, field) {
      await t.test(name, async () => {
        await admin.query(apply);
        try { await check({ denied: true, field }); }
        finally { await admin.query(reset); }
        await check();
      });
    }

    await t.test("genuine restricted login passes but cannot read employee rows", async () => {
      await check();
      await assert.rejects(() => login.query("SELECT salary FROM qa_catalog_fixture.employees"), error => error.code === "42501");
    });
    await t.test("all three journal SELECT grants are required for receipt audit", async () => {
      await check({ denied: true, field: "journalsReadable", requireJournals: true });
      await admin.query("GRANT SELECT ON public.payrollph_release_migration_receipts,public.payrollph_migration_cutover TO qa_catalog_reader");
      try {
        await check({ denied: true, field: "journalsReadable", requireJournals: true });
        await admin.query("GRANT SELECT ON public.payrollph_schema_migrations TO qa_catalog_reader");
        await check({ requireJournals: true });
      } finally {
        await admin.query("REVOKE ALL ON public.payrollph_release_migration_receipts,public.payrollph_migration_cutover,public.payrollph_schema_migrations FROM qa_catalog_reader");
      }
    });
    for (const privilege of ["INSERT", "UPDATE", "REFERENCES"]) {
      await changed("column-only " + privilege + " cannot bypass table ACL check",
        `GRANT ${privilege}(salary) ON qa_catalog_fixture.employees TO qa_catalog_reader`,
        `REVOKE ${privilege}(salary) ON qa_catalog_fixture.employees FROM qa_catalog_reader`,
        "withoutUnexpectedRelationAccess");
    }
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
      await changed("table " + privilege + " rejected",
        `GRANT ${privilege} ON qa_catalog_fixture.employees TO qa_catalog_reader`,
        `REVOKE ${privilege} ON qa_catalog_fixture.employees FROM qa_catalog_reader`,
        "withoutUnexpectedRelationAccess");
    }
    if (preflight.version >= 170000) {
      await changed("MAINTAIN rejected on supported PostgreSQL",
        "GRANT MAINTAIN ON qa_catalog_fixture.employees TO qa_catalog_reader",
        "REVOKE MAINTAIN ON qa_catalog_fixture.employees FROM qa_catalog_reader",
        "withoutUnexpectedRelationAccess");
    }
    await changed("managed-auth-shaped alternate schema SELECT rejected",
      "GRANT SELECT(token) ON qa_catalog_auth.identities TO qa_catalog_reader",
      "REVOKE SELECT(token) ON qa_catalog_auth.identities FROM qa_catalog_reader",
      "withoutUnexpectedRelationAccess");
    await changed("PUBLIC SELECT is effective access too",
      "GRANT SELECT ON qa_catalog_fixture.employees TO PUBLIC",
      "REVOKE SELECT ON qa_catalog_fixture.employees FROM PUBLIC",
      "withoutUnexpectedRelationAccess");
    await changed("sequence USAGE rejected",
      "GRANT USAGE ON qa_catalog_fixture.evidence_ids TO qa_catalog_reader",
      "REVOKE USAGE ON qa_catalog_fixture.evidence_ids FROM qa_catalog_reader",
      "withoutUnexpectedRelationAccess");
    await changed("membership rejected even with NOINHERIT",
      "GRANT pg_read_all_data TO qa_catalog_reader",
      "REVOKE pg_read_all_data FROM qa_catalog_reader", "withoutMembership");
    for (const [enabled, disabled] of [["CREATEDB", "NOCREATEDB"], ["CREATEROLE", "NOCREATEROLE"], ["BYPASSRLS", "NOBYPASSRLS"], ["REPLICATION", "NOREPLICATION"], ["SUPERUSER", "NOSUPERUSER"], ["INHERIT", "NOINHERIT"]]) {
      await changed("elevated role attribute " + enabled + " rejected",
        `ALTER ROLE qa_catalog_reader ${enabled}`, `ALTER ROLE qa_catalog_reader ${disabled}`, "restrictedAttributes");
    }
    await changed("database CREATE rejected", "GRANT CREATE ON DATABASE neondb TO qa_catalog_reader",
      "REVOKE CREATE ON DATABASE neondb FROM qa_catalog_reader", "withoutDatabaseCreate");
    await changed("schema CREATE rejected", "GRANT CREATE ON SCHEMA qa_catalog_fixture TO qa_catalog_reader",
      "REVOKE CREATE ON SCHEMA qa_catalog_fixture FROM qa_catalog_reader", "withoutSchemaCreate");
    await changed("ownership rejected even after revoking owner's ordinary privileges",
      "ALTER TABLE qa_catalog_fixture.employees OWNER TO qa_catalog_reader; REVOKE ALL ON qa_catalog_fixture.employees FROM qa_catalog_reader",
      "ALTER TABLE qa_catalog_fixture.employees OWNER TO postgres", "withoutObjectOwnership");
    await changed("publicly executable SECURITY DEFINER rejected",
      "CREATE FUNCTION qa_catalog_fixture.unsafe() RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'",
      "DROP FUNCTION qa_catalog_fixture.unsafe()", "withoutSecurityDefinerExecution");
    await t.test("SET ROLE cannot disguise an elevated session login", () => check({ client: admin, setRole: true, denied: true, field: "sessionMatches" }));
    await t.test("wrong branch identity rejected", () => check({ branch: "fictional-wrong-branch", denied: true, field: "targetMatches" }));
    await t.test("read-write transaction rejected", () => check({ readOnly: false, denied: true, field: "readOnly" }));
    await check();
    const { rows: [row] } = await admin.query("SELECT count(*)::int AS count, sum(salary)::text AS salary FROM qa_catalog_fixture.employees");
    assert.deepEqual(row, { count: 1, salary: "24000" }, "Privilege tests never mutate fictional salary data");
  } finally {
    if (loginConnected) await login.end();
    await admin.end();
    // The dedicated Actions PostgreSQL service is destroyed by the runner.
    // No DROP OWNED, live grant cleanup or external database is used here.
  }
});
