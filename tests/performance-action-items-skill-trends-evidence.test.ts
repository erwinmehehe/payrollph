import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("drizzle/0083_performance_action_items_skill_trends_evidence.sql", "utf8");
const schema = readFileSync("src/db/schema.ts", "utf8");
const actionRoute = readFileSync("src/app/api/performance/action-items/route.ts", "utf8");
const selfActionRoute = readFileSync("src/app/api/self/performance/action-items/route.ts", "utf8");
const continuousRoute = readFileSync("src/app/api/performance/continuous/route.ts", "utf8");
const selfRoute = readFileSync("src/app/api/self/performance/route.ts", "utf8");
const analytics = readFileSync("src/app/api/performance/analytics/route.ts", "utf8");
const evidenceRoute = readFileSync("src/app/api/performance/evidence/route.ts", "utf8");
const evidenceBuilder = readFileSync("src/lib/hcm-performance-evidence.ts", "utf8");
const managerPanel = readFileSync("src/components/performance-continuity-panel.tsx", "utf8");
const selfPanel = readFileSync("src/components/hcm-self-performance.tsx", "utf8");
const governancePanel = readFileSync("src/components/performance-governance-panel.tsx", "utf8");

test("1:1 action items have governed owner visibility status and immutable event history", () => {
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "performance_one_on_one_action_items"'));
  assert.ok(migration.includes('"owner_kind" IN (\'employee\',\'manager\')'));
  assert.ok(migration.includes('"visibility" IN (\'employee_shared\',\'manager_private\')'));
  assert.ok(migration.includes('"status" IN (\'open\',\'in_progress\',\'completed\',\'cancelled\')'));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "performance_one_on_one_action_item_events"'));
  assert.ok(schema.includes("export const performanceOneOnOneActionItems = pgTable("));
  assert.ok(schema.includes("export const performanceOneOnOneActionItemEvents = pgTable("));
});

test("employee-owned action items must remain employee visible", () => {
  assert.ok(actionRoute.includes('ownerKind === "employee" && visibility !== "employee_shared"'));
  assert.ok(actionRoute.includes("Employee-owned action items must be visible to the employee."));
  assert.ok(managerPanel.includes('actionForm.ownerKind === "employee" ? "employee_shared"'));
});

test("closed action items require governed reopen and cancel/reopen rationale", () => {
  assert.ok(actionRoute.includes("Closed action items must be reopened before editing."));
  assert.ok(actionRoute.includes("Closed action items must be reopened before changing status."));
  assert.ok(actionRoute.includes("A cancellation reason of at least 10 characters is required."));
  assert.ok(actionRoute.includes("A reopening reason of at least 10 characters is required."));
  assert.ok(actionRoute.includes('event(row, "reopened"'));
  assert.ok(actionRoute.includes('event(row, "cancelled"'));
});

test("employees can only progress their own employee-visible action items", () => {
  assert.ok(selfActionRoute.includes('existing.visibility !== "employee_shared"'));
  assert.ok(selfActionRoute.includes('existing.ownerKind !== "employee"'));
  assert.ok(selfActionRoute.includes("existing.ownerEmployeeId !== context.employee.id"));
  assert.ok(selfActionRoute.includes('["in_progress", "completed"].includes(status)'));
  assert.ok(selfActionRoute.includes("Closed action items can only be reopened by the manager or People administrator."));
  assert.equal(selfActionRoute.includes("performanceOneOnOneActionItems).delete"), false);
});

test("employee self-service never receives manager-private action items or manager-private notes", () => {
  assert.ok(selfRoute.includes('eq(performanceOneOnOneActionItems.visibility, "employee_shared")'));
  assert.equal(selfRoute.includes("privateManagerNotes: performanceOneOnOnes.privateManagerNotes"), false);
  assert.ok(selfPanel.includes("Start action"));
  assert.ok(selfPanel.includes("Complete"));
});

test("manager workspace receives action items while preserving scoped meeting access", () => {
  assert.ok(continuousRoute.includes("performanceOneOnOneActionItems"));
  assert.ok(continuousRoute.includes('item.visibility === "employee_shared"'));
  assert.ok(continuousRoute.includes("meeting.managerUserId === user.id"));
  assert.ok(managerPanel.includes("ACTION ITEMS"));
  assert.ok(managerPanel.includes("Add action item"));
});

test("skill trends use completed scoped review evidence and identify persistent gaps", () => {
  assert.ok(analytics.includes('filter((item) => item.status === "completed")'));
  assert.ok(analytics.includes("const visibleReviewById = new Map"));
  assert.ok(analytics.includes("skillItemGroups"));
  assert.ok(analytics.includes("consecutiveGapCycles"));
  assert.ok(analytics.includes("persistentGap: consecutiveGapCycles >= 2"));
  assert.ok(analytics.includes("skillTrends"));
  assert.ok(managerPanel.includes("SKILL-LEVEL TREND"));
});

test("performance evidence export is company-wide People-admin MFA gated and audited", () => {
  assert.ok(evidenceRoute.includes("PEOPLE_ADMIN_ROLES"));
  assert.ok(evidenceRoute.includes("access?.companyWide"));
  assert.ok(evidenceRoute.includes("requireSensitiveActionMfa(user)"));
  assert.ok(evidenceRoute.includes("enforceSensitiveActionRateLimit"));
  assert.ok(evidenceRoute.includes("Performance evidence package exported"));
  assert.ok(evidenceRoute.includes("X-Linaw-Performance-Evidence-SHA256"));
});

test("performance evidence package excludes private performance and payroll data", () => {
  assert.equal(evidenceBuilder.includes("privateManagerNotes"), false);
  assert.ok(evidenceBuilder.includes('eq(performanceFeedback.visibility, "employee_shared")'));
  assert.ok(evidenceBuilder.includes('eq(performanceOneOnOneActionItems.visibility, "employee_shared")'));
  assert.equal(evidenceBuilder.includes("basicRate"), false);
  assert.equal(evidenceBuilder.includes("bankAccount"), false);
  assert.ok(evidenceBuilder.includes('"compensation and payroll records"'));
  assert.ok(evidenceBuilder.includes("sectionHashes"));
  assert.ok(evidenceBuilder.includes("sha256(identity)"));
});

test("performance evidence UI requires an employee and downloads the audited package", () => {
  assert.ok(governancePanel.includes("Export an audit-ready employee evidence package"));
  assert.ok(governancePanel.includes("/api/performance/evidence?"));
  assert.ok(governancePanel.includes("Select an employee before exporting performance evidence."));
  assert.ok(governancePanel.includes("URL.createObjectURL"));
});

test("action items trends and evidence remain separated from compensation and payroll mutation", () => {
  assert.equal(actionRoute.includes("basicRate"), false);
  assert.equal(selfActionRoute.includes("basicRate"), false);
  assert.equal(analytics.includes("basicRate"), false);
  assert.equal(evidenceRoute.includes("basicRate"), false);
});
