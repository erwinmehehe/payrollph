import assert from "node:assert/strict";
import test from "node:test";
import {
  availabilityConflictForShift,
  availabilityRuleApplies,
  computeCoverage,
  preferredForShift,
  remainingOpenShiftSlots,
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
