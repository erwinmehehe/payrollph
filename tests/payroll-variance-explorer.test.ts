import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { VerifiedVarianceRow } from "../src/lib/payroll-checker-variance-read";
import { selectPayrollVarianceRows } from "../src/lib/payroll-variance-explorer";

const row = (employeeId: number, employeeName: string, netDelta: number | null,
  categories: VerifiedVarianceRow["categories"] = ["net_variance"]): VerifiedVarianceRow => ({
  employeeId, employeeName, netDelta, categories, organizationId: 9, employeeNo: "SYN-" + employeeId,
  employeeStatus: "Active", entryStatus: "Calculated",
  currentGross: 20000, previousGross: 18000,
  currentNet: 18000, previousNet: netDelta === null ? null : 18000 - netDelta,
  netPercent: null, changedLines: [], payRevision: null,
});

test("materiality filters are centavo-safe and never fill missing prior pay", () => {
  const rows = [
    row(1, "Alex", 99.99), row(2, "Bree", 100.00), row(3, "Caro", -1000),
    row(4, "Dale", null, ["new_to_run"]), row(5, "Eve", -100.01),
  ];
  const original = structuredClone(rows);
  assert.deepEqual(selectPayrollVarianceRows(rows, "all", "at_least_100", "source").map(x => x.employeeId), [2, 3, 5]);
  assert.deepEqual(selectPayrollVarianceRows(rows, "all", "at_least_1000", "source").map(x => x.employeeId), [3]);
  assert.deepEqual(selectPayrollVarianceRows(rows, "all", "no_prior", "source").map(x => x.employeeId), [4]);
  assert.deepEqual(selectPayrollVarianceRows(rows, "new_to_run", "all", "source").map(x => x.employeeId), [4]);
  assert.deepEqual(rows, original);
});

test("largest-net-change order is stable and does not mislabel no-prior amounts", () => {
  const rows = [row(1, "Zoe", null), row(2, "Bella", -120), row(3, "Alex", 120), row(4, "Dax", 30)];
  assert.deepEqual(selectPayrollVarianceRows(rows, "all", "all", "largest_net_change").map(x => x.employeeId), [2, 3, 4, 1]);
  assert.deepEqual(selectPayrollVarianceRows(rows, "all", "all", "employee").map(x => x.employeeId), [3, 2, 4, 1]);
});

test("explorer is layered after verified server evidence; payroll decisions unchanged", () => {
  const source = readFileSync("src/components/workspace/checker-variance.tsx", "utf8");
  assert.ok(source.includes("readVerifiedPayrollCheckerVariance"));
  assert.ok(source.includes("selectPayrollVarianceRows(payload.rows, filter, materiality, sort)"));
  assert.ok(source.includes("payrollTask.id, \"Approved\""));
  assert.ok(source.includes("!payload.summary.coverageComplete"));
});