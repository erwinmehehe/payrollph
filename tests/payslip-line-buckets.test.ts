import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deductionDisplayAmount, payslipLineBucket, payslipSectionTotals, splitPayslipLines } from "../src/lib/payslip-line-buckets";

// Stored lines of a released December cutoff with an approved PHP 1,200 year-end refund (fictional):
// gross 15,000.00, stored deductions 528.70 (1,728.70 withheld less the refund), net 14,471.30.
const refundCutoff = [
  { code: "BASIC", label: "Basic / worked pay", amount: "15000.00" },
  { code: "SSS", label: "SSS contribution", amount: "-750.00" },
  { code: "PHIC", label: "PhilHealth contribution", amount: "-375.00" },
  { code: "HDMF", label: "Pag-IBIG mandatory contribution", amount: "-100.00" },
  { code: "HDMF_VOL", label: "Pag-IBIG voluntary contribution", amount: "0.00" },
  { code: "WHT", label: "Withholding tax", amount: "-503.70" },
  { code: "YE-TAX-7", label: "BIR year-end tax refund (2026)", amount: "1200.00" },
];

test("a year-end refund is a deduction credit, so both payslip sections add up to the stored totals", () => {
  const { earnings, deductions } = splitPayslipLines(refundCutoff);
  assert.deepEqual(earnings.map((line) => line.code), ["BASIC"], "the refund is not compensation and is not listed under earnings");
  assert.deepEqual(deductions.map((line) => line.code), ["SSS", "PHIC", "HDMF", "WHT", "YE-TAX-7"], "zero lines are not printed");
  assert.equal(deductionDisplayAmount(refundCutoff[6]), -1200, "the refund prints as a credit in the deductions section");
  assert.equal(deductionDisplayAmount(refundCutoff[1]), 750, "money withheld prints as a positive deduction");
  const totals = payslipSectionTotals(refundCutoff);
  assert.equal(totals.earnings, 15000, "earnings section equals stored gross");
  assert.equal(totals.deductions, 528.7, "deductions section equals stored deductions");
  assert.equal(Math.round((totals.earnings - totals.deductions) * 100), 1447130, "sections reconcile to stored net");
});

test("a year-end collection, loans, advances and benefits stay deductions; unpaid leave and negative retro stay earnings", () => {
  assert.equal(payslipLineBucket({ code: "YE-TAX-8", amount: "-800.00" }), "deduction");
  for (const code of ["LOAN-1", "EWA-2", "ADV-3", "BEN-4", "LATE", "UT"]) assert.equal(payslipLineBucket({ code, amount: "-10.00" }), "deduction", code);
  assert.equal(payslipLineBucket({ code: "LEAVE-5", amount: "-681.82" }), "earning", "unpaid leave reduces gross");
  assert.equal(payslipLineBucket({ code: "RETRO-6", amount: "-120.00" }), "earning", "a negative retro reduces gross");
  assert.equal(payslipLineBucket({ code: "LEAVE_CONV-9", amount: "6818.20" }), "earning");
  assert.equal(payslipLineBucket({ code: "UNPAID_MANDATORY", amount: "0.00" }), null, "informational zero lines are not printed");
  assert.equal(payslipLineBucket({ code: "SOMETHING-NEW", amount: "-5.00" }), "deduction", "unknown negative codes fall back to the sign");
  assert.equal(payslipLineBucket({ code: "SOMETHING-NEW", amount: "5.00" }), "earning", "unknown positive codes fall back to the sign");
});

test("every payslip view uses the shared bucket classifier instead of splitting by sign", () => {
  for (const file of ["src/app/api/self/payslips/[id]/route.ts", "src/components/self-service-portal.tsx", "src/components/workspace/payroll-run.tsx"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /splitPayslipLines\(/, file + " must classify lines by economic bucket");
    assert.match(source, /deductionDisplayAmount\(/, file + " must print refunds as deduction credits");
    assert.doesNotMatch(source, /\.filter\(\((?:item|line)\) => Number\((?:item|line)\.amount(?: \?\? 0)?\) [<>] 0\)/, file + " still splits payslip lines by sign");
  }
});
