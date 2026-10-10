import assert from "node:assert/strict";
import test from "node:test";
import {
  planSmartRecoveryDraft, recoveryProposalConflict, recoveryShiftInterval,
  type RecoveryCandidate, type RecoveryDemand,
} from "../src/lib/workforce-recovery-draft";

const candidate = (employeeId: number, score = 90, hours = 10): RecoveryCandidate => ({
  employeeId,
  employeeName: "Worker " + employeeId,
  score,
  workloadRisk: "low",
  scheduledMinutesInWindow: hours * 60,
});
const shift = (requirementId: number, date: string, gap: number, candidates: RecoveryCandidate[]): RecoveryDemand => ({
  requirementId,
  workDate: date,
  gap,
  startTime: "08:00",
  endTime: "16:00",
  paidMinutes: 420,
  candidates,
});

test("smart draft preserves a scarce qualified employee for the only role they can cover", () => {
  const broad = shift(11, "2026-10-12", 1, [candidate(1, 99), candidate(2, 80)]);
  const scarce = shift(12, "2026-10-12", 1, [candidate(1, 90)]);
  for (const requirements of [[broad, scarce], [scarce, broad]]) {
    const plan = planSmartRecoveryDraft({ requirements });
    assert.equal(plan.projectedGap, 0);
    assert.equal(plan.requirementsRecovered, 2);
    assert.deepEqual(plan.fills.map(row => [row.requirementId, row.employeeId]), [[12, 1], [11, 2]]);
  }
});

test("balanced strategy fairly prefers the eligible worker with fewer scheduled hours", () => {
  const req = shift(20, "2026-10-12", 1, [candidate(1, 95, 38), candidate(2, 80, 4)]);
  const coverage = planSmartRecoveryDraft({ requirements: [req], mode: "coverage" });
  const balanced = planSmartRecoveryDraft({ requirements: [req], mode: "balanced" });
  assert.equal(coverage.fills[0]?.employeeId, 1);
  assert.equal(balanced.fills[0]?.employeeId, 2);
  assert.equal(balanced.fills[0]?.projectedWindowMinutes, 4 * 60 + 420);
  assert.match(balanced.fills[0]?.explanation ?? "", /manager approval required/);
});

test("preview prevents overlapping overnight shifts even across different Philippine work dates", () => {
  const overnight: RecoveryDemand = {
    ...shift(30, "2026-10-12", 1, [candidate(1)]),
    startTime: "22:00", endTime: "06:00",
  };
  const morning: RecoveryDemand = {
    ...shift(31, "2026-10-13", 1, [candidate(1, 99), candidate(2, 80)]),
    startTime: "05:00", endTime: "13:00",
  };
  const plan = planSmartRecoveryDraft({ requirements: [overnight, morning] });
  assert.deepEqual(plan.fills.map(row => row.employeeId), [1, 2]);
  assert.equal(plan.avoidedConflictingAssignments, 1);
  assert.equal(plan.projectedGap, 0);
});

test("exact boundary of an overnight shift does not overlap the next work date", () => {
  const prior = { employeeId: 1, requirementId: 1, workDate: "2026-10-12", startTime: "22:00", endTime: "06:00" };
  const next = { employeeId: 1, requirementId: 2, workDate: "2026-10-13", startTime: "06:00", endTime: "14:00" };
  assert.equal(recoveryProposalConflict([prior, next]), null);
});

test("server-side proposal integrity rejects duplicate same-day assignments even if shift hours differ", () => {
  const a = { employeeId: 3, requirementId: 1, workDate: "2026-10-12", startTime: "08:00", endTime: "12:00" };
  const b = { employeeId: 3, requirementId: 2, workDate: "2026-10-12", startTime: "13:00", endTime: "17:00" };
  assert.equal(recoveryProposalConflict([a, b])?.code, "DUPLICATE_EMPLOYEE_DAY");
  assert.equal(recoveryProposalConflict([a, { ...b, employeeId: 4 }]), null);
});

test("server-side proposal integrity blocks overlapping adjacent dates and invalid dates", () => {
  const a = { employeeId: 9, requirementId: 1, workDate: "2026-10-12", startTime: "23:00", endTime: "07:00" };
  const b = { employeeId: 9, requirementId: 2, workDate: "2026-10-13", startTime: "06:00", endTime: "14:00" };
  assert.equal(recoveryProposalConflict([a, b])?.code, "OVERLAPPING_EMPLOYEE_SHIFT");
  for (const invalid of [
    { ...a, workDate: "2026-02-30" },
    { ...a, startTime: "25:00" },
    { ...a, endTime: "23:00" },
    { ...a, startTime: "08:00", endTime: "08:00" },
  ]) assert.equal(recoveryProposalConflict([invalid])?.code, "INVALID_SHIFT_WINDOW");
  assert.equal(recoveryShiftInterval({ workDate: "2024-02-29", startTime: "08:00", endTime: "17:00" }) !== null, true);
});

