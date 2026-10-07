import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("0067 persists idempotent attendance exception lifecycle evidence", () => {
  const migration = read("drizzle/0067_attendance_exception_events.sql");
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "attendance_exception_events"'));
  assert.ok(migration.includes('"fingerprint_sha256" varchar(64) NOT NULL'));
  assert.ok(migration.includes('"status" varchar(16) NOT NULL DEFAULT \'open\''));
  assert.ok(migration.includes("attendance_exception_events_fingerprint_unique"));
  assert.ok(migration.includes("UNIQUE INDEX"));
  assert.ok(migration.includes("'info','warning','blocker'"));
  assert.ok(migration.includes("'open','resolved'"));
});

test("fresh schema mirrors the attendance exception ledger constraints", () => {
  const schema = read("src/db/schema.ts");
  const baseline = read("drizzle/baseline.sql");
  for (const source of [schema, baseline]) {
    assert.ok(source.includes("attendance_exception_events"));
    assert.ok(source.includes("attendance_exception_events_fingerprint_unique"));
    assert.ok(source.includes("attendance_exception_events_open_idx"));
  }
  assert.ok(schema.includes("attendance_exception_events_severity_check"));
  assert.ok(schema.includes("attendance_exception_events_status_check"));
});

test("attendance.exception_created is now live rather than planned", () => {
  const source = read("src/lib/automation.ts");
  const liveStart = source.indexOf("export const AUTOMATION_LIVE_TRIGGERS");
  const plannedStart = source.indexOf("export const AUTOMATION_PLANNED_TRIGGERS");
  assert.ok(liveStart >= 0 && plannedStart > liveStart);
  const live = source.slice(liveStart, plannedStart);
  const planned = source.slice(plannedStart, source.indexOf("export function automationTriggerIsLive", plannedStart));
  assert.ok(live.includes('"attendance.exception_created"'));
  assert.equal(planned.includes('"attendance.exception_created"'), false);
  assert.ok(source.includes('"attendanceExceptionKind"'));
  assert.ok(source.includes('"attendanceExceptionSeverity"'));
});

test("exception reconciliation is fingerprinted, resolves stale rows, and emits only newly created events", () => {
  const source = read("src/lib/workforce-attendance-exception-events.ts");
  assert.ok(source.includes('createHash("sha256")'));
  assert.ok(source.includes("attendanceExceptionFingerprint"));
  assert.ok(source.includes("onConflictDoNothing().returning()"));
  assert.ok(source.includes('status: "resolved"'));
  assert.ok(source.includes("for (const row of created)"));
  assert.ok(source.includes('trigger: "attendance.exception_created"'));
  assert.ok(source.includes("attendance-exception-created:"));
  assert.ok(source.includes("attendanceExceptionKind: row.exceptionKind"));
  assert.ok(source.includes("attendanceExceptionSeverity: row.severity"));
});

test("authoritative attendance mutation paths reconcile without making automation transactional", () => {
  const bundy = read("src/app/api/web-bundy/route.ts");
  const biometric = read("src/app/api/biometrics/sync/route.ts");
  const corrections = read("src/app/api/workforce/attendance-corrections/route.ts");

  assert.ok(bundy.includes("reconcileAttendanceExceptionEvents"));
  assert.ok(bundy.includes('status: "sync_error"'));
  assert.ok(bundy.includes("attendanceExceptionSync"));

  assert.ok(biometric.includes("reconcileAttendanceExceptionEvents"));
  assert.ok(biometric.includes("changedAttendance"));
  assert.ok(biometric.includes('status: "sync_error"'));
  assert.ok(biometric.includes("attendanceExceptionSync"));

  assert.ok(corrections.includes("reconcileAttendanceExceptionEvents"));
  assert.ok(corrections.includes('status: "sync_error"'));
  assert.ok(corrections.includes("attendanceExceptionSync"));
});

test("attendance exception event generation stays outside the read-only exception report", () => {
  const report = read("src/app/api/workforce/attendance-exceptions/route.ts");
  assert.equal(report.includes("reconcileAttendanceExceptionEvents"), false);
  assert.equal(report.includes("runAutomationEventSafely"), false);
});
