import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../src/db/schema";
import { verifyCoreSchemaReadOnly } from "../src/lib/core-schema-readonly";

// The isolated CI app_db is built from the reviewed clean baseline.
// An old hosted schema is no longer upgraded by request-time compatibility SQL.
test("clean-baseline disposable demo catalog supports current launch and workspace models", {
  skip: process.env.CI !== "true" || !process.env.DATABASE_URL,
}, async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  let reusable = false;
  try {
    await verifyCoreSchemaReadOnly((sql, params) => client.query(sql, params));
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    let transactionOpen = true;
    try {
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
      for (const path of [
        "src/db/public-demo.ts", "src/lib/dashboard-data.ts", "src/app/api/self/payslips/route.ts",
      ]) {
        const source = readFileSync(path, "utf8");
        for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']@\/db\/schema["']/g)) {
          for (const name of match[1].split(",").map(value => value.trim()).filter(Boolean)) {
            const model = schema[name as keyof typeof schema];
            assert.ok(models.some(table => table === model) || name === "separationRecords",
              "Unverified demo model: " + name);
          }
        }
      }
      await client.query(
        "SELECT id, employee_id, separation_type, notice_date, last_day, status " +
        "FROM public.separation_records LIMIT 0",
      );
      for (const model of models) {
        const config = getTableConfig(model);
        const columns = config.columns.map(column => '"' + column.name + '"').join(", ");
        await client.query("SELECT " + columns + ' FROM public."' + config.name + '" LIMIT 0');
      }
      await client.query("ROLLBACK");
      transactionOpen = false;
      reusable = true;
    } finally {
      if (transactionOpen) {
        try {
          await client.query("ROLLBACK");
          reusable = true;
        } catch {
          // Never put a potentially open transaction back in the pool.
        }
      }
    }
  } finally {
    client.release(!reusable);
    await pool.end();
  }
});
