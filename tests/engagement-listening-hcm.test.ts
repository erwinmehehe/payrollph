import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("src/db/schema.ts", "utf8");
const privacy = readFileSync("src/lib/engagement-privacy.ts", "utf8");
const management = readFileSync("src/app/api/engagement/route.ts", "utf8");
const response = readFileSync("src/app/api/engagement/respond/route.ts", "utf8");
const recognition = readFileSync("src/app/api/engagement/recognition/route.ts", "utf8");
const panel = readFileSync("src/components/engagement-panel.tsx", "utf8");
const employeePanel = readFileSync("src/components/employee-engagement-panel.tsx", "utf8");
const selfService = readFileSync("src/components/self-service-portal.tsx", "utf8");
const nav = readFileSync("src/components/workspace/nav.ts", "utf8");
const workspace = readFileSync("src/components/linaw-workspace.tsx", "utf8");

test("engagement schema models listening responses actions recognition and feedback", () => {
  for (const table of [
    "engagement_surveys",
    "engagement_questions",
    "engagement_responses",
    "engagement_answers",
    "engagement_action_plans",
    "recognition_events",
    "continuous_feedback",
  ]) {
    assert.ok(schema.includes(`"${table}"`), `missing table ${table}`);
  }
  assert.ok(schema.includes('"engagement_responses_survey_respondent_unique"'));
  assert.ok(schema.includes('privacyThreshold: integer("privacy_threshold")'));
  assert.ok(schema.includes('orgUnitIdSnapshot: integer("org_unit_id_snapshot")'));
});

test("anonymous respondent identity uses a keyed pseudonymous token", () => {
  assert.ok(privacy.includes('createHmac("sha256", key)'));
  assert.ok(privacy.includes("ENGAGEMENT_ANONYMITY_KEY"));
  assert.ok(privacy.includes("MIN_ANONYMITY_KEY_BYTES = 32"));
  assert.ok(response.includes("respondentUserId: survey.anonymous ? null : user.id"));
  assert.ok(response.includes("respondentEmployeeId: survey.anonymous ? null : employee.id"));
  assert.ok(response.includes("responseId: survey.anonymous ? null : result.id"));
});

test("anonymous survey submissions deliberately avoid actor-timestamp audit side channels", () => {
  assert.ok(response.includes("Deliberately no per-respondent audit event here"));
  assert.equal(response.includes("recordAuditEvent"), false);
});

test("small cohort analytics suppress answer counts scores and comments", () => {
  assert.ok(privacy.includes("DEFAULT_PRIVACY_THRESHOLD = 5"));
  assert.ok(privacy.includes("responseCount >= normalizedPrivacyThreshold"));
  assert.ok(management.includes("responseCount: null"));
  assert.ok(management.includes("textResponseCount: null"));
  assert.ok(management.includes("suppressed: true"));
  assert.ok(management.includes("Raw anonymous comments are never returned"));
  assert.ok(management.includes("responseCount: unitReportable ? rows.length : null"));
  assert.ok(management.includes("access.companyWide || reportable ? scopeResponses.length : null"));
});

test("anonymous surveys cannot open without privacy infrastructure or enough eligible employees", () => {
  assert.ok(management.includes("Configure ENGAGEMENT_ANONYMITY_KEY with at least 32 bytes"));
  assert.ok(management.includes("eligible.length < threshold"));
  assert.ok(management.includes("Anonymous survey cannot open because the eligible audience has"));
  assert.ok(management.includes('survey.kind === "enps"'));
  assert.ok(management.includes('question.type === "enps_0_10"'));
});

test("eNPS is calculated from promoters minus detractors", () => {
  assert.ok(privacy.includes("value >= 9"));
  assert.ok(privacy.includes("value <= 6"));
  assert.ok(privacy.includes("((promoters - detractors) / values.length) * 100"));
});

test("survey response validation is fail closed by question type and audience", () => {
  assert.ok(response.includes("This survey is not assigned to your organization unit."));
  assert.ok(response.includes("Rating answers must be whole numbers from 1 to 5."));
  assert.ok(response.includes("eNPS answers must be whole numbers from 0 to 10."));
  assert.ok(response.includes("Text survey answers are limited to 2,000 characters."));
  assert.ok(response.includes("An answer references a question outside this survey."));
});

test("action planning and continuous feedback remain org-unit scoped", () => {
  assert.ok(management.includes("assertScope(access, owner.orgUnitId)"));
  assert.ok(management.includes("Action-plan owner must belong to the selected organization unit."));
  assert.ok(management.includes("assertScope(access, recipient.orgUnitId)"));
  assert.ok(management.includes('"manager_and_recipient"'));
});

test("peer recognition is employee-authored and cannot target self", () => {
  assert.ok(recognition.includes("A linked employee profile is required to give peer recognition."));
  assert.ok(recognition.includes("Peer recognition must be given to another employee."));
  assert.ok(recognition.includes("visibleToEveryone: true"));
  assert.ok(recognition.includes('"Peer recognition shared"'));
});

test("engagement is exposed to HR and employee self-service", () => {
  assert.ok(nav.includes('{ name: "Engagement"'));
  assert.ok(workspace.includes('import { EngagementPanel }'));
  assert.ok(workspace.includes('page === "Engagement"'));
  assert.ok(selfService.includes('["voice", "My voice"]'));
  assert.ok(selfService.includes("<EmployeeEngagementPanel"));
  assert.ok(employeePanel.includes("Surveys & recognition"));
  assert.ok(panel.includes("Listen safely, then turn findings into action."));
});
