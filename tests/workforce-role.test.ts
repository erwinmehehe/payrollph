import assert from "node:assert/strict";
import test from "node:test";
import { effectiveJobProfileId } from "../src/lib/workforce-role";

const assignments = [
  { id: 1, employeeId: 10, positionId: 100, effectiveFrom: "2026-01-01", effectiveUntil: "2026-06-30" },
  { id: 2, employeeId: 10, positionId: 200, effectiveFrom: "2026-07-01", effectiveUntil: null },
  { id: 3, employeeId: 11, positionId: 300, effectiveFrom: "2026-01-01", effectiveUntil: null },
];

const positions = [
  { id: 100, jobProfileId: 1 },
  { id: 200, jobProfileId: 2 },
  { id: 300, jobProfileId: 3 },
];

test("effective job profile follows effective-dated position assignments", () => {
  assert.equal(effectiveJobProfileId({ employeeId: 10, date: "2026-06-30", assignments, positions }), 1);
  assert.equal(effectiveJobProfileId({ employeeId: 10, date: "2026-07-01", assignments, positions }), 2);
  assert.equal(effectiveJobProfileId({ employeeId: 11, date: "2026-10-05", assignments, positions }), 3);
});

test("effective job profile is null when no governed position applies", () => {
  assert.equal(effectiveJobProfileId({ employeeId: 12, date: "2026-10-05", assignments, positions }), null);
});
