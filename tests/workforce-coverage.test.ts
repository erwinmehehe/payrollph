import assert from "node:assert/strict";
import test from "node:test";
import {
  availabilityConflictForShift,
  availabilityRuleApplies,
  computeCoverage,
  preferredForShift,
  remainingOpenShiftSlots,
  rankCoverageCandidates,
  forecastCoverageRisk,
  simulateBestFitCoverage,
  buildRosterPublishReadiness,
  weekdayForDate,
} from "../src/lib/workforce-coverage";

const unavailableMonday = {
  id: 1,
  employeeId: 10,
  weekday: 1,
  startTime: "08:00",
  endTime: "18:00",
  availabilityType: "unavailable" as const,
  effectiveFrom: "2026-10-01",
  effectiveUntil: null,
};

test("availability rules respect weekday and effective dates", () => {
  assert.equal(weekdayForDate("2026-10-05"), 1);
  assert.equal(availabilityRuleApplies(unavailableMonday, "2026-10-05"), true);
  assert.equal(availabilityRuleApplies(unavailableMonday, "2026-10-06"), false);
  assert.equal(availabilityRuleApplies({ ...unavailableMonday, effectiveFrom: "2026-10-06" }, "2026-10-05"), false);
});

test("unavailable windows conflict only when they overlap a shift", () => {
  assert.equal(availabilityConflictForShift({
    rules: [unavailableMonday],
    date: "2026-10-05",
    shift: { id: 1, startTime: "09:00", endTime: "17:00", spansMidnight: false },
  }), true);

  assert.equal(availabilityConflictForShift({
    rules: [{ ...unavailableMonday, startTime: "18:00", endTime: "23:00" }],
    date: "2026-10-05",
    shift: { id: 1, startTime: "09:00", endTime: "17:00", spansMidnight: false },
  }), false);
});

test("cross-midnight availability uses the same absolute window model as shifts", () => {
  assert.equal(availabilityConflictForShift({
    rules: [{ ...unavailableMonday, startTime: "22:00", endTime: "06:00" }],
    date: "2026-10-05",
    shift: { id: 2, startTime: "23:00", endTime: "07:00", spansMidnight: true },
  }), true);
});

test("preferred availability must cover the whole shift", () => {
  const preferred = { ...unavailableMonday, availabilityType: "preferred" as const, startTime: "08:00", endTime: "18:00" };
  assert.equal(preferredForShift({
    rules: [preferred],
    date: "2026-10-05",
    shift: { id: 1, startTime: "09:00", endTime: "17:00", spansMidnight: false },
  }), true);
});

test("coverage excludes scheduled employees who are unavailable for that shift", () => {
  const rows = computeCoverage({
    requirements: [{
      id: 7,
      worksiteId: 100,
      workDate: "2026-10-05",
      shiftDefinitionId: 3,
      requiredHeadcount: 3,
    }],
    scheduled: [
      { employeeId: 1, workDate: "2026-10-05", worksiteId: 100, shiftDefinitionIds: [3], unavailableShiftDefinitionIds: [] },
      { employeeId: 2, workDate: "2026-10-05", worksiteId: 100, shiftDefinitionIds: [3], unavailableShiftDefinitionIds: [3] },
      { employeeId: 3, workDate: "2026-10-05", worksiteId: 100, shiftDefinitionIds: [3], unavailableShiftDefinitionIds: [] },
    ],
  });

  assert.equal(rows[0].scheduledHeadcount, 3);
  assert.equal(rows[0].unavailableScheduledHeadcount, 1);
  assert.equal(rows[0].availableScheduledHeadcount, 2);
  assert.equal(rows[0].gap, 1);
});

test("open shift remaining slots never go negative", () => {
  assert.equal(remainingOpenShiftSlots({ slots: 3, approvedClaims: 1 }), 2);
  assert.equal(remainingOpenShiftSlots({ slots: 1, approvedClaims: 2 }), 0);
});


