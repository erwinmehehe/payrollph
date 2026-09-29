import test from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { db } from "../src/db";
import {
  employeePayAdjustments,
  employeePayRateChanges,
  employees,
  historicalPayrollEntries,
  organizations,
  payrollEntries,
  payrollRuns,
} from "../src/db/schema";
import {
  basicSalaryEarnedForYear,
  buildPaySegments,
  calculateSegmentedBasicPay,
} from "../src/lib/pay-history";
import { ensureEmployeePayHistory } from "../src/lib/pay-basis-schema";
import { recordEffectivePayChange } from "../src/lib/pay-history-server";
import { buildEmployeeYearLedger } from "../src/lib/compensation-ledger";

test("monthly salary change inside a cutoff is segmented by effective date", () => {
  const segments = buildPaySegments({
    fallback: {
      payBasis: "monthly",
      rateAmount: 30000,
      standardWorkDaysPerMonth: 22,
      standardHoursPerDay: 8,
    },
    changes: [
      {
        id: 1,
        effectiveFrom: "2025-01-01",
        payBasis: "monthly",
        rateAmount: 30000,
        standardWorkDaysPerMonth: 22,
        standardHoursPerDay: 8,
      },
      {
        id: 2,
        effectiveFrom: "2026-09-21",
        payBasis: "monthly",
        rateAmount: 36000,
        standardWorkDaysPerMonth: 22,
        standardHoursPerDay: 8,
      },
    ],
    periodStart: "2026-09-16",
    periodEnd: "2026-09-30",
  });

  assert.equal(segments.length, 2);
  assert.deepEqual(segments.map((segment) => [segment.start, segment.end, segment.profile.rateAmount]), [
    ["2026-09-16", "2026-09-20", 30000],
    ["2026-09-21", "2026-09-30", 36000],
  ]);

  const pay = calculateSegmentedBasicPay({
    segments,
    punches: [],
    periodStart: "2026-09-16",
    periodEnd: "2026-09-30",
  });
  assert.equal(pay.basicPay, 17000);
  assert.equal(pay.changedWithinCutoff, true);
});

test("pay-basis switches inside a cutoff fail closed", () => {
  const segments = buildPaySegments({
    fallback: {
      payBasis: "monthly",
      rateAmount: 30000,
      standardWorkDaysPerMonth: 22,
      standardHoursPerDay: 8,
    },
    changes: [
      {
        effectiveFrom: "2025-01-01",
        payBasis: "monthly",
        rateAmount: 30000,
        standardWorkDaysPerMonth: 22,
        standardHoursPerDay: 8,
      },
      {
        effectiveFrom: "2026-09-21",
        payBasis: "daily",
        rateAmount: 1500,
        standardWorkDaysPerMonth: 22,
        standardHoursPerDay: 8,
      },
    ],
    periodStart: "2026-09-16",
    periodEnd: "2026-09-30",
  });

  assert.throws(
    () => calculateSegmentedBasicPay({
      segments,
      punches: [],
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
    }),
    /pay-basis change cannot take effect inside one payroll cutoff/,
  );
});

test("13th-month basic salary ledger excludes OT but includes unpaid leave and same-year retro basic", () => {
  const earned = basicSalaryEarnedForYear([
    { code: "BASIC", amount: "15000.00" },
    { code: "LEAVE-17", amount: "-1000.00" },
    { code: "OT", amount: "2500.00" },
    { code: "LEAVE_CONV-2", amount: "800.00" },
    { code: "RETRO_BASIC-3", amount: "1200.00", serviceYear: 2026, thirteenthMonthEligible: true },
    { code: "RETRO_BASIC-4", amount: "900.00", serviceYear: 2025, thirteenthMonthEligible: true },
  ], 2026, 2026);

  assert.equal(earned, 15200);
});

