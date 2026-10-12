#!/usr/bin/env node
"use strict";
/**
 * Disposable Postgres migration acceptance for combined A1-A6 only.
 * Always verify the local CI database identity; never attach to live Neon.
 * Performs DDL in a transaction and deliberately rolls it back in --rollback.
 * --apply-ci is for a disposable DB reserved for the integration test runner.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const proposals = [
  "employee-hr-cases.sql",
  "spend-payroll-reimbursements.sql",
  "employee-document-vault-a5.sql",
  "offboarding-clearance-a6.sql",
  "recruitment-applicant-privacy.sql",
  // The abandoned A-3 storage_key field MUST NOT be reintroduced. A-5
  // object_storage_key is authoritative for COE + 201 file downloads.
  "a1-a6-cross-tenant-fk-qa.sql",
];
const expectedTables = [
  "employee_hr_cases", "employee_hr_case_messages",
  "expense_category_policies", "hcm_document_expiry_notices",
  "separation_clearance_waivers", "applicant_privacy_evidence",
];
const tenantFkNames = [
  "a1a6_hr_case_worker_tenant_fk", "a1a6_hr_message_case_tenant_fk",
  "a1a6_expiry_worker_tenant_fk", "a1a6_expiry_document_tenant_fk",
  "a1a6_expiry_compliance_tenant_fk", "a1a6_clearance_worker_tenant_fk",
  "a1a6_clearance_separation_tenant_fk", "a1a6_claim_category_policy_tenant_fk",
];
function requireDisposable() {
  assert.equal(process.env.CI, "true", "Only CI may run this script");
  assert.equal(process.env.A1_A6_DISPOSABLE_MIGRATION_MODE, "isolated-ci-only");
  const url = new URL(process.env.DATABASE_URL || "");
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "No remote database");
  assert.equal(url.pathname, "/app_db", "Refuse non-disposable database name");
  const mode = process.argv[2];
  assert.ok(["--rollback", "--apply-ci"].includes(mode), "Mode is required");
  return mode;
}
function sqlSource(file) {
  const target = path.join(process.cwd(), "docs", "engineering", "migration-proposals", file);
  let sql = fs.readFileSync(target, "utf8");
  // Only A-2's supplied proposal has redundant top-level transaction lines.
  // We control transaction boundaries here, so the source COMMIT is forbidden.
  if (file === "recruitment-applicant-privacy.sql") {
    sql = sql.replace(/^BEGIN;\s*$/gm, "").replace(/^COMMIT;\s*$/gm, "");
  }
  const actualSql = sql.replace(/--[^\n]*/g, "");
  // ON DELETE CASCADE/SET NULL is valid FK DDL, not a DELETE FROM mutation.
  const mutationScan = actualSql.replace(/\bON\s+DELETE\s+(?:CASCADE|RESTRICT|SET\s+NULL|NO\s+ACTION)\b/gi, "");
  assert.ok(!/\b(DROP|TRUNCATE|DELETE|INSERT|UPDATE|GRANT|REVOKE)\b/i.test(mutationScan),
    "Destructive or DML statement not allowed in migration rehearsal");
  assert.ok(actualSql.trim().length > 10 && !/\bCOMMIT\b|\bROLLBACK\b/i.test(actualSql));
  return sql;
}
async function schemaAcceptance(client) {
  const { rows: version } = await client.query("SHOW server_version");
  const { rows: tableRows } = await client.query(
    "SELECT to_regclass('public.' || names.name) AS name FROM unnest($1::text[]) AS names(name)",
    [expectedTables],
  );
  assert.equal(tableRows.length, expectedTables.length);
  for (const row of tableRows) assert.ok(row.name, "New feature table is missing");

  for (const [table, column] of [
    ["documents", "object_storage_key"], ["documents", "uploaded_by_user_id"],
    ["expense_claims", "category_policy_id"], ["expense_claims", "approved_amount"],
    ["expense_claims", "receipt_storage_key"], ["expense_claims", "taxable"],
    ["applicant_privacy_evidence", "deletion_reviewed_by_user_id"],
  ]) {
    const res = await client.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2",
      [table, column],
    );
    assert.equal(res.rowCount, 1, "Missing " + table + "." + column);
  }
  const legacy = await client.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='documents' AND column_name='storage_key'",
  );
  assert.equal(legacy.rowCount, 0, "Conflicting A-3 storage_key migration must be excluded");
  const fks = await client.query(
    "SELECT conname FROM pg_constraint WHERE contype='f' AND conname = ANY($1::text[])",
    [tenantFkNames],
  );
  assert.deepEqual(fks.rows.map(x => x.conname).sort(), [...tenantFkNames].sort());
  const policyCheck = await client.query(
    "SELECT conname FROM pg_constraint WHERE conrelid='hcm_document_expiry_notices'::regclass AND contype='c'",
  );
  assert.ok(policyCheck.rows.length >= 1, "30/14/7 CHECK must exist");
  return { pgVersion: version[0].server_version, tables: expectedTables.length,
    tenantForeignKeys: fks.rows.length, checkedColumns: 7 };
}
/** Prove PostgreSQL itself rejects cross-employer personnel joins. */
async function negativeTenantFixture(client) {
  const { rows: orgs } = await client.query(
    "INSERT INTO organizations(name,legal_name) VALUES ('QA release tenant A','QA release tenant A'), ('QA release tenant B','QA release tenant B') RETURNING id",
  );
  const { rows: actors } = await client.query(
    "INSERT INTO users(email,name,password_hash) VALUES ($1,'QA HR reviewer','synthetic-only') RETURNING id",
    ["a1a6-" + Math.random().toString(36).slice(2) + "@example.invalid"],
  );
  const { rows: workers } = await client.query(
    "INSERT INTO employees(organization_id,employee_no,first_name,last_name,title,avatar_initials,basic_rate,start_date) VALUES ($1,'QA-WORKER','Synthetic','Other Tenant','Analyst','SO','20000.00','2026-01-01') RETURNING id",
    [orgs[1].id],
  );
  await client.query("SAVEPOINT cross_employer_probe");
  let denied = false;
  try {
    await client.query(
      "INSERT INTO employee_hr_cases(organization_id,employee_id,created_by_user_id,case_type,subject,description,assigned_role,sla_due_at) VALUES ($1,$2,$3,'general','Synthetic access test','Never persist wrong tenant data','hr',now() + interval '24 hours')",
      [orgs[0].id, workers[0].id, actors[0].id],
    );
  } catch (error) {
    denied = error.code === "23503";
  }
  await client.query("ROLLBACK TO SAVEPOINT cross_employer_probe");
  assert.ok(denied, "Cross-employer HR case must fail a database composite FK");
  await client.query("RELEASE SAVEPOINT cross_employer_probe");
  await client.query("DELETE FROM organizations WHERE id=$1 OR id=$2",
    [orgs[0].id, orgs[1].id]);
  await client.query("DELETE FROM users WHERE id=$1", [actors[0].id]);
  return true;
}

