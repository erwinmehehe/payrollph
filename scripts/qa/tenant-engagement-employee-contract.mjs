import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const ORIGIN = "http://127.0.0.1:3000";
export const API_PATH = "/api/hcm/engagement-surveys";
export const ENGAGEMENT_SOURCE_PINS = Object.freeze({
  "src/app/api/hcm/engagement-surveys/route.ts": "0440db4fb597953281769f154d73ad982f7c8efe",
  "src/lib/engagement-survey.ts": "3cd87143f9a1be6d136a552ee4a3c4c4a0348057",
  "src/app/app/engagement/page.tsx": "48132ee7356603136d7ac660086b3812ef28ed94",
  "src/components/engagement-survey-page.tsx": "28bbb0fc7c7fe172301af414079c81182552177f",
  "src/lib/tenant-engagement-employee-scope.ts": "6af77a09cb178b2d6111bb875ca21c722db5ac15",
});

export function gitBlobSha(data) {
  const b = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return createHash("sha1").update(Buffer.from(`blob ${b.length}\0`)).update(b).digest("hex");
}

export function requireDisposableEngagementEmployeeEnv(env = process.env) {
  const required = {
    CI: "true",
    GITHUB_ACTIONS: "true",
    NODE_ENV: "production",
    BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
    TENANT_ENGAGEMENT_EMPLOYEE_PROOF: "fictional-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    APP_BASE_URL: ORIGIN,
    TRUSTED_APP_ORIGINS: ORIGIN,
    SECURITY_SMOKE_URL: ORIGIN,
    ENGAGEMENT_SURVEY_ENABLED: "true",
    GOALS_REVIEW_CYCLE_ENABLED: "false",
    DEMO_MODE: "false",
    REQUIRE_PRIVILEGED_MFA: "true",
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
    FINAL_PAY_SIGNED_REVIEW_ENABLED: "false",
    EXACT_THIRTEENTH_CENTAVOS_ENABLED: "false",
    PAYROLL_CALCULATION_HISTORY_ENABLED: "false",
  };
  for (const [key, expected] of Object.entries(required)) {
    assert.equal(env[key], expected, "ENGAGEMENT_EMPLOYEE_REFUSED: " + key);
  }
  for (const key of [
    "PAYMONGO_SECRET_KEY", "PAYMONGO_WEBHOOK_SECRET", "XENDIT_SECRET_KEY",
    "XENDIT_PAYOUT_SECRET_KEY", "STRIPE_SECRET_KEY", "RESEND_API_KEY",
    "POSTMARK_SERVER_TOKEN", "SMTP_PASSWORD", "SMTP_URL", "OPENAI_API_KEY",
    "CRON_SECRET", "WORKER_TOKEN",
  ]) {
    assert.ok(!env[key], "ENGAGEMENT_EMPLOYEE_REFUSED: external credential " + key);
  }
}

export function assertNoForeignMarkers(body, others, context) {
  assert.equal(typeof body, "string", context + ": HTTP response body required");
  const decoded = body.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)));
  for (const other of others) {
    assert.ok(!decoded.includes(other.marker),
      context + ": forbidden employer marker exposed: " + other.label);
  }
}

export function assertNoIndividualRatings(response, context) {
  assert.equal(typeof response.text, "string", context + ": raw response required");
  const forbidden = [
    "employeeId", "userId", "participantId", "scoreSum", "responseCount",
    "individualScore", "respondentName", "respondentEmail",
  ];
  const obj = response.json ?? {};
  const fields = JSON.stringify(obj);
  for (const key of forbidden) {
    assert.ok(!fields.includes(`"${key}"`),
      context + ": private per-employee or raw aggregate field leaked: " + key);
  }
}

export function assertOwnEmployeePage(response, actor, others) {
  assert.equal(response.status, 200, actor.label + ": real employee SSR required");
  assert.match(response.contentType ?? "", /text\/html/i);
  assert.ok(response.text.includes("Engagement survey"), "Must render Engagement UI, not generic shell");
  assert.ok(response.text.includes("/app?organizationId=" + actor.org.id),
    "The page must bind the authenticated selected employer");
  assertNoForeignMarkers(response.text, others, "own employee SSR");
}

export function assertSurveyRead(response, actor, others, {
  employee = false, submitted = null, status = "open",
  disclosed = false, responses = null, average = null,
} = {}) {
  assert.equal(response.status, 200, actor.label + ": authorized own survey GET required");
  assert.equal(response.json?.admin, !employee);
  assert.ok(Array.isArray(response.json?.surveys),
    "Must return real persisted survey collection");
  const entry = response.json.surveys.find(s => s.id === actor.survey.id);
  assert.ok(entry, "GET must contain persisted own-employer survey ID");
  assert.ok(entry.question.includes(actor.marker), "Actual own-employer question required");
  assert.equal(entry.status, status);
  assert.equal(entry.disclosure, disclosed ? "available" : "suppressed");
  assert.equal("responseCount" in entry, false, "Raw response count must not leak");
  assert.equal("scoreSum" in entry, false, "Raw score sum must not leak");
  if (employee) {
    assert.equal(entry.submitted, submitted, "Only the caller's participation flag may appear");
  } else assert.equal("submitted" in entry, false, "Admin must not get any individual participation flag");
  if (disclosed) {
    assert.equal(entry.responses, responses);
    assert.equal(entry.average, average);
  } else {
    assert.equal("responses" in entry, false, "Do not disclose live/undersized response count");
    assert.equal("average" in entry, false, "Do not disclose live/undersized average");
  }
  assertNoIndividualRatings(response, "survey GET");
  assertNoForeignMarkers(response.text, others, "own survey GET");
  assert.match(response.headers?.get("cache-control") ?? "", /no-store/i,
    "Tenant survey read must never enter a shared cache");
}

