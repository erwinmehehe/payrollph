#!/usr/bin/env node
/**
 * #1113: catalog-only evidence, NEVER a migration or hosted-UAT signoff.
 * Explicitly confined to a fictional, non-production PostgreSQL target.
 * Prints no connection strings, employee rows, names, or secrets.
 */
import { Client } from "pg";
import { pathToFileURL } from "node:url";

function assertIsolatedEnvironment(env) {
  if (env.ISSUE1113_FICTIONAL_QA !== "I_CONFIRM_FICTIONAL_ISOLATED_DB") {
    throw new Error("ISSUE1113_ISOLATED_QA_CONFIRMATION_REQUIRED");
  }
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") {
    throw new Error("ISSUE1113_PRODUCTION_CONTEXT_REFUSED");
  }
  if (!env.DATABASE_URL) throw new Error("ISSUE1113_DATABASE_URL_REQUIRED");
}
export { assertIsolatedEnvironment };

export async function verifyIssue1113Catalog(client) {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
  try {
    await client.query("SET LOCAL statement_timeout = '7000ms'");
    await client.query("SET LOCAL lock_timeout = '2000ms'");
    await client.query("SET LOCAL search_path = pg_catalog");
    const identity = await client.query(
      "SELECT current_database() AS database_name, current_user AS role_name, " +
      "current_setting('transaction_read_only') AS readonly");
    if (identity.rows[0]?.readonly !== "on") throw new Error("ISSUE1113_READ_ONLY_TX_REQUIRED");
    const { rows } = await client.query(String.raw`
      SELECT c.table_name, c.column_name, c.udt_name, c.character_maximum_length,
        c.numeric_precision, c.numeric_scale, c.is_nullable, c.column_default
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name IN ('employee_worksite_assignments', 'separation_records')
      ORDER BY c.table_name, c.ordinal_position
    `);
    const byTable = (table) => rows.filter(r => r.table_name === table);
    const work = byTable("employee_worksite_assignments");
    const sep = byTable("separation_records");
    const decision = work.find(r => r.column_name === "decision");
    const requiredAdditions = [
      "thirteenth_entitlement", "thirteenth_paid_ytd",
      "basic_salary_earned_ytd", "historical_basic_salary_earned",
      "unpaid_basic_salary", "separation_pay", "retirement_pay", "other_benefits",
      "final_statutory_deductions", "gross_final_pay", "final_pay_due_date",
      "computation_snapshot", "approved_at", "released_at", "release_reference",
      "prepared_by_user_id", "approved_by_user_id", "released_by_user_id",
    ];
    const missingSep = requiredAdditions.filter(name => !sep.some(r => r.column_name === name));
    const basicColumnsValid = work.length === 10 && sep.length === 38 &&
      decision?.udt_name === "varchar" && Number(decision.character_maximum_length) === 8 &&
      decision.is_nullable === "NO" &&
      /^'allow'::character varying(?:\(8\))?$/.test(String(decision.column_default)) &&
      missingSep.length === 0;
    const constraints = await client.query(String.raw`
      SELECT con.conname AS name, con.contype AS kind, con.convalidated AS validated
      FROM pg_catalog.pg_constraint con
      WHERE con.conrelid IN ('public.employee_worksite_assignments'::regclass,
          'public.separation_records'::regclass)
        AND con.contype IN ('p','f','c')
    `);
    const checkConstraint = constraints.rows.find(c =>
      c.name === "separation_review_identity_separation_check" &&
      c.kind === "c" && c.validated === true);
    const journal = await client.query(
      "SELECT pg_catalog.to_regclass('public.payrollph_schema_migrations') IS NOT NULL AS present");
    const result = {
      databaseName: identity.rows[0].database_name,
      // Role name is deliberately not printed: the operator validates it privately.
      worksiteColumnCount: work.length,
      separationColumnCount: sep.length,
      decisionColumnValid: Boolean(decision && basicColumnsValid),
      requiredSeparationAdditionsPresent: missingSep.length === 0,
      reviewIdentityCheckPresent: Boolean(checkConstraint),
      migrationJournalPresent: journal.rows[0]?.present === true,
      hostedOwnerHrUat: "NOT_RUN",
      hostedTenantDenials: "NOT_RUN",
      actualDeploymentDatabaseIdentity: "UNVERIFIED",
      independentDbaReleaseApproval: "NOT_OBTAINED",
    };
    await client.query("ROLLBACK");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* caller must discard connection */ }
    throw error;
  }
}

const executing = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (executing) {
  try {
    assertIsolatedEnvironment(process.env);
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const report = await verifyIssue1113Catalog(client);
      console.log(JSON.stringify(report, null, 2));
      if (!report.decisionColumnValid || !report.requiredSeparationAdditionsPresent ||
          !report.reviewIdentityCheckPresent || !report.migrationJournalPresent) {
        process.exitCode = 1;
      }
    } finally { await client.end(); }
  } catch (error) {
    // Avoid echoing pg connection strings, SQL text, or private database metadata.
    console.error("Issue #1113 catalog preflight blocked or failed. Verify target and migration receipts privately.");
    process.exitCode = 1;
  }
}
