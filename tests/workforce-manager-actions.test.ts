import assert from "node:assert/strict";
import test from "node:test";
import { buildWfmManagerActionQueue, phWorkDateAt } from "../src/lib/workforce-manager-actions";

test("Philippine workday boundary is stable even when the manager is in another timezone", () => {
  assert.equal(phWorkDateAt(new Date("2026-10-08T15:59:59.000Z")), "2026-10-08");
  assert.equal(phWorkDateAt(new Date("2026-10-08T16:00:00.000Z")), "2026-10-09");
  assert.throws(() => phWorkDateAt(new Date("bad")), /Invalid clock instant/);
});

test("action queue prioritizes urgent coverage and approval over routine evidence review", () => {
  const result = buildWfmManagerActionQueue({
    today: "2026-10-09",
    coverage: [
      { requirementId: 7, workDate: "2026-10-09", gap: 2 },
      { requirementId: 8, workDate: "2026-10-12", gap: 1 },
    ],
    openShifts: [{ id: 31, workDate: "2026-10-09" }],
    claims: [
      { id: 1, openShiftId: 31, status: "pending" },
      { id: 2, openShiftId: 31, status: "pending" },
      { id: 3, openShiftId: 31, status: "rejected" },
    ],
    blockingGuardrailIssues: 1,
    attendanceExceptionCount: 2,
    evidenceWarnings: [{ code: "site_evidence", count: 2, message: "never copy raw PII" }],
  });
  assert.equal(result.critical, 3);
  assert.equal(result.total, 6);
  assert.equal(result.dueWithinTwoDays, 2);
  assert.equal(result.actions[0]?.priority, "critical");
  assert.equal(result.actions.find(x => x.id === "claim:31")?.title, "Review 2 pending shift claim(s)");
  assert.deepEqual(result.actions.find(x => x.id === "guardrails")?.destination, "#wfm-roster-readiness");
  assert.ok(!JSON.stringify(result).includes("never copy raw PII"));
});

test("past coverage can prompt reconciliation but never retroactive auto-scheduling", () => {
  const result = buildWfmManagerActionQueue({
    today: "2026-10-09",
    coverage: [{ requirementId: 15, workDate: "2026-10-07", gap: 1 }],
    openShifts: [], claims: [], blockingGuardrailIssues: 0, attendanceExceptionCount: 0,
  });
  assert.equal(result.actions[0]?.title, "Investigate past staffing gap");
  assert.equal(result.actions[0]?.destination, "#wfm-labor-variance");
  assert.match(result.actions[0]?.detail ?? "", /do not backdate/);
});

test("invalid dates, non-positive gaps and unknown evidence codes cannot fabricate queue work", () => {
  const result = buildWfmManagerActionQueue({
    today: "2026-10-09",
    coverage: [
      { requirementId: 1, workDate: "2026-02-30", gap: 2 },
      { requirementId: 2, workDate: "2026-10-09", gap: 0 },
      { requirementId: 3, workDate: "2026-10-09", gap: Number.NaN },
    ],
    openShifts: [{ id: 21, workDate: "2026-13-01" }],
    claims: [{ id: 22, openShiftId: 21, status: "pending" }],
    blockingGuardrailIssues: Number.POSITIVE_INFINITY,
    attendanceExceptionCount: -2,
    evidenceWarnings: [{ code: "salary_evidence", count: 2, message: "Restricted" }],
  });
  assert.equal(result.total, 0);
  assert.throws(() => buildWfmManagerActionQueue({
    today: "2026-02-30", coverage: [], openShifts: [], claims: [],
    blockingGuardrailIssues: 0, attendanceExceptionCount: 0,
  }), /valid Philippine work date/);
});

test("large manager queues are bounded and sorted predictably", () => {
  const result = buildWfmManagerActionQueue({
    today: "2026-10-09",
    coverage: Array.from({ length: 90 }, (_, i) => ({
      requirementId: i + 1, workDate: "2026-10-09", gap: 1,
    })),
    openShifts: [], claims: [], blockingGuardrailIssues: 0, attendanceExceptionCount: 0,
  });
  assert.equal(result.total, 90);
  assert.equal(result.actions.length, 25);
  assert.deepEqual(result.actions.map(x => x.id).slice(0, 3),
    ["coverage:1", "coverage:10", "coverage:11"]);
});
