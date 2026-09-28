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

test("payroll and final-pay mutation routes explicitly reject employee-only memberships", () => {
  for (const path of [
    "src/app/api/payroll-runs/[id]/process/route.ts",
    "src/app/api/payroll-runs/[id]/release/route.ts",
    "src/app/api/payroll-runs/[id]/review/route.ts",
    "src/app/api/separation/route.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.ok(source.includes("getAccess"), `${path} must resolve the member's access role`);
    assert.ok(source.includes('access.role === "employee"'), `${path} must reject employee-only payroll access`);
  }
});

test("payroll approval route enforces maker-checker separation", () => {
  const source = readFileSync("src/app/api/approvals/[id]/route.ts", "utf8");
  assert.ok(source.includes("Payroll submitted for approval"));
  assert.ok(source.includes("Maker-checker control"));
  assert.ok(source.includes("submission?.actor"));
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
