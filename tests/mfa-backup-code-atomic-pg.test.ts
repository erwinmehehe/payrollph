import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import pg from "pg";

// Never point a destructive/concurrency probe at Neon or an arbitrary database.
// CI shards each provide their own disposable PostgreSQL 16 localhost service.
const ISOLATED_URL = "postgresql://postgres:postgres@127.0.0.1:5432/app_db";
const githubCI = process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true";

test("real PostgreSQL serializes consumption of the same one-time backup code", {
  skip: !githubCI,
  timeout: 25_000,
}, async () => {
  assert.equal(process.env.DATABASE_URL, ISOLATED_URL,
    "MFA concurrency test may run only against the exact disposable CI database");

  const first = new pg.Client({ connectionString: ISOLATED_URL, statement_timeout: 7000 });
  const second = new pg.Client({ connectionString: ISOLATED_URL, statement_timeout: 7000 });
  let connectedFirst = false;
  let connectedSecond = false;
  let tableCreated = false;
  const table = "qa_mfa_backup_" + randomBytes(8).toString("hex");

  try {
    await first.connect();
    connectedFirst = true;
    await second.connect();
    connectedSecond = true;

    const identity = await first.query(`SELECT current_database() AS database,
      current_setting('server_version_num')::integer AS version,
      inet_server_addr()::text AS host`);
    assert.equal(identity.rows[0].database, "app_db");
    assert.equal(identity.rows[0].host, "127.0.0.1");
    assert.ok(identity.rows[0].version >= 160000 && identity.rows[0].version < 190000);

    // Only a new throwaway synthetic table is mutated. Application users,
    // sessions, payroll and statutory data are not accessed.
    await first.query(`CREATE TABLE "${table}" (
      id integer PRIMARY KEY,
      backup_codes jsonb NOT NULL
    )`);
    tableCreated = true;
    await first.query(`INSERT INTO "${table}" (id, backup_codes)
      VALUES (1, '["SYNTHETIC-ONCE","SYNTHETIC-OTHER"]'::jsonb)`);

    const consume = `UPDATE "${table}"
      SET backup_codes = backup_codes - $1::text
      WHERE id = $2
        AND jsonb_typeof(backup_codes) = 'array'
        AND backup_codes @> jsonb_build_array($1::text)
      RETURNING id`;

    // Hold the first transaction's lock while the second attempts reuse.
    // At READ COMMITTED the waiting UPDATE must recheck its WHERE predicate.
    await first.query("BEGIN");
    const initial = await first.query(consume, ["SYNTHETIC-ONCE", 1]);
    assert.equal(initial.rowCount, 1);
    const competing = second.query(consume, ["SYNTHETIC-ONCE", 1]);
    await new Promise(resolve => setTimeout(resolve, 75));
    await first.query("COMMIT");

    const replay = await competing;
    assert.equal(replay.rowCount, 0,
      "The second concurrent request must not consume a used code");
    const repeated = await second.query(consume, ["SYNTHETIC-ONCE", 1]);
    assert.equal(repeated.rowCount, 0);

    const remaining = await first.query(`SELECT backup_codes FROM "${table}" WHERE id = 1`);
    assert.deepEqual(remaining.rows[0].backup_codes, ["SYNTHETIC-OTHER"],
      "Unrelated recovery credentials must not be discarded");

    // A distinct legitimate recovery code remains usable exactly once.
    const other = await second.query(consume, ["SYNTHETIC-OTHER", 1]);
    assert.equal(other.rowCount, 1);
    const after = await first.query(`SELECT backup_codes FROM "${table}" WHERE id = 1`);
    assert.deepEqual(after.rows[0].backup_codes, []);
  } finally {
    if (connectedFirst) {
      await first.query("ROLLBACK").catch(() => {});
      if (tableCreated) await first.query(`DROP TABLE IF EXISTS "${table}"`).catch(() => {});
    }
    if (connectedSecond) await second.end().catch(() => {});
    if (connectedFirst) await first.end().catch(() => {});
  }
});
