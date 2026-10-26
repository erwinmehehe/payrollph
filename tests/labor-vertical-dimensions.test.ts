import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveLaborAllocation, allocateLaborAmount, laborAllocationTrace,
  type LaborAllocationRow } from "../src/lib/labor-costing";
import { normalizeLaborVerticalDimensions, laborVerticalDimensionValues,
  journalRequiresVerticalDimensionColumns, LABOR_VERTICAL_DIMENSION_HEADERS } from "../src/lib/labor-vertical-dimensions";

const row = (id: number, allocationPercent: number, extra: Partial<LaborAllocationRow> = {}): LaborAllocationRow => ({
  id, employeeId: 42, costCenterId: 5, effectiveFrom: "2026-01-01", effectiveUntil: null,
  allocationPercent, allocationBasis: "percentage", ...extra,
});

test("BPO, manufacturing and hospitality labels normalize predictably and remain separate", () => {
  const dims = normalizeLaborVerticalDimensions({
    campaignCode: " camp-a ", siteCode: "sg01", teamCode: "t-2",
    plantCode: "plant1", lineCode: "line3", shiftCode: "night",
    propertyCode: "prop", departmentCode: "events", eventCode: "evt.4",
  });
  assert.deepEqual(laborVerticalDimensionValues(dims),
    ["CAMP-A", "SG01", "T-2", "PLANT1", "LINE3", "NIGHT", "PROP", "EVENTS", "EVT.4"]);
  assert.equal(LABOR_VERTICAL_DIMENSION_HEADERS.length, 9);
});
test("vertical distinctions cannot collide or silently collapse into a duplicate cost center", () => {
  const resolved = resolveLaborAllocation({ employeeId: 42, asOf: "2026-10-05", rows: [
    row(1, 50, { verticalDimensions: { campaignCode: "A", teamCode: "B" } }),
    row(2, 50, { verticalDimensions: { campaignCode: "B", teamCode: "A" } }),
  ] });
  assert.equal(resolved.allocations.length, 2);
  const allocated = allocateLaborAmount(99.99, resolved);
  assert.deepEqual(allocated.map(item => item.amount), [50, 49.99]);
  assert.equal(allocated[0]?.verticalDimensions?.campaignCode, "A");
  assert.equal(allocated[1]?.verticalDimensions?.campaignCode, "B");
  assert.equal(laborAllocationTrace(resolved).allocations[0]?.verticalDimensions?.teamCode, "B");
});
test("duplicate same vertical dimensions are refused", () => {
  assert.throws(() => resolveLaborAllocation({ employeeId: 42, asOf: "2026-10-05", rows: [
    row(1, 50, { verticalDimensions: { plantCode: "P1" } }),
    row(2, 50, { verticalDimensions: { plantCode: "P1" } }),
  ] }), /Duplicate active labor allocation dimension/);
});
test("unknown keys and invalid values fail closed, never truncate, ignore or reassign labels", () => {
  for (const invalid of [
    [], "BPO", { campaignCode: "" }, { campaignCode: null },
    { clientCode: "NOT-ALLOWED" }, { siteCode: "../../bad" },
    { shiftCode: "N".repeat(65) }, { teamCode: { code: "A" } },
  ]) {
    assert.throws(() => normalizeLaborVerticalDimensions(invalid), /dimension|object|keys/i);
  }
  assert.deepEqual(normalizeLaborVerticalDimensions({}), null);
});
test("journal and API source pass typed dimensions end-to-end without changing amounts", () => {
  const exporter = readFileSync("src/lib/exporters.ts", "utf8");
  const api = readFileSync("src/app/api/workforce/labor-costing/route.ts", "utf8");
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const sql = readFileSync("drizzle/0138_labor_vertical_dimensions.sql", "utf8");
  for (const source of [exporter, api, schema, sql]) assert.match(source, /verticalDimensions|vertical_dimensions/);
  assert.match(exporter, /allocated.verticalDimensions/);
  assert.match(exporter, /LABOR_VERTICAL_DIMENSION_HEADERS/);
  assert.match(exporter, /journalRequiresVerticalDimensionColumns/);
  assert.match(exporter, /journalEmployeeIds/);
  assert.match(exporter, /debitIndex/);
  assert.match(api, /resolvedAllocation.verticalDimensions/);
  const ui = readFileSync("src/components/workspace/labor-costing-panel.tsx", "utf8");
  assert.match(ui, /Additional industry allocation codes/);
  assert.match(ui, /invalidVerticalDimensions/);
  assert.match(ui, /row.verticalDimensions/);
  assert.match(ui, /normalizeLaborVerticalDimensions/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS vertical_dimensions jsonb/);
});

test("journal CSV only expands for allocations of employees effective within the exported run", () => {
  const entries = [
    { employeeId: 1, effectiveFrom: "2026-01-01", effectiveUntil: "2026-12-31",
      verticalDimensions: null },
    { employeeId: 2, effectiveFrom: "2027-01-01", effectiveUntil: null,
      verticalDimensions: { campaignCode: "FUTURE" } },
    { employeeId: 3, effectiveFrom: "2026-01-01", effectiveUntil: null,
      verticalDimensions: { propertyCode: "OTHER-EMPLOYEE" } },
  ];
  const selected = new Set([1, 2]);
  assert.equal(journalRequiresVerticalDimensionColumns({
    allocations: entries, employeeIds: selected, asOf: "2026-10-31",
  }), false);
  assert.equal(journalRequiresVerticalDimensionColumns({
    allocations: entries, employeeIds: selected, asOf: "2027-02-01",
  }), true);
  assert.equal(journalRequiresVerticalDimensionColumns({
    allocations: entries, employeeIds: new Set([3]), asOf: "2026-10-31",
  }), true);
  assert.equal(journalRequiresVerticalDimensionColumns({
    allocations: [{ ...entries[0]!, verticalDimensions: {} }],
    employeeIds: new Set([1]), asOf: "2026-10-31",
  }), false);
});
