import assert from "node:assert/strict";
import test from "node:test";
import { buildDemandStaffingShiftEvidence } from "../src/lib/workforce-demand-staffing-evidence";
import { previewDemandToStaffing } from "../src/lib/workforce-demand-staffing-planner";
import type { IssuedDemandSnapshot } from "../src/lib/workforce-issued-demand-evidence";

const snapshot: IssuedDemandSnapshot = {
  version: 1,
  source: "source_reported_aggregate_workload",
  issuedAt: "2026-10-11T00:00:00.000Z",
  sourceCutoffAt: "2026-10-11T00:00:00.000Z",
  horizonStartPh: "2026-10-12",
  trainingEvidenceSha256: "f".repeat(64),
  retrospectiveComparisons: 20,
  scope: {
    organizationId: 101, worksiteId: 201, sourceKey: "pos-main",
    metricKind: "transactions", intervalMinutes: 30, horizonDays: 7,
  },
  points: [
    {intervalStart: "2026-10-12T01:00:00.000Z",
      predictedCount: 10, lowerScenarioCount: 8, upperScenarioCount: 12,
      historicalEvidenceCount: 11},
    {intervalStart: "2026-10-12T01:30:00.000Z",
      predictedCount: 20, lowerScenarioCount: 10, upperScenarioCount: 24,
      historicalEvidenceCount: 11},
  ],
  boundary: "source reported only",
};
const input = {
  organizationId: 101, worksiteId: 201, jobProfileId: 301,
  snapshot, hashVerified: true,
  shift: {id: 401, startTime: "09:00", endTime: "10:00", spansMidnight: false, breakMinutes: 0},
  windowStart: "2026-10-12", windowEnd: "2026-10-12",
  productivityUnitsPerHour: 10, serviceTargetPercent: 100,
  coverage: [{
    requirementId: 501, worksiteId: 201, workDate: "2026-10-12",
    shiftDefinitionId: 401, jobProfileId: 301, availableScheduledHeadcount: 2,
  }],
  laborCostVisible: true, laborRows: [{requirementId: 501, benchmarkHourlyRate: 120}],
  now: new Date("2026-10-11T12:00:00.000Z"),
};
test("peak throughput drives required staff; base cost uses full paid shift", () => {
  const evidence = buildDemandStaffingShiftEvidence(input);
  assert.equal(evidence.slots[0].predictedCount, 20);
  assert.equal(evidence.evidence[0].totalPredictedActivity, 30);
  assert.equal(evidence.slots[0].demandIntervalMinutes, 30);
  const preview = previewDemandToStaffing(evidence.slots);
  assert.equal(preview.rows[0].requiredWorkers, 4);
  assert.equal(preview.rows[0].scheduledWorkers, 2);
  assert.equal(preview.rows[0].gapWorkers, 2);
  assert.equal(preview.rows[0].estimatedAddedBaseCostPhp, 240);
  assert.equal(preview.rows[0].feasibleDraftAdds, null);
  assert.equal(preview.automaticallyPublished, false);
});
test("missing issue time-slot is unknown, not zero demand", () => {
  const result = buildDemandStaffingShiftEvidence({
    ...input, snapshot: {...snapshot, points: snapshot.points.slice(0, 1)},
  });
  assert.equal(result.evidence[0].missingForecastIntervals, 1);
  assert.equal(result.slots[0].predictedCount, null);
  assert.equal(previewDemandToStaffing(result.slots).rows[0].gapWorkers, null);
});
test("missing role/shift requirement cannot be reinterpreted as zero roster", () => {
  const result = buildDemandStaffingShiftEvidence({...input, coverage: []});
  assert.equal(result.slots[0].scheduledHeadcount, null);
  assert.equal(previewDemandToStaffing(result.slots).rows[0].requiredWorkers, 4);
  assert.equal(previewDemandToStaffing(result.slots).rows[0].gapWorkers, null);
});
test("role scope, tenant scope and hash-provenance mismatch fail closed", () => {
  assert.throws(() => buildDemandStaffingShiftEvidence({...input, organizationId: 999}), /verified/);
  assert.throws(() => buildDemandStaffingShiftEvidence({...input, hashVerified: false}), /verified/);
  assert.equal(buildDemandStaffingShiftEvidence({...input, jobProfileId: 999}).slots[0].scheduledHeadcount, null);
});
test("cost redaction, in-progress shift and scenario range cannot create false proof", () => {
  const hidden = buildDemandStaffingShiftEvidence({...input, laborCostVisible: false});
  assert.equal(hidden.slots[0].hourlyBaseCostPhp, null);
  assert.equal(previewDemandToStaffing(hidden.slots).rows[0].estimatedAddedBaseCostPhp, null);
  const past = buildDemandStaffingShiftEvidence({...input, now: new Date("2026-10-12T02:00:00Z")});
  assert.equal(past.slots[0].predictedCount, null);
  const corrupt = {...snapshot, points: [...snapshot.points, snapshot.points[0]]};
  assert.throws(() => buildDemandStaffingShiftEvidence({...input, snapshot: corrupt}), /untrusted/);
});
test("forecast aligned to overnight shift excludes missing next-day intervals", () => {
  const s: IssuedDemandSnapshot = {...snapshot, points: [
    {intervalStart: "2026-10-12T15:00:00.000Z", predictedCount: 10,
      lowerScenarioCount: 8, upperScenarioCount: 12, historicalEvidenceCount: 11},
    {intervalStart: "2026-10-12T16:00:00.000Z", predictedCount: 11,
      lowerScenarioCount: 9, upperScenarioCount: 13, historicalEvidenceCount: 11},
  ], scope: {...snapshot.scope, intervalMinutes: 60}};
  const result = buildDemandStaffingShiftEvidence({...input, snapshot: s,
    shift: {id:401,startTime:"23:00",endTime:"01:00",breakMinutes:0,spansMidnight:true}});
  assert.equal(result.evidence[0].missingForecastIntervals, 0);
  assert.equal(result.slots[0].predictedCount, 11);
});
