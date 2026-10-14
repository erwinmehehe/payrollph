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

test("attendance API failures expose an unavailable state rather than false empty results", () => {
  assert.ok(panel.includes('setLoadError(error instanceof Error'));
  assert.ok(panel.includes('setPayload(null)'));
  assert.ok(panel.includes('setOperations(null)'));
  assert.ok(panel.includes('!loadError && rows.length === 0'));
  assert.ok(panel.includes('!loadError && (operations?.exceptions.length ?? 0) === 0'));
  assert.ok(panel.includes('No absence of exceptions can be confirmed'));
});

test("shared notification callbacks are stable and duplicate errors do not stack", () => {
  const ui = readFileSync("src/components/workspace/ui.tsx", "utf8");
  assert.ok(ui.includes('const notify = useCallback('));
  assert.ok(ui.includes('const dismiss = useCallback('));
  assert.ok(ui.includes('current.some((toast) => toast.kind === "err" && toast.message === message)'));
  assert.ok(ui.includes('.slice(-6)'));
});
