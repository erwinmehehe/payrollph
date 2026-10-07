import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("drizzle/0077_performance_calibration.sql", "utf8");
const schema = readFileSync("src/db/schema.ts", "utf8");
const route = readFileSync("src/app/api/performance/calibration/route.ts", "utf8");
const performanceRoute = readFileSync("src/app/api/performance/route.ts", "utf8");
const panel = readFileSync("src/components/performance-calibration-panel.tsx", "utf8");
const governance = readFileSync("src/components/performance-governance-panel.tsx", "utf8");

test("performance calibration has governed session and entry evidence", () => {
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "performance_calibration_sessions"'));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "performance_calibration_entries"'));
  assert.ok(migration.includes('"require_calibration" boolean NOT NULL DEFAULT false'));
  assert.ok(schema.includes("export const performanceCalibrationSessions = pgTable("));
  assert.ok(schema.includes("export const performanceCalibrationEntries = pgTable("));
  assert.ok(schema.includes('requireCalibration: boolean("require_calibration")'));
});

test("calibration can only open after completed manager reviews", () => {
  assert.ok(route.includes("Complete every manager review with a final rating before opening calibration."));
  assert.ok(route.includes('review.status !== "completed" || !review.finalScore'));
  assert.ok(route.includes("A calibration session already exists for this performance cycle."));
});

test("changed calibrated ratings require explicit written rationale", () => {
  assert.ok(route.includes("A written rationale of at least 10 characters is required when changing a manager final rating."));
  assert.ok(route.includes("Performance rating calibration changed"));
  assert.ok(route.includes("rationaleProvided"));
});

test("finalization writes calibrated performance ratings but never compensation actions", () => {
  assert.ok(route.includes("Performance calibration finalized"));
  assert.ok(route.includes("db.update(performanceReviews)"));
  assert.ok(route.includes("finalScore: entry.calibratedScore!"));
  assert.equal(route.includes("compensation"), false);
});

test("cycle closure waits for required or voluntarily opened calibration", () => {
  assert.ok(performanceRoute.includes("cycle.requireCalibration || calibrationSessions.length > 0"));
  assert.ok(performanceRoute.includes("calibrationRequiredAndOpen"));
  assert.ok(performanceRoute.includes("any required calibration is finalized"));
});

test("calibration UI is part of performance governance", () => {
  assert.ok(governance.includes("PerformanceCalibrationPanel"));
  assert.ok(panel.includes("Review rating consistency before cycle closure"));
  assert.ok(panel.includes("Change rationale · required"));
  assert.ok(panel.includes("Finalize calibration"));
});
