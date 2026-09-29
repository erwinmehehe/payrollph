import test from "node:test";
import assert from "node:assert/strict";
import { buildPayExplanation } from "../src/lib/payroll-explain";

const current = {
  grossPay: "35625",
  deductions: "5200",
  netPay: "30425",
  lineItems: [
    { code: "BASIC", label: "Basic / worked pay", amount: "30000" },
    { code: "OT", label: "Overtime (25%)", amount: "5625" },
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
      "taxableCompensation=34025",
      "punches=10",
      "regularMinutes=4800",
      "overtimeMinutes=792",
      "nightMinutes=0",
      "tardinessMinutes=0",
      "undertimeMinutes=0",
      "sssMonthlySalaryCredit=35000",
      "philHealthContributionBase=60000",
      "pagIbigFundSalary=10000",
      "pagIbigEmployeeRate=0.02",
      "region=NCR",
      "mwe=false",
      "withholdingTable=RR11-2018-revised-2023+",
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

test("explain pay compares stored components and exposes calculation causes", () => {
  const result = buildPayExplanation(current, previous);

  assert.equal(result.netDelta, 4925);
  assert.equal(result.ruleVersion, "PH-2026.01");
  assert.equal(result.context.sssMonthlySalaryCredit, 35000);
  assert.equal(result.context.pagIbigEmployeeRate, 0.02);

  const overtime = result.lines.find((line) => line.code === "OT");
  assert.ok(overtime);
  assert.equal(overtime.previous, 0);
  assert.equal(overtime.current, 5625);
  assert.equal(overtime.delta, 5625);
  assert.match(overtime.reason, /13.2 hours of overtime/i);

  const withholding = result.lines.find((line) => line.code === "WHT");
  assert.ok(withholding);
  assert.equal(withholding.delta, 700);
  assert.equal(withholding.netEffectDelta, -700);
  assert.match(withholding.reason, /taxable compensation/i);
  assert.match(withholding.reason, /RR11-2018/i);
});

test("explain pay works without a previous released cutoff", () => {
  const result = buildPayExplanation(current, null);
  assert.equal(result.previousNet, null);
  assert.equal(result.netDelta, null);
  assert.ok(result.lines.every((line) => line.previous === null));
});
