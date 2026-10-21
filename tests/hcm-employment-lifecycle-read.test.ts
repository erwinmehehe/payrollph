import assert from "node:assert/strict";
import test from "node:test";
import { readVerifiedLifecycleResponse } from "../src/lib/hcm-employment-lifecycle-read";

const scope = { organizationId: 12, legalEntityId: null, multiEntityEnabled: false };
const row = {
  employeeId: 99, employeeNo: "P099", employeeName: "Worker", employeeStatus: "Active",
  state: "action_required", severity: "warning", action: "review_decision",
  dueDate: "2026-11-01", daysUntil: 11, label: "Decision due", detail: "Review",
  term: null, decision: null,
};
const empty = {
  organizationId: 12, legalEntityId: null, today: "2026-10-21",
  policy: { actionWindowDays: 30 },
  summary: {
    total: 0, actionRequired: 0, upcoming: 0, inProgress: 0,
    unconfigured: 0, handoffReady: 0,
  },
  rows: [],
};
test("verified empty lifecycle state is different from failed or partial read", () => {
  assert.deepEqual(readVerifiedLifecycleResponse(true, empty, scope), empty);
  assert.equal(readVerifiedLifecycleResponse(false, empty, scope), null);
  assert.equal(readVerifiedLifecycleResponse(true, {}, scope), null);
  assert.equal(readVerifiedLifecycleResponse(true, { ...empty, rows: undefined }, scope), null);
  assert.equal(readVerifiedLifecycleResponse(true, { ...empty, summary: undefined }, scope), null);
  assert.equal(readVerifiedLifecycleResponse(true, { ...empty, organizationId: 999 }, scope), null);
  assert.equal(readVerifiedLifecycleResponse(true, { ...empty, legalEntityId: 5 }, scope), null);
});
test("lifecycle counts and action eligibility require complete, consistent row", () => {
  const one = { ...empty, rows: [row], summary: { ...empty.summary, total: 1, actionRequired: 1 } };
  assert.deepEqual(readVerifiedLifecycleResponse(true, one, scope), one);
  assert.equal(readVerifiedLifecycleResponse(true, { ...one, rows: [row, row] }, scope), null);
  assert.equal(readVerifiedLifecycleResponse(true, { ...one, rows: [{ ...row, action: undefined }] }, scope), null);
  assert.equal(readVerifiedLifecycleResponse(true, { ...one, rows: [{ ...row, employeeId: 0 }] }, scope), null);
  assert.equal(readVerifiedLifecycleResponse(true, { ...one, summary: empty.summary }, scope), null);
  assert.equal(readVerifiedLifecycleResponse(true, { ...one, rows: [{ ...row, state: "clear" }] }, scope), null);
});
test("legal-employer scope is checked independently of organization", () => {
  const multi = { organizationId: 12, legalEntityId: 42, multiEntityEnabled: true };
  assert.deepEqual(readVerifiedLifecycleResponse(true, { ...empty, legalEntityId: 42 }, multi),
    { ...empty, legalEntityId: 42 });
  assert.equal(readVerifiedLifecycleResponse(true, empty, multi), null);
  // Retry only restores actions after a new, independently verified HTTP success.
  assert.equal(readVerifiedLifecycleResponse(false, empty, scope), null);
  assert.deepEqual(readVerifiedLifecycleResponse(true, empty, scope), empty);
});
