import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateLaborAmount,
  laborAllocationTrace,
  resolveLaborAllocation,
  resolveLaborGlAccount,
  type LaborAllocationRow,
} from "../src/lib/labor-costing";

function row(overrides: Partial<LaborAllocationRow> = {}): LaborAllocationRow {
  return {
    id: 1,
    employeeId: 42,
    costCenterId: 10,
    effectiveFrom: "2026-01-01",
    effectiveUntil: null,
    allocationPercent: 100,
    allocationBasis: "percentage",
    allocationHours: null,
    projectCode: null,
    clientCode: null,
    jobCode: null,
    ...overrides,
  };
}

test("single active cost center resolves to 100 percent", () => {
  const result = resolveLaborAllocation({
    employeeId: 42,
    asOf: "2026-10-05",
    rows: [row()],
  });

  assert.equal(result.status, "allocated");
  assert.equal(result.totalPercent, 100);
  assert.equal(result.allocations[0]?.costCenterId, 10);
});

test("employee can split cost across client/project dimensions", () => {
  const result = resolveLaborAllocation({
    employeeId: 42,
    asOf: "2026-10-05",
    rows: [
      row({ id: 1, costCenterId: 10, allocationPercent: 60, clientCode: "CLIENT-A" }),
      row({ id: 2, costCenterId: 20, allocationPercent: 30, clientCode: "CLIENT-B", projectCode: "P-22" }),
      row({ id: 3, costCenterId: 30, allocationPercent: 10, jobCode: "INTERNAL" }),
    ],
  });

  assert.equal(result.totalPercent, 100);
  assert.equal(result.allocations.length, 3);
  assert.equal(result.allocations.find((item) => item.costCenterId === 20)?.projectCode, "P-22");
});

test("effective dates choose only rows active on the costing date", () => {
  const result = resolveLaborAllocation({
    employeeId: 42,
    asOf: "2026-07-01",
    rows: [
      row({ id: 1, costCenterId: 10, effectiveUntil: "2026-06-30" }),
      row({ id: 2, costCenterId: 20, effectiveFrom: "2026-07-01" }),
    ],
  });

  assert.deepEqual(result.allocations.map((item) => item.costCenterId), [20]);
});

test("missing allocation remains explicit rather than invented", () => {
  const result = resolveLaborAllocation({
    employeeId: 42,
    asOf: "2026-10-05",
    rows: [],
  });

  assert.equal(result.status, "unallocated");
  assert.equal(result.totalPercent, 0);
  assert.deepEqual(result.allocations, []);
});

test("partial or excessive active allocation fails closed", () => {
  assert.throws(() => resolveLaborAllocation({
    employeeId: 42,
    asOf: "2026-10-05",
    rows: [
      row({ id: 1, costCenterId: 10, allocationPercent: 60 }),
      row({ id: 2, costCenterId: 20, allocationPercent: 30 }),
    ],
  }), /totals 90\.000%, expected 100\.000%/);

  assert.throws(() => resolveLaborAllocation({
    employeeId: 42,
    asOf: "2026-10-05",
    rows: [
      row({ id: 1, costCenterId: 10, allocationPercent: 70 }),
      row({ id: 2, costCenterId: 20, allocationPercent: 40 }),
    ],
  }), /totals 110\.000%, expected 100\.000%/);
});

test("duplicate active dimensions fail closed", () => {
  assert.throws(() => resolveLaborAllocation({
    employeeId: 42,
    asOf: "2026-10-05",
    rows: [
      row({ id: 1, allocationPercent: 50 }),
      row({ id: 2, allocationPercent: 50 }),
    ],
  }), /Duplicate active labor allocation dimension/);
});

test("literal pipe characters in separate costing dimensions cannot alias a duplicate", () => {
  const result = resolveLaborAllocation({
    employeeId: 42,
    asOf: "2026-10-05",
    rows: [
      row({ id: 1, allocationPercent: 50, projectCode: "A|B", clientCode: "C" }),
      row({ id: 2, allocationPercent: 50, projectCode: "A", clientCode: "B|C" }),
    ],
  });

  assert.equal(result.status, "allocated");
  assert.deepEqual(result.allocations.map((item) => item.id).sort((a, b) => a - b), [1, 2]);
  // Both combinations previously serialized to the same pipe-delimited key.
  assert.notEqual(result.allocations[0]?.projectCode, result.allocations[1]?.projectCode);
});

test("trace preserves finance allocation evidence", () => {
  const result = resolveLaborAllocation({
    employeeId: 42,
    asOf: "2026-10-05",
    rows: [row({ clientCode: "CLIENT-A", projectCode: "PROJ-1", jobCode: "ROLE-9" })],
  });

  assert.deepEqual(laborAllocationTrace(result), {
    status: "allocated",
    asOf: "2026-10-05",
    basis: "percentage",
    totalPercent: 100,
    totalHours: null,
    allocations: [{
      allocationId: 1,
      costCenterId: 10,
      percent: 100,
      hours: null,
      clientCode: "CLIENT-A",
      projectCode: "PROJ-1",
      jobCode: "ROLE-9",
    }],
  });
});


