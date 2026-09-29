import assert from "node:assert/strict";
import test from "node:test";
import {
  annualize,
  renderForm2316,
  THIRTEENTH_MONTH_EXEMPTION_CAP,
} from "../src/lib/annualization";
import { BACKOFF_SCHEDULE_MS, nextBackoffMs } from "../src/lib/webhook-backoff";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  employeePayProfiles,
  employees,
  organizations,
  payrollEntries,
  payrollRuns,
} from "../src/db/schema";
import { computeFinalPayPackage } from "../src/lib/final-pay-service";
import {
  computeStatutoryRetirementPay,
  computeStatutorySeparationPay,
  computeThirteenthMonthBalance,
  finalPayDueDate,
  roundedYearsOfService,
  thirteenthMonthBasicFromEntry,
} from "../src/lib/final-pay";

test("13th month pay is exempt up to the 90,000 cap", () => {
  const under = annualize({ grossCompensation: 600_000, thirteenthMonth: 50_000, statutoryContributions: 0, taxWithheld: 0, mwe: false });
  assert.equal(under.exemptThirteenthMonth, 50_000);
  assert.equal(under.taxableThirteenthMonth, 0);

  const over = annualize({ grossCompensation: 600_000, thirteenthMonth: 130_000, statutoryContributions: 0, taxWithheld: 0, mwe: false });
  assert.equal(over.exemptThirteenthMonth, THIRTEENTH_MONTH_EXEMPTION_CAP);
  assert.equal(over.taxableThirteenthMonth, 40_000);
  assert.equal(over.taxableIncome, 510_000, "gross already contains the full 13th month, so the taxable excess must not be added twice");
  assert.equal(over.taxDue, 44_500);
});

test("annualization computes taxable income net of contributions and exemptions", () => {
  const result = annualize({
    grossCompensation: 600_000,
    thirteenthMonth: 50_000,
    statutoryContributions: 25_000,
    taxWithheld: 0,
    mwe: false,
  });
  // 600,000 + 0 taxable 13th - (50,000 exempt + 25,000 contributions) = 525,000
  assert.equal(result.taxableIncome, 525_000);
  // TRAIN: 22,500 + 20% over 400,000 => 22,500 + 25,000 = 47,500
  assert.equal(result.taxDue, 47_500);
});

test("over-withholding produces a December refund", () => {
  const result = annualize({
    grossCompensation: 600_000,
    thirteenthMonth: 50_000,
    statutoryContributions: 25_000,
    taxWithheld: 60_000,
    mwe: false,
  });
  assert.equal(result.taxDue, 47_500);
  assert.equal(result.adjustment, -12_500);
  assert.equal(result.outcome, "refund");
});

test("under-withholding produces a December collection", () => {
  const result = annualize({
    grossCompensation: 600_000,
    thirteenthMonth: 50_000,
    statutoryContributions: 25_000,
    taxWithheld: 30_000,
    mwe: false,
  });
  assert.equal(result.adjustment, 17_500);
  assert.equal(result.outcome, "collect");
});

test("exact withholding balances to zero", () => {
  const result = annualize({
    grossCompensation: 600_000,
    thirteenthMonth: 50_000,
    statutoryContributions: 25_000,
    taxWithheld: 47_500,
    mwe: false,
  });
  assert.equal(result.adjustment, 0);
  assert.equal(result.outcome, "balanced");
});

test("MWE is fully exempt and is refunded anything withheld in error", () => {
  const result = annualize({
    grossCompensation: 220_000,
    thirteenthMonth: 18_000,
    statutoryContributions: 9_000,
    taxWithheld: 1_200,
    mwe: true,
  });
  assert.equal(result.taxableIncome, 0);
  assert.equal(result.taxDue, 0);
  assert.equal(result.adjustment, -1_200);
  assert.equal(result.outcome, "refund");
});

test("income below the 250k threshold owes no tax", () => {
  const result = annualize({ grossCompensation: 240_000, thirteenthMonth: 20_000, statutoryContributions: 12_000, taxWithheld: 0, mwe: false });
  assert.equal(result.taxDue, 0);
  assert.equal(result.outcome, "balanced");
});

