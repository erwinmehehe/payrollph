import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";
import { assertIsolatedMigrationTarget } from "../scripts/lib/isolated-migration-target.mjs";

const preflight = readFileSync("docs/sql/issue-1031-financial-schema-catalog-preflight.sql", "utf8");
const proposed = readFileSync("docs/sql/issue-1031-filing-snapshot-additive-candidate.sql", "utf8");
const historical = readFileSync("drizzle/0026_filing_remittance_snapshot.sql", "utf8");
const stripComments = (s) => s.replace(/--[^\n]*/g, "").trim();
const normalize = (s) => stripComments(s).replace(/\s+/g, " ").trim();

test("#1031 diagnostic is one catalog-only SELECT with no customer row reads", () => {
  const source = stripComments(preflight);
  assert.match(source, /^WITH required_tables\b/i);
  assert.equal(source.split(";").filter((s) => s.trim()).length, 1);
  assert.match(source, /\bpg_catalog\.pg_class\b/);
  assert.match(source, /\bpg_catalog\.pg_attribute\b/);
  assert.match(source, /\bCATALOG_ONLY_NOT_MIGRATION_RECEIPT_OR_RELEASE_APPROVAL\b/);
  for (const required of [
    "government_filing_validations", "applicable_month", "employee_count",
    "reported_total", "compensation_bands", "compensation_cycles",
    "compensation_proposals", "compensation_components",
    "employee_compensation_components", "employee_payout_change_requests",
    "attendance_exception_events", "user_permission_assignments",
  ]) assert.ok(source.includes(required), "missing preflight object " + required);
  assert.doesNotMatch(source,
    /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|EXECUTE)\b/i);
  assert.doesNotMatch(source,
    /\b(?:FROM|JOIN)\s+(?:public\.)?(?:employees|users|payroll_runs|payroll_entries|attendance_exception_events|compensation_bands)\b/i);
});

test("#1031 proposed filing repair exactly matches the archived additive SQL", () => {
  assert.equal(normalize(proposed), normalize(historical));
  const sql = stripComments(proposed);
  assert.match(sql, /^ALTER TABLE "government_filing_validations"/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS "government_filing_month_idx"/);
  assert.doesNotMatch(sql,
    /\b(?:DELETE|UPDATE|TRUNCATE|DROP|CASCADE|GRANT|REVOKE|INSERT|BEGIN|COMMIT|ROLLBACK|SET|COPY|CALL)\b/i);
  assert.equal(sql.split(";").filter((s) => s.trim()).length, 2);
});

const allowed = process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true"
  && (() => {
    try {
      const u = new URL(process.env.DATABASE_URL ?? "");
      return ["localhost", "127.0.0.1"].includes(u.hostname)
        && u.protocol === "postgresql:" && u.port === "5432"
        && u.pathname === "/app_db" && u.username === "postgres"
        && !u.search && !u.hash;
    } catch { return false; }
  })();

test("#1031 exact additive SQL rehearses only on disposable CI PostgreSQL and rolls back", {
  skip: !allowed,
  timeout: 90000,
}, async () => {
  const url = assertIsolatedMigrationTarget({
    ...process.env, MIGRATION_REHEARSAL_MODE: "isolated-ci-only",
  });
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 4000 });
  await client.connect();
  let inTx = false;
  const schema = "issue1031_" + randomUUID().replace(/-/g, "").slice(0, 16);
  try {
    await client.query("BEGIN");
    inTx = true;
    await client.query('CREATE SCHEMA "' + schema + '"');
    await client.query('SET LOCAL search_path TO "' + schema + '", pg_catalog');
    await client.query(
      "CREATE TABLE government_filing_validations (" +
        "id integer PRIMARY KEY, organization_id integer NOT NULL," +
        "agency varchar(16) NOT NULL, status varchar(16) NOT NULL)"
    );
    await client.query(proposed);
    await client.query(proposed);
    const actual = (await client.query(
      "SELECT column_name, data_type, character_maximum_length, numeric_precision, numeric_scale " +
      "FROM information_schema.columns " +
      "WHERE table_schema=$1 AND table_name='government_filing_validations'",
      [schema],
    )).rows;
    const byName = new Map(actual.map((row) => [row.column_name, row]));
    assert.equal(byName.get("applicable_month")?.data_type, "character varying");
    assert.equal(byName.get("applicable_month")?.character_maximum_length, 7);
    assert.equal(byName.get("employee_count")?.data_type, "integer");
    assert.equal(byName.get("reported_total")?.numeric_precision, 14);
    assert.equal(byName.get("reported_total")?.numeric_scale, 2);
    const indexRows = (await client.query(
      "SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=$1 " +
      "AND indexname='government_filing_month_idx'", [schema],
    )).rows;
    assert.equal(indexRows.length, 1);
    assert.match(indexRows[0].indexdef, /\(organization_id, agency, applicable_month, status\)/);
    await client.query("ROLLBACK");
    inTx = false;
    const noFixture = (await client.query("SELECT to_regnamespace($1) IS NULL AS absent", [schema])).rows[0];
    assert.equal(noFixture.absent, true);
  } finally {
    if (inTx) {
      try { await client.query("ROLLBACK"); } catch { /* cleanup */ }
    }
    await client.end();
  }
});