export function assertSubmittedAnswer(response, others) {
  assert.equal(response.status, 201, "Employee response must be persisted and return 201");
  assert.deepEqual(response.json, { submitted: true },
    "Employee response must never echo the rating or participant identity");
  assertNoIndividualRatings(response, "employee answer");
  assertNoForeignMarkers(response.text, others, "employee answer");
}

export function assertDenied(response, code, employers, context) {
  assert.equal(response.status, code, context + ": expected exact denial");
  assert.ok(!response.json?.submitted, context + ": denial cannot claim a submitted answer");
  assertNoForeignMarkers(response.text, employers, context);
}

export function assertUnchanged(before, after, context) {
  assert.deepEqual(after, before, context + ": persisted employer rows mutated");
}

export function assertAnswerDelta(before, after, actor, employeeId, score) {
  for (const [key, rows] of Object.entries(before)) {
    if (key === "engagementSurveys" || key === "engagementSurveyParticipants") continue;
    assert.deepEqual(after[key], rows, "Answer must not mutate " + key);
  }
  assert.equal(before.engagementSurveys.length, 1);
  assert.equal(after.engagementSurveys.length, 1);
  const [oldSurvey] = before.engagementSurveys;
  const [newSurvey] = after.engagementSurveys;
  assert.equal(oldSurvey.id, actor.survey.id);
  assert.equal(newSurvey.id, actor.survey.id);
  assert.equal(newSurvey.responseCount, oldSurvey.responseCount + 1);
  assert.equal(newSurvey.scoreSum, oldSurvey.scoreSum + score);
  for (const [key, value] of Object.entries(oldSurvey)) {
    if (["responseCount", "scoreSum"].includes(key)) continue;
    assert.deepEqual(newSurvey[key], value, "Answer modified unexpected survey field " + key);
  }
  assert.equal(after.engagementSurveyParticipants.length,
    before.engagementSurveyParticipants.length + 1);
  assert.deepEqual(after.engagementSurveyParticipants.slice(0, before.engagementSurveyParticipants.length),
    before.engagementSurveyParticipants, "Existing participant rows may not change");
  const row = after.engagementSurveyParticipants.at(-1);
  assert.deepEqual(Object.keys(row).sort(), ["employeeId", "id", "organizationId", "surveyId"],
    "Participation record may not store ratings, answer timestamps or person details");
  assert.equal(row.organizationId, actor.org.id);
  assert.equal(row.surveyId, actor.survey.id);
  assert.equal(row.employeeId, employeeId);
}

export function assertCloseDelta(before, after, actor) {
  for (const [key, rows] of Object.entries(before)) {
    if (key === "engagementSurveys" || key === "auditEvents") continue;
    assert.deepEqual(after[key], rows, "Close unexpectedly mutated " + key);
  }
  assert.equal(before.engagementSurveys.length, 1);
  assert.equal(after.engagementSurveys.length, 1);
  const oldSurvey = before.engagementSurveys[0];
  const newSurvey = after.engagementSurveys[0];
  assert.equal(oldSurvey.id, actor.survey.id);
  assert.equal(oldSurvey.status, "open");
  assert.equal(newSurvey.status, "closed");
  assert.equal(newSurvey.responseCount, oldSurvey.responseCount);
  assert.equal(newSurvey.scoreSum, oldSurvey.scoreSum);
  assert.ok(Number.isFinite(Date.parse(newSurvey.closedAt)));
  for (const [key, value] of Object.entries(oldSurvey)) {
    if (["status", "closedAt"].includes(key)) continue;
    assert.deepEqual(newSurvey[key], value, "Close modified unexpected survey field " + key);
  }
  assert.deepEqual(after.auditEvents.slice(0, before.auditEvents.length), before.auditEvents,
    "Previous append-only audit must not change");
  assert.equal(after.auditEvents.length, before.auditEvents.length + 1,
    "Exactly one own-employer closure audit event required");
  const receipt = after.auditEvents.at(-1);
  assert.equal(receipt.organizationId, actor.org.id);
  assert.equal(receipt.action, "Engagement survey closed");
  assert.equal(receipt.metadata?.surveyId, actor.survey.id);
  assert.equal(receipt.metadata?.actorUserId, actor.owner.id);
  assert.ok(!JSON.stringify(receipt).includes("score"),
    "Audit record must not contain individual ratings");
}