test("role-specific coverage excludes capability-ineligible scheduled workers", () => {
  const result = computeCoverage({
    requirements: [{
      id: 99,
      worksiteId: 1,
      workDate: "2026-10-06",
      shiftDefinitionId: 2,
      jobProfileId: 7,
      requiredHeadcount: 2,
    }],
    scheduled: [
      {
        employeeId: 1,
        workDate: "2026-10-06",
        worksiteId: 1,
        jobProfileId: 7,
        shiftDefinitionIds: [2],
      },
      {
        employeeId: 2,
        workDate: "2026-10-06",
        worksiteId: 1,
        jobProfileId: 7,
        shiftDefinitionIds: [2],
        ineligibleShiftDefinitionIds: [2],
      },
    ],
  });

  assert.equal(result[0]?.scheduledHeadcount, 2);
  assert.equal(result[0]?.capabilityIneligibleHeadcount, 1);
  assert.equal(result[0]?.availableScheduledHeadcount, 1);
  assert.equal(result[0]?.gap, 1);
});

test("generic headcount demand does not invent capability requirements", () => {
  const result = computeCoverage({
    requirements: [{
      id: 100,
      worksiteId: 1,
      workDate: "2026-10-06",
      shiftDefinitionId: 2,
      jobProfileId: null,
      requiredHeadcount: 1,
    }],
    scheduled: [{
      employeeId: 3,
      workDate: "2026-10-06",
      worksiteId: 1,
      jobProfileId: 7,
      shiftDefinitionIds: [2],
      ineligibleShiftDefinitionIds: [2],
    }],
  });

  assert.equal(result[0]?.capabilityIneligibleHeadcount, 0);
  assert.equal(result[0]?.availableScheduledHeadcount, 1);
  assert.equal(result[0]?.gap, 0);
});


test("approved full-day leave removes rostered workers from effective coverage", () => {
  const result = computeCoverage({
    requirements: [{
      id: 101,
      worksiteId: 1,
      workDate: "2026-10-06",
      shiftDefinitionId: 2,
      jobProfileId: 7,
      requiredHeadcount: 2,
    }],
    scheduled: [
      {
        employeeId: 1,
        workDate: "2026-10-06",
        worksiteId: 1,
        jobProfileId: 7,
        shiftDefinitionIds: [2],
      },
      {
        employeeId: 2,
        workDate: "2026-10-06",
        worksiteId: 1,
        jobProfileId: 7,
        shiftDefinitionIds: [2],
        approvedLeaveShiftDefinitionIds: [2],
      },
    ],
  });

  assert.equal(result[0]?.scheduledHeadcount, 2);
  assert.equal(result[0]?.approvedLeaveScheduledHeadcount, 1);
  assert.equal(result[0]?.availableScheduledHeadcount, 1);
  assert.equal(result[0]?.gap, 1);
});


test("site-ineligible scheduled workers create a qualified coverage gap", () => {
  const result = computeCoverage({
    requirements: [{
      id: 222, worksiteId: 10, workDate: "2026-10-06",
      shiftDefinitionId: 2, jobProfileId: 4, requiredHeadcount: 2,
    }],
    scheduled: [{
      employeeId: 1, workDate: "2026-10-06", worksiteId: 10,
      jobProfileId: 4, shiftDefinitionIds: [2],
    }, {
      employeeId: 2, workDate: "2026-10-06", worksiteId: 10,
      jobProfileId: 4, shiftDefinitionIds: [2], siteIneligibleShiftDefinitionIds: [2],
    }],
  });
  assert.equal(result[0]?.scheduledHeadcount, 2);
  assert.equal(result[0]?.siteIneligibleHeadcount, 1);
  assert.equal(result[0]?.availableScheduledHeadcount, 1);
  assert.equal(result[0]?.gap, 1);
});


test("partial approved leave reduces planned minutes without removing whole-shift headcount", () => {
  const result = computeCoverage({
    requirements: [{
      id: 333,
      worksiteId: 10,
      workDate: "2026-10-06",
      shiftDefinitionId: 2,
      jobProfileId: 4,
      requiredHeadcount: 1,
    }],
    scheduled: [{
      employeeId: 1,
      workDate: "2026-10-06",
      worksiteId: 10,
      jobProfileId: 4,
      shiftDefinitionIds: [2],
      paidMinutesByShiftDefinitionId: { 2: 480 },
      approvedLeaveUnavailableMinutesByShiftDefinitionId: { 2: 240 },
    } as any],
  });

  assert.equal(result[0]?.scheduledHeadcount, 1);
  assert.equal(result[0]?.availableScheduledHeadcount, 1);
  assert.equal(result[0]?.approvedLeavePartiallyUnavailableHeadcount, 1);
  assert.equal(result[0]?.approvedLeaveUnavailableMinutes, 240);
  assert.equal(result[0]?.scheduledPaidMinutes, 480);
  assert.equal(result[0]?.availableScheduledMinutes, 240);
});

