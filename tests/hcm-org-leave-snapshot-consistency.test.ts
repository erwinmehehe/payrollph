import assert from "node:assert/strict";
import test from "node:test";
import { readScopedResponse } from "../src/lib/hcm-scoped-read-failure";
import { validOrgExplorerResponse, validTeamLeaveResponse } from "../src/lib/hcm-scoped-read-validation";
import {
  projectOrgExplorer,
  type OrgExplorerUnitSource,
  type OrgExplorerPositionSource,
} from "../src/lib/hcm-org-explorer-projection";

const orgId = 17;
const units: OrgExplorerUnitSource[] = [
  { id: 10, parentId: null, code: "ROOT", name: "Fictional HQ", type: "department" },
  { id: 11, parentId: 10, code: "OPS", name: "Fictional Ops", type: "team" },
];
const positions: OrgExplorerPositionSource[] = [
  { id: 80, code: "P-A", status: "active", jobTitle: "Test A", orgUnitId: 10, supervisoryOrgUnitId: null },
  { id: 81, code: "P-B", status: "active", jobTitle: "Test B", orgUnitId: 10, supervisoryOrgUnitId: 11 },
];
function orgSnapshot(
  unitSources: OrgExplorerUnitSource[] = units,
  positionSources: OrgExplorerPositionSource[] = positions,
) {
  return {
    tenantId: orgId,
    observedAt: "2026-10-29T06:00:00.000Z",
    currentBusinessDate: "2026-10-29",
    sources: ["org_units", "positions", "job_profiles"] as const,
    ...projectOrgExplorer(unitSources, positionSources),
  };
}
const validOrg = (value: unknown) => validOrgExplorerResponse(value, orgId);

test("actual source-projected root/linked, unlinked, missing-parent and cycle snapshots remain valid", () => {
  assert.equal(validOrg(orgSnapshot()), true, "root and child with counted positions");
  assert.equal(validOrg(orgSnapshot([], [])), true, "empty coherent employer snapshot");
  assert.equal(validOrg(orgSnapshot(units, [
    { ...positions[0], orgUnitId: 900, supervisoryOrgUnitId: null },
  ])), true, "foreign unit source is redacted and reported as needs_review");
  assert.equal(validOrg(orgSnapshot([
    { id: 100, parentId: 999, code: "LOST", name: "Fictional Orphan", type: "team" },
  ], [])), true, "missing ancestor must remain redacted and labeled for review");
  assert.equal(validOrg(orgSnapshot([
    { id: 100, parentId: 101, code: "CYCLE-1", name: "Cycle 1", type: "team" },
    { id: 101, parentId: 100, code: "CYCLE-2", name: "Cycle 2", type: "team" },
  ], [])), true, "cycles must be visible as redacted review warnings");
});

