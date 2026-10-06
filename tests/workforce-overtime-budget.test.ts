import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  evaluateOvertimeBudget,
  overtimeBudgetMonthStart,
  overtimeBudgetScopeKey,
  resolveOvertimeBudgetPolicy,
} from "../src/lib/workforce-overtime-budget";

test("budget scope keys distinguish department fallback from manager-specific control", () => {
  assert.equal(overtimeBudgetScopeKey(7, null), "unit:7");
  assert.equal(overtimeBudgetScopeKey(7, 42), "unit:7:manager:42");
  assert.throws(() => overtimeBudgetScopeKey(0, null), /positive organization-unit/);
});

test("budget month resolution is deterministic", () => {
  assert.equal(overtimeBudgetMonthStart("2026-10-31"), "2026-10-01");
  assert.throws(() => overtimeBudgetMonthStart("10/31/2026"), /YYYY-MM-DD/);
});

test("manager-specific budget overrides the department fallback for that manager", () => {
  const policies = [
    {
      id: 1,
      orgUnitId: 9,
      managerUserId: null,
      monthStart: "2026-10-01",
      budgetMinutes: 2400,
      enforcementMode: "advisory",
      active: true,
    },
    {
      id: 2,
      orgUnitId: 9,
      managerUserId: 88,
      monthStart: "2026-10-01",
      budgetMinutes: 1200,
      enforcementMode: "blocking",
      active: true,
    },
  ];

  assert.equal(resolveOvertimeBudgetPolicy({
    policies,
    orgUnitId: 9,
    managerUserId: 88,
    workDate: "2026-10-15",
  })?.id, 2);

  assert.equal(resolveOvertimeBudgetPolicy({
    policies,
    orgUnitId: 9,
    managerUserId: 77,
    workDate: "2026-10-15",
  })?.id, 1);
});

test("advisory budgets warn while blocking budgets stop authorization", () => {
  const advisory = evaluateOvertimeBudget({
    budgetMinutes: 600,
    usedMinutes: 540,
    requestedMinutes: 120,
    enforcementMode: "advisory",
  });
  assert.equal(advisory.exceeded, true);
  assert.equal(advisory.overageMinutes, 60);
  assert.equal(advisory.blocked, false);

  const blocking = evaluateOvertimeBudget({
    budgetMinutes: 600,
    usedMinutes: 540,
    requestedMinutes: 120,
    enforcementMode: "blocking",
  });
  assert.equal(blocking.exceeded, true);
  assert.equal(blocking.blocked, true);
});

test("OT budget schema is bounded and monthly-scoped", () => {
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const migration = readFileSync("drizzle/0047_overtime_budget_controls.sql", "utf8");
  const compat = readFileSync("src/lib/core-schema-compat.ts", "utf8");

  assert.ok(schema.includes('export const overtimeBudgetPolicies = pgTable('));
  assert.ok(schema.includes('"overtime_budget_policies"'));
  assert.ok(schema.includes('uniqueIndex("overtime_budget_scope_month_unique")'));
  assert.ok(migration.includes("overtime_budget_minutes_check"));
  assert.ok(migration.includes("overtime_budget_mode_check"));
  assert.ok(compat.includes("linaw_core_schema_compat_v17"));
  assert.ok(compat.includes("CREATE TABLE IF NOT EXISTS overtime_budget_policies"));
});

test("OT API applies budgets only to authorization and supports atomic bulk decisions", () => {
  const source = readFileSync("src/app/api/workforce/overtime/route.ts", "utf8");

  assert.ok(source.includes('action === "upsert_budget"'));
  assert.ok(source.includes('action === "bulk_decide_requests"'));
  assert.ok(source.includes("requestIds.length > 50"));
  assert.ok(source.includes("db.transaction(async (tx)"));
  assert.ok(source.includes("Overtime requests cannot be self-approved") || source.includes("cannot be self-approved"));
  assert.ok(source.includes("OVERTIME_BUDGET_BLOCKED"));
  assert.ok(source.includes("approvalBudgetCheck"));
  assert.ok(source.includes("resolveOvertimeBudgetPolicy"));
  assert.ok(source.includes("budgetWarnings"));
  assert.ok(source.includes("bulkDecision: requestIds.length > 1"));

  // Budget enforcement is authorization-side only. It must not call payroll arithmetic.
  assert.ok(!source.includes("calculateEmployeePay("));
  assert.ok(!source.includes("holidayMultiplier("));
});

test("OT UI exposes budget utilization and bulk decision operations", () => {
  const source = readFileSync("src/components/workspace/workforce-overtime-panel.tsx", "utf8");

  assert.ok(source.includes("Monthly OT budget"));
  assert.ok(source.includes("Department-wide"));
  assert.ok(source.includes("blocking"));
  assert.ok(source.includes("Approve selected"));
  assert.ok(source.includes("Reject selected"));
  assert.ok(source.includes('"bulk_decide_requests"'));
  assert.ok(source.includes('"upsert_budget"'));
  assert.ok(source.includes("Authorization and entitlement stay separate."));
});
