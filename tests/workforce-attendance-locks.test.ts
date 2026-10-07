import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  attendanceMutationLock,
  payrollCutoffLockForPeriod,
} from "../src/lib/workforce-attendance-lock";

const locks = [
  {
    id: 1,
    periodStart: "2026-10-01",
    periodEnd: "2026-10-15",
    lockType: "attendance",
    status: "locked",
  },
  {
    id: 2,
    periodStart: "2026-10-01",
    periodEnd: "2026-10-15",
    lockType: "payroll_cutoff",
    status: "locked",
  },
];

test("capture mutations are blocked by attendance or payroll-cutoff locks", () => {
  assert.equal(attendanceMutationLock([locks[0]!], "2026-10-05", "capture")?.id, 1);
  assert.equal(attendanceMutationLock(locks, "2026-10-05", "capture")?.id, 2);
  assert.equal(attendanceMutationLock(locks, "2026-10-16", "capture"), null);
});

test("governed corrections remain possible under capture lock but freeze at payroll cutoff", () => {
  assert.equal(attendanceMutationLock([locks[0]!], "2026-10-05", "correction"), null);
  assert.equal(attendanceMutationLock(locks, "2026-10-05", "correction")?.id, 2);
});

test("payroll cutoff gate requires a lock covering the whole payroll period", () => {
  assert.equal(payrollCutoffLockForPeriod(locks, "2026-10-01", "2026-10-15")?.id, 2);
  assert.equal(payrollCutoffLockForPeriod(locks, "2026-09-30", "2026-10-15"), null);
});

test("schema and migration retain auditable lock state", () => {
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const migration = readFileSync("drizzle/0087_wfm_attendance_cutoff_locks.sql", "utf8");
  const baseline = readFileSync("drizzle/baseline.sql", "utf8");
  for (const source of [schema, migration, baseline]) {
    assert.ok(source.includes("workforce_attendance_lock_policies"));
    assert.ok(source.includes("workforce_attendance_period_locks"));
  }
  assert.ok(migration.includes("locked_by_user_id"));
  assert.ok(migration.includes("unlocked_by_user_id"));
  assert.ok(migration.includes("unlock_reason"));
});

test("all attendance mutation paths enforce locks and stale finalized timesheets", () => {
  const webBundy = readFileSync("src/app/api/web-bundy/route.ts", "utf8");
  const biometrics = readFileSync("src/app/api/biometrics/sync/route.ts", "utf8");
  const corrections = readFileSync("src/app/api/workforce/attendance-corrections/route.ts", "utf8");
  const overtime = readFileSync("src/app/api/workforce/overtime/route.ts", "utf8");
  for (const source of [webBundy, biometrics, corrections, overtime]) {
    assert.ok(source.includes("attendanceMutationLock"));
  }
  assert.ok(webBundy.includes("markTimesheetsStaleForEmployeeDate"));
  assert.ok(biometrics.includes("markTimesheetsStaleForEmployeeDate"));
});

test("payroll creation and recalculation enforce the optional cutoff gate", () => {
  const create = readFileSync("src/app/api/payroll-runs/route.ts", "utf8");
  const process = readFileSync("src/app/api/payroll-runs/[id]/process/route.ts", "utf8");
  for (const source of [create, process]) {
    assert.ok(source.includes("loadAttendanceCutoffGate"));
    assert.ok(source.includes("ATTENDANCE_CUTOFF_LOCK_REQUIRED"));
  }
});

test("attendance exception center exposes lock controls", () => {
  const panel = readFileSync("src/components/workspace/attendance-exceptions-panel.tsx", "utf8");
  assert.ok(panel.includes("AttendanceLockControl"));
});
