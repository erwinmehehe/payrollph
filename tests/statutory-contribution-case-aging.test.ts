import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  addBusinessDays,
  businessDaysPastTarget,
  contributionCaseEscalationStage,
  contributionCaseServiceStatus,
  contributionCaseServiceTargets,
} from "../src/lib/statutory-contribution-case-aging";

test("contribution case service targets skip weekends", () => {
  const friday = new Date("2026-10-02T09:00:00+08:00");
  assert.equal(addBusinessDays(friday, 1).toISOString().slice(0, 10), "2026-10-05");
  assert.equal(addBusinessDays(friday, 5).toISOString().slice(0, 10), "2026-10-09");
});

test("service targets follow Manila calendar dates instead of UTC dates", () => {
  // 2026-10-06 00:30 in Manila is still 2026-10-05 UTC.
  const filed = new Date("2026-10-06T00:30:00+08:00");
  const targets = contributionCaseServiceTargets({
    status: "open",
    createdAt: filed,
    reviewStartedAt: null,
    updatedAt: filed,
  });
  assert.equal(targets.firstReviewDue.toISOString().slice(0, 10), "2026-10-07");
});

test("open case becomes review overdue only after the first-review target", () => {
  const issue = {
    status: "open",
    createdAt: "2026-10-02T09:00:00+08:00",
    reviewStartedAt: null,
    updatedAt: "2026-10-02T09:00:00+08:00",
  };
  assert.equal(contributionCaseServiceStatus(issue, "2026-10-05T12:00:00+08:00").state, "review_due_today");
  assert.equal(contributionCaseServiceStatus(issue, "2026-10-06T12:00:00+08:00").state, "review_overdue");
});

test("in-review case uses the five-business-day resolution/update target", () => {
  const issue = {
    status: "in_review",
    createdAt: "2026-10-01T09:00:00+08:00",
    reviewStartedAt: "2026-10-02T09:00:00+08:00",
    updatedAt: "2026-10-02T09:00:00+08:00",
  };
  const status = contributionCaseServiceStatus(issue, "2026-10-09T12:00:00+08:00");
  assert.equal(status.resolutionDue, "2026-10-08");
  assert.equal(status.state, "resolution_overdue");
  assert.equal(status.overdue, true);
  assert.match(status.internalPolicyNote, /not a statutory or agency deadline/);
});

test("resolved contribution cases never remain overdue", () => {
  const status = contributionCaseServiceStatus({
    status: "resolved",
    createdAt: "2026-09-01T09:00:00+08:00",
    reviewStartedAt: "2026-09-02T09:00:00+08:00",
    updatedAt: "2026-09-04T09:00:00+08:00",
    resolvedAt: "2026-09-04T09:00:00+08:00",
  }, "2026-10-05T12:00:00+08:00");
  assert.equal(status.state, "resolved");
  assert.equal(status.overdue, false);
  assert.equal(status.targetDate, null);
});

test("case creation and review advance the compliance task due date", () => {
  const selfApi = readFileSync("src/app/api/self/contribution-issues/route.ts", "utf8");
  const payrollApi = readFileSync("src/app/api/compliance/contribution-issues/route.ts", "utf8");

  assert.ok(selfApi.includes("contributionCaseServiceTargets(issue)"));
  assert.ok(selfApi.includes("dueDate: serviceTargets.firstReviewDue.toISOString().slice(0, 10)"));
  assert.ok(payrollApi.includes("contributionCaseServiceTargets(next)"));
  assert.ok(payrollApi.includes("dueDate: serviceTargets.resolutionDue.toISOString().slice(0, 10)"));
  assert.ok(selfApi.includes("service: contributionCaseServiceStatus"));
  assert.ok(payrollApi.includes("service: contributionCaseServiceStatus"));
});

test("hourly worker escalates only overdue internal service targets and keeps tenant scope", () => {
  const worker = readFileSync("scripts/worker.ts", "utf8");
  const escalations = readFileSync("src/lib/statutory-contribution-case-escalations.ts", "utf8");
  const notifications = readFileSync("src/lib/statutory-contribution-case-notifications.ts", "utf8");

  assert.ok(worker.includes("runScheduledContributionCaseEscalations"));
  assert.ok(escalations.includes('service.state !== "review_overdue"'));
  assert.ok(escalations.includes('service.state !== "resolution_overdue"'));
  assert.ok(escalations.includes("RUN_EVERY_MS = 60 * 60 * 1000"));
  assert.ok(escalations.includes("complianceActionTasks.organizationId"));
  assert.ok(escalations.includes('complianceActionTasks.sourceType, "employee_contribution_issue"'));
  assert.ok(notifications.includes('"review_overdue"'));
  assert.ok(notifications.includes('"resolution_overdue"'));
  assert.ok(notifications.includes("internalServiceTarget: true"));
  assert.ok(notifications.includes("PayrollPH service targets are internal operational targets, not statutory or agency deadlines."));
});

test("payroll and employee screens show service aging without presenting it as law", () => {
  const payroll = readFileSync("src/components/workspace/statutory-contribution-issue-cases-panel.tsx", "utf8");
  const employee = readFileSync("src/components/self-service-portal.tsx", "utf8");

  assert.ok(payroll.includes("Review overdue"));
  assert.ok(payroll.includes("Resolution overdue"));
  assert.ok(payroll.includes("internal service target"));
  assert.ok(employee.includes("PayrollPH service target"));
  assert.ok(employee.includes("Internal service targets are not statutory or agency deadlines"));
});


test("case escalation stages age in business days after the internal target", () => {
  const issue = {
    status: "open",
    createdAt: "2026-10-01T09:00:00+08:00",
    reviewStartedAt: null,
    updatedAt: "2026-10-01T09:00:00+08:00",
  };

  // First review target is Friday, Oct 2. Weekend does not advance follow-up stage.
  assert.equal(businessDaysPastTarget("2026-10-02", "2026-10-03T12:00:00+08:00"), 0);
  assert.equal(contributionCaseEscalationStage(issue, "2026-10-03T12:00:00+08:00"), 1);
  assert.equal(contributionCaseEscalationStage(issue, "2026-10-05T12:00:00+08:00"), 1);
  assert.equal(contributionCaseEscalationStage(issue, "2026-10-06T12:00:00+08:00"), 2);
  assert.equal(contributionCaseEscalationStage(issue, "2026-10-09T12:00:00+08:00"), 3);
});

test("case escalation stage is zero while on track or after resolution", () => {
  const issue = {
    status: "open",
    createdAt: "2026-10-05T09:00:00+08:00",
    reviewStartedAt: null,
    updatedAt: "2026-10-05T09:00:00+08:00",
  };
  assert.equal(contributionCaseEscalationStage(issue, "2026-10-05T12:00:00+08:00"), 0);
  assert.equal(
    contributionCaseEscalationStage({
      ...issue,
      status: "resolved",
      resolvedAt: "2026-10-05T15:00:00+08:00",
    }, "2026-10-20T12:00:00+08:00"),
    0,
  );
});

test("hourly employee-case monitor passes bounded stages and preserves critical age", () => {
  const escalations = readFileSync("src/lib/statutory-contribution-case-escalations.ts", "utf8");

  assert.ok(escalations.includes("contributionCaseEscalationStage(issue, now)"));
  assert.ok(escalations.includes("stage,"));
  assert.ok(escalations.includes('action.severity === "danger"'));
  assert.ok(escalations.includes("action.severityChangedAt"));
  assert.ok(escalations.includes("stageCounts"));
});
