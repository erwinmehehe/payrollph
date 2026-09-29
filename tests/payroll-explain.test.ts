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
