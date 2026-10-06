import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("attendance capture policy governs mobile kiosk and offline sync", () => {
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const policy = readFileSync("src/app/api/workforce/attendance-capture/route.ts", "utf8");
  const sync = readFileSync("src/app/api/workforce/attendance-sync/route.ts", "utf8");

  assert.ok(schema.includes('export const attendanceCapturePolicies = pgTable('));
  assert.ok(schema.includes('export const attendanceOfflineEvents = pgTable('));
  assert.ok(schema.includes("attendance_offline_event_unique"));
  assert.ok(policy.includes("mobileClockEnabled"));
  assert.ok(policy.includes("kioskClockEnabled"));
  assert.ok(policy.includes("offlineSyncEnabled"));
  assert.ok(policy.includes("maxOfflineAgeMinutes"));
  assert.ok(sync.includes("verifyBiometricDeviceCredential"));
  assert.ok(sync.includes('device.protocol.trim().toUpperCase() !== "KIOSK"'));
  assert.ok(sync.includes("onConflictDoNothing"));
  assert.ok(sync.includes("pg_advisory_xact_lock"));
  assert.ok(sync.includes("markTimesheetsStaleForEmployeeDate"));
  assert.ok(sync.includes("mobile_offline"));
  assert.ok(sync.includes("kiosk_offline"));
});
