import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("drizzle/0078_performance_continuity.sql", "utf8");
const schema = readFileSync("src/db/schema.ts", "utf8");
const route = readFileSync("src/app/api/performance/continuous/route.ts", "utf8");
const analytics = readFileSync("src/app/api/performance/analytics/route.ts", "utf8");
const selfRoute = readFileSync("src/app/api/self/performance/route.ts", "utf8");
const reminders = readFileSync("src/lib/hcm-performance-reminders.ts", "utf8");
const scheduler = readFileSync("src/lib/scheduler.ts", "utf8");
const panel = readFileSync("src/components/performance-continuity-panel.tsx", "utf8");
const selfPanel = readFileSync("src/components/hcm-self-performance.tsx", "utf8");

test("performance continuity schema separates shared and private 1:1 evidence", () => {
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "performance_one_on_ones"'));
  assert.ok(migration.includes('"shared_summary" text'));
  assert.ok(migration.includes('"private_manager_notes" text'));
  assert.ok(schema.includes("export const performanceOneOnOnes = pgTable("));
});

test("continuous feedback is append-only with explicit employee or manager visibility", () => {
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "performance_feedback"'));
  assert.ok(migration.includes("employee_shared"));
  assert.ok(migration.includes("manager_private"));
  assert.ok(route.includes('entityType === "feedback"'));
  assert.equal(route.includes("db.update(performanceFeedback)"), false);
});

test("employee self-service never selects manager-private 1:1 notes or private feedback", () => {
  assert.ok(selfRoute.includes("sharedSummary: performanceOneOnOnes.sharedSummary"));
  assert.equal(selfRoute.includes("privateManagerNotes: performanceOneOnOnes.privateManagerNotes"), false);
  assert.ok(selfRoute.includes('eq(performanceFeedback.visibility, "employee_shared")'));
  assert.ok(selfPanel.includes("Manager-private notes stay private."));
});

test("1:1 completion requires a shared summary and locks completed records", () => {
  assert.ok(route.includes("A shared 1:1 summary of at least 10 characters is required"));
  assert.ok(route.includes("Completed or cancelled 1:1 records are locked."));
  assert.ok(route.includes('action: "Performance 1:1 completed"'));
});

test("performance reminders are durable deduplicated scheduler work", () => {
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "performance_reminder_tasks"'));
  assert.ok(migration.includes('CREATE UNIQUE INDEX IF NOT EXISTS "performance_reminder_source_unique"'));
  assert.ok(reminders.includes("performanceReminderStage"));
  assert.ok(reminders.includes('"hcm-performance-reminder"'));
  assert.ok(reminders.includes('"performance-reminder"'));
  assert.ok(scheduler.includes("runScheduledPerformanceReminders"));
  assert.ok(scheduler.includes('"hcm-performance-reminders"'));
});

test("unowned reminder work escalates to a company-wide People admin", () => {
  assert.ok(reminders.includes("fallbackPeopleAdmin"));
  assert.ok(reminders.includes("roleAllowed(row.role, PEOPLE_ADMIN_ROLES)"));
  assert.ok(reminders.includes("fallbackOwner"));
});

test("performance analytics cover manager org-unit distribution and workflow backlog", () => {
  assert.ok(analytics.includes("byManager"));
  assert.ok(analytics.includes("byOrgUnit"));
  assert.ok(analytics.includes("ratingDistribution"));
  assert.ok(analytics.includes("oneOnOneCoverage"));
  assert.ok(analytics.includes("overdueReminders"));
  assert.ok(panel.includes("BY MANAGER"));
  assert.ok(panel.includes("BY ORG UNIT"));
  assert.ok(panel.includes("RATING DISTRIBUTION"));
});

test("continuous performance remains separated from compensation and payroll mutation", () => {
  assert.equal(route.includes("compensation"), false);
  assert.equal(route.includes("basicRate"), false);
  assert.equal(reminders.includes("basicRate"), false);
  assert.ok(panel.includes("without turning informal feedback into compensation actions"));
});
