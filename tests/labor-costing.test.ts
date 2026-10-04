import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import {
  laborAllocationTrace,
  resolveLaborAllocation,
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

test("trace preserves finance allocation evidence", () => {
  const result = resolveLaborAllocation({
    employeeId: 42,
    asOf: "2026-10-05",
    rows: [row({ clientCode: "CLIENT-A", projectCode: "PROJ-1", jobCode: "ROLE-9" })],
  });

  assert.deepEqual(laborAllocationTrace(result), {
    status: "allocated",
    asOf: "2026-10-05",
    totalPercent: 100,
    allocations: [{
      allocationId: 1,
      costCenterId: 10,
      percent: 100,
      clientCode: "CLIENT-A",
      projectCode: "PROJ-1",
      jobCode: "ROLE-9",
    }],
  });
});


test("production compatibility schema carries labor-costing tables and constraints", () => {
  const source = readFileSync("src/lib/core-schema-compat.ts", "utf8");
  assert.ok(source.includes("CREATE TABLE IF NOT EXISTS cost_centers"));
  assert.ok(source.includes("CREATE TABLE IF NOT EXISTS employee_labor_allocations"));
  assert.ok(source.includes("employee_labor_allocations_percent_check"));
  assert.ok(source.includes("employee_labor_allocations_basis_check"));
  assert.ok(source.includes("employee_labor_allocations_dates_check"));
});
