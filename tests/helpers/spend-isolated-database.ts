import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
const require = createRequire(import.meta.url);

/** Whole-source schema in a generated namespace; no public-table fallback. */
export async function spendIsolatedDatabase() {
  const url = new URL(process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/app_db");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/app_db");
  const schema = "qa_spend_" + randomUUID().replaceAll("-", "");
  const pool = new Pool({ connectionString: url.toString(), options: `-c search_path=${schema}` });
  const exported = execFileSync(process.execPath, [join(process.cwd(), "node_modules/drizzle-kit/bin.cjs"),
    "export", "--config=drizzle.config.ts"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, DATABASE_URL: url.toString() } });
  const start = exported.indexOf("CREATE TABLE");
  assert.ok(start >= 0);
  const ddl = exported.slice(start).replaceAll('"public".', '"' + schema + '".');
  await pool.query(`CREATE SCHEMA ${schema}`);
  try { await pool.query(ddl); }
  catch (error) { await pool.query(`DROP SCHEMA ${schema} CASCADE`); await pool.end(); throw error; }
  const db = drizzle(pool);
  const dbId = require.resolve("../../src/db"), original = require(dbId);
  require.cache[dbId]!.exports = { ...original, db, pool };
  return { db, pool, schema, async close() {
    require.cache[dbId]!.exports = original;
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  } };
}
