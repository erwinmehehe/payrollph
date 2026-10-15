#!/usr/bin/env node
/**
 * Issue #1019: one positive and one deliberately denied COE association,
 * using fictional rows inside a single transaction that ALWAYS rolls back.
 * Works only in the verified empty GitHub PostgreSQL 18 CI service.
 * Never touch the Neon branch or a real customer's employee records.
 */
import { strict as assert } from "node:assert";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { assertDisposablePG18Environment } from "./fresh-pg18-development-schema.mjs";

const TARGET = "postgresql://postgres:postgres@127.0.0.1:5432/app_db";

export function assertCOEConstraintRejection(error) {
  assert.equal(error?.code, "23503", "Required FK violation must use SQLSTATE 23503");
  assert.equal(error?.constraint, "employee_hr_cases_coe_document_tenant_fk",
    "Cross-tenant denial must come from the exact organization/employee/document composite FK");
  return true;
}

export async function runFictionalCOEReferenceProof(env = process.env) {
  assertDisposablePG18Environment(env);
  const client = new pg.Client({ connectionString: TARGET, connectionTimeoutMillis: 7000, query_timeout: 20000 });
  await client.connect();
  let inTransaction = false;
  try {
    const identity = (await client.query(
      "SELECT current_database() AS db, current_user AS role, current_setting('server_version_num')::integer AS version"
    )).rows[0];
    assert.equal(identity.db, "app_db");
    assert.equal(identity.role, "postgres");
    assert.ok(identity.version >= 180000 && identity.version < 190000, "Only PostgreSQL 18");
    await client.query("BEGIN");
    inTransaction = true;
    const a = (await client.query(
      "INSERT INTO organizations (name, legal_name) VALUES ('Fictional Canary Employer A', 'Fictional Canary Employer A') RETURNING id"
    )).rows[0].id;
    const b = (await client.query(
      "INSERT INTO organizations (name, legal_name) VALUES ('Fictional Canary Employer B', 'Fictional Canary Employer B') RETURNING id"
    )).rows[0].id;
    const user = (await client.query(
      "INSERT INTO users(email, name, password_hash) VALUES ('canary-owner@synthetic.invalid', 'Synthetic Canary Owner', 'not-a-real-password-hash') RETURNING id"
    )).rows[0].id;
    const employeeSql = "INSERT INTO employees " +
      "(organization_id, employee_no, first_name, last_name, title, avatar_initials, basic_rate, start_date) " +
      "VALUES ($1, $2, 'Synthetic', 'Employee', 'Test Role', 'SE', 1200, DATE '2026-01-01') RETURNING id";
    const employeeA = (await client.query(employeeSql, [a, "CANARY-A-01"])).rows[0].id;
    const employeeB = (await client.query(employeeSql, [b, "CANARY-B-01"])).rows[0].id;
    const docSql = "INSERT INTO documents " +
      "(organization_id, employee_id, kind, file_name, mime_type, byte_size, sha256, uploaded_by, content) " +
      "VALUES ($1, $2, 'coe', 'fictional-only.txt', 'text/plain', 8, $3, 'synthetic-canary', 'fictional') RETURNING id";
    const docA = (await client.query(docSql, [a, employeeA, "a".repeat(64)])).rows[0].id;
    const docB = (await client.query(docSql, [b, employeeB, "b".repeat(64)])).rows[0].id;
    const caseSql = "INSERT INTO employee_hr_cases " +
      "(organization_id, employee_id, created_by_user_id, case_type, subject, description, assigned_role, sla_due_at, coe_document_id) " +
      "VALUES ($1, $2, $3, 'coe', 'Synthetic COE request', 'Disposable PostgreSQL only', 'hr', " +
      "NOW() + INTERVAL '1 day', $4) RETURNING id";
    // A valid within-tenant reference must work (not a broken FK that denies all).
    const valid = (await client.query(caseSql, [a, employeeA, user, docA])).rows[0].id;
    assert.ok(Number.isSafeInteger(valid));
    await client.query("SAVEPOINT cross_tenant_denial");
    let denied = false;
    try {
      await client.query(caseSql, [a, employeeA, user, docB]);
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT cross_tenant_denial");
      assertCOEConstraintRejection(error);
      denied = true;
    }
    assert.equal(denied, true, "A document belonging to another organization MUST NOT attach to an HR case");
    process.stdout.write("PG18_COE_TENANT_NEGATIVE_PASS: correct composite FK rejected fictional cross-tenant document; valid matching document accepted\n");
  } finally {
    if (inTransaction) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runFictionalCOEReferenceProof().catch(() => {
    process.stderr.write("PG18_COE_TENANT_NEGATIVE_FAILED\n");
    process.exitCode = 1;
  });
}
