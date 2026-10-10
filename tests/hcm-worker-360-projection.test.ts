import assert from "node:assert/strict";
import test from "node:test";
import {
  projectWorker360Events, selectWorker360Assignment, validWorker360Date,
} from "../src/lib/hcm-worker-360-projection";

test("strict PH business date rejects impossible dates and timestamp input", () => {
  assert.equal(validWorker360Date("2026-02-28"), true);
  assert.equal(validWorker360Date("2026-02-29"), false);
  assert.equal(validWorker360Date("2024-02-29"), true);
  assert.equal(validWorker360Date("2026-10-10T00:00:00Z"), false);
  assert.equal(validWorker360Date("2026-13-01"), false);
});

test("as-of position selection respects inclusive dates without current-record inference", () => {
  const rows = [
    { id: 1, positionId: 10, assignmentType: "primary", effectiveFrom: "2024-01-01", effectiveUntil: "2025-12-31" },
    { id: 2, positionId: 20, assignmentType: "primary", effectiveFrom: "2026-01-01", effectiveUntil: null },
    { id: 3, positionId: 30, assignmentType: "secondary", effectiveFrom: "2025-01-01", effectiveUntil: null },
  ];
  assert.equal(selectWorker360Assignment(rows, "2025-12-31").assignment?.positionId, 10);
  assert.equal(selectWorker360Assignment(rows, "2026-01-01").assignment?.positionId, 20);
  assert.deepEqual(selectWorker360Assignment(rows, "2023-01-01"), { status: "not_recorded", assignment: null });
});

test("overlapping as-of primary assignments fail closed", () => {
  const rows = [
    { id: 1, positionId: 10, assignmentType: "primary", effectiveFrom: "2024-01-01", effectiveUntil: null },
    { id: 2, positionId: 20, assignmentType: "primary", effectiveFrom: "2025-01-01", effectiveUntil: null },
  ];
  assert.deepEqual(selectWorker360Assignment(rows, "2026-10-10"), { status: "ambiguous", assignment: null });
  assert.throws(() => selectWorker360Assignment(rows, "2026-02-29"));
});

test("history preview excludes future events, sorts by effective date and flags caps", () => {
  const rows = [
    { id: 4, effectiveDate: "2027-01-01", eventType: "transfer", positionAssignmentId: 4 },
    { id: 1, effectiveDate: "2025-01-01", eventType: "hire", positionAssignmentId: null },
    { id: 2, effectiveDate: "2026-01-01", eventType: "promotion", positionAssignmentId: 2 },
    { id: 3, effectiveDate: "2026-01-01", eventType: "transfer", positionAssignmentId: 3 },
  ];
  const preview = projectWorker360Events(rows, "2026-10-10", 2);
  assert.deepEqual(preview.items.map((item) => item.id), [3, 2]);
  assert.equal(preview.hasMore, true);
  assert.equal(preview.partial, true);
  assert.equal(projectWorker360Events(rows, "2026-10-10", 10).hasMore, false);
  assert.throws(() => projectWorker360Events(rows, "2026-10-10", 101));
});