test("over-limit, contradictory hierarchy and invented reporting-unit evidence are rejected", () => {
  const snapshot = orgSnapshot();
  const root = snapshot.units.find((unit) => unit.id === 10)!;
  const child = snapshot.units.find((unit) => unit.id === 11)!;
  const target = snapshot.positions.find((position) => position.id === 81)!;
  const mutateUnit = (id: number, changes: Record<string, unknown>) => ({
    ...snapshot,
    units: snapshot.units.map((unit) => unit.id === id ? { ...unit, ...changes } : unit),
  });
  const mutatePosition = (changes: Record<string, unknown>) => ({
    ...snapshot,
    positions: snapshot.positions.map((position) =>
      position.id === target.id ? { ...position, ...changes } : position),
  });

  for (const broken of [
    mutateUnit(root.id, { relationship: "linked" }),
    mutateUnit(root.id, { depth: 1 }),
    mutateUnit(child.id, { relationship: "root" }),
    mutateUnit(child.id, { parentId: 999 }),
    mutateUnit(child.id, { depth: 2 }),
    mutateUnit(root.id, { positionRecordCount: 0 }),
    mutatePosition({ reportingUnitId: 10 }),
    mutatePosition({ reportingUnitId: 999 }),
    mutatePosition({ supervisoryOrgUnitId: 999 }),
    mutatePosition({ orgUnitId: 999 }),
    mutatePosition({ relationship: "unit_not_in_snapshot" }),
    { ...snapshot, unlinkedPositionRecords: 1 },
    { ...snapshot, integrity: "needs_review" },
  ]) {
    assert.equal(validOrg(broken), false, "untrusted JSON cannot contradict a projector source fact");
  }

  const partial = orgSnapshot(units, [
    { ...positions[0], orgUnitId: 900 },
  ]);
  assert.equal(validOrg({ ...partial, integrity: "ready" }), false,
    "unlinked source position must never be presented as verified ready");

  const tooManyUnits = orgSnapshot(Array.from({ length: 251 }, (_, n) => ({
    id: 1000 + n, parentId: null, code: "U" + n, name: "Fictional " + n, type: "team",
  })), []);
  assert.equal(validOrg(tooManyUnits), false, "server bounds the complete unit inventory at 250");
  const tooManyPositions = orgSnapshot(
    [units[0]], Array.from({ length: 501 }, (_, n) => ({
      id: 1000 + n, code: "P" + n, status: "active",
      jobTitle: "Fictional", orgUnitId: 10, supervisoryOrgUnitId: null,
    })),
  );
  assert.equal(validOrg(tooManyPositions), false, "server bounds complete positions at 500");
});

const dates = { start: "2026-10-01", end: "2026-10-31" };
function request(requestId: number, startDate: string, status: "Approved" | "Pending" = "Approved") {
  return {
    requestId, employeeId: 55, employeeNo: "SYNTH-55", employeeName: "Fictional Colleague",
    status, startDate, endDate: "2026-10-31",
  };
}
function calendar(cases: ReturnType<typeof request>[]) {
  return {
    organizationId: orgId,
    scope: { kind: "unit" as const, orgUnitId: 10 },
    month: "2026-10",
    observedAt: "2026-10-29T06:00:00.000Z",
    dates, notice: "Read-only fictional month, not verified staffing",
    cases,
    summary: {
      approvedRequestRecords: cases.filter((item) => item.status === "Approved").length,
      pendingRequestRecords: cases.filter((item) => item.status === "Pending").length,
    },
  };
}
const validCalendar = (value: unknown) => validTeamLeaveResponse(value, orgId, "2026-10", dates);

test("leave calendar retains valid SQL-ordered cases including same-start IDs and cross-month overlaps", () => {
  assert.equal(validCalendar(calendar([])), true);
  assert.equal(validCalendar(calendar([request(1, "2026-10-01")])), true);
  assert.equal(validCalendar(calendar([
    request(5, "2026-09-28", "Pending"),
    request(9, "2026-10-03"),
    request(10, "2026-10-03", "Pending"),
  ])), true);
});

test("leave calendar rejects shuffled date and request-ID rows", () => {
  const broken = [
    [request(10, "2026-10-02"), request(2, "2026-10-01")],
    [request(11, "2026-10-03"), request(10, "2026-10-03")],
    [request(10, "2026-10-01"), request(8, "2026-10-03"), request(7, "2026-10-02")],
  ];
  for (const cases of broken) {
    assert.equal(validCalendar(calendar(cases)), false,
      "API only emits startDate ASC, requestId ASC");
  }
});

test("malformed 200 JSON becomes unavailable instead of a verified empty org or leave result", async () => {
  const invalidOrg = { ...orgSnapshot(), integrity: "needs_review" };
  assert.deepEqual(
    await readScopedResponse(async () => Response.json(invalidOrg), validOrg),
    { status: "unavailable", failure: "invalid" },
  );
  const invalidLeave = calendar([request(2, "2026-10-03"), request(1, "2026-10-03")]);
  assert.deepEqual(
    await readScopedResponse(async () => Response.json(invalidLeave), validCalendar),
    { status: "unavailable", failure: "invalid" },
  );
});
