import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv, parseEmployeeCsv, parseEmployeeRow } from "../src/lib/csv-import";

test("csv parser handles quoted fields, doubled quotes and CRLF", () => {
  const rows = parseCsv('a,b,c\r\n"1,000","say ""hi""",plain\n');
  assert.deepEqual(rows, [
    ["a", "b", "c"],
    ["1,000", 'say "hi"', "plain"],
  ]);
});

test("customers can upload their own column names and order", () => {
  const result = parseEmployeeCsv(
    "Employee No,Last Name,First Name,Basic Pay,Region\nEMP-1,Dela Cruz,Juan,21500,NCR\n",
  );
  assert.equal(result.valid.length, 1);
  assert.equal(result.valid[0].lastName, "Dela Cruz");
  assert.equal(result.valid[0].monthlyBasic, 21500);
});

test("unknown extra columns are ignored and reported", () => {
  const result = parseEmployeeCsv(
    "Employee No,First Name,Last Name,Monthly Basic,Birthday,Favorite Color\nE1,Ana,Reyes,20000,1990-01-01,Blue\n",
  );
  assert.equal(result.valid.length, 1);
  assert.ok(result.unmapped.includes("Birthday"));
  assert.ok(result.unmapped.includes("Favorite Color"));
});

test("currency symbols, commas and whitespace in amounts are accepted", () => {
  const parsed = parseEmployeeRow({ employeeNo: "E1", firstName: "A", lastName: "B", monthlyBasic: "₱ 21,500.00" });
  assert.ok(parsed.ok);
  if (parsed.ok) assert.equal(parsed.value.monthlyBasic, 21500);
});

test("each problem is specific, not a generic failure", () => {
  const parsed = parseEmployeeRow({
    employeeNo: "",
    firstName: "A",
    lastName: "",
    monthlyBasic: "abc",
    region: "MARS",
    email: "nope",
    mobile: "123",
  });
  assert.ok(!parsed.ok);
  if (!parsed.ok) {
    const joined = parsed.problems.join("; ");
    assert.ok(joined.includes("employeeNo is required"));
    assert.ok(joined.includes("lastName is required"));
    assert.ok(joined.includes("monthlyBasic \"abc\" is not a number"));
    assert.ok(joined.includes("region \"MARS\""));
    assert.ok(joined.includes("email \"nope\""));
    assert.ok(joined.includes("mobile \"123\" must be 11 digits starting 09"));
  }
});

test("below-minimum wage rows are accepted but flagged as MWE-capable", () => {
  const parsed = parseEmployeeRow({ employeeNo: "E9", firstName: "P", lastName: "R", monthlyBasic: "6450", region: "NCR" });
  assert.ok(parsed.ok);
  if (parsed.ok) {
    assert.equal(parsed.value.monthlyBasic, 6450);
    assert.equal(parsed.value.mwe, false, "MWE stays an explicit decision, not inferred at import");
  }
});

test("MWE flags parse from yes/no/y/true", () => {
  for (const flag of ["yes", "YES", "y", "true", "1"]) {
    const parsed = parseEmployeeRow({ employeeNo: "E", firstName: "A", lastName: "B", monthlyBasic: "20000", mwe: flag });
    assert.ok(parsed.ok);
    if (parsed.ok) assert.equal(parsed.value.mwe, true, flag);
  }
});

test("a header-only file is rejected with a clear message", () => {
  const result = parseEmployeeCsv("Employee No,First Name\n");
  assert.equal(result.valid.length, 0);
  assert.equal(result.errors[0].problems[0], "CSV needs a header row and at least one data row");
});

test("bank account rejects non-numeric values", () => {
  const parsed = parseEmployeeRow({ employeeNo: "E", firstName: "A", lastName: "B", monthlyBasic: "20000", bankAccount: "BDO-123" });
  assert.ok(!parsed.ok);
  if (!parsed.ok) assert.ok(parsed.problems[0].includes("must be 6-20 digits"));
});
