import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { Client } from "pg";
import { rlsCatalogSql } from "../scripts/check-issue-1031-full-schema-diff";
import { summarizeRlsPolicyCoverage, type RlsCatalogRow } from "../src/lib/issue-1031-rls-catalog";

function requireDisposablePg() {
  const value = process.env.ISSUE1031_DISPOSABLE_PG_URL;
  if (!value || process.env.CI !== "true") throw new Error("ISSUE1031_DISPOSABLE_ONLY");
  const parsed = new URL(value);
  if (parsed.hostname !== "127.0.0.1" || parsed.port !== "5432" ||
      parsed.pathname !== "/issue1031_schema_fixture") {
    throw new Error("ISSUE1031_DISPOSABLE_ONLY");
  }
  return value;
}

// Global regression shards intentionally lack this dedicated disposable URL.
// The pinned issue-1031-schema-diff-ci workflow sets it and MUST run this test.
// A configured URL is still strictly checked below; wrong/nonlocal targets fail.
test("#1031 actual pg_catalog policy metadata changes are detected but never certified", {
  skip: !process.env.ISSUE1031_DISPOSABLE_PG_URL
    ? "Requires dedicated issue-1031 disposable PostgreSQL fixture"
    : false,
}, async () => {
  const client = new Client({ connectionString: requireDisposablePg() });
  await client.connect();
  const table = "issue1031_rls_fixture";
  let created = false;
  async function sample() {
    // The production catalog report runs under an independent protected-role
    // boundary. This test only proves the SQL and mapper against disposable PG16.
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    try {
      const meta = await client.query<{table_name:string;rls_enabled:boolean;rls_forced:boolean;policy_name:string|null;policy_command:string|null;policy_permissive:boolean|null;policy_roles:string[]|null;using_expression:string|null;with_check_expression:string|null;}>(rlsCatalogSql);
      assert.equal(meta.rows.some((r) => r.table_name === table), true);
      assert.equal(meta.rows.filter((r) => r.table_name === table).length, 1);
      const single: RlsCatalogRow[] = meta.rows.filter((r) => r.table_name === table);
      return summarizeRlsPolicyCoverage([table], single);
    } finally {
      await client.query("ROLLBACK");
    }
  }
  try {
    await client.query("CREATE TABLE public.issue1031_rls_fixture (id integer PRIMARY KEY, org_id integer NOT NULL)");
    created = true;
    let r = await sample();
    assert.equal(r.tables[0].rlsEnabled, false);
    assert.equal(r.tables[0].policyCount, 0);
    assert.equal(r.policyParityVerified, false);

    await client.query("ALTER TABLE public.issue1031_rls_fixture ENABLE ROW LEVEL SECURITY");
    await client.query("ALTER TABLE public.issue1031_rls_fixture FORCE ROW LEVEL SECURITY");
    await client.query("CREATE POLICY tenant_read ON public.issue1031_rls_fixture FOR SELECT TO PUBLIC USING (org_id = 42)");
    r = await sample();
    assert.equal(r.tables[0].rlsEnabled, true);
    assert.equal(r.tables[0].rlsForced, true);
    assert.equal(r.tables[0].policyCount, 1);
    const digestBefore = r.tables[0].policyDigest;
    assert.match(digestBefore ?? "", /^[0-9a-f]{64}$/);

    await client.query("ALTER POLICY tenant_read ON public.issue1031_rls_fixture USING (org_id = 43)");
    const changed = await sample();
    assert.notEqual(changed.tables[0].policyDigest, digestBefore);
    assert.equal(changed.tables[0].coverage, "UNMODELED_REQUIRES_DBA_EXPECTATION");
    assert.equal(changed.approvedForDeployment, false);
    assert.doesNotMatch(JSON.stringify(changed), /org_id = 43/);
  } finally {
    if (created) await client.query("DROP TABLE IF EXISTS public.issue1031_rls_fixture");
    await client.end();
  }
});

/**
 * Execute the actual pg_catalog query as a separately authenticated, unprivileged
 * LOGIN, not as the fixture database owner. All objects are disposable PG16 CI.
 */