async function run() {
  const mode = requireDisposable();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  let begun = false;
  try {
    await client.connect();
    const exists = await client.query(
      "SELECT to_regclass('public.employee_hr_cases') AS hr, to_regclass('public.applicant_privacy_evidence') AS privacy",
    );
    assert.ok(!exists.rows[0].hr && !exists.rows[0].privacy,
      "Expected baseline main schema, not pre-applied feature tables");
    await client.query("BEGIN");
    begun = true;
    for (const file of proposals) await client.query(sqlSource(file));
    const verified = await schemaAcceptance(client);
    verified.negativeCrossEmployerFkTest = await negativeTenantFixture(client);
    if (mode === "--rollback") {
      await client.query("ROLLBACK");
      begun = false;
      const rolled = await client.query(
        "SELECT to_regclass('public.employee_hr_cases') AS hr, to_regclass('public.applicant_privacy_evidence') AS privacy",
      );
      assert.ok(!rolled.rows[0].hr && !rolled.rows[0].privacy,
        "Rollback failed to remove newly created schema");
    } else {
      await client.query("COMMIT");
      begun = false;
      await schemaAcceptance(client);
    }
    const artifact = {
      environment: "local disposable PostgreSQL CI only",
      productionApproval: false,
      legalPrivacyPayrollCertification: false,
      canonicalNumberedMigration: false,
      mode, proposals, ...verified,
      transaction: mode === "--rollback" ? "rolled_back" : "applied_disposable_db",
      timestamp: new Date().toISOString(),
    };
    fs.mkdirSync("qa-artifacts", { recursive: true });
    fs.writeFileSync("qa-artifacts/a1-a6-migration-rehearsal.json",
      JSON.stringify(artifact, null, 2) + "\n");
    console.log(JSON.stringify(artifact));
  } finally {
    if (begun) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}
run().catch(error => {
  console.error("A1-A6 migration rehearsal failed:", error.message);
  process.exitCode = 1;
});
