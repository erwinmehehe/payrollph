import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";
import { assertIsolatedMigrationTarget } from "../scripts/lib/isolated-migration-target.mjs";

const read = (path) => readFileSync(path, "utf8");
const source = read("docs/sql/issue-1015-attendance-exception-catalog-preflight.sql");

// PostgreSQL rehearsal MUST stay on the disposable CI service. No live Neon,
// Vercel, customer attendance/punch data, production migration or payout.
const allowed = process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true"
  && (() => {
    try {
      const u = new URL(process.env.DATABASE_URL);
      return ["localhost", "127.0.0.1"].includes(u.hostname)
        && u.protocol === "postgresql:" && u.port === "5432"
        && u.pathname === "/app_db" && u.username === "postgres"
        && !u.search && !u.hash;
    } catch { return false; }
  })();

test("#1015 source diagnostic is one read-only, fixed-schema catalog SELECT", () => {
  const sql = source.replace(/--[^\n]*/g, "").trim();
  assert.match(sql, /^WITH required_columns\b/i);
  assert.match(sql, /\bSELECT area, object_name, status\b/);
  assert.equal(sql.split(";").filter((s) => s.trim()).length, 1);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|EXECUTE)\b/i);
  assert.doesNotMatch(sql, /\b(?:FROM|JOIN)\s+(?:public\.)?(?:employees|users|time_punches|payroll_entries|payroll_runs|attendance_exception_events)\b/i,
    "no application business rows may be inspected");
  for (const required of [
    "pg_catalog.pg_class", "pg_catalog.pg_attribute", "pg_catalog.pg_index",
    "pg_catalog.pg_constraint", "public", "attendance_exception_events",
    "organization_id", "employee_id", "fingerprint_sha256",
    "owner_user_id", "sla_due_at", "resolution_note", "resolved_by_user_id",
    "resolution_recorded_at", "attendance_exception_events_fingerprint_unique",
    "attendance_exception_events_owner_idx", "attendance_exception_events_sla_idx",
    "attendance_exception_events_severity_check", "attendance_exception_events_status_check",
    "CATALOG_EVIDENCE_ONLY_NOT_MIGRATION_RECEIPT_OR_RELEASE_APPROVAL",
  ]) assert.ok(sql.includes(required), "missing mandatory catalog evidence " + required);
});

test("#1015 migration rehearsal is runnable ONLY on ephemeral GitHub PG16/18", {
  skip: !allowed, timeout: 90000,
}, async () => {
  const url = assertIsolatedMigrationTarget({
    ...process.env, MIGRATION_REHEARSAL_MODE: "isolated-ci-only",
  });
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 4000 });
  await client.connect();
  let inTransaction = false;
  try {
    // First verify fresh Drizzle schema parity using an actual READ ONLY
    // transaction. The query returns metadata, never real employee rows.
    await client.query("BEGIN TRANSACTION READ ONLY");
    inTransaction = true;
    const healthy = (await client.query(source)).rows;
    assert.ok(healthy.length >= 35, "the preflight must cover table, fields, indexes, FKs and checks");
    assert.deepEqual(healthy.filter((r) => r.status !== "PASS"), [],
      "fresh isolated schema must have complete attendance structural parity");
    assert.ok(healthy.every((r) => r.evidence_scope.endsWith("NOT_MIGRATION_RECEIPT_OR_RELEASE_APPROVAL")));
    await client.query("ROLLBACK");
    inTransaction = false;

    // Prove a missing index and a weaker same-name index are NOT false green.
    await client.query("BEGIN");
    inTransaction = true;
    await client.query("DROP INDEX public.attendance_exception_events_owner_idx");
    const absent = (await client.query(source)).rows;
    assert.equal(absent.find((r) => r.object_name === "attendance_exception_events_owner_idx")?.status, "MISSING");
    await client.query(
      "CREATE INDEX attendance_exception_events_owner_idx " +
      "ON public.attendance_exception_events (organization_id, status, sla_due_at)",
    );
    const wrongKeys = (await client.query(source)).rows;
    assert.equal(wrongKeys.find((r) => r.object_name === "attendance_exception_events_owner_idx")?.status, "DRIFT");
    await client.query("ROLLBACK");
    inTransaction = false;
    assert.ok((await client.query(source)).rows.every((r) => r.status === "PASS"),
      "rollback must restore the clean schema");

    // Rehearse the EXACT archived SQL only in an isolated fictional schema,
    // never replay it against public/production or assume a historical receipt.
    const schema = "issue_1015_" + randomUUID().replace(/-/g, "").slice(0, 16);
    await client.query("BEGIN");
    inTransaction = true;
    await client.query('CREATE SCHEMA "' + schema + '"');
    await client.query('SET LOCAL search_path TO "' + schema + '", pg_catalog');
    await client.query([
      "CREATE TABLE organizations(id integer PRIMARY KEY)",
      "CREATE TABLE employees(id integer PRIMARY KEY)",
      "CREATE TABLE users(id integer PRIMARY KEY)",
      "CREATE TABLE time_punches(id integer PRIMARY KEY)",
    ].join(";\n") + ";");
    await client.query("INSERT INTO organizations(id) VALUES(1),(2)");
    await client.query("INSERT INTO employees(id) VALUES(101),(201)");
    await client.query("INSERT INTO users(id) VALUES(11),(22)");
    await client.query("INSERT INTO time_punches(id) VALUES(1001),(2001)");

    const migration67 = read("drizzle/0067_attendance_exception_events.sql");
    const migration88 = read("drizzle/0088_attendance_exception_governance.sql");
    await client.query(migration67);
    await client.query(
      "INSERT INTO attendance_exception_events" +
      "(organization_id,employee_id,work_date,exception_kind,severity,message,fingerprint_sha256) " +
      "VALUES" +
      "(1,101,'2026-10-10','missed_punch','blocker','Fictional blocker',$1)," +
      "(1,101,'2026-10-11','late_punch','warning','Fictional warning',$2)," +
      "(2,201,'2026-10-12','late_punch','info','Fictional info',$3)",
      ["a".repeat(64), "b".repeat(64), "c".repeat(64)],
    );
    await client.query(migration88);
    const hours = (await client.query(
      "SELECT severity,round(extract(epoch from (sla_due_at - first_detected_at))/3600)::integer AS hours " +
      "FROM attendance_exception_events ORDER BY hours",
    )).rows;
    assert.deepEqual(hours.map((r) => [r.severity, r.hours]),
      [["blocker", 4], ["warning", 24], ["info", 72]]);
    await client.query(migration67);
    await client.query(migration88);
    assert.equal(Number((await client.query("SELECT count(*) AS n FROM attendance_exception_events")).rows[0].n), 3,
      "rehearsed migrations must not create or remove synthetic history on replay");

    await client.query("SAVEPOINT invalid_owner");
    await assert.rejects(() => client.query(
      "UPDATE attendance_exception_events SET owner_user_id=999 WHERE organization_id=1",
    ), (error) => error.code === "23503", "governance owner FK must reject missing users");
    await client.query("ROLLBACK TO SAVEPOINT invalid_owner");
    await client.query("RELEASE SAVEPOINT invalid_owner");
    await client.query("ROLLBACK");
    inTransaction = false;
    const after = await client.query("SELECT to_regnamespace($1) IS NULL AS absent", [schema]);
    assert.equal(after.rows[0].absent, true, "entire synthetic migration rehearsal must roll back");
  } finally {
    if (inTransaction) {
      try { await client.query("ROLLBACK"); } catch { /* cleanup even on assertion failure */ }
    }
    await client.end();
  }
});
