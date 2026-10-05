import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("contribution case timeline is append-only at the API surface", () => {
  const route = readFileSync("src/app/api/compliance/contribution-issues/route.ts", "utf8");
  assert.ok(route.includes("statutoryContributionIssueEvents"));
  assert.ok(route.includes('eventType: "review_started"'));
  assert.ok(route.includes('eventType: "payroll_update"'));
  assert.ok(route.includes('eventType: "referred"'));
  assert.ok(route.includes('eventType: "resolved"'));
  assert.equal(route.includes("update(statutoryContributionIssueEvents)"), false);
  assert.equal(route.includes("delete(statutoryContributionIssueEvents)"), false);
});

test("employee report creates its first timeline event in the same transaction", () => {
  const route = readFileSync("src/app/api/self/contribution-issues/route.ts", "utf8");
  const transactionAt = route.indexOf("db.transaction(async (tx)");
  const caseInsertAt = route.indexOf("tx.insert(statutoryContributionIssueCases)", transactionAt);
  const eventInsertAt = route.indexOf("tx.insert(statutoryContributionIssueEvents)", caseInsertAt);
  const taskInsertAt = route.indexOf("tx.insert(complianceActionTasks)", eventInsertAt);
  assert.ok(transactionAt >= 0);
  assert.ok(caseInsertAt > transactionAt);
  assert.ok(eventInsertAt > caseInsertAt);
  assert.ok(taskInsertAt > eventInsertAt);
  assert.ok(route.includes('eventType: "reported"'));
});

test("review start appends its event atomically with ownership and task acknowledgement", () => {
  const route = readFileSync("src/app/api/compliance/contribution-issues/route.ts", "utf8");
  const reviewAt = route.indexOf('if (action === "start_review")');
  const txAt = route.indexOf("db.transaction(async (tx)", reviewAt);
  const caseUpdateAt = route.indexOf("tx.update(statutoryContributionIssueCases)", txAt);
  const taskUpdateAt = route.indexOf("tx.update(complianceActionTasks)", caseUpdateAt);
  const eventAt = route.indexOf("tx.insert(statutoryContributionIssueEvents)", taskUpdateAt);
  assert.ok(reviewAt >= 0);
  assert.ok(txAt > reviewAt);
  assert.ok(caseUpdateAt > txAt);
  assert.ok(taskUpdateAt > caseUpdateAt);
  assert.ok(eventAt > taskUpdateAt);
  assert.ok(route.includes("This case review has already started."));
});

test("payroll can post an employee-visible update without mutating statutory evidence", () => {
  const route = readFileSync("src/app/api/compliance/contribution-issues/route.ts", "utf8");
  assert.ok(route.includes('action === "add_update"'));
  assert.ok(route.includes("Start review before posting an employee-visible case update."));
  assert.ok(route.includes('eventType: "payroll_update"'));
  assert.ok(route.includes('visibility: "employee"'));
  assert.ok(route.includes("notifyEmployeeOfContributionCaseUpdate"));
  assert.equal(route.includes("update(statutoryRemittanceMembers)"), false);
  assert.equal(route.includes("update(statutoryRemittanceBatches)"), false);
});

test("employee timelines are scoped to the signed-in employee and employee-visible events", () => {
  const issueRoute = readFileSync("src/app/api/self/contribution-issues/route.ts", "utf8");
  const payslipRoute = readFileSync("src/app/api/self/payslips/route.ts", "utf8");
  for (const source of [issueRoute, payslipRoute]) {
    assert.ok(source.includes("statutoryContributionIssueEvents.employeeId"));
    assert.ok(source.includes('statutoryContributionIssueEvents.visibility, "employee"'));
  }
});

test("timeline schema is additive and constrained", () => {
  const migration = readFileSync("drizzle/0029_statutory_contribution_issue_events.sql", "utf8");
  const schema = readFileSync("src/db/schema.ts", "utf8");
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "statutory_contribution_issue_events"'));
  assert.ok(migration.includes("statutory_contribution_issue_event_type_check"));
  assert.ok(migration.includes("statutory_contribution_issue_event_visibility_check"));
  assert.ok(migration.includes("'referred'"));
  const referralMigration = readFileSync("drizzle/0030_contribution_issue_event_referral.sql", "utf8");
  assert.ok(referralMigration.includes("pg_get_constraintdef"));
  assert.ok(referralMigration.includes("'referred'"));
  assert.ok(schema.includes("statutoryContributionIssueEvents"));
});

test("payroll and employee UIs expose the immutable case timeline", () => {
  const payroll = readFileSync("src/components/workspace/statutory-contribution-issue-cases-panel.tsx", "utf8");
  const employee = readFileSync("src/components/self-service-portal.tsx", "utf8");
  assert.ok(payroll.includes("Post update"));
  assert.ok(payroll.includes("Employee-visible contribution case update"));
  assert.ok(payroll.includes("issue.events.slice(0, 3)"));
  assert.ok(employee.includes("Case timeline"));
  assert.ok(employee.includes("issue.events.slice(0, 5).reverse()"));
});

test("update email dedupe is keyed to the immutable event id", () => {
  const notifications = readFileSync("src/lib/statutory-contribution-case-notifications.ts", "utf8");
  assert.ok(notifications.includes("eventId: number"));
  assert.ok(notifications.includes("payroll_update-"));
  assert.ok(notifications.includes("caseEventId: input.eventId"));
  assert.ok(notifications.includes("You do not need to share your agency password, OTP or login credentials"));
});