test("a fully unavailable precise-leave shift is excluded from available headcount", () => {
  const result = computeCoverage({
    requirements: [{
      id: 334,
      worksiteId: 10,
      workDate: "2026-10-06",
      shiftDefinitionId: 2,
      jobProfileId: 4,
      requiredHeadcount: 1,
    }],
    scheduled: [{
      employeeId: 1,
      workDate: "2026-10-06",
      worksiteId: 10,
      jobProfileId: 4,
      shiftDefinitionIds: [2],
      paidMinutesByShiftDefinitionId: { 2: 480 },
      approvedLeaveUnavailableMinutesByShiftDefinitionId: { 2: 480 },
      approvedLeaveShiftDefinitionIds: [2],
    } as any],
  });

  assert.equal(result[0]?.approvedLeaveScheduledHeadcount, 1);
  assert.equal(result[0]?.approvedLeavePartiallyUnavailableHeadcount, 0);
  assert.equal(result[0]?.availableScheduledHeadcount, 0);
  assert.equal(result[0]?.availableScheduledMinutes, 0);
});


test("coverage candidate ranking prefers qualified available workers with lower workload and preferences", () => {
  const ranked = rankCoverageCandidates({
    shiftPaidMinutes: 480,
    candidates: [
      {
        employeeId: 1,
        employeeName: "Ana Santos",
        preferred: true,
        scheduledMinutesInWindow: 1200,
        consecutiveWorkingDaysBeforeShift: 2,
        alreadyWorkingThatDay: false,
      },
      {
        employeeId: 2,
        employeeName: "Ben Cruz",
        preferred: false,
        scheduledMinutesInWindow: 2100,
        consecutiveWorkingDaysBeforeShift: 4,
        alreadyWorkingThatDay: false,
      },
      {
        employeeId: 3,
        employeeName: "Cara Lim",
        preferred: true,
        scheduledMinutesInWindow: 900,
        consecutiveWorkingDaysBeforeShift: 1,
        alreadyWorkingThatDay: true,
      },
    ],
  });

  assert.deepEqual(ranked.map((row) => row.employeeId), [1, 2]);
  assert.equal(ranked[0]?.workloadRisk, "low");
  assert.match(ranked[0]?.reasons.join(" "), /preferred availability/i);
});

test("coverage candidate ranking flags high projected workload instead of hiding it", () => {
  const [candidate] = rankCoverageCandidates({
    shiftPaidMinutes: 480,
    candidates: [{
      employeeId: 9,
      employeeName: "Dana Reyes",
      preferred: false,
      scheduledMinutesInWindow: 2700,
      consecutiveWorkingDaysBeforeShift: 6,
      alreadyWorkingThatDay: false,
    }],
  });

  assert.equal(candidate?.workloadRisk, "high");
  assert.ok((candidate?.score ?? 100) < 50);
  assert.match(candidate?.reasons.join(" "), /Projected workload risk: high/);
});


test("coverage risk is critical when a staffing gap has no governed recovery candidate", () => {
  const [risk] = forecastCoverageRisk([{
    requirementId: 1,
    gap: 2,
    eligibleRecoveryCandidates: 0,
    unavailableScheduledHeadcount: 1,
  }]);

  assert.equal(risk?.level, "critical");
  assert.match(risk?.reasons.join(" "), /no governed eligible recovery candidate/i);
});

test("coverage risk distinguishes thin candidate benches from recoverable gaps", () => {
  const risks = forecastCoverageRisk([
    { requirementId: 2, gap: 3, eligibleRecoveryCandidates: 1 },
    { requirementId: 3, gap: 2, eligibleRecoveryCandidates: 4 },
    { requirementId: 4, gap: 0, eligibleRecoveryCandidates: 0 },
  ]);

  assert.equal(risks[0]?.level, "high");
  assert.equal(risks[1]?.level, "medium");
  assert.equal(risks[2]?.level, "low");
});


