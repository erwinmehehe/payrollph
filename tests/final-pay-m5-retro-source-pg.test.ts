import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  employeePayRetroAdjustments, employeePayRevisions, employees,
  organizations, payrollEntries, payrollRuns,
} from "../src/db/schema";
import { readBasicAndThirteenth, retroSourceTaxYear } from "../src/lib/final-pay";
import { loadFinalPayRetroSourcePeriods } from "../src/lib/final-pay-retro-source-lookup";

test("M-5 PostgreSQL: only Released same-tenant same-employee source payroll may establish a retro year", async () => {
  // Run ONLY against disposable PostgreSQL in CI; never shared Neon or real payroll.
  // Never let an operator accidentally run this write-heavy synthetic fixture
  // against a shared development or employer database.
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "The M-5 DB test requires a disposable PostgreSQL connection.");
  const hostname = new URL(databaseUrl).hostname;
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(hostname),
    "The M-5 DB test must run against loopback PostgreSQL, never hosted Neon or production.");
  const suffix = randomUUID().slice(0, 9);
  const [employer, otherEmployer] = await db.insert(organizations).values([
    { name: "M5 test employer " + suffix, legalName: "Fictional Employer A", plan: "Core" },
    { name: "M5 foreign employer " + suffix, legalName: "Fictional Employer B", plan: "Core" },
  ]).returning();
  try {
    const [employee, differentEmployee] = await db.insert(employees).values([
      {
        organizationId: employer.id, employeeNo: "M5-A-" + suffix,
        firstName: "Fictional", lastName: "Employee", title: "Tester",
        avatarInitials: "FE", basicRate: "30000.00", startDate: "2025-01-01",
      },
      {
        organizationId: employer.id, employeeNo: "M5-B-" + suffix,
        firstName: "Fictional", lastName: "Colleague", title: "Tester",
        avatarInitials: "FC", basicRate: "30000.00", startDate: "2025-01-01",
      },
    ]).returning();
    const [revision] = await db.insert(employeePayRevisions).values({
      organizationId: employer.id, employeeId: employee.id, effectiveDate: "2026-10-01",
      previousPayBasis: "monthly", previousRateAmount: "28000.00",
      previousStandardWorkDaysPerMonth: "22.00", previousStandardHoursPerDay: "8.00",
      newPayBasis: "monthly", newRateAmount: "30000.00",
      newStandardWorkDaysPerMonth: "22.00", newStandardHoursPerDay: "8.00",
      reason: "Fictional retro salary correction",
    }).returning();

    const specifications = [
      { periodLabel: "M5_RELEASED_2025", organizationId: employer.id, status: "Released", periodStart: "2025-12-01", periodEnd: "2025-12-15", payDate: "2025-12-16" },
      { periodLabel: "M5_DRAFT_2025", organizationId: employer.id, status: "Draft", periodStart: "2025-11-01", periodEnd: "2025-11-15", payDate: "2025-11-16" },
      { periodLabel: "M5_WRONG_EMPLOYEE", organizationId: employer.id, status: "Released", periodStart: "2025-10-01", periodEnd: "2025-10-15", payDate: "2025-10-16" },
      { periodLabel: "M5_FOREIGN_TENANT", organizationId: otherEmployer.id, status: "Released", periodStart: "2025-09-01", periodEnd: "2025-09-15", payDate: "2025-09-16" },
      { periodLabel: "M5_CROSS_YEAR", organizationId: employer.id, status: "Released", periodStart: "2025-12-16", periodEnd: "2026-01-15", payDate: "2026-01-16" },
      { periodLabel: "M5_RELEASED_2026", organizationId: employer.id, status: "Released", periodStart: "2026-09-01", periodEnd: "2026-09-15", payDate: "2026-09-16" },
    ];
    const runs = await db.insert(payrollRuns).values(specifications).returning();
    const byLabel = new Map(runs.map(run => [run.periodLabel, run]));
    const runFor = (label: string) => {
      const run = byLabel.get(label);
      assert.ok(run, label);
      return run;
    };

    await db.insert(payrollEntries).values([
      { payrollRunId: runFor("M5_RELEASED_2025").id, employeeId: employee.id, grossPay: "15000.00", deductions: "2000.00", netPay: "13000.00" },
      { payrollRunId: runFor("M5_DRAFT_2025").id, employeeId: employee.id, grossPay: "15000.00", deductions: "2000.00", netPay: "13000.00" },
      { payrollRunId: runFor("M5_WRONG_EMPLOYEE").id, employeeId: differentEmployee.id, grossPay: "15000.00", deductions: "2000.00", netPay: "13000.00" },
      // Synthetic inconsistent cross-employer reference deliberately probes
      // the tenant boundary; payroll_entries has no organization_id itself.
      { payrollRunId: runFor("M5_FOREIGN_TENANT").id, employeeId: employee.id, grossPay: "15000.00", deductions: "2000.00", netPay: "13000.00" },
      { payrollRunId: runFor("M5_CROSS_YEAR").id, employeeId: employee.id, grossPay: "15000.00", deductions: "2000.00", netPay: "13000.00" },
      { payrollRunId: runFor("M5_RELEASED_2026").id, employeeId: employee.id, grossPay: "15000.00", deductions: "2000.00", netPay: "13000.00" },
    ]);

    const retroInput = specifications.map((spec, index) => ({
      organizationId: employer.id, employeeId: employee.id,
      revisionId: revision.id, sourcePayrollRunId: runFor(spec.periodLabel).id,
      sourcePeriodLabel: index === 0 ? "FALSE: current year!" : "UNTRUSTED",
      amount: index === 0 ? "250.25" : index === 5 ? "125.25" : "75.25",
    }));
    const adjustments = await db.insert(employeePayRetroAdjustments).values(retroInput).returning();
    const identity = adjustments.map(row => row.id);
    const records = await loadFinalPayRetroSourcePeriods({
      organizationId: employer.id, employeeId: employee.id, adjustmentIds: identity,
    });
    assert.equal(records.length, specifications.length, "invalid references remain in evidence as null, never disappear");
    const byAdjustment = new Map(records.map(row => [row.id, row]));
    const recordAt = (index: number) => {
      const record = byAdjustment.get(adjustments[index].id);
      assert.ok(record, "each settled line must retain evidence");
      return record;
    };

    assert.deepEqual([recordAt(0).sourcePeriodStart, recordAt(0).sourcePeriodEnd],
      ["2025-12-01", "2025-12-15"]);
    for (const index of [1, 2, 3]) {
      assert.equal(recordAt(index).sourcePeriodStart, null, "unreleased, wrong worker or foreign tenant must fail closed");
      assert.equal(recordAt(index).sourcePeriodEnd, null);
    }
    assert.deepEqual([recordAt(4).sourcePeriodStart, recordAt(4).sourcePeriodEnd],
      ["2025-12-16", "2026-01-15"]);
    assert.deepEqual([recordAt(5).sourcePeriodStart, recordAt(5).sourcePeriodEnd],
      ["2026-09-01", "2026-09-15"]);

    const attribution = {
      taxYear: 2026,
      sourceYearByAdjustmentId: new Map(records.map(row => [
        row.id, retroSourceTaxYear(String(row.sourcePeriodStart), String(row.sourcePeriodEnd)),
      ])),
    };
    assert.equal(readBasicAndThirteenth([
      { code: "BASIC", amount: "2000.00" },
      { code: `RETRO-${adjustments[0].id}`, amount: "250.25" },
      { code: `RETRO-${adjustments[5].id}`, amount: "125.25" },
    ], attribution).basic, 2125.25, "2025 source is excluded but 2026 source is included exactly");

    for (const index of [1, 2, 3, 4]) {
      assert.throws(() => readBasicAndThirteenth([
        { code: `RETRO-${adjustments[index].id}`, amount: "75.25" },
      ], attribution), /FINAL_PAY_RETRO_SOURCE_YEAR_UNVERIFIED/,
      "invalid source, including cross-year original cutoff, must block final pay");
    }

    assert.deepEqual(await loadFinalPayRetroSourcePeriods({
      organizationId: otherEmployer.id, employeeId: employee.id, adjustmentIds: identity,
    }), [], "a foreign employer cannot read the worker's retro evidence");
    assert.deepEqual(await loadFinalPayRetroSourcePeriods({
      organizationId: employer.id, employeeId: differentEmployee.id, adjustmentIds: identity,
    }), [], "a different worker cannot read these retro adjustments");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, employer.id));
    await db.delete(organizations).where(eq(organizations.id, otherEmployer.id));
  }
});
