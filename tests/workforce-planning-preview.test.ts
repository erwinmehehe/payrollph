import assert from "node:assert/strict";
import test from "node:test";
import { planSmartRecoveryDraft } from "../src/lib/workforce-recovery-draft";
import { previewWorkforceRecovery } from "../src/lib/workforce-planning-preview";

const workDate = "2026-10-14";
const shifts = [{
  id: 5, startTime: "08:00", endTime: "16:00", breakMinutes: 30, spansMidnight: false,
}, {
  id: 6, startTime: "22:00", endTime: "06:00", breakMinutes: 60, spansMidnight: true,
}];
const coverage = [{
  requirementId: 10, workDate, worksiteId: 20, shiftDefinitionId: 5,
  requiredHeadcount: 3, availableScheduledHeadcount: 1, gap: 2,
}];
const candidates = [
  { employeeId: 2, employeeName: "Synthetic Employee A", score: 95,
    workloadRisk: "low" as const, scheduledMinutesInWindow: 1200,
    consecutiveWorkingDaysBeforeShift: 1 },
  { employeeId: 3, employeeName: "Synthetic Employee B", score: 84,
    workloadRisk: "low" as const, scheduledMinutesInWindow: 1440,
    consecutiveWorkingDaysBeforeShift: 2 },
];
const makeDraft = (shiftId = 5, gap = 2) => planSmartRecoveryDraft({
  mode: "coverage",
  maxProjectedMinutesInWindow: 96 * 60,
  maxConsecutiveWorkingDays: 6,
  requirements: [{
    requirementId: 10, workDate, gap, startTime: shifts.find(s => s.id === shiftId)!.startTime,
    endTime: shifts.find(s => s.id === shiftId)!.endTime,
    spansMidnight: shifts.find(s => s.id === shiftId)!.spansMidnight,
    paidMinutes: shiftId === 5 ? 450 : 420,
    candidates,
  }],
});
const makeLabor = (rate: number | null, visible = true, basis = "scheduled-mix") => ({
  costVisible: visible,
  costingBoundary: "Base-pay estimate only; excludes premiums and statutory treatment.",
  rows: [{ requirementId: 10, benchmarkHourlyRate: rate, requiredCostBasis: basis }],
  quality: { missingPayProfileEmployeeIds: [] as number[], invalidPayProfileEmployeeIds: [] as number[] },
});

test("preview reconciles slot coverage and uses existing paid-shift minutes and benchmark", () => {
  const draft = makeDraft();
  assert.equal(draft.fills.length, 2);
  const result = previewWorkforceRecovery({ draft, coverage, shifts, labor: makeLabor(200) });
  assert.equal(result.uncoveredBefore, 2);
  assert.equal(result.uncoveredAfter, 0);
  assert.equal(result.proposedAssignments, 2);
  assert.equal(result.rows[0].projectedAvailableHeadcount, 3);
  assert.equal(result.rows[0].estimatedAddedBaseCost, 3000);
  assert.equal(result.estimatedAdditionalBaseCost, 3000);
  assert.deepEqual(result.costBases, ["scheduled-mix"]);
  assert.equal(result.costStatus, "estimated");
  assert.equal(result.unpricedAssignments, 0);
});

test("overnight estimates use paid minutes, not wall clock or gross hours", () => {
  const draft = makeDraft(6, 1);
  const nightCoverage = [{ ...coverage[0], shiftDefinitionId: 6, requiredHeadcount: 2, gap: 1 }];
  const result = previewWorkforceRecovery({
    draft, coverage: nightCoverage, shifts, labor: makeLabor(150, true, "workspace-average"),
  });
  assert.equal(result.estimatedAdditionalBaseCost, 1050);
  assert.deepEqual(result.costBases, ["workspace-average"]);
});

test("without People/Payroll cost access all monetary output is redacted", () => {
  const result = previewWorkforceRecovery({
    draft: makeDraft(), coverage, shifts, labor: makeLabor(null, false),
  });
  assert.equal(result.costStatus, "restricted");
  assert.equal(result.estimatedAdditionalBaseCost, null);
  assert.equal(result.rows[0].estimatedAddedBaseCost, null);
  assert.equal(result.rows[0].costBasis, null);
  assert.deepEqual(result.costBases, []);
  assert.equal(result.uncoveredAfter, 0);
});

test("missing or invalid pay profiles fail closed and hide even otherwise valid cost rows", () => {
  for (const field of ["missingPayProfileEmployeeIds", "invalidPayProfileEmployeeIds"] as const) {
    const labor = makeLabor(220);
    labor.quality[field].push(7);
    const result = previewWorkforceRecovery({ draft: makeDraft(), coverage, shifts, labor });
    assert.equal(result.costStatus, "incomplete");
    assert.equal(result.estimatedAdditionalBaseCost, null);
    assert.equal(result.rows[0].estimatedAddedBaseCost, null);
    assert.ok(result.evidenceWarnings.length > 0);
  }
});

test("zero, non-finite or absent benchmarks are NOT interpreted as zero payroll cost", () => {
  for (const rate of [0, null, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = previewWorkforceRecovery({
      draft: makeDraft(), coverage, shifts, labor: makeLabor(rate),
    });
    assert.equal(result.costStatus, "incomplete");
    assert.equal(result.unpricedAssignments, 2);
    assert.equal(result.estimatedAdditionalBaseCost, null);
  }
});

test("unresolved shift or unsupported cost source blocks monetary preview", () => {
  const draft = makeDraft();
  for (const options of [
    { shifts: [] as typeof shifts, labor: makeLabor(200) },
    { shifts, labor: makeLabor(200, true, "unverified-rate") },
  ]) {
    const result = previewWorkforceRecovery({ draft, coverage, ...options });
    assert.equal(result.costStatus, "incomplete");
    assert.equal(result.estimatedAdditionalBaseCost, null);
    assert.equal(result.unpricedAssignments, 2);
  }
});

test("inconsistent recovery demand fails closed rather than producing a plausible cost", () => {
  const draft = makeDraft();
  const wrong = [{ ...coverage[0], gap: 1 }];
  const result = previewWorkforceRecovery({ draft, coverage: wrong, shifts, labor: makeLabor(200) });
  assert.equal(result.costStatus, "incomplete");
  assert.equal(result.estimatedAdditionalBaseCost, null);
  assert.match(result.evidenceWarnings.join(" "), /do not reconcile/);
});

test("no demand produces no invented staffing or base-pay increase", () => {
  const draft = planSmartRecoveryDraft({ requirements: [] });
  const result = previewWorkforceRecovery({
    draft, coverage: [], shifts, labor: makeLabor(250),
  });
  assert.equal(result.rows.length, 0);
  assert.equal(result.proposedAssignments, 0);
  assert.equal(result.estimatedAdditionalBaseCost, 0);
});
