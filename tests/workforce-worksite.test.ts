import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveWorksiteId,
  selectEffectiveWorksiteAssignment,
  worksiteAssignmentOverlaps,
} from "../src/lib/workforce-worksite";

test("effective worksite assignment is resolved by date without rewriting history", () => {
  const assignments = [
    {
      id: 1,
      worksiteId: 10,
      effectiveFrom: "2026-01-01",
      effectiveUntil: "2026-09-30",
    },
    {
      id: 2,
      worksiteId: 20,
      effectiveFrom: "2026-10-01",
      effectiveUntil: null,
    },
  ];

  assert.equal(selectEffectiveWorksiteAssignment(assignments, "2026-09-30")?.worksiteId, 10);
  assert.equal(selectEffectiveWorksiteAssignment(assignments, "2026-10-01")?.worksiteId, 20);
});

test("explicit schedule worksite outranks employee default worksite", () => {
  const assignments = [{
    id: 1,
    worksiteId: 10,
    effectiveFrom: "2026-01-01",
    effectiveUntil: null,
  }];

  assert.equal(resolveWorksiteId({
    date: "2026-10-05",
    scheduleWorksiteId: 99,
    assignments,
  }), 99);

  assert.equal(resolveWorksiteId({
    date: "2026-10-05",
    assignments,
  }), 10);
});

test("overlap detector rejects conflicting effective-dated assignments", () => {
  const existing = [{
    id: 1,
    worksiteId: 10,
    effectiveFrom: "2026-01-01",
    effectiveUntil: "2026-10-31",
  }];

  assert.equal(worksiteAssignmentOverlaps(existing, {
    effectiveFrom: "2026-10-15",
    effectiveUntil: null,
  }), true);

  assert.equal(worksiteAssignmentOverlaps(existing, {
    effectiveFrom: "2026-11-01",
    effectiveUntil: null,
  }), false);
});

test("invalid assignment ranges fail closed", () => {
  assert.throws(
    () => worksiteAssignmentOverlaps([], {
      effectiveFrom: "2026-10-05",
      effectiveUntil: "2026-10-01",
    }),
    /cannot be before/i,
  );
});
