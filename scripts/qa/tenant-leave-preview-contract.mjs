/**
 * Uncredited POST leave/preview tenant-isolation contracts.
 * The only HTTP target is disposable production-mode localhost; no submission,
 * leave deduction, worker mutation, payroll approval or money action occurs.
 */
import assert from "node:assert/strict";

export const LEAVE_DATE = "2026-11-10";
const SHIFT = Object.freeze({
  1: { start: "08:00", end: "17:00", breakMinutes: 60, wall: 540, paid: 480 },
  2: { start: "09:00", end: "18:00", breakMinutes: 30, wall: 540, paid: 510 },
  3: { start: "06:00", end: "14:00", breakMinutes: 30, wall: 480, paid: 450 },
  4: { start: "10:00", end: "19:00", breakMinutes: 45, wall: 540, paid: 495 },
});
export const shiftFor = rank => {
  assert.ok(Object.hasOwn(SHIFT, rank), "a genuine fixture rank is required");
  return { ...SHIFT[rank] };
};

export function requireDisposableLeavePreview(env = process.env) {
  const values = {
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    DEMO_MODE: "false", PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
  };
  for (const [key, value] of Object.entries(values)) {
    assert.equal(env[key], value, "LEAVE_PREVIEW_REFUSED: disposable " + key + " required");
  }
}

export function fullDayPreviewBody(organizationId, employeeId) {
  assert.ok(Number.isSafeInteger(organizationId) && organizationId > 0);
  assert.ok(Number.isSafeInteger(employeeId) && employeeId > 0);
  return {
    organizationId, employeeId,
    intervals: [{ kind: "full_day", workDate: LEAVE_DATE, timezone: "Asia/Manila" }],
  };
}

export function proveActualLeavePreview(reply, expected) {
  assert.equal(reply?.status, 200, "authorized preview must return the real employee schedule");
  assert.match(reply.headers?.get("content-type") ?? "", /^application\/json(?:;|$)/i);
  const body = reply.json;
  assert.ok(body && typeof body === "object" && !Array.isArray(body));
  assert.deepEqual(Object.keys(body).sort(), ["employee", "previews", "blocking"].sort());
  assert.deepEqual(body.employee, {
    id: expected.workerId,
    employeeNo: expected.employeeNo,
    name: expected.employeeName,
  }, "the response must bind the real persisted worker identity");
  assert.equal(body.blocking, false);
  assert.ok(Array.isArray(body.previews) && body.previews.length === 1);
  const preview = body.previews[0];
  assert.deepEqual(Object.keys(preview).sort(), [
    "workDate", "timezone", "schedule", "unavailableWallMinutes",
    "unavailablePaidMinutes", "partiallyAvailable", "blockers", "warnings",
    "segmentImpacts",
  ].sort(), "preview must not include unrelated private workforce source data");
  const shift = shiftFor(expected.rank);
  assert.equal(preview.workDate, LEAVE_DATE);
  assert.equal(preview.timezone, "Asia/Manila");
  assert.equal(preview.unavailableWallMinutes, shift.wall);
  assert.equal(preview.unavailablePaidMinutes, shift.paid);
  assert.equal(preview.partiallyAvailable, false);
  assert.deepEqual(preview.blockers, []);
  assert.deepEqual(preview.warnings, []);
  assert.deepEqual(preview.segmentImpacts, [{
    segmentOrder: 1,
    unavailableWallMinutes: shift.wall,
    unavailablePaidMinutes: shift.paid,
  }]);
  const schedule = preview.schedule;
  assert.ok(schedule && typeof schedule === "object");
  assert.deepEqual(Object.keys(schedule).sort(), [
    "date", "source", "isRestDay", "assignmentId", "patternId",
    "patternDayIndex", "overrideId", "workLocationOrgUnitId",
    "worksiteId", "segments", "audit",
  ].sort());
  assert.equal(schedule.date, LEAVE_DATE);
  assert.equal(schedule.source, "override", "must use a real persisted shift override");
  assert.equal(schedule.isRestDay, false);
  assert.equal(schedule.overrideId, expected.overrideId);
  assert.equal(schedule.assignmentId, null);
  assert.equal(schedule.patternId, null);
  assert.equal(schedule.patternDayIndex, null);
  assert.equal(schedule.workLocationOrgUnitId, expected.unitId);
  assert.equal(schedule.worksiteId, null);
  assert.deepEqual(schedule.segments, [{
    shiftDefinitionId: expected.shiftId,
    shiftCode: expected.shiftCode,
    shiftName: expected.shiftName,
    segmentOrder: 1,
    startTime: shift.start, endTime: shift.end,
    breakMinutes: shift.breakMinutes,
    spansMidnight: false,
  }], "no other employer's schedule or shift may be returned");
  assert.ok(Array.isArray(schedule.audit) && schedule.audit.includes(
    "overrideId=" + expected.overrideId));
  assert.ok(schedule.audit.includes("overrideKind=shift"));
  for (const forbidden of expected.forbiddenMarkers ?? []) {
    assert.ok(forbidden && !reply.text.includes(forbidden),
      "cross-employer/peer marker must never appear in the preview");
  }
  return preview;
}

export function proveLeavePreviewDenial(reply, expectedStatus, forbiddenMarkers = []) {
  assert.equal(reply?.status, expectedStatus, "unauthorized preview must be blocked exactly");
  assert.ok(reply.text.length < 2500, "denial must not reflect a private schedule");
  assert.ok(reply.json && typeof reply.json.error === "string",
    "denial must be a bounded error, never an empty successful preview");
  assert.equal(reply.json.employee, undefined);
  assert.equal(reply.json.previews, undefined);
  for (const forbidden of forbiddenMarkers) {
    assert.ok(forbidden && !reply.text.includes(forbidden),
      "denial must not disclose a victim or peer employee marker");
  }
}

export function assertLeavePreviewSourcesEqual(before, after) {
  assert.deepEqual(after, before,
    "leave preview must not change work schedules, worker data, leave, audit, or payroll");
}
