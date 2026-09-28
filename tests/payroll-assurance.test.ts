import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePayrollAssurance } from "../src/lib/payroll-assurance";

function entry(input: Partial<{
  id: number;
  employeeId: number;
  grossPay: string;
  deductions: string;
  netPay: string;
  status: string;
  lineItems: unknown;
  trace: unknown;
}> = {}) {
  return {
    id: input.id ?? 1,
    employeeId: input.employeeId ?? 10,
    grossPay: input.grossPay ?? "30000",
    deductions: input.deductions ?? "5000",
    netPay: input.netPay ?? "25000",
    status: input.status ?? "Ready",
    lineItems:
      input.lineItems ??
      [
        { code: "BASIC", label: "Basic", amount: "30000" },
        { code: "SSS", label: "SSS", amount: "-875" },
        { code: "PHIC", label: "PhilHealth", amount: "-750" },
        { code: "HDMF", label: "Pag-IBIG", amount: "-100" },
        { code: "WHT", label: "Tax", amount: "-3275" },
      ],
    trace: input.trace ?? { flags: [] },
  };
}

test("payroll assurance explains a material net-pay change", () => {
  const current = entry({
    netPay: "32000",
    grossPay: "37000",
    lineItems: [
      { code: "BASIC", label: "Basic", amount: "30000" },
      { code: "OT", label: "Overtime", amount: "7000" },
      { code: "SSS", label: "SSS", amount: "-875" },
      { code: "PHIC", label: "PhilHealth", amount: "-750" },
      { code: "HDMF", label: "Pag-IBIG", amount: "-100" },
      { code: "WHT", label: "Tax", amount: "-3275" },
    ],
  });
  const previous = entry({ id: 2, netPay: "25000", grossPay: "30000" });

  const result = evaluatePayrollAssurance([current], [previous]);
  assert.equal(result.summary.materialChanges, 1);
  assert.equal(result.summary.blocking, 0);

  const variance = result.comparisons[0];
  assert.equal(variance.netDelta, 7000);
  assert.ok(variance.lineChanges.some((line) => line.code === "OT" && line.delta === 7000));
  assert.ok(result.findings.some((finding) => finding.code === "MATERIAL_NET_VARIANCE"));
});

test("hard payroll integrity failures block release", () => {
  const broken = entry({
    deductions: "32000",
    netPay: "0",
    lineItems: [
      { code: "BASIC", label: "Basic", amount: "30000" },
      { code: "SSS", label: "SSS", amount: "-875" },
    ],
  });

  const result = evaluatePayrollAssurance([broken], []);
  assert.ok(result.summary.blocking >= 2);
  assert.ok(result.findings.some((finding) => finding.code === "NONPOSITIVE_NET" && finding.blocking));
  assert.ok(result.findings.some((finding) => finding.code === "DEDUCTIONS_EXCEED_GROSS" && finding.blocking));
  assert.ok(result.findings.some((finding) =>
    finding.code === "MISSING_STATUTORY" &&
    finding.severity === "medium" &&
    !finding.blocking
  ));
});

test("reimbursements alone do not create a false statutory blocker", () => {
  const reimbursementOnly = entry({
    grossPay: "2500",
    deductions: "0",
    netPay: "2500",
    lineItems: [
      { code: "EXP-44", label: "Expense, Transport", amount: "2500" },
    ],
  });

  const result = evaluatePayrollAssurance([reimbursementOnly], []);
  assert.equal(result.summary.blocking, 0);
  assert.ok(!result.findings.some((finding) => finding.code === "MISSING_STATUTORY"));
});

test("engine exceptions require review but do not become hard blockers", () => {
  const flagged = entry({
    status: "Exception",
    trace: { flags: ["Incomplete punch pair, reviewer sign-off required"] },
  });

  const result = evaluatePayrollAssurance([flagged], []);
  assert.equal(result.summary.blocking, 0);
  assert.ok(result.findings.some((finding) => finding.code === "ENGINE_EXCEPTION" && finding.severity === "medium"));
});
