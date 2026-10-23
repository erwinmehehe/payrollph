import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../src/db/schema";

// Run only against the disposable Postgres service supplied by CI.
test("legacy hosted demo schema supports the current launch and workspace models", {
  skip: process.env.CI !== "true" || !process.env.DATABASE_URL,
}, async () => {
  const fixture = `legacy_demo_${randomBytes(8).toString("hex")}`;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA "${fixture}"`);
    await client.query(`SET search_path TO "${fixture}"`);
    const baseline = readFileSync("drizzle/baseline.sql", "utf8")
      .split("CREATE TABLE IF NOT EXISTS government_filing_validations")[0]
      .replaceAll('"public".', `"${fixture}".`);
    await client.query(baseline);
    await client.query(readFileSync("drizzle/0015_workforce_scheduling.sql", "utf8"));
    await client.query(`ALTER TABLE org_units DROP COLUMN legal_entity_id,
      DROP COLUMN cost_center_id, DROP COLUMN manager_employee_id,
      DROP COLUMN effective_from, DROP COLUMN effective_until,
      DROP COLUMN active, DROP COLUMN created_at, DROP COLUMN updated_at`);
    const core = readFileSync("src/lib/core-schema-compat.ts", "utf8")
      .split("export async function ensureCoreCompatibilitySchema")[1];
    const blocks = [...core.matchAll(/await client\.query\(`([\s\S]*?)`\);/g)].map(match => match[1]);
    assert.ok(blocks.length > 0, "compatibility SQL must be exercised");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await client.query("BEGIN");
      for (const sql of blocks) await client.query(sql);
      await client.query("COMMIT");
    }
    // The leave and pay-basis helpers no longer carry request-time DDL; replay the
    // exact historical SQL they used to run so the old demo shape is still rebuilt.
    await client.query(readFileSync("tests/fixtures/retired-runtime-ddl/leave-pay-basis.sql", "utf8"));
    // Module columns are installed by the ordered release migration, never
    // by a request-time compatibility helper. Rehearse the documented upgrade.
    await client.query(readFileSync("drizzle/0122_tenant_module_disclosure.sql", "utf8"));
    const models = [schema.organizations, schema.orgUnits, schema.employees, schema.holidays,
      schema.leaveBalances, schema.leavePolicies, schema.leaveRequests, schema.approvalTasks,
      schema.auditEvents, schema.payrollRuns, schema.payrollEntries, schema.subscriptions,
      schema.users, schema.userOrganizations, schema.sessions, schema.organizationSecurityPolicies,
      schema.complianceActionTasks, schema.employeePayProfiles, schema.employeePayRevisions,
      schema.employeeRestDayRevisions, schema.employeePayRetroAdjustments, schema.approvalDelegations,
      schema.bankTemplates, schema.calamityAdvisories, schema.freelancerProfiles, schema.minWageOrders,
      schema.pricingPlans, schema.provisioningTasks, schema.timePunches, schema.payrollJobs,
      schema.leaveRequestIntervalSets, schema.leaveRequestIntervals, schema.governmentLoanRemittanceBatches,
      schema.governmentLoanRemittanceMembers, schema.payslips, schema.statutoryContributionIssueCases,
      schema.statutoryContributionIssueEvents, schema.statutoryRemittanceBatches,
      schema.statutoryRemittanceMembers, schema.statutoryPostingEvidenceArtifacts];
    for (const path of ["src/db/public-demo.ts", "src/lib/dashboard-data.ts", "src/app/api/self/payslips/route.ts"]) {
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']@\/db\/schema["']/g)) {
        for (const name of match[1].split(",").map(value => value.trim()).filter(Boolean)) {
          const model = schema[name as keyof typeof schema];
          assert.ok(models.some(table => table === model) || name === "separationRecords", `Unverified demo model: ${name}`);
        }
      }
    }
    // This loader deliberately selects only these legacy separation columns.
    await client.query("SELECT id, employee_id, separation_type, notice_date, last_day, status FROM separation_records LIMIT 0");
    for (const model of models) {
      const config = getTableConfig(model);
      // This fixture deliberately excludes new, feature-flagged employer
      // attribution columns. Runtime compatibility must NOT synthesize a
      // production legal_entity_id or attempt a schema write.
      const columns = config.columns.filter(column => column.name !== "legal_entity_id")
        .map(column => `"${column.name}"`).join(", ");
      await client.query(`SELECT ${columns} FROM "${config.name}" LIMIT 0`);
    }
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.query(`DROP SCHEMA IF EXISTS "${fixture}" CASCADE`);
    client.release();
    await pool.end();
  }
});
