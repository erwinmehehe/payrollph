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


test("role-specific coverage counts only employees in the required job profile", () => {
  const requirements = [{
    id: 8,
    worksiteId: 100,
    workDate: "2026-10-05",
    shiftDefinitionId: 3,
    jobProfileId: 7,
    requiredHeadcount: 2,
  }];
  const scheduled = [
    { employeeId: 1, workDate: "2026-10-05", worksiteId: 100, jobProfileId: 7, shiftDefinitionIds: [3], unavailableShiftDefinitionIds: [] },
    { employeeId: 2, workDate: "2026-10-05", worksiteId: 100, jobProfileId: 9, shiftDefinitionIds: [3], unavailableShiftDefinitionIds: [] },
  ];

  const roleRows = computeCoverage({ requirements, scheduled });
  assert.equal(roleRows[0].scheduledHeadcount, 1);
  assert.equal(roleRows[0].gap, 1);
  assert.equal(roleRows[0].jobProfileId, 7);

  const genericRows = computeCoverage({
    requirements: [{ ...requirements[0], id: 9, jobProfileId: null }],
    scheduled,
  });
  assert.equal(genericRows[0].scheduledHeadcount, 2);
  assert.equal(genericRows[0].gap, 0);
});
