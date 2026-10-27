import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  LEAVE_DATE, shiftFor, requireDisposableLeavePreview, fullDayPreviewBody,
  proveActualLeavePreview, proveLeavePreviewDenial, assertLeavePreviewSourcesEqual,
} from "../scripts/qa/tenant-leave-preview-contract.mjs";

const a = {
  rank: 1, workerId: 41, employeeNo: "FICTIONAL-ATTA-worker",
  employeeName: "Table FICTIONAL-ATTA-worker",
  unitId: 11, shiftId: 61, shiftCode: "ATTA-SH",
  shiftName: "FICTIONAL-ATTA shift", overrideId: 81,
  forbiddenMarkers: ["FICTIONAL-VICTIM", "FICTIONAL-ATTB", "FICTIONAL-PEER"],
};
const b = {
  rank: 2, workerId: 51, employeeNo: "FICTIONAL-ATTB-worker",
  employeeName: "Table FICTIONAL-ATTB-worker",
  unitId: 15, shiftId: 71, shiftCode: "ATTB-SH",
  shiftName: "FICTIONAL-ATTB shift", overrideId: 91,
  forbiddenMarkers: ["FICTIONAL-VICTIM", "FICTIONAL-ATTA"],
};

function fakeReply(subject) {
  const s = shiftFor(subject.rank);
  const json = {
    employee: { id: subject.workerId, employeeNo: subject.employeeNo,
      name: subject.employeeName },
    blocking: false,
    previews: [{
      workDate: LEAVE_DATE, timezone: "Asia/Manila",
      schedule: {
        date: LEAVE_DATE, source: "override", isRestDay: false,
        assignmentId: null, patternId: null, patternDayIndex: null,
        overrideId: subject.overrideId, workLocationOrgUnitId: subject.unitId,
        worksiteId: null,
        segments: [{
          shiftDefinitionId: subject.shiftId, shiftCode: subject.shiftCode,
          shiftName: subject.shiftName, segmentOrder: 1, startTime: s.start,
          endTime: s.end, breakMinutes: s.breakMinutes, spansMidnight: false,
        }],
        audit: ["No effective schedule assignment; schedule was not guessed.",
          "overrideId=" + subject.overrideId, "overrideKind=shift", "isRestDay=false"],
      },
      unavailableWallMinutes: s.wall, unavailablePaidMinutes: s.paid,
      partiallyAvailable: false, blockers: [], warnings: [],
      segmentImpacts: [{
        segmentOrder: 1, unavailableWallMinutes: s.wall,
        unavailablePaidMinutes: s.paid,
      }],
    }],
  };
  return { status: 200, json, text: JSON.stringify(json),
    headers: new Headers({ "content-type": "application/json" }) };
}
function forged(change, sample = a) {
  const copy = fakeReply(sample);
  change(copy.json, copy);
  copy.text = JSON.stringify(copy.json);
  return copy;
}

