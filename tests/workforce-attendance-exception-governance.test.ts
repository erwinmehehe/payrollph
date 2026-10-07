import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  attendanceExceptionAgeHours,
  attendanceExceptionSlaDueAt,
  attendanceExceptionSlaStatus,
  defaultAttendanceExceptionSlaHours,
} from "../src/lib/workforce-attendance-exception-governance";

test("attendance exception SLA defaults prioritize payroll blockers", () => {
  assert.equal(defaultAttendanceExceptionSlaHours("blocker"), 4);
  assert.equal(defaultAttendanceExceptionSlaHours("warning"), 24);
  assert.equal(defaultAttendanceExceptionSlaHours("info"), 72);
});

test("attendance exception SLA due time and age are deterministic", () => {
  const detected = new Date("2026-10-07T00:00:00.000Z");
  assert.equal(
    attendanceExceptionSlaDueAt({
      firstDetectedAt: detected,
      severity: "blocker",
    }).toISOString(),
    "2026-10-07T04:00:00.000Z",
  );
  assert.equal(
    attendanceExceptionAgeHours(detected, new Date("2026-10-07T05:59:59.000Z")),
    5,
  );
});

test("attendance exception SLA state separates resolved, overdue, on-track and untracked", () => {
  const now = new Date("2026-10-07T12:00:00.000Z");
  assert.equal(attendanceExceptionSlaStatus({
    status: "open",
    slaDueAt: "2026-10-07T11:00:00.000Z",
    now,
  }), "overdue");
  assert.equal(attendanceExceptionSlaStatus({
    status: "open",
    slaDueAt: "2026-10-07T13:00:00.000Z",
    now,
  }), "on_track");
  assert.equal(attendanceExceptionSlaStatus({
    status: "open",
    slaDueAt: null,
    now,
  }), "untracked");
  assert.equal(attendanceExceptionSlaStatus({
    status: "resolved",
    slaDueAt: "2026-10-01T00:00:00.000Z",
    now,
  }), "resolved");
});

test("attendance exception governance is persisted in migration, schema and baseline", () => {
  const migration = readFileSync("drizzle/0085_attendance_exception_governance.sql", "utf8");
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const baseline = readFileSync("drizzle/baseline.sql", "utf8");

  for (const source of [migration, schema, baseline]) {
    assert.ok(source.includes("owner_user_id"));
    assert.ok(source.includes("sla_due_at"));
    assert.ok(source.includes("resolution_note"));
    assert.ok(source.includes("resolved_by_user_id"));
    assert.ok(source.includes("resolution_recorded_at"));
  }
  assert.ok(migration.includes("interval '4 hours'"));
  assert.ok(migration.includes("interval '24 hours'"));
  assert.ok(migration.includes("interval '72 hours'"));
});

test("new attendance exception events receive SLA deadlines", () => {
  const source = readFileSync("src/lib/workforce-attendance-exception-events.ts", "utf8");
  assert.ok(source.includes("attendanceExceptionSlaDueAt"));
  assert.ok(source.includes("slaDueAt: attendanceExceptionSlaDueAt"));
  assert.ok(source.includes("found.slaDueAt ?? attendanceExceptionSlaDueAt"));
});

test("attendance exception API exposes operational queue state", () => {
  const route = readFileSync("src/app/api/workforce/attendance-exceptions/route.ts", "utf8");
  assert.ok(route.includes("eventLedger"));
  assert.ok(route.includes("openPersistedExceptions"));
  assert.ok(route.includes("overduePersistedExceptions"));
  assert.ok(route.includes("unassignedPersistedExceptions"));
  assert.ok(route.includes("attendanceExceptionAgeHours"));
  assert.ok(route.includes("attendanceExceptionSlaStatus"));
});

test("attendance exception assignment and resolution evidence are security governed", () => {
  const route = readFileSync("src/app/api/workforce/attendance-exceptions/route.ts", "utf8");
  assert.ok(route.includes("enforceSameOriginMutation(request)"));
  assert.ok(route.includes("requireSensitiveActionMfa(user)"));
  assert.ok(route.includes("enforceSensitiveActionRateLimit"));
  assert.ok(route.includes('action === "assign"'));
  assert.ok(route.includes('action === "record_resolution"'));
  assert.ok(route.includes("Only open attendance exceptions can be assigned."));
  assert.ok(route.includes("The selected owner is not an active user in this organization."));
  assert.ok(route.includes("Resolution evidence can only be recorded after the authoritative attendance exception is resolved."));
  assert.ok(route.includes('"Attendance exception assigned"'));
  assert.ok(route.includes('"Attendance exception resolution evidence recorded"'));
});
