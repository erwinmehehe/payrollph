import assert from "node:assert/strict";
import test from "node:test";
import { previewDemandToStaffing, type DemandStaffingSlot } from "../src/lib/workforce-demand-staffing-planner";

const sample: DemandStaffingSlot = {
  workDate: "2026-10-12", startTime: "09:00", predictedCount: 40,
  lowerScenarioCount: 20, upperScenarioCount: 60,
  scheduledHeadcount: 2, availableEligibleHeadcount: 3,
  eligibleSkillEvidenceComplete: true, restAndAvailabilityEvidenceComplete: true,
  serviceTargetCoveragePercent: 100, productiveUnitsPerWorkerHour: 10,
  paidMinutesPerWorker: 60, hourlyBaseCostPhp: 120,
  overtimeHoursPerAddedWorker: 0, overtimeRateMultiplier: 1.25,
};
test("forecast slots create review-only coverage and scenario-cost evidence", () => {
  const x = previewDemandToStaffing([sample]);
  assert.equal(x.status, "review_ready");
  assert.equal(x.rows[0].requiredWorkers, 4);
  assert.equal(x.rows[0].lowScenarioWorkers, 2);
  assert.equal(x.rows[0].highScenarioWorkers, 6);
  assert.equal(x.rows[0].gapWorkers, 2);
  assert.equal(x.rows[0].feasibleDraftAdds, 2);
  assert.equal(x.totals.estimatedBaseCostPhp, 240);
  assert.equal(x.totals.estimatedOvertimeCostPhp, 0);
  assert.equal(x.approvalRequired, true);
  assert.equal(x.automaticallyPublished, false);
});
test("missing demand remains unknown, not zero", () => {
  const x = previewDemandToStaffing([{...sample, predictedCount:null}]);
  assert.equal(x.status, "source_review");
  assert.equal(x.rows[0].requiredWorkers, null);
  assert.equal(x.rows[0].feasibleDraftAdds, null);
  assert.equal(x.totals.gaps, null);
});
test("missing rest/skill proof blocks draft capacity without hiding observed gap", () => {
  const x = previewDemandToStaffing([{
    ...sample, eligibleSkillEvidenceComplete:false, restAndAvailabilityEvidenceComplete:false,
  }]);
  assert.equal(x.rows[0].gapWorkers, 2);
  assert.equal(x.rows[0].feasibleDraftAdds, null);
  // The cost is an indicative estimate for the recorded gap, not an
  // authorization to select employees, work overtime, or commit wages.
  assert.equal(x.totals.estimatedBaseCostPhp, 240);
});
test("capacity scarcity produces an uncovered remainder", () => {
  const x = previewDemandToStaffing([{...sample, availableEligibleHeadcount:1}]);
  assert.equal(x.rows[0].feasibleDraftAdds, 1);
  assert.equal(x.rows[0].uncoveredWorkers, 1);
});
test("overtime cannot be silently counted as zero when unknown", () => {
  const x = previewDemandToStaffing([{...sample, overtimeHoursPerAddedWorker:null}]);
  assert.equal(x.rows[0].estimatedAddedOvertimeCostPhp, null);
  assert.equal(x.status, "source_review");
});
test("rejects fabricated range, duplicate intervals and invalid productivity", () => {
  assert.equal(previewDemandToStaffing([{...sample, lowerScenarioCount:50}]).status, "source_review");
  assert.throws(() => previewDemandToStaffing([sample,sample]), /duplicated/);
  assert.throws(() => previewDemandToStaffing([{...sample, productiveUnitsPerWorkerHour:0}]), /Invalid/);
});

test("unknown scheduled headcount never becomes an empty roster", () => {
  const result = previewDemandToStaffing([{...sample, scheduledHeadcount:null}]);
  assert.equal(result.rows[0].requiredWorkers, 4);
  assert.equal(result.rows[0].gapWorkers, null);
  assert.equal(result.rows[0].estimatedAddedBaseCostPhp, null);
  assert.ok(result.rows[0].reviewReasons.includes("missing_roster_evidence"));
});
test("peak 30-minute demand and paid 8-hour shift have separate units", () => {
  const result = previewDemandToStaffing([{
    ...sample, predictedCount:20, lowerScenarioCount:10,
    upperScenarioCount:25, demandIntervalMinutes:30, paidMinutesPerWorker:480,
  }]);
  assert.equal(result.rows[0].requiredWorkers, 4);
  assert.equal(result.rows[0].gapWorkers, 2);
  assert.equal(result.rows[0].estimatedAddedBaseCostPhp, 1920);
  assert.equal(result.rows[0].estimatedAddedOvertimeCostPhp, 0);
});
test("unbounded demand does not return impossible headcount or infinity", () => {
  const result = previewDemandToStaffing([{
    ...sample, predictedCount:1_000_000, upperScenarioCount:1_000_000,
    lowerScenarioCount:1_000_000, productiveUnitsPerWorkerHour:0.01,
  }]);
  assert.equal(result.status, "source_review");
  assert.equal(result.rows[0].requiredWorkers, null);
  assert.ok(result.rows[0].reviewReasons.includes("staffing_estimate_unbounded"));
});

test("review-ready staffing requires literal boolean skill and rest evidence", () => {
  for (const invalid of ["false", "true", 1, 0, null, undefined, [], {}]) {
    assert.throws(() => previewDemandToStaffing([{
      ...sample, eligibleSkillEvidenceComplete: invalid,
    } as unknown as DemandStaffingSlot]), /Invalid, duplicated or unbounded/,
    "reject coerced skill proof: " + String(invalid));
    assert.throws(() => previewDemandToStaffing([{
      ...sample, restAndAvailabilityEvidenceComplete: invalid,
    } as unknown as DemandStaffingSlot]), /Invalid, duplicated or unbounded/,
    "reject coerced rest/availability proof: " + String(invalid));
  }
  const denied = previewDemandToStaffing([{
    ...sample, eligibleSkillEvidenceComplete: false,
    restAndAvailabilityEvidenceComplete: true,
  }]);
  assert.equal(denied.status, "source_review");
  assert.equal(denied.rows[0].feasibleDraftAdds, null);
  assert.ok(denied.rows[0].reviewReasons.includes("skill_evidence_missing"));
  const verified = previewDemandToStaffing([sample]);
  assert.equal(verified.status, "review_ready");
  assert.equal(verified.rows[0].feasibleDraftAdds, 2);
  assert.equal(verified.automaticallyPublished, false);
});