test("reviewed migrations own labor-costing tables and constraints; core never repairs them", () => {
  const foundation = readFileSync("drizzle/0020_enterprise_labor_costing.sql", "utf8");
  const depth = readFileSync("drizzle/0064_labor_costing_depth.sql", "utf8");
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const compat = readFileSync("src/lib/core-schema-compat.ts", "utf8");
  assert.ok(foundation.includes('CREATE TABLE IF NOT EXISTS "cost_centers"'));
  assert.ok(foundation.includes('CREATE TABLE IF NOT EXISTS "employee_labor_allocations"'));
  for (const marker of [
    "employee_labor_allocations_percent_check",
    "employee_labor_allocations_dates_check",
  ]) assert.ok(foundation.includes(marker), marker);
  assert.ok(depth.includes('"allocation_hours"'));
  assert.ok(depth.includes("employee_labor_allocations_basis_check"));
  assert.ok(depth.includes("'percentage', 'hours'"));
  assert.ok(depth.includes('CREATE TABLE IF NOT EXISTS "labor_gl_mappings"'));
  assert.ok(depth.includes("labor_gl_mappings_scope_unique"));
  for (const name of ['"cost_centers"', '"employee_labor_allocations"', '"labor_gl_mappings"'])
    assert.ok(schema.includes(name), name);
  assert.ok(compat.includes("await verifyCoreSchemaReadOnly("));
  assert.doesNotMatch(compat, /\bCREATE\s+TABLE\b/i);
});


test("hours-based allocations preserve source hours and normalize to 100 percent", () => {
  const result = resolveLaborAllocation({
    employeeId: 42,
    asOf: "2026-10-05",
    rows: [
      row({ id: 1, costCenterId: 10, allocationBasis: "hours", allocationHours: 6, allocationPercent: 75 }),
      row({ id: 2, costCenterId: 20, allocationBasis: "hours", allocationHours: 2, allocationPercent: 25 }),
    ],
  });

  assert.equal(result.basis, "hours");
  assert.equal(result.totalHours, 8);
  assert.equal(result.totalPercent, 100);
  assert.deepEqual(result.allocations.map((item) => [item.costCenterId, item.hours, item.percent]), [
    [10, 6, 75],
    [20, 2, 25],
  ]);
});

test("hours-based allocations reject mixed bases and invalid hours", () => {
  assert.throws(() => resolveLaborAllocation({
    employeeId: 42,
    asOf: "2026-10-05",
    rows: [
      row({ id: 1, allocationBasis: "percentage", allocationPercent: 50 }),
      row({ id: 2, costCenterId: 20, allocationBasis: "hours", allocationHours: 4, allocationPercent: 50 }),
    ],
  }), /Mixed labor allocation bases/);

  assert.throws(() => resolveLaborAllocation({
    employeeId: 42,
    asOf: "2026-10-05",
    rows: [row({ allocationBasis: "hours", allocationHours: 0 })],
  }), /Invalid labor allocation hours/);
});

test("labor amount allocation balances exactly to the cent", () => {
  const resolved = resolveLaborAllocation({
    employeeId: 42,
    asOf: "2026-10-05",
    rows: [
      row({ id: 1, costCenterId: 10, allocationPercent: 33.333 }),
      row({ id: 2, costCenterId: 20, allocationPercent: 33.333 }),
      row({ id: 3, costCenterId: 30, allocationPercent: 33.334 }),
    ],
  });
  const allocated = allocateLaborAmount(100, resolved);

  assert.equal(allocated.reduce((sum, item) => sum + item.amount, 0), 100);
  assert.deepEqual(allocated.map((item) => item.amount), [33.33, 33.33, 33.34]);
});

test("centavo allocations round half-cent adjustments symmetrically and reverse exactly", () => {
  const resolved = resolveLaborAllocation({
    employeeId: 42,
    asOf: "2026-10-05",
    rows: [
      row({ id: 1, costCenterId: 10, allocationPercent: 50 }),
      row({ id: 2, costCenterId: 20, allocationPercent: 50 }),
    ],
  });

  const debit = allocateLaborAmount(1.005, resolved);
  const reversal = allocateLaborAmount(-1.005, resolved);
  assert.deepEqual(debit.map((entry) => entry.amount), [0.51, 0.5]);
  assert.deepEqual(reversal.map((entry) => entry.amount), [-0.51, -0.5]);
  assert.equal(debit.reduce((sum, entry) => sum + entry.amount, 0), 1.01);
  assert.equal(reversal.reduce((sum, entry) => sum + entry.amount, 0), -1.01);

  const unallocated = resolveLaborAllocation({ employeeId: 42, asOf: "2026-10-05", rows: [] });
  assert.equal(allocateLaborAmount(100.005, unallocated)[0]?.amount, 100.01);
  assert.equal(allocateLaborAmount(-100.005, unallocated)[0]?.amount, -100.01);
  assert.equal(allocateLaborAmount(-0.005, unallocated)[0]?.amount, -0.01);
  assert.throws(() => allocateLaborAmount(Number.MAX_VALUE, resolved), /finite|safe centavo precision/);
});

test("GL mapping resolves most specific legal-entity and cost-center account", () => {
  const mappings = [
    { id: 1, legalEntityId: null, costCenterId: null, accountKey: "salary_expense", accountCode: "5000", accountName: "Payroll expense", active: true },
    { id: 2, legalEntityId: 7, costCenterId: null, accountKey: "salary_expense", accountCode: "5100", accountName: "Entity payroll expense", active: true },
    { id: 3, legalEntityId: 7, costCenterId: 10, accountKey: "salary_expense", accountCode: "5110", accountName: "Operations payroll expense", active: true },
  ];

  assert.deepEqual(resolveLaborGlAccount({
    mappings,
    legalEntityId: 7,
    costCenterId: 10,
    accountKey: "salary_expense",
    fallbackName: "Salaries and Wages Expense",
  }), {
    mappingId: 3,
    accountCode: "5110",
    accountName: "Operations payroll expense",
  });
});
