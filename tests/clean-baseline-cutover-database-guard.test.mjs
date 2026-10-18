import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import pg from "pg";
import { installV2AuditGuards } from "../scripts/lib/clean-baseline-cutover.mjs";

const branchId = "br-fictional-cutover-guard";
const projectId = "calm-wave-70219564";

test("audit installation rejects absent or unsafe database names before querying", async () => {
  for (const databaseName of [undefined, "", "x';drop", "a".repeat(64), "two names"]) {
    let queries = 0;
    await assert.rejects(installV2AuditGuards(async () => { queries++; }, { branchId, databaseName }), /CUTOVER_DATABASE_NAME_INVALID/);
    assert.equal(queries, 0);
  }
});

const url = process.env.CUTOVER_DATABASE_GUARD_TEST_URL;
test("real PostgreSQL audit companion binds the explicit database and preserves identity and mutation guards", { skip: !url }, async (t) => {
  const parsed = new URL(url);
  assert.equal(parsed.hostname, "127.0.0.1");
  assert.ok(["neondb", "payrollph_clean_baseline"].includes(parsed.pathname.slice(1)));
  const local = process.platform === "win32" && process.env.CUTOVER_GUARD_LOCAL_FIXTURE === "true";
  if (!local) {
    assert.equal(process.env.CI, "true");
    assert.equal(process.env.GITHUB_ACTIONS, "true");
    assert.equal(parsed.port, "5432");
  } else {
    assert.equal(parsed.port, "54848");
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    if (local) {
      const dir = resolve("..", "..", "outputs", "cutover-named-database-pg18-20261019", "data");
      assert.equal(readFileSync(resolve(dir, "SYNTHETIC_ONLY"), "utf8"), "empty-fictional-fixture\n");
      const actual = (await client.query("SHOW data_directory")).rows[0].data_directory;
      assert.equal(resolve(actual).toLowerCase(), dir.toLowerCase());
    }
    const databaseName = (await client.query("SELECT current_database() AS db")).rows[0].db;
    const q = (sql, params) => client.query(sql, params);
    const fixture = async () => {
      await q("BEGIN");
      await q(`CREATE TABLE public.audit_events (
        id integer, organization_id integer, actor text, action text, resource text,
        metadata jsonb, created_at timestamptz, chain_seq bigint, prev_hash text, row_hash text);
        CREATE TABLE public.audit_chain_heads (organization_id integer);
        CREATE FUNCTION public.audit_events_protect() RETURNS trigger LANGUAGE plpgsql AS
          'BEGIN RETURN NEW; END';
        CREATE TRIGGER audit_events_protect_mutation BEFORE UPDATE OR DELETE ON public.audit_events
          FOR EACH ROW EXECUTE FUNCTION public.audit_events_protect();
        CREATE FUNCTION public.seal_audit_events(integer) RETURNS integer LANGUAGE sql AS 'SELECT 0';`);
      await q("SELECT set_config('neon.project_id', $1, true), set_config('neon.branch_id', $2, true)", [projectId, branchId]);
    };
    for (const [name, options, alteredProject, alteredBranch] of [
      ["other database denied", { databaseName: databaseName === "neondb" ? "payrollph_clean_baseline" : "neondb", branchId }],
      ["other project denied", { databaseName, branchId }, "other-project"],
      ["other branch denied", { databaseName, branchId }, projectId, "br-other-fixture-guard"],
    ]) {
      await t.test(name, async () => {
        await fixture();
        try {
          if (alteredProject) await q("SELECT set_config('neon.project_id', $1, true), set_config('neon.branch_id', $2, true)", [alteredProject, alteredBranch || branchId]);
          await assert.rejects(installV2AuditGuards(q, options), (e) => e.code === "P0001" && e.message === "ISSUE908_ISOLATED_REVIEW_ONLY");
        } finally { await q("ROLLBACK"); }
        assert.equal((await q("SELECT to_regprocedure('public.audit_events_protect_v2()') AS fn")).rows[0].fn, null);
      });
    }
    await t.test("matching name installs guards; spoofed chain, mutation and truncate are rejected; rollback removes all", async () => {
      await fixture();
      try {
        await installV2AuditGuards(q, { databaseName, branchId });
        await q("INSERT INTO public.audit_events (id, organization_id, action) VALUES (1, 1, 'fictional')");
        for (const sql of [
          "INSERT INTO public.audit_events (id, chain_seq) VALUES (2, 1)",
          "UPDATE public.audit_events SET action = 'changed' WHERE id = 1",
          "TRUNCATE public.audit_events",
        ]) {
          await q("SAVEPOINT rejected_write");
          await assert.rejects(q(sql), (e) => e.code === "42501");
          await q("ROLLBACK TO SAVEPOINT rejected_write");
        }
        assert.equal((await q("SELECT action FROM public.audit_events WHERE id=1")).rows[0].action, "fictional");
      } finally { await q("ROLLBACK"); }
      assert.equal((await q("SELECT to_regclass('public.audit_events') AS table_name")).rows[0].table_name, null);
    });
  } finally { await client.end(); }
});