test("retroactive same-basis increase creates a pending adjustment only for runs that contained the employee", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Effective Pay Retro Test",
    legalName: "Effective Pay Retro Test Inc.",
    plan: "Core",
  }).returning();

  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "RETRO-001",
      firstName: "Retro",
      lastName: "Employee",
      title: "Staff",
      avatarInitials: "RE",
      basicRate: "30000.00",
      bankAccount: "1234567890",
      bankCode: "BDO",
      startDate: "2025-01-01",
    }).returning();

    await ensureEmployeePayHistory(org.id);

    const [employeeRun, unrelatedRun] = await db.insert(payrollRuns).values([
      {
        organizationId: org.id,
        periodLabel: "Sep 1–15, 2026 employee",
        periodStart: "2026-09-01",
        periodEnd: "2026-09-15",
        scopeLabel: "All locations",
        status: "Released",
        payDate: "2026-09-15",
        employeeCount: 1,
      },
      {
        organizationId: org.id,
        periodLabel: "Aug 16–31, 2026 unrelated",
        periodStart: "2026-08-16",
        periodEnd: "2026-08-31",
        scopeLabel: "Other unit",
        status: "Released",
        payDate: "2026-08-31",
        employeeCount: 1,
      },
    ]).returning();

    await db.insert(payrollEntries).values({
      payrollRunId: employeeRun.id,
      employeeId: employee.id,
      grossPay: "15000.00",
      deductions: "0.00",
      netPay: "15000.00",
      status: "Ready",
      lineItems: [{ code: "BASIC", label: "Basic", amount: "15000.00" }],
      trace: {},
    });
    void unrelatedRun;

    const result = await recordEffectivePayChange({
      organizationId: org.id,
      employeeId: employee.id,
      effectiveFrom: "2026-09-10",
      payProfile: {
        payBasis: "monthly",
        rateAmount: 36000,
        standardWorkDaysPerMonth: 22,
        standardHoursPerDay: 8,
      },
      reason: "Promotion effective Sep 10",
      actor: "Payroll QA",
    });

    assert.equal(result.retroAdjustments.length, 1);
    assert.equal(result.retroAdjustments[0].amount, 1200);
    assert.equal(result.retroAdjustments[0].status, "pending");

    const stored = await db.select().from(employeePayAdjustments)
      .where(eq(employeePayAdjustments.employeeId, employee.id));
    assert.equal(stored.length, 1);
    assert.equal(Number(stored[0].amount), 1200);
    assert.equal(stored[0].serviceFrom, "2026-09-10");
    assert.equal(stored[0].serviceThrough, "2026-09-15");

    const changes = await db.select().from(employeePayRateChanges)
      .where(eq(employeePayRateChanges.employeeId, employee.id));
    assert.equal(changes.some((change) => String(change.effectiveFrom) === "2026-09-10"), true);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("negative retro correction is held for review and never auto-deducted", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Negative Retro Review Test",
    legalName: "Negative Retro Review Test Inc.",
    plan: "Core",
  }).returning();

  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "RETRO-NEG",
      firstName: "Negative",
      lastName: "Retro",
      title: "Staff",
      avatarInitials: "NR",
      basicRate: "30000.00",
      startDate: "2025-01-01",
    }).returning();
    await ensureEmployeePayHistory(org.id);

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Sep 1–15, 2026",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-15",
      scopeLabel: "All locations",
      status: "Released",
      payDate: "2026-09-15",
      employeeCount: 1,
    }).returning();
    await db.insert(payrollEntries).values({
      payrollRunId: run.id,
      employeeId: employee.id,
      grossPay: "15000.00",
      deductions: "0.00",
      netPay: "15000.00",
      status: "Ready",
      lineItems: [{ code: "BASIC", label: "Basic", amount: "15000.00" }],
      trace: {},
    });

    const result = await recordEffectivePayChange({
      organizationId: org.id,
      employeeId: employee.id,
      effectiveFrom: "2026-09-10",
      payProfile: {
        payBasis: "monthly",
        rateAmount: 24000,
        standardWorkDaysPerMonth: 22,
        standardHoursPerDay: 8,
      },
      actor: "Payroll QA",
      reason: "Correction requiring review",
    });

    assert.equal(result.retroAdjustments[0].amount, -1200);
    assert.equal(result.retroAdjustments[0].status, "review");
    const [stored] = await db.select().from(employeePayAdjustments)
      .where(eq(employeePayAdjustments.employeeId, employee.id));
    assert.equal(stored.status, "review");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("year ledger uses actual basic salary earned and blocks missing migrated basic salary", async () => {
  const [org] = await db.insert(organizations).values({
    name: "13th Month Ledger Test",
    legalName: "13th Month Ledger Test Inc.",
    plan: "Core",
  }).returning();

  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "13TH-001",
      firstName: "Actual",
      lastName: "Basic",
      title: "Staff",
      avatarInitials: "AB",
      basicRate: "30000.00",
      startDate: "2025-01-01",
    }).returning();

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Sep 1–15, 2026",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-15",
      scopeLabel: "All locations",
      status: "Released",
      payDate: "2026-09-15",
      employeeCount: 1,
    }).returning();
    await db.insert(payrollEntries).values({
      payrollRunId: run.id,
      employeeId: employee.id,
      grossPay: "16500.00",
      deductions: "0.00",
      netPay: "16500.00",
      status: "Ready",
      lineItems: [
        { code: "BASIC", label: "Basic", amount: "15000.00" },
        { code: "LEAVE-1", label: "Unpaid leave", amount: "-1000.00" },
        { code: "OT", label: "Overtime", amount: "2500.00" },
      ],
      trace: {},
    });

    await db.insert(historicalPayrollEntries).values({
      organizationId: org.id,
      employeeId: employee.id,
      sourceSystem: "generic",
      sourceReference: "JAN-IMPORT",
      periodLabel: "Jan 1–15, 2026",
      payDate: "2026-01-15",
      grossPay: "10000.00",
      netPay: "9000.00",
      taxWithheld: "500.00",
      sssEmployee: "200.00",
      philHealthEmployee: "150.00",
      pagIbigEmployee: "100.00",
      thirteenthMonth: "0.00",
      basicSalaryEarned: "10000.00",
    });

    let ledger = await buildEmployeeYearLedger({
      organizationId: org.id,
      employeeId: employee.id,
      taxYear: 2026,
      throughDate: "2026-09-15",
    });
    assert.equal(ledger.basicSalaryEarned, 24000);
    assert.equal(ledger.thirteenthMonthAccrued, 2000);
    assert.equal(ledger.dataComplete, true);

    await db.insert(historicalPayrollEntries).values({
      organizationId: org.id,
      employeeId: employee.id,
      sourceSystem: "generic",
      sourceReference: "FEB-MISSING-BASIC",
      periodLabel: "Feb 1–15, 2026",
      payDate: "2026-02-15",
      grossPay: "10000.00",
      netPay: "9000.00",
      taxWithheld: "500.00",
      sssEmployee: "200.00",
      philHealthEmployee: "150.00",
      pagIbigEmployee: "100.00",
      thirteenthMonth: "0.00",
      basicSalaryEarned: null,
    });

    ledger = await buildEmployeeYearLedger({
      organizationId: org.id,
      employeeId: employee.id,
      taxYear: 2026,
      throughDate: "2026-09-15",
    });
    assert.equal(ledger.dataComplete, false);
    assert.equal(ledger.importedBasicSalaryMissing, 1);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("final-pay route fails closed instead of estimating salary and tax", () => {
  const route = readFileSync("src/app/api/separation/route.ts", "utf8");
  assert.ok(route.includes("buildEmployeeYearLedger"));
  assert.ok(route.includes("requiresUnpaidBasicSalary"));
  assert.ok(route.includes("basicSalaryEarnedYtd"));
  assert.ok(route.includes("thirteenthMonthPreviouslyPaid"));
  assert.ok(route.includes("taxReviewRequired"));
  assert.ok(route.includes('action === "release"'));
  assert.equal(route.includes("monthsWorkedInYear"), false);
  assert.equal(route.includes("monthlyBasic * monthsWorkedInYear"), false);
});
