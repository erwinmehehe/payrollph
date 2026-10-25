/** Existing 0104 objects for the empty disposable tenant-table database only.
 * db:push omits the SQL-only event table. Never called by the application.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

export function assertHcmWorkItemFixtureTarget(env) {
  assert.equal(env.GITHUB_ACTIONS, "true", "disposable GitHub Actions only");
  assert.equal(env.CI, "true");
  assert.equal(env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(env.DATABASE_URL, "postgresql://postgres:postgres@127.0.0.1:5432/app_db");
  assert.equal(env.PAYMONGO_DISBURSEMENTS_ENABLED, "false");
  assert.equal(env.XENDIT_PAYOUTS_ENABLED, "false");
}

export function hcmWorkItemFixtureSql() {
  const sql = readFileSync(new URL("../../drizzle/0104_hcm_work_item_sla.sql", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  assert.equal(createHash("sha256").update(sql).digest("hex"), "5930ae73d79d468f02146c5445e31698b2dd2a5fc83f71efabcafdd99aba940b", "review the exact existing 0104 source before changing this fixture");
  return sql;
}

export async function prepareHcmWorkItemFixture(env = process.env) {
  assertHcmWorkItemFixtureTarget(env);
  const sql = hcmWorkItemFixtureSql();
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE organizations, audit_events IN ACCESS EXCLUSIVE MODE");
    const { rows: [target] } = await client.query("SELECT current_database() AS db, current_user AS role, current_setting('server_version_num')::int AS version, (SELECT count(*)::int FROM organizations) AS employers, (SELECT count(*)::int FROM audit_events) AS audits");
    assert.equal(target.db, "app_db"); assert.equal(target.role, "postgres");
    assert.ok([16, 18].includes(Math.floor(target.version / 10000)));
    assert.equal(target.employers, 0, "no existing employer database allowed");
    assert.equal(target.audits, 0, "no existing audit records allowed");
    await client.query(sql);
    await client.query("COMMIT");
    console.log(JSON.stringify({ kind: "hcm-work-item-fixture-ready", source: "0104", disposable: true, productionTested: false }));
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { await client.end(); }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/qa/prepare-hcm-work-item-fixture.mjs")) {
  prepareHcmWorkItemFixture().catch(error => { console.error(error); process.exitCode = 1; });
}