test("strict disposable guard refuses missing GitHub Actions, nonlocal PG, providers and incorrect app flags", () => {
  const env = {
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000", DEMO_MODE: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  };
  requireDisposableLeavePreview(env);
  for (const key of Object.keys(env)) {
    assert.throws(() => requireDisposableLeavePreview({ ...env, [key]: "invalid" }),
      /LEAVE_PREVIEW_REFUSED/);
    assert.throws(() => requireDisposableLeavePreview({ ...env, [key]: undefined }),
      /LEAVE_PREVIEW_REFUSED/);
  }
});

test("four genuinely distinct shift schedules have exact paid/wall minutes", () => {
  assert.deepEqual(shiftFor(1), {
    start: "08:00", end: "17:00", breakMinutes: 60, wall: 540, paid: 480,
  });
  assert.deepEqual(shiftFor(2), {
    start: "09:00", end: "18:00", breakMinutes: 30, wall: 540, paid: 510,
  });
  assert.deepEqual(shiftFor(3), {
    start: "06:00", end: "14:00", breakMinutes: 30, wall: 480, paid: 450,
  });
  assert.deepEqual(shiftFor(4), {
    start: "10:00", end: "19:00", breakMinutes: 45, wall: 540, paid: 495,
  });
  assert.throws(() => shiftFor(0));
  assert.throws(() => shiftFor(5));
});

test("preview always uses one bounded full-day Philippine work-date interval", () => {
  const body = fullDayPreviewBody(11, 41);
  assert.deepEqual(body, { organizationId: 11, employeeId: 41, intervals: [{
    kind: "full_day", workDate: "2026-11-10", timezone: "Asia/Manila",
  }] });
  assert.throws(() => fullDayPreviewBody(-1, 41));
  assert.throws(() => fullDayPreviewBody(11, NaN));
});

test("authentic own HTTP shape is identity- and shift-bound; swapped employers cannot pass", () => {
  proveActualLeavePreview(fakeReply(a), a);
  proveActualLeavePreview(fakeReply(b), b);
  assert.throws(() => proveActualLeavePreview(fakeReply(a), b));
  assert.throws(() => proveActualLeavePreview(fakeReply(b), a));
});

test("proof rejects empty, foreign, forged, no-shift and unexpected sensitive source fields", () => {
  const mutations = [
    body => { body.employee = null; },
    body => { body.employee.id = b.workerId; },
    body => { body.employee.employeeNo = b.employeeNo; },
    body => { body.employee.name = b.employeeName; },
    body => { body.blocking = true; },
    body => { body.previews = []; },
    body => { body.previews[0].schedule = null; },
    body => { body.previews[0].schedule.source = "unassigned"; },
    body => { body.previews[0].schedule.overrideId = b.overrideId; },
    body => { body.previews[0].schedule.workLocationOrgUnitId = b.unitId; },
    body => { body.previews[0].schedule.segments[0].shiftDefinitionId = b.shiftId; },
    body => { body.previews[0].schedule.segments[0].shiftCode = b.shiftCode; },
    body => { body.previews[0].schedule.segments[0].startTime = "23:00"; },
    body => { body.previews[0].schedule.segments[0].breakMinutes = 12; },
    body => { body.previews[0].unavailablePaidMinutes = 0; },
    body => { body.previews[0].partiallyAvailable = true; },
    body => { body.previews[0].blockers.push({ code: "SCHEDULE_REQUIRED" }); },
    body => { body.previews[0].segmentImpacts[0].unavailableWallMinutes = 0; },
    body => { body.previews[0].payrollAccount = "0000000"; },
    body => { body.secretGovernmentId = "000000000"; },
    body => { body.employee.employeeNo = "FICTIONAL-VICTIM"; },
  ];
  for (const mutate of mutations) assert.throws(() =>
    proveActualLeavePreview(forged(mutate), a));
  const incorrect = fakeReply(a);
  incorrect.status = 403;
  assert.throws(() => proveActualLeavePreview(incorrect, a));
  const forbidden = fakeReply(a);
  forbidden.text += "FICTIONAL-VICTIM";
  assert.throws(() => proveActualLeavePreview(forbidden, a));
});

test("untrusted worker IDs, invalid time, cross-origin and foreign tenant denials remain uninformative", () => {
  for (const status of [400, 401, 403, 404, 409]) {
    const json = { error: "Scope unavailable." };
    proveLeavePreviewDenial({ status, json, text: JSON.stringify(json) }, status,
      ["FICTIONAL-VICTIM"]);
  }
  for (const text of [
    '{"error":"FICTIONAL-VICTIM"}',
    '{"error":"Not found", "employee":{"id":91}}',
    '{"error":"Not found", "previews":[]}',
  ]) {
    const json = JSON.parse(text);
    assert.throws(() => proveLeavePreviewDenial({ status: 403, json, text },
      403, ["FICTIONAL-VICTIM"]));
  }
  assert.throws(() => proveLeavePreviewDenial({
    status: 200, json: { error: "none" }, text: '{"error":"none"}',
  }, 403));
});

test("read-only source snapshot rejects any changed worker, shift, leave, payroll or audit state", () => {
  const original = {
    staff: [{ id: 1 }], shifts: [{ id: 2 }], overrides: [{ id: 3 }],
    leaves: [{ id: 4 }], balances: [{ id: 5 }], runs: [{ id: 6 }],
    payProfiles: [{ id: 7 }], audit: [{ id: 8 }],
  };
  assertLeavePreviewSourcesEqual(original, structuredClone(original));
  for (const name of Object.keys(original)) {
    const changed = structuredClone(original);
    changed[name][0].tampered = true;
    assert.throws(() => assertLeavePreviewSourcesEqual(original, changed), name);
  }
});

test("exact manifest GET/POST identities remain uncredited and server source binds employee access", () => {
  const manifest = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const record = Object.values(manifest.allApiRouteFiles).find(
    row => row.route === "leave/preview");
  assert.equal(record?.methods?.find(method => method.name === "POST")?.status, "GAP");
  const source = readFileSync("src/app/api/leave/preview/route.ts", "utf8");
  for (const condition of [
    "enforceSameOriginMutation", "getAccess(user.id, organizationId)",
    "employeeId = user.employeeId", "eq(employees.organizationId, organizationId)",
    "eq(employees.id, employeeId)", "assertScope(access, employee.orgUnitId)",
    "loadResolvedEmployeeSchedule", "resolveLeaveIntervalsForSchedule",
  ]) assert.ok(source.includes(condition), "missing actual route gate: " + condition);
  const integration = readFileSync("scripts/qa/tenant-leave-preview-http.mjs", "utf8");
  for (const proof of [
    "seedEmployer", "standaloneMakeSession", "victimSnapshot", "peerWorker",
    "workerEmployeeId", "fullDayPreviewBody", "shiftDefinitions",
    "scheduleOverrides", "assertLeavePreviewSourcesEqual", "ignoredSpoofs",
    "const separated", "crossSite",
  ]) assert.ok(integration.includes(proof), "missing actual PG/HTTP test source: " + proof);
});
