import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { calibrateRecordedWorkAgainstSchedule, type LaborCalibrationRow } from "../src/lib/workforce-labor-calibration";
import { planSmartRecoveryDraft, recoveryProposedRestConflict, type RecoveryProposal } from "../src/lib/workforce-recovery-draft";
import { WorkforceLaborCalibrationPanel } from "../src/components/workspace/workforce-labor-calibration-panel";

function rows(): LaborCalibrationRow[] {
  return ["2026-10-06", "2026-10-07", "2026-10-08"].flatMap(workDate =>
    [1,2,3].map(() => ({
      workDate, requiredHours: 8, scheduledHours: 8,
      actualHours: 7.5, attendanceFlags: [],
    })));
}

test("historical calibration reports evidence-only hours variance, not machine-learning demand accuracy", () => {
  const result = calibrateRecordedWorkAgainstSchedule({ rows: rows(), today: "2026-10-11" });
  assert.equal(result.status, "ready");
  assert.equal(result.eligibleRows, 9);
  assert.equal(result.eligibleDates, 3);
  assert.equal(result.scheduledHours, 72);
  assert.equal(result.recordedHours, 67.5);
  assert.equal(result.weightedAbsoluteVariancePercent, 6.25);
  assert.equal(result.signedHoursDifference, -4.5);
  assert.equal(result.observedToRequiredPercent, 93.75);
  assert.match(result.boundary, /not a forecast of customer demand/);
});
test("incomplete, future or missing punches never count as recorded zero hours", () => {
  const base = rows();
  base[0] = { ...base[0], actualHours: 0 };
  base[1] = { ...base[1], attendanceFlags: ["Incomplete punch"] };
  base[2] = { ...base[2], workDate: "2026-10-12" };
  const result = calibrateRecordedWorkAgainstSchedule({ rows: base, today: "2026-10-11" });
  assert.equal(result.eligibleRows, 6);
  assert.equal(result.excludedRows, 3);
  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.weightedAbsoluteVariancePercent, null);
});
test("unmatched source, impossible dates, negative worked time and >500 rows fail closed", () => {
  const q = { unmatchedPunchRows: 1 };
  assert.equal(calibrateRecordedWorkAgainstSchedule({ rows: rows(), today: "2026-10-11", quality: q }).status, "source_review");
  assert.equal(calibrateRecordedWorkAgainstSchedule({ rows: rows(), today: "2026-02-30" }).status, "source_review");
  assert.equal(calibrateRecordedWorkAgainstSchedule({ rows: [{ ...rows()[0], actualHours: -1 }], today: "2026-10-11" }).status, "source_review");
  assert.equal(calibrateRecordedWorkAgainstSchedule({ rows: Array.from({ length: 501 }, () => rows()[0]), today: "2026-10-11" }).status, "source_review");
});

const night: RecoveryProposal = { requirementId: 1, employeeId: 11, workDate: "2026-10-11",
  startTime: "22:00", endTime: "06:00", spansMidnight: true };
const morning: RecoveryProposal = { requirementId: 2, employeeId: 11, workDate: "2026-10-12",
  startTime: "08:00", endTime: "16:00", spansMidnight: false };

test("blocking rest boundary uses actual overnight intervals, not dates or overlap only", () => {
  assert.equal(recoveryProposedRestConflict([night], morning, 660), true);
  assert.equal(recoveryProposedRestConflict([night], morning, 120), false);
  assert.equal(recoveryProposedRestConflict([night], { ...morning, employeeId: 12 }, 660), false);
  assert.equal(recoveryProposedRestConflict([night], { ...morning, workDate: "2026-10-32" }, 660), true);
  assert.equal(recoveryProposedRestConflict([night], morning, -1), true);
});

test("review-only planner switches an adjacent-shift candidate to an eligible rested peer", () => {
  const worker = (employeeId: number, score: number) => ({
    employeeId, employeeName: "Synthetic worker " + employeeId,
    score, workloadRisk: "low" as const,
    scheduledMinutesInWindow: 360,
  });
  const requirements = [
    { requirementId: 1, workDate: night.workDate, gap: 1,
      startTime: night.startTime, endTime: night.endTime,
      spansMidnight: true, paidMinutes: 420, candidates: [worker(11, 100)] },
    { requirementId: 2, workDate: morning.workDate, gap: 1,
      startTime: morning.startTime, endTime: morning.endTime,
      spansMidnight: false, paidMinutes: 420,
      candidates: [worker(11, 100), worker(12, 80)] },
  ];
  const withoutPolicy = planSmartRecoveryDraft({ requirements });
  assert.deepEqual(withoutPolicy.fills.map(x => x.employeeId), [11, 11]);
  const withPolicy = planSmartRecoveryDraft({ requirements, minimumRestMinutes: 660 });
  assert.deepEqual(withPolicy.fills.map(x => x.employeeId), [11, 12]);
  assert.equal(withPolicy.avoidedProposedRestViolations, 1);
  assert.equal(withPolicy.projectedGap, 0);
  assert.throws(() => planSmartRecoveryDraft({ requirements, minimumRestMinutes: 1441 }), /Invalid company planning cap/);
});
test("Coverage UI only treats configured BLOCKING rest policy as a draft hard constraint", () => {
  const src = readFileSync("src/components/workspace/workforce-coverage-panel.tsx", "utf8");
  assert.ok(src.includes('policy.enforcementMode === "block"'));
  assert.ok(src.includes("minimumRestMinutes: payload?.guardrailReadiness?.policy.active"));
  assert.ok(src.includes("WorkforceLaborCalibrationPanel"));
  assert.ok(src.includes("addDays(planningToday, -14)"));
});
test("historical calibration panel is readable and never claims wage or customer demand accuracy", () => {
  const html = renderToStaticMarkup(createElement(WorkforceLaborCalibrationPanel, {
    labor: { rows: rows(), quality: { unmatchedPunchRows: 0 } },
    today: "2026-10-11", loading: false, onReviewHistory: () => {},
  }));
  assert.match(html, /Recorded vs scheduled absolute variance/);
  assert.match(html, /6.3%|6.2%/);
  assert.match(html, /Review previous 14 days/);
  assert.match(html, /not a prediction of customer demand/);
});