test("#1031 quoted identifiers remain visible to a restricted catalog-only LOGIN", {
  skip: !process.env.ISSUE1031_DISPOSABLE_PG_URL
    ? "Requires dedicated issue-1031 disposable PostgreSQL fixture"
    : false,
}, async () => {
  const sourceUrl = requireDisposablePg();
  const login = "issue1031_catalog_reader";
  const policyRole = "issue1031 $policy reviewer";
  const table = "issue1031$rls_audit_fixture";
  const policyName = "tenant-read policy";
  const password = randomBytes(24).toString("hex");
  const limitedUrl = new URL(sourceUrl);
  limitedUrl.username = login;
  limitedUrl.password = password;
  const admin = new Client({ connectionString: sourceUrl });
  const reader = new Client({ connectionString: limitedUrl.toString() });
  let adminConnected = false;
  let readerConnected = false;
  let tableCreated = false;
  let policyRoleCreated = false;
  let loginCreated = false;
  let readOnlyTransaction = false;
  try {
    await admin.connect();
    adminConnected = true;
    // The fixture role creates objects; the audit role gets NO table SELECT
    // and NO schema CREATE, DML, membership, BypassRLS or ownership.
    await admin.query('CREATE ROLE "issue1031 $policy reviewer" NOLOGIN');
    policyRoleCreated = true;
    await admin.query("CREATE ROLE issue1031_catalog_reader WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '" + password + "'");
    loginCreated = true;
    await admin.query('CREATE TABLE public."issue1031$rls_audit_fixture" (id integer PRIMARY KEY, org_id integer NOT NULL)');
    tableCreated = true;
    await admin.query('ALTER TABLE public."issue1031$rls_audit_fixture" ENABLE ROW LEVEL SECURITY');
    await admin.query('CREATE POLICY "tenant-read policy" ON public."issue1031$rls_audit_fixture" FOR SELECT TO "issue1031 $policy reviewer" USING (org_id = 55)');

    await reader.connect();
    readerConnected = true;
    await reader.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    readOnlyTransaction = true;
    const identity = await reader.query<{ identity: string; logged_in: string; can_read: boolean; can_create: boolean }>(
      "SELECT current_user::text AS identity, session_user::text AS logged_in, " +
        "pg_catalog.has_table_privilege(current_user, $1::text, 'SELECT') AS can_read, " +
        "pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE') AS can_create",
      ['public."issue1031$rls_audit_fixture"'],
    );
    assert.equal(identity.rows[0].identity, login);
    assert.equal(identity.rows[0].logged_in, login);
    assert.equal(identity.rows[0].can_read, false, "Catalog account must not SELECT application rows");
    assert.equal(identity.rows[0].can_create, false, "Catalog account must not CREATE schema objects");
    const metadata = await reader.query<RlsCatalogRow>(rlsCatalogSql);
    const matching = metadata.rows.filter((row) => row.table_name === table);
    assert.equal(matching.length, 1, "Restricted login must read real pg_catalog policy metadata");
    assert.equal(matching[0].policy_name, policyName);
    assert.deepEqual(matching[0].policy_roles, [policyRole]);
    assert.equal(matching[0].rls_enabled, true);
    const report = summarizeRlsPolicyCoverage([table], metadata.rows);
    const entry = report.tables.find((candidate) => candidate.table === table);
    assert.equal(entry?.rlsEnabled, true);
    assert.equal(entry?.policyCount, 1);
    assert.match(entry?.policyDigest ?? "", /^[0-9a-f]{64}$/);
    assert.equal(entry?.coverage, "UNMODELED_REQUIRES_DBA_EXPECTATION");
    assert.equal(report.policyParityVerified, false);
    assert.equal(report.approvedForDeployment, false);
    const publicOutput = JSON.stringify(report);
    assert.doesNotMatch(publicOutput, /tenant-read policy|issue1031 \$policy reviewer|org_id = 55/);
    await reader.query("ROLLBACK");
    readOnlyTransaction = false;
    await assert.rejects(
      () => reader.query('SELECT id FROM public."issue1031$rls_audit_fixture" LIMIT 1'),
      (error: unknown) => (error as { code?: string })?.code === "42501",
      "The catalog role must actually be denied application-row SELECT",
    );
  } finally {
    if (readerConnected) {
      if (readOnlyTransaction) await reader.query("ROLLBACK").catch(() => {});
      await reader.end().catch(() => {});
    }
    if (adminConnected) {
      // Scope cleanup to objects created in this verified disposable database.
      if (tableCreated) await admin.query('DROP TABLE public."issue1031$rls_audit_fixture"');
      if (policyRoleCreated) await admin.query('DROP ROLE "issue1031 $policy reviewer"');
      if (loginCreated) await admin.query("DROP ROLE issue1031_catalog_reader");
      await admin.end();
    }
  }
});
