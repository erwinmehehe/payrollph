import assert from "node:assert/strict";
import test from "node:test";
import { classifyPayrollVariance } from "../src/lib/payroll-variance";
import type { ExplainPayModel } from "../src/lib/payroll-explain";

function explanation(overrides: Partial<ExplainPayModel> = {}): ExplainPayModel {
  return {
    currentGross: 30000,
    currentDeductions: 5000,
    currentNet: 25000,
    previousGross: 28000,
    previousDeductions: 4500,
    previousNet: 23500,
    netDelta: 1500,
    netPercent: 6.38,
    ruleVersion: "PH-2026.01",
    context: {},
    lines: [],
    ...overrides,
  };
}

test("checker variance classifies salary, statutory and net-pay changes without re-calculating payroll", () => {
  const categories = classifyPayrollVariance({
    explanation: explanation({
      lines: [{
        code: "SSS",
        label: "SSS",
        direction: "deduction",
        previous: 1000,
        current: 1100,
        delta: 100,
        netEffectDelta: -100,
        reason: "stored",
        notes: [],
      }],
    }),
    currentStatus: "Ready",
    employeeStatus: "Active",
    hasCurrentEntry: true,
    hasPreviousEntry: true,
    hasPayRevision: true,
    isNewHire: false,
    bankDetailsChanged: false,
  });

  assert.ok(categories.includes("salary_change"));
  assert.ok(categories.includes("statutory"));
  assert.ok(categories.includes("net_variance"));
});

test("OT spike requires a meaningful increase", () => {
  const smallIncrease = classifyPayrollVariance({
    explanation: explanation({
      lines: [{
        code: "OT",
        label: "Overtime",
        direction: "earning",
        previous: 1000,
        current: 1200,
        delta: 200,
        netEffectDelta: 200,
        reason: "stored",
        notes: [],
      }],
    }),
    currentStatus: "Ready",
    employeeStatus: "Active",
    hasCurrentEntry: true,
    hasPreviousEntry: true,
    hasPayRevision: false,
    isNewHire: false,
    bankDetailsChanged: false,
  });
  assert.ok(!smallIncrease.includes("overtime_spike"));

  const spike = classifyPayrollVariance({
    explanation: explanation({
      lines: [{
        code: "OT",
        label: "Overtime",
        direction: "earning",
        previous: 1000,
        current: 1600,
        delta: 600,
        netEffectDelta: 600,
        reason: "stored",
        notes: [],
      }],
    }),
    currentStatus: "Ready",
    employeeStatus: "Active",
    hasCurrentEntry: true,
    hasPreviousEntry: true,
    hasPayRevision: false,
    isNewHire: false,
    bankDetailsChanged: false,
  });
  assert.ok(spike.includes("overtime_spike"));
});

test("missing prior/current entries are surfaced for checker review", () => {
  const newHire = classifyPayrollVariance({
    explanation: explanation({ previousNet: null, netDelta: null, netPercent: null }),
    currentStatus: "Ready",
    employeeStatus: "Active",
    hasCurrentEntry: true,
    hasPreviousEntry: false,
    hasPayRevision: false,
    isNewHire: true,
    bankDetailsChanged: false,
  });
  assert.ok(newHire.includes("new_hire"));
  assert.ok(!newHire.includes("new_to_run"));

  const missing = classifyPayrollVariance({
    explanation: explanation({ currentNet: 0, netDelta: -23500, netPercent: -100 }),
    currentStatus: null,
    employeeStatus: "Active",
    hasCurrentEntry: false,
    hasPreviousEntry: true,
    hasPayRevision: false,
    isNewHire: false,
    bankDetailsChanged: false,
  });
  assert.ok(missing.includes("missing_from_run"));
});


test("voluntary Pag-IBIG changes are treated as statutory variance", () => {
  const categories = classifyPayrollVariance({
    explanation: explanation({
      lines: [{
        code: "HDMF_VOL",
        label: "Pag-IBIG voluntary contribution",
        direction: "deduction",
        previous: 0,
        current: 500,
        delta: 500,
        netEffectDelta: -500,
        reason: "stored",
        notes: [],
      }],
    }),
    currentStatus: "Ready",
    employeeStatus: "Active",
    hasCurrentEntry: true,
    hasPreviousEntry: true,
    hasPayRevision: false,
    isNewHire: false,
    bankDetailsChanged: false,
  });

  assert.ok(categories.includes("statutory"));
});

test("variance API bounds audit and pay-revision queries to the reviewed cutoff", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/app/api/payroll-runs/[id]/variance/route.ts", "utf8");
  assert.ok(source.includes("gte(employeePayRevisions.effectiveDate, run.periodStart)"));
  assert.ok(source.includes("lte(employeePayRevisions.effectiveDate, run.periodEnd)"));
  assert.ok(source.includes("gte(auditEvents.createdAt, periodStart)"));
  assert.ok(source.includes("lte(auditEvents.createdAt, periodEnd)"));
  assert.ok(!source.includes("db.select().from(auditEvents).where(eq(auditEvents.organizationId, run.organizationId))"));
});


test("checker variance UI blocks approval when stored payroll coverage is incomplete", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/components/workspace/checker-variance.tsx", "utf8");
  assert.ok(source.includes("coverageComplete"));
  assert.ok(source.includes("Approval blocked."));
  assert.ok(source.includes("disabled={busy || !payload.summary.coverageComplete}"));
});
