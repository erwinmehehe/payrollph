import test from "node:test";
import assert from "node:assert/strict";
import { buildPayExplanation } from "../src/lib/payroll-explain";

test("Explain This Pay compares stored components, leave and statutory causes", () => {
  const current = {
    grossPay: "32000",
    deductions: "5200",
    netPay: "26800",
    lineItems: [
      { code: "BASIC", label: "Basic / worked pay", amount: "30000" },
      { code: "LEAVE-91", label: "Paid leave, Annual leave", amount: "1000", notes: ["1 day(s) in this cutoff", "100% paid"] },
      { code: "OT", label: "Overtime (25%)", amount: "1000" },
      { code: "SSS", label: "SSS contribution", amount: "-875" },
      { code: "PHIC", label: "PhilHealth contribution", amount: "-625" },
      { code: "HDMF", label: "Pag-IBIG contribution", amount: "-100" },
      { code: "WHT", label: "Withholding tax", amount: "-3600" },
    ],
    trace: {
      ruleVersion: "PH-2026.01",
      inputs: [
        "basicRate=60000",
        "hourlyRate=340.91",
        "taxableCompensation=30400",
        "punches=10",
        "regularMinutes=4800",
        "overtimeMinutes=140.8",
        "nightMinutes=0",
        "tardinessMinutes=0",
        "undertimeMinutes=0",
        "paidLeaveDays=1",
        "unpaidLeaveDays=0",
        "leavePayAdjustment=1000",
        "sssMonthlySalaryCredit=35000",
        "philHealthContributionBase=60000",
        "pagIbigFundSalary=10000",
        "pagIbigEmployeeRate=0.02",
        "withholdingTable=RR11-2018-revised-2023+",
        "region=NCR",
        "mwe=false",
      ],
      flags: [],
    },
  };
  const previous = {
    grossPay: "30000",
    deductions: "4500",
    netPay: "25500",
    lineItems: [
      { code: "BASIC", label: "Basic / worked pay", amount: "30000" },
      { code: "SSS", label: "SSS contribution", amount: "-875" },
      { code: "PHIC", label: "PhilHealth contribution", amount: "-625" },
      { code: "HDMF", label: "Pag-IBIG contribution", amount: "-100" },
      { code: "WHT", label: "Withholding tax", amount: "-2900" },
    ],
    trace: { ruleVersion: "PH-2026.01", inputs: [] },
  };

  const result = buildPayExplanation(current, previous);
  assert.equal(result.netDelta, 1300);
  assert.equal(result.context.sssMonthlySalaryCredit, 35000);
  assert.equal(result.context.pagIbigEmployeeRate, 0.02);
  const leave = result.lines.find((line) => line.code === "LEAVE-91");
  assert.ok(leave);
  assert.equal(leave.netEffectDelta, 1000);
  assert.match(leave.reason, /100% paid/i);
  const withholding = result.lines.find((line) => line.code === "WHT");
  assert.ok(withholding);
  assert.equal(withholding.netEffectDelta, -700);
  assert.match(withholding.reason, /taxable compensation/i);
});

test("Explain This Pay works without a previous released cutoff", () => {
  const result = buildPayExplanation({
    grossPay: "1000",
    deductions: "100",
    netPay: "900",
    lineItems: [{ code: "BASIC", label: "Basic / worked pay", amount: "1000" }],
    trace: { ruleVersion: "PH-2026.01", inputs: ["punches=0"] },
  }, null);
  assert.equal(result.previousNet, null);
  assert.equal(result.netDelta, null);
  assert.ok(result.lines.every((line) => line.previous === null));
});