test("best-fit coverage simulation avoids double-booking the same worker on the same date", () => {
  const result = simulateBestFitCoverage({
    requirements: [
      {
        requirementId: 10,
        workDate: "2026-10-12",
        gap: 1,
        candidates: [
          { employeeId: 1, employeeName: "Ana", score: 90, workloadRisk: "low" },
          { employeeId: 2, employeeName: "Ben", score: 80, workloadRisk: "low" },
        ],
      },
      {
        requirementId: 11,
        workDate: "2026-10-12",
        gap: 1,
        candidates: [
          { employeeId: 1, employeeName: "Ana", score: 95, workloadRisk: "low" },
          { employeeId: 3, employeeName: "Cara", score: 70, workloadRisk: "low" },
        ],
      },
    ],
  });

  assert.equal(result.baselineGap, 2);
  assert.equal(result.projectedGap, 0);
  assert.equal(new Set(result.fills.map((row) => row.employeeId)).size, 2);
});

test("best-fit coverage simulation skips high workload risk unless explicitly allowed", () => {
  const safe = simulateBestFitCoverage({
    requirements: [{
      requirementId: 12,
      workDate: "2026-10-13",
      gap: 1,
      candidates: [
        { employeeId: 4, employeeName: "Dina", score: 99, workloadRisk: "high" },
      ],
    }],
  });
  assert.equal(safe.projectedGap, 1);
  assert.equal(safe.avoidedHighRiskCandidates, 1);

  const override = simulateBestFitCoverage({
    allowHighWorkloadRisk: true,
    requirements: [{
      requirementId: 12,
      workDate: "2026-10-13",
      gap: 1,
      candidates: [
        { employeeId: 4, employeeName: "Dina", score: 99, workloadRisk: "high" },
      ],
    }],
  });
  assert.equal(override.projectedGap, 0);
});


test("roster publish readiness blocks critical coverage and blocking guardrails", () => {
  const readiness = buildRosterPublishReadiness({
    coverageRisk: [{ level: "critical" }, { level: "low" }],
    uncoveredRequirements: 1,
    uncoveredSlots: 2,
    pendingRecoveryClaims: 0,
    blockingGuardrailIssues: 2,
    roleEvidenceIssues: 0,
    capabilityEvidenceIssues: 0,
    absenceEvidenceIssues: 0,
    siteEvidenceIssues: 0,
  });

  assert.equal(readiness.status, "blocked");
  assert.equal(readiness.blockerCount, 4);
  assert.ok(readiness.signals.some((signal) => signal.code === "coverage_gap"));
  assert.ok(readiness.signals.some((signal) => signal.code === "coverage_critical"));
  assert.ok(readiness.signals.some((signal) => signal.code === "blocking_guardrail"));
});

test("roster publish readiness can be ready with warnings but no blockers", () => {
  const readiness = buildRosterPublishReadiness({
    coverageRisk: [{ level: "high" }, { level: "medium" }],
    uncoveredRequirements: 0,
    uncoveredSlots: 0,
    pendingRecoveryClaims: 2,
    blockingGuardrailIssues: 0,
    roleEvidenceIssues: 0,
    capabilityEvidenceIssues: 1,
    absenceEvidenceIssues: 0,
    siteEvidenceIssues: 0,
  });

  assert.equal(readiness.status, "warning");
  assert.equal(readiness.blockerCount, 0);
  assert.equal(readiness.warningCount, 4);
});

test("roster publish readiness is ready when no unresolved signals remain", () => {
  const readiness = buildRosterPublishReadiness({
    coverageRisk: [{ level: "low" }],
    uncoveredRequirements: 0,
    uncoveredSlots: 0,
    pendingRecoveryClaims: 0,
    blockingGuardrailIssues: 0,
    roleEvidenceIssues: 0,
    capabilityEvidenceIssues: 0,
    absenceEvidenceIssues: 0,
    siteEvidenceIssues: 0,
  });

  assert.equal(readiness.status, "ready");
  assert.equal(readiness.blockerCount, 0);
  assert.equal(readiness.warningCount, 0);
});
