import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  attendanceExceptionAgeHours,
  attendanceExceptionSlaDueAt,
  attendanceExceptionSlaStatus,
  defaultAttendanceExceptionSlaHours,
} from "../src/lib/workforce-attendance-exception-governance";

test("attendance exception SLA defaults are severity-aware", () => {
  assert.equal(defaultAttendanceExceptionSlaHours("blocker"), 4);
  assert.equal(defaultAttendanceExceptionSlaHours("warning"), 24);
  assert.equal(defaultAttendanceExceptionSlaHours("info"), 72);
  const first = new Date("2026-10-07T00:00:00.000Z");
  assert.equal(
    attendanceExceptionSlaDueAt({ firstDetectedAt: first, severity: "blocker" }).toISOString(),
    "2026-10-07T04:00:00.000Z",
  );
  assert.equal(
    attendanceExceptionSlaDueAt({ firstDetectedAt: first, severity: "warning" }).toISOString(),
    "2026-10-08T00:00:00.000Z",
  );
});

test("attendance exception age and SLA state are deterministic", () => {
  const now = new Date("2026-10-08T06:00:00.000Z");
  assert.equal(attendanceExceptionAgeHours("2026-10-07T00:00:00.000Z", now), 30);
  assert.equal(attendanceExceptionSlaStatus({
    status: "open",
    slaDueAt: "2026-10-08T00:00:00.000Z",
    now,
  }), "overdue");
  assert.equal(attendanceExceptionSlaStatus({
    status: "open",
    slaDueAt: "2026-10-09T00:00:00.000Z",
    now,
  }), "on_track");
  assert.equal(attendanceExceptionSlaStatus({
    status: "resolved",
    slaDueAt: "2026-10-07T01:00:00.000Z",
    now,
  }), "resolved");
});

test("WFM attendance exception governance persists owner SLA and resolution evidence", () => {
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const migration = readFileSync("drizzle/0085_attendance_exception_governance.sql", "utf8");
  const baseline = readFileSync("drizzle/baseline.sql", "utf8");
  const compat = readFileSync("src/lib/core-schema-compat.ts", "utf8");

  for (const source of [schema, migration, baseline, compat]) {
    assert.ok(source.includes("owner_user_id"));
    assert.ok(source.includes("sla_due_at"));
    assert.ok(source.includes("resolution_note"));
    assert.ok(source.includes("resolved_by_user_id"));
    assert.ok(source.includes("resolution_recorded_at"));
  }
  assert.ok(migration.includes("attendance_exception_events_owner_idx"));
  assert.ok(migration.includes("attendance_exception_events_sla_idx"));
});

test("WFM attendance exception operations are scoped MFA-gated and audited", () => {
  const route = readFileSync("src/app/api/workforce/attendance-exception-events/route.ts", "utf8");
  assert.ok(route.includes("assertOrganizationRole"));
  assert.ok(route.includes("assertScope"));
  assert.ok(route.includes("requireSensitiveActionMfa"));
  assert.ok(route.includes("enforceSensitiveActionRateLimit"));
  assert.ok(route.includes('action === "assign_owner"'));
  assert.ok(route.includes('action === "record_resolution"'));
  assert.ok(route.includes("Only open attendance exceptions can be assigned."));
  assert.ok(route.includes("Resolution evidence can only be recorded after the underlying attendance exception is resolved."));
  assert.ok(route.includes("Resolution evidence is immutable once recorded."));
  assert.ok(route.includes('"WFM attendance exception assigned"'));
  assert.ok(route.includes('"WFM attendance exception resolution evidence recorded"'));
  assert.ok(route.includes("slaStatus"));
  assert.ok(route.includes("ageHours"));
});

test("attendance correction approval records resolution actor evidence automatically", () => {
  const route = readFileSync("src/app/api/workforce/attendance-corrections/route.ts", "utf8");
  assert.ok(route.includes("resolutionEvidence:"));
  assert.ok(route.includes("actorUserId: user.id"));
  assert.ok(route.includes("actorName: user.name"));
  assert.ok(route.includes("Attendance correction #"));
});

test("reopened attendance exceptions clear stale resolution evidence", () => {
  const reconciler = readFileSync("src/lib/workforce-attendance-exception-events.ts", "utf8");
  assert.ok(reconciler.includes("resolutionNote: null"));
  assert.ok(reconciler.includes("resolvedByUserId: null"));
  assert.ok(reconciler.includes("resolvedByName: null"));
  assert.ok(reconciler.includes("resolutionRecordedAt: null"));
  assert.ok(reconciler.includes("resolutionEvidence?:"));
});