test("form 2316 draft states its own limits and shows the adjustment", () => {
  const result = annualize({ grossCompensation: 600_000, thirteenthMonth: 50_000, statutoryContributions: 25_000, taxWithheld: 60_000, mwe: false });
  const doc = renderForm2316({
    taxYear: 2026,
    employerName: "Loom & Local Philippines Inc.",
    employeeName: "Mariel Santos",
    employeeNo: "LL-101",
    result,
  });
  assert.ok(doc.includes("DRAFT - NOT A CERTIFIED SUBMISSION"));
  assert.ok(doc.includes("REFUND TO EMPLOYEE"));
  assert.ok(doc.includes("12,500.00"));
  assert.ok(doc.includes("Rule version: PH-2026.01"));
});

test("webhook retry backoff escalates then caps", () => {
  assert.equal(nextBackoffMs(1), 60_000);
  assert.equal(nextBackoffMs(2), 300_000);
  assert.equal(nextBackoffMs(3), 1_500_000);
  assert.equal(nextBackoffMs(4), 7_500_000);
  // Beyond the schedule length it stays at the final interval.
  assert.equal(nextBackoffMs(9), BACKOFF_SCHEDULE_MS[BACKOFF_SCHEDULE_MS.length - 1]);
});


test("13th month uses actual basic salary earned and pays only the remaining balance", () => {
  const basic = thirteenthMonthBasicFromEntry({
    grossPay: 16_500,
    lineItems: [
      { code: "BASIC", label: "Basic / worked pay", amount: "10000.00" },
      { code: "LEAVE-1", label: "Paid leave", amount: "1000.00" },
      { code: "LEAVE-2", label: "Unpaid leave", amount: "-500.00" },
      { code: "OT", label: "Overtime", amount: "5000.00" },
      { code: "RETRO-9", label: "Retro pay", amount: "1000.00" },
    ],
    trace: {},
  }, { eligibleRetroIds: new Set([9]) });

  assert.equal(basic, 11_500, "OT is excluded while basic, leave adjustments and eligible basic-salary retro remain in the 13th-month basis");

  const result = computeThirteenthMonthBalance({
    basicSalaryEarned: 240_000,
    alreadyPaid: 8_000,
    eligible: true,
  });
  assert.equal(result.entitlement, 20_000);
  assert.equal(result.balanceDue, 12_000);
  assert.equal(result.overpaid, 0);
});

test("13th month exclusion is explicit and does not invent a statutory benefit", () => {
  const result = computeThirteenthMonthBalance({
    basicSalaryEarned: 300_000,
    alreadyPaid: 0,
    eligible: false,
  });
  assert.equal(result.entitlement, 0);
  assert.equal(result.balanceDue, 0);
});

test("authorized-cause separation pay uses the statutory one-month and half-month formulas", () => {
  assert.equal(roundedYearsOfService("2023-01-01", "2026-07-01"), 4, "a service fraction of at least six months rounds up");

  const redundancy = computeStatutorySeparationPay({
    cause: "redundancy",
    monthlyEquivalent: 30_000,
    startDate: "2023-01-01",
    lastDay: "2026-07-01",
  });
  assert.equal(redundancy.amount, 120_000);

  const retrenchment = computeStatutorySeparationPay({
    cause: "retrenchment",
    monthlyEquivalent: 30_000,
    startDate: "2023-01-01",
    lastDay: "2026-07-01",
  });
  assert.equal(retrenchment.amount, 60_000);

  const shortService = computeStatutorySeparationPay({
    cause: "disease",
    monthlyEquivalent: 30_000,
    startDate: "2026-01-01",
    lastDay: "2026-05-31",
  });
  assert.equal(shortService.amount, 30_000, "half-month-per-year cases still keep the one-month minimum");
});

test("statutory retirement uses 22.5 daily-rate days per rounded service year and fails closed without eligibility facts", () => {
  const eligible = computeStatutoryRetirementPay({
    dailyRate: 1_000,
    startDate: "2016-01-01",
    lastDay: "2026-07-01",
    birthDate: "1965-01-01",
  });
  assert.equal(eligible.eligible, true);
  assert.equal(eligible.years, 11);
  assert.equal(eligible.amount, 247_500);

  const missingBirth = computeStatutoryRetirementPay({
    dailyRate: 1_000,
    startDate: "2016-01-01",
    lastDay: "2026-07-01",
    birthDate: null,
  });
  assert.equal(missingBirth.eligible, false);
  assert.match(missingBirth.blocker ?? "", /Birth date is required/);
});

