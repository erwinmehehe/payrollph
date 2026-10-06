import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  evaluateOvertimeBudget,
  monthForWorkDate,
  summarizeOvertimeBudget,
} from "../src/lib/workforce-overtime-budget";

test("hard OT budget blocks forward-looking pre-approval over the cap", () => {
  const result = evaluateOvertimeBudget({
    budget: {
      id: 1,
      orgUnitId: 9,
      periodMonth: "2026-10",
      budgetMinutes: 600,
      enforcementMode: "block",
      active: true,
    },
    approvedMinutes: 540,
    pendingMinutes: 120,
    requestedMinutes: 120,
    requestKind: "pre_approved",
  });

  assert.equal(result.projectedApprovedMinutes, 660);
  assert.equal(result.projectedRemainingMinutes, -60);
  assert.equal(result.overBudget, true);
  assert.equal(result.approvalBlocked, true);
  assert.equal(result.payrollEntitlementIndependent, true);
});

test("advisory OT budget records overrun without blocking approval", () => {
  const result = evaluateOvertimeBudget({
    budget: {
      id: 1,
      orgUnitId: 9,
      periodMonth: "2026-10",
      budgetMinutes: 600,
      enforcementMode: "advisory",
      active: true,
    },
    approvedMinutes: 540,
    pendingMinutes: 120,
    requestedMinutes: 120,
    requestKind: "pre_approved",
  });

  assert.equal(result.overBudget, true);
  assert.equal(result.approvalBlocked, false);
  assert.equal(result.projectedRemainingMinutes, -60);
});

test("emergency post-approval remains recordable even beyond a hard budget", () => {
  const result = evaluateOvertimeBudget({
    budget: {
      id: 1,
      orgUnitId: 9,
      periodMonth: "2026-10",
      budgetMinutes: 600,
      enforcementMode: "block",
      active: true,
    },
    approvedMinutes: 600,
    pendingMinutes: 60,
    requestedMinutes: 60,
    requestKind: "emergency_post_approval",
  });

  assert.equal(result.overBudget, true);
  assert.equal(result.approvalBlocked, false);
  assert.equal(result.payrollEntitlementIndependent, true);
});

test("OT budget month and utilization summary are deterministic", () => {
  assert.equal(monthForWorkDate("2026-10-31"), "2026-10");
  assert.throws(() => monthForWorkDate("10/31/2026"), /YYYY-MM-DD/);

  const summary = summarizeOvertimeBudget({
    budgetMinutes: 600,
    approvedMinutes: 300,
    pendingMinutes: 180,
  });
  assert.equal(summary.remainingMinutes, 300);
  assert.equal(summary.committedPercent, 50);
  assert.equal(summary.pendingIfApprovedMinutes, 480);
  assert.equal(summary.pendingIfApprovedPercent, 80);
  assert.equal(summary.projectedOverBudget, false);
});

test("OT schema persists monthly budgets and stable request budget evidence", () => {
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const migration = readFileSync("drizzle/0046_wfm_overtime_budgets.sql", "utf8");
  assert.ok(schema.includes('export const overtimeBudgets = pgTable('));
  assert.ok(schema.includes('budgetSnapshot: jsonb("budget_snapshot")'));
  assert.ok(schema.includes('orgUnitId: integer("org_unit_id")'));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "overtime_budgets"'));
  assert.ok(migration.includes('UPDATE "overtime_requests" ot'));
  assert.ok(migration.includes('"overtime_requests_budget_idx"'));
});

test("OT decisions serialize by org-unit budget and keep entitlement independent", () => {
  const source = readFileSync("src/app/api/workforce/overtime/route.ts", "utf8");
  assert.ok(source.includes("pg_advisory_xact_lock"));
  assert.ok(source.includes("bulk_decide_requests"));
  assert.ok(source.includes("requestIds.length > 100"));
  assert.ok(source.includes("approvalBlocked"));
  assert.ok(source.includes("emergency_post_approval"));
  assert.ok(source.includes("Budget authorization never suppresses legally payable overtime"));
  assert.ok(source.includes("requestedByUserId === input.user.id"));
  assert.ok(source.includes("eq(overtimeRequests.status, \"pending\")"));
});

test("OT budget administration is scoped and separately authorized", () => {
  const source = readFileSync("src/app/api/workforce/overtime/route.ts", "utf8");
  assert.ok(source.includes("OT_BUDGET_ADMIN_ROLES"));
  assert.ok(source.includes('action === "save_budget"'));
  assert.ok(source.includes("access.orgUnitId !== orgUnitId"));
  assert.ok(source.includes("enforcementMode"));
  assert.ok(source.includes("canManageBudgets"));
});

test("OT UI includes monthly budget ledger and bulk decision controls", () => {
  const panel = readFileSync("src/components/workspace/workforce-overtime-panel.tsx", "utf8");
  assert.ok(panel.includes("Overtime authorization & budgets"));
  assert.ok(panel.includes("Budget / decision month"));
  assert.ok(panel.includes("Save monthly budget"));
  assert.ok(panel.includes('bulkDecide("approved")'));
  assert.ok(panel.includes('bulkDecide("rejected")'));
  assert.ok(panel.includes("Select pending"));
  assert.ok(panel.includes("Authorization, budget, and entitlement stay separate"));
  assert.ok(panel.includes("data-wfm-overtime-budget"));
});

test("production compatibility schema includes OT budget migration", () => {
  const source = readFileSync("src/lib/core-schema-compat.ts", "utf8");
  assert.ok(source.includes("linaw_core_schema_compat_v16"));
  assert.ok(source.includes("CREATE TABLE IF NOT EXISTS overtime_budgets"));
  assert.ok(source.includes("ADD COLUMN IF NOT EXISTS budget_snapshot"));
  assert.ok(source.includes("UPDATE overtime_requests ot"));
});
