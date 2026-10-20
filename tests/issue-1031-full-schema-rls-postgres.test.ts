import assert from "node:assert/strict";
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
