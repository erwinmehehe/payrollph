import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("enterprise workforce analytics joins the governed WFM and payroll sources", () => {
  const reports = read("src/lib/reports.ts");
  const route = read("src/app/api/reports/route.ts");
  const analytics = read("src/components/workspace/analytics.tsx");

  assert.ok(reports.includes('key === "workforce"'));
  assert.ok(reports.includes("overtimeRequests.requestedMinutes"));
  assert.ok(reports.includes("leaveRequests.status"));
  assert.ok(reports.includes("staffingRequirements.requiredHeadcount"));
  assert.ok(reports.includes("openShiftClaims.status"));
  assert.ok(reports.includes("workforceTimesheets.scheduledMinutes"));
  assert.ok(reports.includes("workforceTimesheets.workedMinutes"));
  assert.ok(reports.includes("payrollRuns.grossPay"));
  assert.ok(reports.includes('"Schedule adherence"'));
  assert.ok(reports.includes('"Payroll variance"'));
  assert.ok(reports.includes('"Labor cost"'));
  assert.ok(route.includes('"workforce"'));
  assert.ok(analytics.includes('name: "Workforce operations"'));
  assert.ok(analytics.includes('useState<ReportKey>("workforce")'));
});
