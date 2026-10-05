import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  boundedProgress,
  nextCadenceDate,
  reviewScore,
} from "../src/lib/employee-experience";

const schema = readFileSync("src/db/schema.ts", "utf8");
const managerRoute = readFileSync("src/app/api/experience/route.ts", "utf8");
const selfRoute = readFileSync("src/app/api/self/experience/route.ts", "utf8");
const engagementRoute = readFileSync("src/app/api/engagement/route.ts", "utf8");
const engagementResponse = readFileSync("src/app/api/engagement/respond/route.ts", "utf8");
const performancePanel = readFileSync("src/components/performance-panel.tsx", "utf8");
const managerPanel = readFileSync("src/components/manager-experience-panel.tsx", "utf8");
const growthPanel = readFileSync("src/components/employee-growth-panel.tsx", "utf8");
const employeePortal = readFileSync("src/components/self-service-portal.tsx", "utf8");
const employeeEngagement = readFileSync("src/components/employee-engagement-panel.tsx", "utf8");

test("manager experience schema covers goal cascade one-on-ones feedback and mentorship", () => {
  for (const table of [
    "strategic_goals",
    "performance_goal_alignments",
    "one_on_one_series",
    "one_on_one_meetings",
    "one_on_one_action_items",
    "feedback_rounds",
    "feedback_requests",
    "mentorships",
  ]) {
    assert.ok(schema.includes(`"${table}"`), `missing table ${table}`);
  }
  assert.ok(schema.includes('selfSubmittedAt: timestamp("self_submitted_at"'));
  assert.ok(schema.includes('employeeVisible: boolean("employee_visible")'));
  assert.ok(schema.includes('publicUpdate: text("public_update")'));
});

test("recurring one-on-one cadence is calendar safe", () => {
  assert.equal(nextCadenceDate("2026-01-31", "monthly"), "2026-02-28");
  assert.equal(nextCadenceDate("2026-01-31", "quarterly"), "2026-04-30");
  assert.equal(nextCadenceDate("2026-02-01", "weekly"), "2026-02-08");
  assert.equal(nextCadenceDate("2026-02-01", "biweekly"), "2026-02-15");
});

test("experience input guards bound progress and review scores", () => {
  assert.equal(boundedProgress(0), 0);
  assert.equal(boundedProgress(100), 100);
  assert.equal(boundedProgress(101), null);
  assert.equal(reviewScore(1), "1.00");
  assert.equal(reviewScore(5), "5.00");
  assert.equal(reviewScore(5.1), null);
});

test("manager experience API excludes bookkeepers and enforces assigned-manager one-on-one ownership", () => {
  assert.ok(managerRoute.includes('EXPERIENCE_ROLES = new Set(["owner", "admin", "hr", "manager"])'));
  assert.ok(managerRoute.includes("Only the assigned manager can update or complete this one-on-one."));
  assert.ok(managerRoute.includes("Only the assigned manager can add one-on-one action items."));
  assert.ok(managerRoute.includes("Only the assigned manager can update one-on-one action items."));
  assert.ok(managerRoute.includes("nextCadenceDate(meeting.scheduledDate"));
  assert.ok(managerRoute.includes("onConflictDoNothing"));
  assert.ok(managerRoute.includes("managerPrivateNotes: maySeePrivate ? meeting.managerPrivateNotes : null"));
});

test("goal cascading links governed employee goals to strategic objectives", () => {
  assert.ok(managerRoute.includes('entityType === "strategic_goal"'));
  assert.ok(managerRoute.includes('entityType === "goal_alignment"'));
  assert.ok(managerRoute.includes("performanceGoalAlignments"));
  assert.ok(managerRoute.includes("Company goals require company-wide access."));
  assert.ok(managerRoute.includes("Goal organization unit not found in this workspace."));
});

test("employee self-service hides manager drafts while allowing self-assessment and own goal progress", () => {
  assert.ok(selfRoute.includes('action === "self_assessment"'));
  assert.ok(selfRoute.includes('action === "goal_progress"'));
  assert.ok(selfRoute.includes('eq(performanceReviews.employeeId, employee.id)'));
  assert.ok(selfRoute.includes('review.status === "completed"'));
  assert.ok(selfRoute.includes("managerScore: null, finalScore: null, managerSummary: null"));
  assert.ok(selfRoute.includes('row.status === "completed" ? row.managerUpdate : null'));
  assert.ok(selfRoute.includes('eq(oneOnOneSeries.employeeId, employee.id)'));
});

test("360 feedback foundation is explicitly named and recipient-bound", () => {
  assert.ok(selfRoute.includes("360 feedback in this foundation is named, not anonymous."));
  assert.ok(selfRoute.includes('eq(feedbackRequests.reviewerEmployeeId, employee.id)'));
  assert.ok(selfRoute.includes('"Named 360 feedback submitted"'));
  assert.ok(managerRoute.includes('"360 feedback round opened"'));
  assert.equal(selfRoute.includes("anonymousRespondentKey"), false);
});

test("mentorship requests require participant ownership for employee transitions", () => {
  assert.ok(selfRoute.includes('entityType === "mentorship_request"'));
  assert.ok(selfRoute.includes("mentorship.mentorEmployeeId === employee.id"));
  assert.ok(selfRoute.includes("mentorship.menteeEmployeeId === employee.id"));
  assert.ok(selfRoute.includes("This mentorship does not belong to your employee record."));
});

test("engagement action plans support safe employee-visible follow-through", () => {
  assert.ok(engagementRoute.includes('action === "action_plan_publish"'));
  assert.ok(engagementRoute.includes("Engagement action plan published to employees"));
  assert.ok(engagementResponse.includes("employeeVisible"));
  assert.ok(engagementResponse.includes("publicUpdate"));
  assert.ok(engagementResponse.includes("surveyName"));
  assert.equal(engagementResponse.includes("question.prompt"), true);
  assert.equal(engagementResponse.includes("comments:"), false);
  assert.ok(employeeEngagement.includes("YOU SAID, WE DID"));
});

test("manager and employee experience UIs are integrated without replacing formal performance", () => {
  assert.ok(performancePanel.includes('import { ManagerExperiencePanel }'));
  assert.ok(performancePanel.includes("<ManagerExperiencePanel"));
  assert.ok(managerPanel.includes("CONTINUOUS PERFORMANCE"));
  assert.ok(managerPanel.includes("Named 360 feedback workflow"));
  assert.ok(employeePortal.includes('["growth", "My growth"]'));
  assert.ok(employeePortal.includes("<EmployeeGrowthPanel"));
  assert.ok(growthPanel.includes("MY GROWTH"));
  assert.ok(growthPanel.includes("SELF-ASSESSMENT"));
  assert.ok(growthPanel.includes("MY 1:1s"));
});