test("final pay due date is 30 calendar days after separation", () => {
  assert.equal(finalPayDueDate("2026-09-30"), "2026-10-30");
});


test("final pay 13th-month balance comes from released basic salary, not the employee's current salary", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Final Pay Actual Basic Test",
    legalName: "Final Pay Actual Basic Test Inc.",
    plan: "Core",
  }).returning();

  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "FP-ACTUAL-BASIC",
      firstName: "Actual",
      lastName: "Basic",
      title: "Staff",
      avatarInitials: "AB",
      basicRate: "30000.00",
      thirteenthMonthEligible: true,
      startDate: "2025-01-01",
    }).returning();

    await db.insert(employeePayProfiles).values({
      employeeId: employee.id,
      organizationId: org.id,
      payBasis: "monthly",
      rateAmount: "30000.00",
      standardWorkDaysPerMonth: "22.00",
      standardHoursPerDay: "8.00",
    });

    const [firstRun, secondRun] = await db.insert(payrollRuns).values([
      {
        organizationId: org.id,
        periodLabel: "Jan 1–15, 2026",
        periodStart: "2026-01-01",
        periodEnd: "2026-01-15",
        scopeLabel: "All locations",
        status: "Released",
        payDate: "2026-01-15",
        employeeCount: 1,
        grossPay: "12000.00",
        netPay: "12000.00",
      },
      {
        organizationId: org.id,
        periodLabel: "Jan 16–31, 2026",
        periodStart: "2026-01-16",
        periodEnd: "2026-01-31",
        scopeLabel: "All locations",
        status: "Released",
        payDate: "2026-01-31",
        employeeCount: 1,
        grossPay: "12000.00",
        netPay: "12000.00",
      },
    ]).returning();

    await db.insert(payrollEntries).values([
      {
        payrollRunId: firstRun.id,
        employeeId: employee.id,
        grossPay: "12000.00",
        deductions: "0.00",
        netPay: "12000.00",
        status: "Ready",
        lineItems: [{ code: "BASIC", label: "Basic / worked pay", amount: "12000.00" }],
        trace: { inputs: ["deMinimisPaid=0.00", "deMinimisTaxableExcess=0.00"] },
      },
      {
        payrollRunId: secondRun.id,
        employeeId: employee.id,
        grossPay: "12000.00",
        deductions: "0.00",
        netPay: "12000.00",
        status: "Ready",
        lineItems: [{ code: "BASIC", label: "Basic / worked pay", amount: "12000.00" }],
        trace: { inputs: ["deMinimisPaid=0.00", "deMinimisTaxableExcess=0.00"] },
      },
    ]);

    const result = await computeFinalPayPackage({
      organizationId: org.id,
      employeeId: employee.id,
      separationType: "resignation",
      noticeDate: "2026-01-01",
      lastDay: "2026-01-31",
      unusedLeaveCredits: 0,
      leaveBasisNote: "",
      finalPayrollVerified: false,
      unpaidBasicSalary: 0,
      otherUnpaidTaxableEarnings: 0,
      additionalThirteenthMonthBasic: 0,
      deductOutstandingLoans: false,
      separationPayTaxExemptConfirmed: false,
      retirementPlanBenefit: 0,
      retirementPlanReference: "",
      retirementTaxExemptConfirmed: false,
      additionalCompanyBenefit: 0,
      additionalCompanyBenefitTaxable: true,
    });

    assert.deepEqual(result.snapshot.blockers, []);
    assert.equal(result.snapshot.thirteenthMonth.basicSalaryEarned, 24000);
    assert.equal(result.snapshot.thirteenthMonth.entitlement, 2000);
    assert.equal(result.snapshot.thirteenthMonth.balanceDue, 2000);
    assert.equal(result.columns.netFinalPay, 2000);
    assert.equal(result.columns.finalPayDueDate, "2026-03-02");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
