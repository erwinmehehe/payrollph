import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const time = readFileSync("src/components/workspace/time.tsx", "utf8");
const panel = readFileSync("src/components/workspace/attendance-exceptions-panel.tsx", "utf8");

test("time workspace surfaces the attendance exception center", () => {
  assert.ok(time.includes("AttendanceExceptionsPanel"));
  assert.ok(time.includes("organizationId={data.selectedOrganization.id}"));
});

test("attendance exception center calls the scoped workforce API", () => {
  assert.ok(panel.includes("/api/workforce/attendance-exceptions"));
  assert.ok(panel.includes("organizationId: String(organizationId)"));
  assert.ok(panel.includes("startDate"));
  assert.ok(panel.includes("endDate"));
});

test("attendance UI distinguishes blocking review from informational signals", () => {
  assert.ok(panel.includes('severity === "blocker"'));
  assert.ok(panel.includes('severity === "warning"'));
  assert.ok(panel.includes("Needs review"));
  assert.ok(panel.includes("All signals"));
});

test("attendance UI states that authorization cannot suppress statutory overtime", () => {
  assert.ok(panel.includes("never zeroes legally payable overtime"));
});
