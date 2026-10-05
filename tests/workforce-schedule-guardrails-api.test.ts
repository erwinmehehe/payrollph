import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("src/db/schema.ts", "utf8");
const policyRoute = readFileSync("src/app/api/workforce/schedule-guardrails/route.ts", "utf8");
const schedulesRoute = readFileSync("src/app/api/workforce/schedules/route.ts", "utf8");
const windowService = readFileSync("src/lib/workforce-schedule-window.ts", "utf8");
const panel = readFileSync("src/components/workspace/workforce-schedule-guardrails-panel.tsx", "utf8");
const planner = readFileSync("src/components/workspace/workforce-planner.tsx", "utf8");

test("WFM guardrail policy is organization-scoped and configurable", () => {
  assert.ok(schema.includes('export const workforceScheduleGuardrailPolicies = pgTable('));
  assert.ok(schema.includes('organizationId: integer("organization_id").notNull().unique()'));
  assert.ok(schema.includes('minimumRestMinutes: integer("minimum_rest_minutes")'));
  assert.ok(schema.includes('maxConsecutiveWorkingDays: integer("max_consecutive_working_days")'));
  assert.ok(schema.includes('rollingSevenDayMinutes: integer("rolling_seven_day_minutes")'));
  assert.ok(schema.includes('enforcementMode: varchar("enforcement_mode"'));
});

test("guardrail policy mutations require company-wide People access, MFA and audit evidence", () => {
  assert.ok(policyRoute.includes("PEOPLE_ADMIN_ROLES"));
  assert.ok(policyRoute.includes("access?.companyWide"));
  assert.ok(policyRoute.includes("requireSensitiveActionMfa(user)"));
  assert.ok(policyRoute.includes("enforceSameOriginMutation(request)"));
  assert.ok(policyRoute.includes("enforceSensitiveActionRateLimit(request"));
  assert.ok(policyRoute.includes('action: "WFM schedule guardrail policy updated"'));
});

test("schedule previews use prior-week context and return guardrail issues", () => {
  assert.ok(schedulesRoute.includes("startDate: addDays(previewDates[0], -7)"));
  assert.ok(schedulesRoute.includes("evaluateScheduleGuardrails"));
  assert.ok(schedulesRoute.includes("guardrailPolicy,"));
  assert.ok(schedulesRoute.includes("guardrailIssues,"));
  assert.ok(windowService.includes("resolveEmployeeScheduleWindow"));
});

test("assignments and overrides are preflighted before database insertion", () => {
  const assignmentPreflight = schedulesRoute.indexOf('prospectiveAssignment: {');
  const assignmentInsert = schedulesRoute.indexOf("db.insert(employeeScheduleAssignments)");
  const overridePreflight = schedulesRoute.indexOf('prospectiveOverride: {');
  const overrideInsert = schedulesRoute.indexOf("db.insert(scheduleOverrides)");

  assert.ok(assignmentPreflight > -1 && assignmentPreflight < assignmentInsert);
  assert.ok(overridePreflight > -1 && overridePreflight < overrideInsert);
  assert.ok(schedulesRoute.includes("scheduleGuardrailBlocksMutation(guardrailIssues)"));
  assert.ok(schedulesRoute.includes("WFM schedule guardrails blocked this roster assignment."));
  assert.ok(schedulesRoute.includes("WFM schedule guardrails blocked this roster override."));
});

test("UI explicitly distinguishes company fatigue policy from statutory entitlements", () => {
  assert.ok(panel.includes("not universal statutory entitlements"));
  assert.ok(panel.includes("Advisory: warn but allow"));
  assert.ok(panel.includes("Block policy breaches"));
  assert.ok(panel.includes("Overlapping scheduled intervals are always blocked"));
  assert.ok(planner.includes("<WorkforceScheduleGuardrailsPanel"));
  assert.ok(planner.includes("preview?.guardrailIssues"));
});
