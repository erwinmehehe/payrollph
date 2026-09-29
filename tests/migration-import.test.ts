import assert from "node:assert/strict";
import test from "node:test";
import { parseMigrationCsv } from "../src/lib/migration-import";

test("Sprout employee export aliases map into the canonical employee shape", () => {
  const result = parseMigrationCsv({
    source: "sprout",
    kind: "employees",
    csv: [
      "Employee ID,First Name,Last Name,Employment Status,Basic Salary,Email Address,Hire Date,TIN,SSS Number,PhilHealth PIN,Pag-IBIG No",
      "SP-001,Ana,Reyes,Regular,35000,ana@example.com,01/15/2024,123-456-789,12-3456789-0,12-345678901-2,1234-5678-9012",
    ].join("\n"),
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.rows.length, 1);
  const row = result.rows[0] as { employeeNo: string; monthlyBasic: number; status: string; tin: string | null; startDate: string | null };
  assert.equal(row.employeeNo, "SP-001");
  assert.equal(row.monthlyBasic, 35000);
  assert.equal(row.status, "Active");
  assert.equal(row.tin, "123456789");
  assert.equal(row.startDate, "2024-01-15");
});

test("inactive competitor statuses migrate into the non-active payroll cohort", () => {
  const result = parseMigrationCsv({
    source: "sprout",
    kind: "employees",
    csv: "Employee ID,First Name,Last Name,Employment Status,Basic Salary\nSP-2,Juan,Cruz,Resigned,25000\n",
  });

  const row = result.rows[0] as { status: string };
  assert.equal(row.status, "Separating");
});

test("GreatDay-style full name exports can be split when first/last columns are absent", () => {
  const result = parseMigrationCsv({
    source: "greatday",
    kind: "employees",
    csv: "Employee ID,Employee Name,Basic Salary\nGD-1,Maria Santos,42000\n",
  });

  assert.equal(result.errors.length, 0);
  const row = result.rows[0] as { firstName: string; lastName: string };
  assert.equal(row.firstName, "Maria");
  assert.equal(row.lastName, "Santos");
});

test("historical payroll imports preserve YTD components instead of recalculating them", () => {
  const result = parseMigrationCsv({
    source: "sprout",
    kind: "payroll_history",
    csv: [
      "Employee ID,Pay Date,Payroll Period,Gross Pay,Net Pay,Withholding Tax,SSS Contribution,PhilHealth Contribution,Pag-IBIG Contribution,13th Month Pay",
      "SP-001,2026-06-30,June 2,40000,33500,2500,900,500,100,0",
    ].join("\n"),
  });

  assert.equal(result.errors.length, 0);
  const row = result.rows[0] as {
    employeeNo: string;
    payDate: string;
    grossPay: number;
    taxWithheld: number;
    sssEmployee: number;
    philHealthEmployee: number;
    pagIbigEmployee: number;
  };
  assert.equal(row.employeeNo, "SP-001");
  assert.equal(row.payDate, "2026-06-30");
  assert.equal(row.grossPay, 40000);
  assert.equal(row.taxWithheld, 2500);
  assert.equal(row.sssEmployee, 900);
  assert.equal(row.philHealthEmployee, 500);
  assert.equal(row.pagIbigEmployee, 100);
});

test("Salarium-style leave balances and generic loans parse into opening balances", () => {
  const leave = parseMigrationCsv({
    source: "salarium",
    kind: "leave_balances",
    csv: "Employee ID,Leave Type,Year,Opening Balance,Accrued,Used,Pending\nE-1,Vacation,2026,5,10,3,1\n",
  });
  assert.equal(leave.errors.length, 0);
  assert.equal((leave.rows[0] as { opening: number }).opening, 5);

  const loan = parseMigrationCsv({
    source: "generic",
    kind: "loans",
    csv: "Employee No,Loan Type,Loan Number,Original Amount,Outstanding Balance,Monthly Deduction\nE-1,SSS Salary Loan,SSS-123,20000,12000,2000\n",
  });
  assert.equal(loan.errors.length, 0);
  const row = loan.rows[0] as { referenceNo: string; remainingBalance: number; monthlyAmortization: number; cutoffDeduction: number };
  assert.equal(row.referenceNo, "SSS-123");
  assert.equal(row.remainingBalance, 12000);
  assert.equal(row.monthlyAmortization, 2000);
  assert.equal(row.cutoffDeduction, 1000);
});

test("unknown columns stay visible to the user instead of disappearing silently", () => {
  const result = parseMigrationCsv({
    source: "generic",
    kind: "employees",
    csv: "Employee ID,First Name,Last Name,Basic Salary,Custom Cost Center\nE-9,Pat,Lim,30000,North\n",
  });

  assert.ok(result.unmappedColumns.includes("Custom Cost Center"));
  assert.equal(result.mappings.employeeNo, "Employee ID");
  assert.equal(result.mappings.monthlyBasic, "Basic Salary");
});
