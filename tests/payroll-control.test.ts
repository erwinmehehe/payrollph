import assert from "node:assert/strict";
import test from "node:test";
import {
  auditPayrollControl,
  explainPayrollEntry,
  parseParallelPayrollCsv,
} from "../src/lib/payroll-control";

const employees = [
  { id: 1, employeeNo: "LL-101", firstName: "Jonas", lastName: "Reyes" },
  { id: 2, employeeNo: "LL-102", firstName: "Aira", lastName: "Villanueva" },
];

const current = [
  {
    id: 11,
    employeeId: 1,
    grossPay: "35000",
    deductions: "5000",
    netPay: "30000",
    status: "Ready",
    trace: { flags: [] },
    lineItems: [
      { code: "BASIC", label: "Basic pay", amount: "33000" },
      { code: "OT", label: "Overtime", amount: "2000" },
      { code: "SSS", label: "SSS", amount: "-1750" },
      { code: "PHIC", label: "PhilHealth", amount: "-1000" },
      { code: "HDMF", label: "Pag-IBIG", amount: "-200" },
      { code: "TAX", label: "Withholding tax", amount: "-2050" },
    ],
  },
  {
    id: 12,
    employeeId: 2,
    grossPay: "40000",
    deductions: "14000",
    netPay: "26000",
    status: "Exception",
    trace: { flags: ["Incomplete punch pair, reviewer sign-off required"] },
    lineItems: [
      { code: "BASIC", label: "Basic pay", amount: "40000" },
      { code: "SSS", label: "SSS", amount: "-1750" },
      { code: "PHIC", label: "PhilHealth", amount: "-1000" },
      { code: "HDMF", label: "Pag-IBIG", amount: "-200" },
      { code: "TAX", label: "Withholding tax", amount: "-11050" },
    ],
  },
];

const previous = [
  {
    id: 1,
    employeeId: 1,
    grossPay: "31000",
    deductions: "4000",
    netPay: "27000",
    status: "Ready",
    lineItems: [
      { code: "BASIC", label: "Basic pay", amount: "31000" },
      { code: "SSS", label: "SSS", amount: "-1750" },
      { code: "PHIC", label: "PhilHealth", amount: "-1000" },
      { code: "HDMF", label: "Pag-IBIG", amount: "-200" },
      { code: "TAX", label: "Withholding tax", amount: "-1050" },
    ],
  },
];

test("parallel payroll CSV accepts employee_no and net_pay", () => {
  const result = parseParallelPayrollCsv("employee_no,name,net_pay\nLL-101,Jonas Reyes,29500\nLL-102,Aira Villanueva,26000");
  assert.equal(result.errors.length, 0);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].employeeNo, "LL-101");
  assert.equal(result.rows[0].netPay, 29_500);
});

test("payroll auditor detects prior-pay and parallel-payroll variances", () => {
  const result = auditPayrollControl({
    entries: current,
    employees,
    previousEntries: previous,
    parallelRows: [
      { employeeNo: "LL-101", netPay: 29_000 },
      { employeeNo: "LL-102", netPay: 26_000 },
    ],
  });

  assert.ok(result.issues.some((issue) => issue.code === "NET_VARIANCE" && issue.employeeId === 1));
  assert.ok(result.issues.some((issue) => issue.code === "PARALLEL_VARIANCE" && issue.employeeId === 1));
  assert.ok(result.issues.some((issue) => issue.code === "ENGINE_EXCEPTION" && issue.employeeId === 2));
  assert.equal(result.variances.find((row) => row.employeeId === 1)?.referenceDelta, 1_000);
});

test("a large parallel-payroll mismatch is blocking", () => {
  const result = auditPayrollControl({
    entries: [current[0]],
    employees,
    parallelRows: [{ employeeNo: "LL-101", netPay: 28_000 }],
  });

  const issue = result.issues.find((row) => row.code === "PARALLEL_VARIANCE");
  assert.equal(issue?.severity, "high");
  assert.equal(result.readiness.verdict, "blocked");
});

test("configured pending maker-checker approval keeps readiness in review", () => {
  const result = auditPayrollControl({
    entries: [current[0]],
    employees,
    approvalTask: {
      id: 7,
      title: "Review payroll",
      detail: "Checker sign-off",
      approver: "Mariel Santos",
      status: "Pending",
    },
  });

  const approval = result.readiness.checks.find((check) => check.key === "approval");
  assert.equal(approval?.state, "review");
  assert.equal(result.readiness.verdict, "review");
});

test("explain pay shows line-item changes and previous net delta", () => {
  const explanation = explainPayrollEntry({
    entry: current[0],
    employee: employees[0],
    previousEntry: previous[0],
    parallelRow: { employeeNo: "LL-101", netPay: 29_500 },
  });

  assert.equal(explanation.previousDelta, 3_000);
  assert.equal(explanation.referenceDelta, 500);
  assert.equal(explanation.changes[0].code, "BASIC");
  assert.equal(explanation.changes[0].delta, 2_000);
});

test("unreconciled stored line items block release readiness", () => {
  const result = auditPayrollControl({
    entries: [
      {
        ...current[0],
        grossPay: "36000",
      },
    ],
    employees,
  });

  assert.ok(result.issues.some((issue) => issue.code === "UNRECONCILED_LINES" && issue.severity === "high"));
  assert.equal(result.readiness.verdict, "blocked");
});
