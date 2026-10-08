import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePayrollAssurance, payrollComponentsOf } from "../src/lib/payroll-assurance";
import { buildParallelPayrollComparison, parseParallelMoney } from "../src/lib/parallel-payroll";

function entry(input: Partial<{
  id: number;
  employeeId: number;
  grossPay: string;
  deductions: string;
  netPay: string;
  status: string;
  lineItems: unknown;
}> = {}) {
  return {
    id: input.id ?? 1,
    employeeId: input.employeeId ?? 10,
    grossPay: input.grossPay ?? "30000",
    deductions: input.deductions ?? "6000",
    netPay: input.netPay ?? "24000",
    status: input.status ?? "Ready",
    lineItems:
      input.lineItems ??
      [
        { code: "BASIC", label: "Basic", amount: "30000" },
        { code: "SSS", label: "SSS", amount: "-875" },
        { code: "PHIC", label: "PhilHealth", amount: "-750" },
        { code: "HDMF", label: "Pag-IBIG", amount: "-100" },
        { code: "WHT", label: "Tax", amount: "-3275" },
        { code: "LOAN-1", label: "Loan", amount: "-1000" },
      ],
    trace: {},
  };
}

test("payroll component breakdown normalizes statutory deductions and isolates other deductions", () => {
  const components = payrollComponentsOf(entry());

  assert.deepEqual(components, {
    gross: 30000,
    sss: 875,
    philHealth: 750,
    pagIbig: 100,
    withholdingTax: 3275,
    otherDeductions: 1000,
    net: 24000,
  });
});

test("parallel payroll compares all supported components using common header aliases", () => {
  const assurance = evaluatePayrollAssurance([entry()], []);
  const result = buildParallelPayrollComparison({
    records: [
      {
        "Employee Number": "EMP-001",
        "Gross Pay": "29,500.00",
        "SSS Contribution": "-875.00",
        PHIC: "700",
        HDMF: "100",
        WHT: "3,000.00",
        "Other Deductions": "800",
        "Net Pay": "24,025.00",
      },
    ],
    employees: [
      {
        id: 10,
        employeeNo: "EMP-001",
        firstName: "Ana",
        lastName: "Reyes",
      },
    ],
    comparisons: assurance.comparisons,
  });

  assert.deepEqual(result.detected.sort(), [
    "gross",
    "net",
    "otherDeductions",
    "pagIbig",
    "philHealth",
    "sss",
    "withholdingTax",
  ].sort());
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].differenceCount, 5);

  const byKey = new Map(result.rows[0].components.map((component) => [component.key, component]));
  assert.equal(byKey.get("gross")?.delta, 500);
  assert.equal(byKey.get("sss")?.delta, 0);
  assert.equal(byKey.get("philHealth")?.delta, 50);
  assert.equal(byKey.get("pagIbig")?.delta, 0);
  assert.equal(byKey.get("withholdingTax")?.delta, 275);
  assert.equal(byKey.get("otherDeductions")?.delta, 200);
  assert.equal(byKey.get("net")?.delta, -25);
});

test("parallel payroll flags two-cent differences but tolerates one cent", () => {
  const assurance = evaluatePayrollAssurance([entry()], []);
  const compare = (grossPay: string) => buildParallelPayrollComparison({
    records: [{ employee_no: "EMP-001", gross_pay: grossPay }],
    employees: [{ id: 10, employeeNo: "EMP-001", firstName: "Ana", lastName: "Reyes" }],
    comparisons: assurance.comparisons,
  }).rows[0].components[0];

  assert.equal(compare("29999.98").different, true);
  assert.equal(compare("29999.98").delta, 0.02);
  assert.equal(compare("29999.99").different, false);
  assert.equal(compare("30000.00").different, false);
});

test("parallel payroll can derive other deductions from total deductions", () => {
  const assurance = evaluatePayrollAssurance([entry()], []);
  const result = buildParallelPayrollComparison({
    records: [
      {
        employee_no: "EMP-001",
        sss: "875",
        philhealth: "750",
        pagibig: "100",
        withholding_tax: "3275",
        total_deductions: "6000",
        net_pay: "24000",
      },
    ],
    employees: [
      {
        id: 10,
        employeeNo: "EMP-001",
        firstName: "Ana",
        lastName: "Reyes",
      },
    ],
    comparisons: assurance.comparisons,
  });

  const row = result.rows[0];
  const other = row.components.find((component) => component.key === "otherDeductions");
  assert.ok(other, "other deductions should be derived when total deductions is present");
  assert.equal(other?.existing, 1000);
  assert.equal(other?.linaw, 1000);
  assert.equal(other?.delta, 0);
});

test("parallel payroll accepts partial payroll files and reports unmatched employees", () => {
  const assurance = evaluatePayrollAssurance([entry()], []);
  const result = buildParallelPayrollComparison({
    records: [
      { employee_no: "EMP-001", gross_pay: "30000" },
      { employee_no: "UNKNOWN-9", gross_pay: "31000" },
    ],
    employees: [
      {
        id: 10,
        employeeNo: "EMP-001",
        firstName: "Ana",
        lastName: "Reyes",
      },
    ],
    comparisons: assurance.comparisons,
  });

  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.detected, ["gross"]);
  assert.deepEqual(result.unmatchedEmployeeNumbers, ["UNKNOWN-9"]);
  assert.equal(result.rows[0].components.length, 1);
  assert.equal(result.rows[0].components[0].key, "gross");
});

test("parallel payroll money parser handles currency, commas, and accounting negatives", () => {
  assert.equal(parseParallelMoney("₱1,234.50"), 1234.5);
  assert.equal(parseParallelMoney("(875.25)"), -875.25);
  assert.equal(parseParallelMoney(""), null);
});
