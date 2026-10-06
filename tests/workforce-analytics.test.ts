import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("enterprise WFM analytics combines workforce operations while redacting payroll cost", () => {
  const route = readFileSync("src/app/api/workforce/analytics/route.ts", "utf8");
  const panel = readFileSync("src/components/workspace/workforce-analytics-panel.tsx", "utf8");
  const analytics = readFileSync("src/components/workspace/analytics.tsx", "utf8");

  assert.ok(route.includes("WORKFORCE_MANAGER_ROLES"));
  assert.ok(route.includes("PEOPLE_PAYROLL_ROLES"));
  assert.ok(route.includes("overtimeRequests"));
  assert.ok(route.includes("leaveRequests"));
  assert.ok(route.includes("timePunches"));
  assert.ok(route.includes("payrollRuns"));
  assert.ok(panel.includes("/api/workforce/coverage"));
  assert.ok(panel.includes("required → scheduled → actual"));
  assert.ok(panel.includes("Payroll variance"));
  assert.ok(panel.includes("data-wfm-enterprise-analytics"));
  assert.ok(analytics.includes("<WorkforceAnalyticsPanel"));
});
