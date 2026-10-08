import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv, parseEmployeeCsv, parseEmployeeRow } from "../src/lib/csv-import";
import { WAGE_ORDERS } from "../src/lib/wage-orders";

const START = "2025-05-17";
const employee = (more: Record<string, string> = {}) => ({
  employeeNo: "E1",
  firstName: "Ana",
  lastName: "Reyes",
  startDate: START,
  monthlyBasic: "20000.00",
  ...more,
});

test("csv parser handles quoted fields, doubled quotes and CRLF", () => {
  const rows = parseCsv('a,b,c\r\n"1,000","say ""hi""",plain\n');
  assert.deepEqual(rows, [["a", "b", "c"], ["1,000", 'say "hi"', "plain"]]);
});

test("customers can upload aliased column names and order", () => {
  const result = parseEmployeeCsv(
    "Employee No,Last Name,First Name,Hire Date,Basic Pay,Region\nEMP-1,Dela Cruz,Juan,2024-11-15,21500,NCR\n",
  );
  assert.equal(result.valid.length, 1);
  assert.equal(result.valid[0].lastName, "Dela Cruz");
  assert.equal(result.valid[0].startDate, "2024-11-15");
  assert.equal(result.valid[0].monthlyBasic, 21500);
});

test("unknown extra columns are ignored and reported", () => {
  const result = parseEmployeeCsv(
    "Employee No,First Name,Last Name,Start Date,Monthly Basic,Birthday,Favorite Color\nE1,Ana,Reyes,2025-05-17,20000,1990-01-01,Blue\n",
  );
  assert.equal(result.valid.length, 1);
  assert.ok(result.unmapped.includes("Birthday"));
  assert.ok(result.unmapped.includes("Favorite Color"));
});

test("currency symbols, commas and whitespace in amounts are accepted", () => {
  const parsed = parseEmployeeRow(employee({ monthlyBasic: "₱ 21,500.00" }));
  assert.ok(parsed.ok);
  if (parsed.ok) assert.equal(parsed.value.monthlyBasic, 21500);
});

test("each invalid field produces a specific, reviewable error", () => {
  const parsed = parseEmployeeRow(employee({
    employeeNo: "",
    lastName: "",
    monthlyBasic: "abc",
    region: "MARS",
    email: "nope",
    mobile: "123",
  }));
  assert.ok(!parsed.ok);
  if (!parsed.ok) {
    const joined = parsed.problems.join("; ");
    assert.ok(joined.includes("employeeNo is required"));
    assert.ok(joined.includes("lastName is required"));
    assert.ok(joined.includes('monthlyBasic "abc" is not a number'));
    assert.ok(joined.includes('region "MARS"'));
    assert.ok(joined.includes('email "nope"'));
    assert.ok(joined.includes('mobile "123" must be 11 digits starting 09'));
  }
});

test("below-screening-rate rows never infer minimum-wage-earner status", () => {
  const parsed = parseEmployeeRow(employee({ employeeNo: "E9", monthlyBasic: "6450", region: "NCR" }));
  assert.ok(parsed.ok);
  if (parsed.ok) assert.equal(parsed.value.mwe, false, "MWE is an explicit employer decision");
});

test("explicit MWE yes/no variants parse and unknown values fail", () => {
  for (const flag of ["yes", "YES", "y", "true", "1"]) {
    const parsed = parseEmployeeRow(employee({ mwe: flag }));
    assert.ok(parsed.ok);
    if (parsed.ok) assert.equal(parsed.value.mwe, true, flag);
  }
  const bad = parseEmployeeRow(employee({ mwe: "maybe" }));
  assert.ok(!bad.ok);
  if (!bad.ok) assert.ok(bad.problems.join(" ").includes("mwe must be"));
});

test("a header-only file is rejected with a clear message", () => {
  const result = parseEmployeeCsv("Employee No,First Name\n");
  assert.equal(result.valid.length, 0);
  assert.equal(result.errors[0].problems[0], "CSV needs a header row and at least one data row");
});

test("employment start date must exist and be a real calendar date", () => {
  for (const bad of ["", "2026-02-30", "2025-13-01", "01/01/2024"]) {
    const parsed = parseEmployeeRow(employee({ startDate: bad }));
    assert.equal(parsed.ok, false, bad);
  }
  const missingColumn = parseEmployeeCsv(
    "Employee No,First Name,Last Name,Monthly Basic\nE1,Ana,Reyes,20000\n",
  );
  assert.equal(missingColumn.valid.length, 0);
  assert.match(missingColumn.errors[0].problems.join(" "), /Missing required CSV columns: startDate/);
  const leap = parseEmployeeRow(employee({ startDate: "2024-02-29" }));
  assert.equal(leap.ok, true);
});

test("every configured Philippine wage region can be imported", () => {
  assert.equal(WAGE_ORDERS.length, 17);
  for (const { region } of WAGE_ORDERS) {
    const parsed = parseEmployeeRow(employee({ region }));
    assert.equal(parsed.ok, true, region);
  }
  const lowercase = parseEmployeeRow(employee({ region: "iv-a" }));
  assert.ok(lowercase.ok);
  if (lowercase.ok) assert.equal(lowercase.value.region, "IV-A");
});

test("separation statuses are not silently created by a bulk hire", () => {
  for (const status of ["Separating", "Separated", "Suspended", "Terminated"]) {
    const parsed = parseEmployeeRow(employee({ status }));
    assert.equal(parsed.ok, false, status);
  }
  const leave = parseEmployeeRow(employee({ status: "on leave" }));
  assert.equal(leave.ok, true);
  if (leave.ok) assert.equal(leave.value.status, "On leave");
});

test("bank account and bank code are both required for bank details", () => {
  const badAccount = parseEmployeeRow(employee({ bankAccount: "BDO-123", bankCode: "BDO" }));
  assert.equal(badAccount.ok, false);
  const missingBankCode = parseEmployeeRow(employee({ bankAccount: "1234567890" }));
  assert.equal(missingBankCode.ok, false);
  const missingAccount = parseEmployeeRow(employee({ bankCode: "BDO" }));
  assert.equal(missingAccount.ok, false);
  const withPair = parseEmployeeRow(employee({ bankAccount: "1234567890", bankCode: "bdo" }));
  assert.equal(withPair.ok, true);
  if (withPair.ok) assert.equal(withPair.value.bankCode, "BDO");
});

test("payroll amount precision is enforced at the CSV boundary", () => {
  for (const value of ["0", "-1", "12500.001", "10000000000", "Infinity"]) {
    const parsed = parseEmployeeRow(employee({ monthlyBasic: value }));
    assert.equal(parsed.ok, false, value);
  }
});

test("valid source line numbers are retained even after invalid records", () => {
  const result = parseEmployeeCsv(
    "Employee No,First Name,Last Name,Start Date,Monthly Basic\n"
    + "E1,Ana,Reyes,2025-05-17,20000\n"
    + "E2,Ben,Santos,2026-02-30,20000\n"
    + "E3,Cora,Lopez,2024-04-01,21000\n",
  );
  assert.deepEqual(result.validRows.map((row) => row.line), [2, 4]);
  assert.deepEqual(result.errors.map((row) => row.line), [3]);
});
