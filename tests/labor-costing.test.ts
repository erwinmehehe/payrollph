import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import {
  allocatePayrollCostByHours,
  buildLaborCostGlPostings,
  laborAllocationTrace,
  resolveHoursBasedLaborAllocation,
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


test("hours-based allocation resolves actual minutes without inventing scheduled time", () => {
  const result = resolveHoursBasedLaborAllocation({
    employeeId: 42,
    workDate: "2026-10-06",
    rows: [
      {
        id: 1,
        employeeId: 42,
        costCenterId: 10,
        workDate: "2026-10-06",
        minutes: 360,
        clientCode: "CLIENT-A",
      },
      {
        id: 2,
        employeeId: 42,
        costCenterId: 20,
        workDate: "2026-10-06",
        minutes: 120,
        projectCode: "P-2",
      },
      {
        id: 3,
        employeeId: 99,
        costCenterId: 30,
        workDate: "2026-10-06",
        minutes: 480,
      },
    ],
  });

  assert.equal(result.status, "allocated");
  assert.equal(result.allocationBasis, "hours");
  assert.equal(result.totalMinutes, 480);
  assert.deepEqual(result.allocations.map((row) => [row.costCenterId, row.minutes, row.percent]), [
    [10, 360, 75],
    [20, 120, 25],
  ]);
});

test("hours-based allocation fails on duplicate dimensions or invalid minutes", () => {
  assert.throws(() => resolveHoursBasedLaborAllocation({
    employeeId: 42,
    workDate: "2026-10-06",
    rows: [
      { id: 1, employeeId: 42, costCenterId: 10, workDate: "2026-10-06", minutes: 240 },
      { id: 2, employeeId: 42, costCenterId: 10, workDate: "2026-10-06", minutes: 240 },
    ],
  }), /Duplicate hours-based labor allocation dimension/);

  assert.throws(() => resolveHoursBasedLaborAllocation({
    employeeId: 42,
    workDate: "2026-10-06",
    rows: [
      { id: 1, employeeId: 42, costCenterId: 10, workDate: "2026-10-06", minutes: 0 },
    ],
  }), /Invalid labor allocation minutes/);
});

test("gross pay and employer statutory costs allocate to the cent by actual minutes", () => {
  const allocation = resolveHoursBasedLaborAllocation({
    employeeId: 42,
    workDate: "2026-10-06",
    rows: [
      { id: 1, employeeId: 42, costCenterId: 10, workDate: "2026-10-06", minutes: 1 },
      { id: 2, employeeId: 42, costCenterId: 20, workDate: "2026-10-06", minutes: 2 },
    ],
  });

  const lines = allocatePayrollCostByHours({
    allocation,
    grossPay: "100.01",
    employerSss: "10.01",
    employerEc: "2.00",
    employerPhilHealth: "5.01",
    employerPagIbig: "3.01",
  });

  const byComponent = (component: string) =>
    lines.filter((line) => line.component === component);

  assert.deepEqual(byComponent("gross_pay").map((line) => line.amount), [33.34, 66.67]);
  assert.equal(byComponent("gross_pay").reduce((sum, line) => sum + line.amount, 0), 100.01);
  assert.equal(byComponent("employer_sss").reduce((sum, line) => sum + line.amount, 0), 10.01);
  assert.equal(byComponent("employer_ec").reduce((sum, line) => sum + line.amount, 0), 2);
  assert.equal(byComponent("employer_philhealth").reduce((sum, line) => sum + line.amount, 0), 5.01);
  assert.equal(byComponent("employer_pagibig").reduce((sum, line) => sum + line.amount, 0), 3.01);
});

test("non-zero labor cost fails closed when no actual hours allocation exists", () => {
  const allocation = resolveHoursBasedLaborAllocation({
    employeeId: 42,
    workDate: "2026-10-06",
    rows: [],
  });

  assert.throws(() => allocatePayrollCostByHours({
    allocation,
    grossPay: "100.00",
    employerSss: "0",
    employerEc: "0",
    employerPhilHealth: "0",
    employerPagIbig: "0",
  }), /cannot be allocated without recorded minutes/);
});

test("GL posting resolves by legal entity, cost center, component and effective date", () => {
  const allocation = resolveHoursBasedLaborAllocation({
    employeeId: 42,
    workDate: "2026-10-06",
    rows: [
      { id: 1, employeeId: 42, costCenterId: 10, workDate: "2026-10-06", minutes: 480 },
    ],
  });
  const lines = allocatePayrollCostByHours({
    allocation,
    grossPay: "1000",
    employerSss: "100",
    employerEc: "10",
    employerPhilHealth: "50",
    employerPagIbig: "20",
  });
  const components = [...new Set(lines.map((line) => line.component))];
  const mappings = components.map((component, index) => ({
    id: index + 1,
    legalEntityId: 7,
    costCenterId: 10,
    component,
    glAccountCode: `61${index}0`,
    glAccountName: `Payroll cost ${component}`,
    effectiveFrom: "2026-01-01",
    effectiveUntil: null,
    active: true,
  }));

  const postings = buildLaborCostGlPostings({
    legalEntityId: 7,
    asOf: "2026-10-06",
    lines,
    mappings,
  });

  assert.equal(postings.length, 5);
  assert.equal(postings.every((line) => line.legalEntityId === 7), true);
  assert.equal(postings.find((line) => line.component === "gross_pay")?.glAccountCode, "6100");
});

test("GL mapping fails closed when mapping is missing or overlapping", () => {
  const lines = [{
    component: "employer_sss" as const,
    amount: 100,
    costCenterId: 10,
    minutes: 480,
    projectCode: null,
    clientCode: null,
    jobCode: null,
  }];

  assert.throws(() => buildLaborCostGlPostings({
    legalEntityId: 7,
    asOf: "2026-10-06",
    lines,
    mappings: [],
  }), /Missing GL mapping/);

  const mapping = {
    id: 1,
    legalEntityId: 7,
    costCenterId: 10,
    component: "employer_sss" as const,
    glAccountCode: "6110",
    glAccountName: "Employer SSS",
    effectiveFrom: "2026-01-01",
    effectiveUntil: null,
    active: true,
  };
  assert.throws(() => buildLaborCostGlPostings({
    legalEntityId: 7,
    asOf: "2026-10-06",
    lines,
    mappings: [mapping, { ...mapping, id: 2, glAccountCode: "6111" }],
  }), /Overlapping GL mappings/);
});
