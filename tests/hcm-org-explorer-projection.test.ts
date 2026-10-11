import assert from "node:assert/strict";
import test from "node:test";
import {
  orgExplorerBusinessDate, projectOrgExplorer, projectPositionHistory,
} from "../src/lib/hcm-org-explorer-projection";

const units = [
  { id: 1, parentId: null, name: "Company", code: "HQ", type: "company" },
  { id: 2, parentId: 1, name: "Engineering", code: "ENG", type: "department" },
  { id: 3, parentId: 2, name: "Platform", code: "PLT", type: "team" },
  { id: 4, parentId: 1, name: "People", code: "HR", type: "department" },
];

test("hierarchy follows parent links, sorted in tree order, counts position records only", () => {
  const positions = [
    { id: 9, code: "P-9", status: "open", jobTitle: "Engineer", orgUnitId: 4, supervisoryOrgUnitId: 2 },
    { id: 7, code: "P-7", status: "filled", jobTitle: "Analyst", orgUnitId: 4, supervisoryOrgUnitId: null },
  ];
  const projection = projectOrgExplorer(units, positions);
  assert.deepEqual(projection.units.map((x) => x.id), [1, 2, 3, 4]);
  assert.deepEqual(projection.units.map((x) => x.depth), [0, 1, 2, 1]);
  assert.equal(projection.units[1].positionRecordCount, 1);
  assert.equal(projection.units[3].positionRecordCount, 1);
  assert.equal(projection.positions[1].reportingUnitId, 2);
  assert.equal(projection.integrity, "ready");
  assert.equal(projection.unlinkedPositionRecords, 0);
  assert.ok(!JSON.stringify(projection).includes("annualBudget"));
});

test("missing parents are visible as unresolved, not fabricated roots", () => {
  const result = projectOrgExplorer([{ id: 3, parentId: 999, name: "Orphan", code: "X", type: "unit" }], []);
  assert.equal(result.integrity, "needs_review");
  assert.equal(result.units[0].relationship, "missing_parent");
  assert.equal(result.units[0].depth, 0);
  assert.equal(result.units[0].parentId, null);
  assert.ok(!JSON.stringify(result).includes("999"));
});

test("cycles and descendants of cycles do not create a bogus org chart", () => {
  const nodes = [
    { id: 1, parentId: 2, name: "A", code: "A", type: "unit" },
    { id: 2, parentId: 1, name: "B", code: "B", type: "unit" },
    { id: 3, parentId: 1, name: "C", code: "C", type: "unit" },
  ];
  const p = projectOrgExplorer(nodes, []);
  assert.equal(p.integrity, "needs_review");
  assert.ok(p.units.every((x) => x.relationship === "cycle"));
});

test("orphan positions are counted separately and do not claim vacancies", () => {
  const positions = [
    { id: 1, code: "ONE", status: "open", jobTitle: null, orgUnitId: null, supervisoryOrgUnitId: null },
    { id: 2, code: "TWO", status: "closed", jobTitle: "Role", orgUnitId: 20, supervisoryOrgUnitId: null },
  ];
  const p = projectOrgExplorer(units, positions);
  assert.equal(p.integrity, "needs_review");
  assert.equal(p.unlinkedPositionRecords, 2);
  assert.equal(p.positions[0].relationship, "no_unit");
  assert.equal(p.positions[1].relationship, "unit_not_in_snapshot");
  assert.equal(p.units.reduce((n, x) => n + x.positionRecordCount, 0), 0);
});

test("out-of-snapshot org IDs are not returned as actionable position links", () => {
  const data = projectOrgExplorer(units, [
    { id: 55, code: "X", status: "planned", jobTitle: null, orgUnitId: 999, supervisoryOrgUnitId: 1000 },
  ]);
  assert.equal(data.positions[0].relationship, "unit_not_in_snapshot");
  assert.equal(data.positions[0].orgUnitId, null);
  assert.equal(data.positions[0].supervisoryOrgUnitId, null);
  assert.equal(data.positions[0].reportingUnitId, null);
});

test("duplicate/invalid source IDs fail closed", () => {
  assert.throws(() => projectOrgExplorer([units[0], units[0]], []));
  assert.throws(() => projectOrgExplorer([{ ...units[0], id: 0 }], []));
  assert.throws(() => projectOrgExplorer(units, [
    { id: 1, code: "A", status: "open", jobTitle: null, orgUnitId: 1, supervisoryOrgUnitId: null },
    { id: 1, code: "B", status: "open", jobTitle: null, orgUnitId: 1, supervisoryOrgUnitId: null },
  ]));
});

test("historical assignment preview is bounded and never adds private fields", () => {
  const rows = [
    { id: 1, employeeId: 6, assignmentType: "primary", effectiveFrom: "2024-01-01", effectiveUntil: "2025-06-30", reason: "Private note", fte: "0.5" },
    { id: 2, employeeId: 8, assignmentType: "primary", effectiveFrom: "2025-07-01", effectiveUntil: null, reason: "Salary review", fte: "1.0" },
    { id: 3, employeeId: 9, assignmentType: "secondary", effectiveFrom: "2026-01-01", effectiveUntil: null, reason: "Sensitive", fte: "0.4" },
  ];
  const p = projectPositionHistory(rows, 2);
  assert.deepEqual(p.items.map((x) => x.id), [3, 2]);
  assert.equal(p.hasMore, true);
  assert.equal(p.partial, true);
  assert.ok(!JSON.stringify(p).includes("Private note"));
  assert.ok(!JSON.stringify(p).includes("fte"));
  assert.equal(projectPositionHistory(rows, 3).hasMore, false);
  assert.throws(() => projectPositionHistory(rows, 101));
});

test("PH date obeys Asia/Manila midnight boundary", () => {
  assert.equal(orgExplorerBusinessDate(new Date("2026-10-09T15:59:59Z")), "2026-10-09");
  assert.equal(orgExplorerBusinessDate(new Date("2026-10-09T16:00:00Z")), "2026-10-10");
});
