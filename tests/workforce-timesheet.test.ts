import assert from "node:assert/strict";
import test from "node:test";
import {
  dateCoveredByApprovedLeave,
  evaluateTimesheetPayrollGate,
  hashTimesheetSnapshot,
  scheduledMinutesForDay,
} from "../src/lib/workforce-timesheet";

test("scheduled minutes include cross-midnight duration less unpaid break", () => {
  const minutes = scheduledMinutesForDay({
    date: "2026-10-05",
    source: "pattern",
    isRestDay: false,
    assignmentId: 1,
    patternId: 1,
    patternDayIndex: 0,
    overrideId: null,
    workLocationOrgUnitId: null,
    worksiteId: 1,
    segments: [{
      shiftDefinitionId: 1,
      segmentOrder: 1,
      shiftCode: "NIGHT",
      shiftName: "Night",
      startTime: "22:00",
      endTime: "06:00",
      breakMinutes: 60,
      spansMidnight: true,
    }],
    audit: [],
  });

  assert.equal(minutes, 420);
});

test("approved leave covers only dates inside its approved range", () => {
  const leaves = [{
    startDate: "2026-10-05",
    endDate: "2026-10-06",
    status: "Approved",
  }];
  assert.equal(dateCoveredByApprovedLeave("2026-10-05", leaves), true);
  assert.equal(dateCoveredByApprovedLeave("2026-10-06", leaves), true);
  assert.equal(dateCoveredByApprovedLeave("2026-10-07", leaves), false);
  assert.equal(dateCoveredByApprovedLeave("2026-10-05", [{ ...leaves[0], status: "Pending" }]), false);
});

test("advisory policy never blocks payroll for missing approvals", () => {
  const result = evaluateTimesheetPayrollGate({
    policy: { active: true, enforcementMode: "advisory" },
    employeeIds: [3, 1, 2],
    latestTimesheets: [
      { employeeId: 1, status: "approved", version: 1 },
      { employeeId: 2, status: "submitted", version: 2 },
    ],
  });

  assert.equal(result.allowed, true);
  assert.equal(result.blocking, false);
  assert.deepEqual(result.missingEmployeeIds, [3]);
  assert.deepEqual(result.nonApprovedEmployeeIds, [2]);
});

test("blocking policy requires approved latest versions for every employee", () => {
  const result = evaluateTimesheetPayrollGate({
    policy: { active: true, enforcementMode: "block" },
    employeeIds: [1, 2, 3],
    latestTimesheets: [
      { employeeId: 1, status: "approved", version: 1 },
      { employeeId: 2, status: "stale", version: 2 },
    ],
  });

  assert.equal(result.allowed, false);
  assert.equal(result.blocking, true);
  assert.deepEqual(result.approvedEmployeeIds, [1]);
  assert.deepEqual(result.nonApprovedEmployeeIds, [2]);
  assert.deepEqual(result.missingEmployeeIds, [3]);
});

test("inactive blocking policy does not stop payroll", () => {
  const result = evaluateTimesheetPayrollGate({
    policy: { active: false, enforcementMode: "block" },
    employeeIds: [1],
    latestTimesheets: [],
  });
  assert.equal(result.allowed, true);
});

test("timesheet snapshot hash is stable and changes when evidence changes", () => {
  const one = hashTimesheetSnapshot({ employeeId: 1, workedMinutes: 480 });
  const same = hashTimesheetSnapshot({ employeeId: 1, workedMinutes: 480 });
  const changed = hashTimesheetSnapshot({ employeeId: 1, workedMinutes: 481 });
  assert.equal(one, same);
  assert.notEqual(one, changed);
  assert.match(one, /^[a-f0-9]{64}$/);
});