// Fictional December cutoff with an approved PHP 1,200 year-end refund: stored gross 15,000.00, stored deductions 528.70,
// net 14,471.30. The explanation must bucket lines exactly like the payslip (src/lib/payslip-line-buckets.ts), never by sign.
const refundEntry = {
  grossPay: "15000", deductions: "528.70", netPay: "14471.30",
  lineItems: [
    { code: "BASIC", label: "Basic / worked pay", amount: "15000" },
    { code: "SSS", label: "SSS contribution", amount: "-750" },
    { code: "PHIC", label: "PhilHealth contribution", amount: "-375" },
    { code: "HDMF", label: "Pag-IBIG contribution", amount: "-100" },
    { code: "WHT", label: "Withholding tax", amount: "-503.70" },
    { code: "YE-TAX-7", label: "BIR year-end tax refund (2026)", amount: "1200" },
  ],
  trace: { ruleVersion: "PH-2026.01", inputs: [] },
};
const withoutRefund = {
  grossPay: "15000", deductions: "1728.70", netPay: "13271.30",
  lineItems: refundEntry.lineItems.filter((item) => item.code !== "YE-TAX-7"),
  trace: { ruleVersion: "PH-2026.01", inputs: [] },
};

test("a year-end refund is a deduction credit in Explain This Pay, matching the corrected payslip", () => {
  const result = buildPayExplanation(refundEntry, withoutRefund);
  const refund = result.lines.find((line) => line.code === "YE-TAX-7")!;
  assert.equal(refund.direction, "deduction", "a refund is not an earning");
  assert.equal(refund.current, -1200, "shown as a credit in the deductions section");
  assert.equal(refund.previous, 0);
  assert.equal(refund.netEffectDelta, 1200, "the credit raises net pay by exactly the refund");
  assert.match(refund.reason, /refund/i);
  assert.equal(result.netDelta, 1200);
  // Section sums equal the stored totals, as on the payslip.
  const earnings = result.lines.filter((line) => line.direction === "earning").reduce((sum, line) => sum + Math.round(line.current * 100), 0);
  const deductions = result.lines.filter((line) => line.direction === "deduction").reduce((sum, line) => sum + Math.round(line.current * 100), 0);
  assert.equal(earnings, 1500000, "earnings equal stored gross");
  assert.equal(deductions, 52870, "deductions equal stored deductions");
  assert.equal(earnings - deductions, 1447130, "sections reconcile to stored net");
  // Withheld deductions keep their positive display amount.
  assert.equal(result.lines.find((line) => line.code === "SSS")!.current, 750);
  assert.equal(result.lines.find((line) => line.code === "SSS")!.direction, "deduction");
});

test("unpaid leave and negative retro stay earnings, and a year-end collection stays a deduction", () => {
  const current = {
    grossPay: "14318.18", deductions: "800", netPay: "13518.18",
    lineItems: [
      { code: "BASIC", label: "Basic / worked pay", amount: "15000" },
      { code: "LEAVE-5", label: "Unpaid leave", amount: "-681.82" },
      { code: "YE-TAX-8", label: "BIR year-end tax collection (2026)", amount: "-800" },
    ],
    trace: { ruleVersion: "PH-2026.01", inputs: [] },
  };
  const result = buildPayExplanation(current, null);
  const leave = result.lines.find((line) => line.code === "LEAVE-5")!;
  assert.equal(leave.direction, "earning", "unpaid leave reduces gross, so it is an earnings line");
  assert.equal(leave.current, -681.82);
  const collection = result.lines.find((line) => line.code === "YE-TAX-8")!;
  assert.equal(collection.direction, "deduction");
  assert.equal(collection.current, 800);
  assert.match(collection.reason, /collection/i);
});

test("net effect of a changed line has the right sign in every bucket", () => {
  const previous = { ...withoutRefund };
  const current = {
    ...withoutRefund, grossPay: "14318.18", netPay: "12590.00", deductions: "1728.18",
    lineItems: withoutRefund.lineItems.map((item) => item.code === "BASIC" ? { ...item, amount: "14318.18" } : item),
  };
  const result = buildPayExplanation(current, previous);
  const basic = result.lines.find((line) => line.code === "BASIC")!;
  assert.equal(basic.direction, "earning");
  assert.equal(basic.netEffectDelta, -681.82);
  const wht = result.lines.find((line) => line.code === "WHT")!;
  assert.equal(wht.delta, 0);
  assert.equal(wht.netEffectDelta === 0 || Object.is(wht.netEffectDelta, -0), true);
});
