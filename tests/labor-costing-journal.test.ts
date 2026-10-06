import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/lib/exporters.ts", "utf8");

test("payroll journal consumes governed labor allocations", () => {
  assert.ok(source.includes("resolveLaborAllocation"));
  assert.ok(source.includes("allocateLaborAmount"));
  assert.ok(source.includes("employeeLaborAllocations"));
  assert.ok(source.includes('asOf: String(run.periodEnd)'));
});

test("payroll journal allocates employer statutory expense through labor dimensions", () => {
  assert.ok(source.includes('"sss_employer_expense"'));
  assert.ok(source.includes('"ec_employer_expense"'));
  assert.ok(source.includes('"philhealth_employer_expense"'));
  assert.ok(source.includes('"pagibig_employer_expense"'));
  assert.ok(source.includes("allocated.costCenterId"));
});

test("payroll journal resolves GL mappings by entity and cost center", () => {
  assert.ok(source.includes("resolveLaborGlAccount"));
  assert.ok(source.includes("laborGlMappings"));
  assert.ok(source.includes('"Legal Entity"'));
  assert.ok(source.includes('"Cost Center"'));
  assert.ok(source.includes('"Account Code"'));
});

test("dimensioned journal remains fail-closed on imbalance", () => {
  assert.ok(source.includes("Payroll journal does not balance"));
  assert.ok(source.includes("Math.abs(debitTotal - creditTotal) > 0.02"));
});
