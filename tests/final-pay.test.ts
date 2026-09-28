import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { calculateFinalPay, summarizeFinalPayHistory } from "../src/lib/final-pay";

const history = [
  {
    grossPay: "30000",
    lineItems: [
      { code: "BASIC", label: "Basic / worked pay", amount: "25000" },
      { code: "OT", label: "Overtime", amount: "5000" },
      { code: "WHT", label: "Withholding tax", amount: "-1000" },
    ],
    trace: { inputs: ["taxableCompensation=27000.00"] },
  },
  {
    grossPay: "30000",
    lineItems: [
      { code: "BASIC", label: "Basic / worked pay", amount: "25000" },
      { code: "OT", label: "Overtime", amount: "5000" },
      { code: "WHT", label: "Withholding tax", amount: "-1000" },
    ],
    trace: { inputs: ["taxableCompensation=27000.00"] },
  },
];

test("final-pay history reads BASIC, WHT and taxable compensation from released entries", () => {
  const summary = summarizeFinalPayHistory(history);
  assert.equal(summary.periods, 2);
  assert.equal(summary.gross, 60_000);
  assert.equal(summary.basicSalaryEarned, 50_000);
  assert.equal(summary.thirteenthPaid, 0);
  assert.equal(summary.taxable, 54_000);
  assert.equal(summary.taxWithheld, 2_000);
  assert.equal(summary.missingTaxableTrace, 0);
});

test("final pay annualizes tax and turns over-withholding into a refund", () => {
  const result = calculateFinalPay({
    history,
    unusedLeaveConversion: 1_000,
    unusedLeaveTaxTreatment: "taxable",
    otherDeductions: 500,
  });

  assert.equal(result.thirteenthMonth.gross, 4_166.67);
  assert.equal(result.thirteenthMonth.taxable, 0);
  assert.equal(result.annualTaxable, 55_000);
  assert.equal(result.annualTax, 0);
  assert.equal(result.taxRefund, 2_000);
  assert.equal(result.taxSettlement, 2_000);
  assert.equal(result.grossFinalPay, 5_166.67);
  assert.equal(result.netFinalPay, 6_666.67);
});

test("prior-employer taxable compensation participates in final-pay annualization", () => {
  const result = calculateFinalPay({
    history,
    priorEmployerTaxable: 400_000,
    priorEmployerTaxWithheld: 20_000,
  });

  assert.ok(result.annualTaxable > 400_000);
  assert.ok(result.annualTax > 0);
  assert.equal(result.ytdTaxWithheld, 2_000);
});

test("final pay exposes a balance due instead of silently clamping to zero", () => {
  const result = calculateFinalPay({
    history,
    otherDeductions: 20_000,
  });

  assert.ok(result.netFinalPay < 0);
  assert.equal(result.amountDueFromEmployee, Math.abs(result.netFinalPay));
});

test("missing taxable trace is explicit rather than guessed", () => {
  const result = calculateFinalPay({
    history: [{ grossPay: "10000", lineItems: [{ code: "BASIC", label: "Basic", amount: "10000" }] }],
  });

  assert.equal(result.ytdTaxable, 0);
  assert.ok(result.warnings.some((warning) => warning.includes("lack the stored taxable-compensation trace")));
});

test("all company-level payroll routes use the centralized payroll role gate", () => {
  for (const path of [
    "src/app/api/payroll-runs/route.ts",
    "src/app/api/payroll-runs/[id]/process/route.ts",
    "src/app/api/payroll-runs/[id]/release/route.ts",
    "src/app/api/payroll-runs/[id]/review/route.ts",
    "src/app/api/payroll-runs/[id]/parallel/route.ts",
    "src/app/api/payroll-runs/[id]/exports/route.ts",
    "src/app/api/year-end/route.ts",
    "src/app/api/exports/route.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.ok(source.includes("getAccess"), `${path} must resolve the member's access role`);
    assert.ok(source.includes("canOperatePayroll"), `${path} must enforce the centralized payroll role gate`);
  }

  const separation = readFileSync("src/app/api/separation/route.ts", "utf8");
  assert.ok(separation.includes("getAccess"));
  assert.ok(separation.includes("canManageSeparation"));
});

test("payroll approval route enforces maker-checker separation", () => {
  const source = readFileSync("src/app/api/approvals/[id]/route.ts", "utf8");
  const review = readFileSync("src/app/api/payroll-runs/[id]/review/route.ts", "utf8");
  assert.ok(source.includes("Payroll submitted for approval"));
  assert.ok(source.includes("Maker-checker control"));
  assert.ok(source.includes("submission?.actor"));
  assert.ok(review.includes("isPayrollOperatorRole(approver.role)"), "checker must also be a payroll operator");
});

test("Parallel Payroll is persisted and re-checked by review and release APIs", () => {
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const parallel = readFileSync("src/app/api/payroll-runs/[id]/parallel/route.ts", "utf8");
  const review = readFileSync("src/app/api/payroll-runs/[id]/review/route.ts", "utf8");
  const release = readFileSync("src/app/api/payroll-runs/[id]/release/route.ts", "utf8");

  assert.ok(schema.includes('parallel_payroll_rows'));
  assert.ok(parallel.includes("Parallel Payroll imported"));
  assert.ok(parallel.includes("10_000"));
  assert.ok(review.includes("parallelPayrollRows"));
  assert.ok(release.includes("parallelPayrollRows"));
});


test("final pay subtracts 13th-month amounts already paid during the year", () => {
  const result = calculateFinalPay({
    history: [
      ...history,
      {
        grossPay: "5000",
        lineItems: [{ code: "13TH", label: "13th month pay", amount: "3000" }],
        trace: { inputs: ["taxableCompensation=0"] },
      },
    ],
  });

  // BASIC history earns 4,166.67 of 13th month; 3,000 was already paid.
  assert.equal(result.thirteenthPaidYtd, 3_000);
  assert.equal(result.thirteenthMonth.gross, 1_166.67);
});


test("separation API refuses to guess final pay from incomplete released history", () => {
  const source = readFileSync("src/app/api/separation/route.ts", "utf8");
  assert.ok(source.includes("Released payroll history is incomplete"));
  assert.ok(source.includes("lack the stored taxable-compensation trace"));
  assert.ok(source.includes("no BASIC line items"));
});
