import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  reconcileLaborCostingDraftCenters,
  selectedLaborCostingEmployeeId,
} from "../src/lib/labor-costing-panel-view";

const FILE = "src/components/workspace/labor-costing-panel.tsx";
const src = () => readFileSync(FILE, "utf8");

test("employee choice can never reference a worker absent from the current employer roster", () => {
  const first = [{ id: 41 }, { id: 42 }];
  assert.equal(selectedLaborCostingEmployeeId(42, first), 42);
  assert.equal(selectedLaborCostingEmployeeId(1000, first), 41);
  assert.equal(selectedLaborCostingEmployeeId(42, [{ id: 99 }]), 99);
  assert.equal(selectedLaborCostingEmployeeId(42, []), 0);
  assert.equal(selectedLaborCostingEmployeeId(0, []), 0);
  assert.deepEqual(first, [{ id: 41 }, { id: 42 }]);
});

test("new active center fills only an invalid first row and clears later invalid centers", () => {
  const originals = [
    { key: 1, costCenterId: "8", allocationPercent: "60", allocationHours: "5", clientCode: "V-A", projectCode: "P", jobCode: "J" },
    { key: 2, costCenterId: "99", allocationPercent: "30", allocationHours: "2", clientCode: "V-B", projectCode: "P2", jobCode: "" },
    { key: 3, costCenterId: "9", allocationPercent: "10", allocationHours: "1", clientCode: "", projectCode: "", jobCode: "J3" },
  ];
  const active = [{ id: 8, active: false }, { id: 9, active: true }, { id: 10, active: true }];
  const next = reconcileLaborCostingDraftCenters(originals, active);
  assert.deepEqual(next.map((r) => r.costCenterId), ["9", "", "9"]);
  assert.equal(next[0].allocationPercent, "60");
  assert.equal(next[0].allocationHours, "5");
  assert.equal(next[0].clientCode, "V-A");
  assert.equal(next[1].projectCode, "P2");
  assert.equal(next[2].jobCode, "J3");
  assert.deepEqual(originals.map((r) => r.costCenterId), ["8", "99", "9"]);
  assert.equal(next[2], originals[2], "Valid row remains unmodified");
});

test("normalization is a no-op for already valid drafts or missing active centers", () => {
  const draft = [{ key: 1, costCenterId: "15", allocationPercent: "100" }];
  assert.equal(reconcileLaborCostingDraftCenters(draft, [{ id: 15, active: true }]), draft);
  assert.equal(reconcileLaborCostingDraftCenters(draft, [{ id: 15, active: false }]), draft);
  assert.equal(reconcileLaborCostingDraftCenters(draft, []), draft);
  const zero = [{ key: 1, costCenterId: "" }];
  assert.deepEqual(reconcileLaborCostingDraftCenters(zero, [{ id: 15, active: true }]), [
    { key: 1, costCenterId: "15" },
  ]);
  assert.equal(reconcileLaborCostingDraftCenters([], [{ id: 15, active: true }]).length, 0);
});

test("the labor-costing editor is employer-keyed with abortable, last-request-owned GET", () => {
  const content = src();
  assert.match(content, /LaborCostingPanelContent key=\{props\.data\.selectedOrganization\.id\}/);
  assert.match(content, /const \[employeeIdDraft, setEmployeeId\] = useState/);
  assert.match(content, /const employeeId = selectedLaborCostingEmployeeId\(employeeIdDraft, data\.employees\)/);
  assert.match(content, /const load = useCallback\(async \(signal\?: AbortSignal\) =>/);
  assert.match(content, /const revision = \+\+loadRevision\.current/);
  assert.match(content, /revision === loadRevision\.current/);
  assert.match(content, /if \(!isCurrent\(\)\) return; \/\/ A superseded employer\/refresh/);
  assert.match(content, /const controller = new AbortController\(\)/);
  assert.match(content, /queueMicrotask\(\(\) => \{/);
  assert.match(content, /if \(!controller\.signal\.aborted\) void load\(controller\.signal\)/);
  assert.match(content, /controller\.abort\(\)/);
  assert.match(content, /loadRevision\.current \+= 1/);
  assert.match(content, /setDrafts\(\(current\) => reconcileLaborCostingDraftCenters\(current, nextCenters\)\)/);
  assert.equal((content.match(/\buseEffect\(/g) ?? []).length, 1);
  assert.doesNotMatch(content, /setEmployeeId\(data\.employees\[0\]/);
  assert.doesNotMatch(content, /useEffect\(\(\) => \{\s*setCostCenters/);
});

test("writes, reconciliation guards and role-sensitive API remain unchanged", () => {
  const content = src();
  for (const unchanged of [
    'method: "POST"',
    '"create_cost_center"',
    '"set_employee_allocations"',
    'organizationId, action, ...payload',
    'Math.abs(totalPercent - 100) <= 0.001',
    'allocationBasis === "hours"',
    'if (duplicateDimensions)',
    'if (dateRangeInvalid)',
    'effectiveUntil: effectiveUntil || null',
    'allocations: drafts.map',
  ]) assert.ok(content.includes(unchanged), "Missing original allocation guard: " + unchanged);
  const manifest = JSON.parse(readFileSync("eslint-suppressions.json", "utf8"));
  assert.equal(manifest[FILE], undefined);
  const counts = Object.values(manifest as Record<string, Record<string, { count: number }>>)
    .reduce((sum, rules) => sum + Object.values(rules).reduce((n, item) => n + item.count, 0), 0);
  assert.equal(counts, 51);
  assert.equal(Object.keys(manifest).length, 42);
});