test("unreviewed high workload risk stays off by default and needs explicit manager opt-in", () => {
  const req = shift(40, "2026-10-12", 1, [{
    ...candidate(4), workloadRisk: "high" as const,
  }]);
  const safe = planSmartRecoveryDraft({ requirements: [req] });
  assert.equal(safe.projectedGap, 1);
  assert.equal(safe.avoidedHighRiskCandidates, 1);
  const override = planSmartRecoveryDraft({ requirements: [req], allowHighWorkloadRisk: true });
  assert.equal(override.projectedGap, 0);
  assert.equal(override.fills[0]?.workloadRisk, "high");
});

test("draft recommendations are capped to match the staging API maximum of fifty", () => {
  const req = shift(50, "2026-10-12", 55,
    Array.from({ length: 55 }, (_, i) => candidate(i + 1, 100 - i)));
  const plan = planSmartRecoveryDraft({ requirements: [req] });
  assert.equal(plan.fills.length, 50);
  assert.equal(plan.projectedGap, 5);
  assert.equal(plan.limitedToFiftyClaims, true);
  assert.equal(plan.requirementsStillAtRisk, 1);
});

test("no rank preference can assign the same worker twice on the same date", () => {
  const reqs = [
    shift(60, "2026-10-12", 1, [candidate(7, 100)]),
    shift(61, "2026-10-12", 1, [candidate(7, 100)]),
  ];
  const plan = planSmartRecoveryDraft({ requirements: reqs });
  assert.equal(plan.fills.length, 1);
  assert.equal(plan.projectedGap, 1);
  assert.ok(plan.avoidedConflictingAssignments >= 1);
});


test("recovery draft applies cumulative 14-day planning-hour limits across staged days", () => {
  const overloaded = { ...candidate(101), scheduledMinutesInWindow: 90 * 60, consecutiveWorkingDaysBeforeShift: 0 };
  const requirements = [
    shift(12, "2026-10-11", 1, [overloaded]),
    shift(11, "2026-10-10", 1, [overloaded]),
  ];
  const result = planSmartRecoveryDraft({
    requirements, maxProjectedMinutesInWindow: 96 * 60, maxConsecutiveWorkingDays: 6,
  });
  assert.equal(result.fills.length, 0);
  assert.equal(result.avoidedProjectedOverload, 2);
});

test("recovery draft carries projected consecutive days across adjacent shifts", () => {
  const rested = { ...candidate(101), consecutiveWorkingDaysBeforeShift: 5 };
  const result = planSmartRecoveryDraft({
    requirements: [
      shift(11, "2026-10-11", 1, [rested]),
      shift(10, "2026-10-10", 1, [rested]),
    ],
    maxProjectedMinutesInWindow: 96 * 60, maxConsecutiveWorkingDays: 6,
  });
  assert.equal(result.fills.length, 1);
  assert.equal(result.fills[0].workDate, "2026-10-10");
  assert.equal(result.fills[0].projectedConsecutiveDays, 6);
  assert.equal(result.avoidedConsecutiveStreak, 1);
});

test("recovery rejects unknown streak and malformed planning caps", () => {
  const result = planSmartRecoveryDraft({
    requirements: [shift(30, "2026-10-10", 1, [candidate(5)])],
    maxConsecutiveWorkingDays: 6, maxProjectedMinutesInWindow: 5760,
  });
  assert.equal(result.fills.length, 0);
  assert.equal(result.missingWorkloadEvidence, 1);
  assert.throws(() => planSmartRecoveryDraft({
    requirements: [], maxConsecutiveWorkingDays: 0,
  }), /Invalid company planning cap/);
});

test("balanced mode still enforces the same company workload cap", () => {
  const result = planSmartRecoveryDraft({
    mode: "balanced",
    requirements: [shift(40, "2026-10-10", 1, [
      { ...candidate(1), scheduledMinutesInWindow: 96 * 60, consecutiveWorkingDaysBeforeShift: 0 },
      { ...candidate(2), scheduledMinutesInWindow: 8 * 60, consecutiveWorkingDaysBeforeShift: 0 },
    ])],
    maxProjectedMinutesInWindow: 96 * 60, maxConsecutiveWorkingDays: 6,
  });
  assert.equal(result.fills.length, 1);
  assert.equal(result.fills[0].employeeId, 2);
});
