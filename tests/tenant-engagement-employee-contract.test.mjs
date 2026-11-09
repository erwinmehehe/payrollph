import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  ORIGIN, ENGAGEMENT_SOURCE_PINS, gitBlobSha,
  requireDisposableEngagementEmployeeEnv, assertNoForeignMarkers,
  assertOwnEmployeePage, assertSurveyRead, assertSubmittedAnswer,
  assertDenied, assertUnchanged, assertAnswerDelta, assertCloseDelta,
} from "../scripts/qa/tenant-engagement-employee-contract.mjs";

const safe = {
  CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
  BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
  TENANT_ENGAGEMENT_EMPLOYEE_PROOF: "fictional-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL: ORIGIN, TRUSTED_APP_ORIGINS: ORIGIN,
  SECURITY_SMOKE_URL: ORIGIN, ENGAGEMENT_SURVEY_ENABLED: "true",
  GOALS_REVIEW_CYCLE_ENABLED: "false", DEMO_MODE: "false",
  REQUIRE_PRIVILEGED_MFA: "true", WORKER_ENABLED: "false",
  CENTRAL_SCHEDULER_ENABLED: "false", PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  FINAL_PAY_SIGNED_REVIEW_ENABLED: "false",
  EXACT_THIRTEENTH_CENTAVOS_ENABLED: "false",
  PAYROLL_CALCULATION_HISTORY_ENABLED: "false",
};
const a = {
  org: { id: 11 }, label: "ATTA", marker: "TTBL-ATTA-ABC",
  survey: { id: 41 }, owner: { id: 9 },
};
const victim = {
  org: { id: 99 }, label: "VICTIM", marker: "TTBL-VICTIM-XYZ",
  survey: { id: 84 },
};
function rsp(status, json, headers = { "cache-control": "private, no-store" }) {
  return { status, json, text: JSON.stringify(json ?? { error: "Denied" }),
    headers: new Headers(headers), contentType: "application/json" };
}
function readResult(overrides = {}, options = {}) {
  return rsp(200, {
    admin: options.employee ?? true ? false : true,
    surveys: [{
      id: a.survey.id, question: a.marker + " How do you feel at work?",
      status: "open", disclosure: "suppressed",
      ...overrides,
    }],
  });
}
function snap() {
  return {
    engagementSurveys: [{ id: a.survey.id, organizationId: a.org.id,
      question: a.marker, status: "open", responseCount: 0, scoreSum: 0,
      closedAt: null }],
    engagementSurveyParticipants: [],
    auditEvents: [],
    employees: [{ id: 100, organizationId: a.org.id }],
    userOrganizations: [{ id: 4, active: true }],
    payrollRuns: [], outbox: [], organizations: [{ id: a.org.id }],
  };
}

test("standalone proof refuses all nonlocal, unfenced or provider-connected modes", () => {
  assert.doesNotThrow(() => requireDisposableEngagementEmployeeEnv(safe));
  for (const change of [
    { CI: "false" }, { GITHUB_ACTIONS: "false" }, { NODE_ENV: "development" },
    { TENANT_ENGAGEMENT_EMPLOYEE_PROOF: "production" },
    { BUILD_BLOCK_ACCEPTANCE_MODE: "live" },
    { DATABASE_URL: "postgresql://postgres@remote.invalid/app_db" },
    { APP_BASE_URL: "https://invalid.example" },
    { TRUSTED_APP_ORIGINS: "https://invalid.example" },
    { ENGAGEMENT_SURVEY_ENABLED: "false" },
    { GOALS_REVIEW_CYCLE_ENABLED: "true" },
    { PAYMONGO_DISBURSEMENTS_ENABLED: "true" },
    { WORKER_ENABLED: "true" }, { CENTRAL_SCHEDULER_ENABLED: "true" },
    { REQUIRE_PRIVILEGED_MFA: "false" }, { DEMO_MODE: "true" },
    { PAYMONGO_SECRET_KEY: "x" }, { XENDIT_SECRET_KEY: "x" },
    { OPENAI_API_KEY: "x" }, { RESEND_API_KEY: "x" },
    { CRON_SECRET: "x" },
  ]) assert.throws(() => requireDisposableEngagementEmployeeEnv({ ...safe, ...change }),
    /ENGAGEMENT_EMPLOYEE_REFUSED/, JSON.stringify(change));
});

test("exact-source pins cover real survey API, aggregate storage, SSR and client UI", () => {
  assert.deepEqual(Object.keys(ENGAGEMENT_SOURCE_PINS).sort(), [
    "src/app/api/hcm/engagement-surveys/route.ts",
    "src/app/app/engagement/page.tsx",
    "src/components/engagement-survey-page.tsx",
    "src/lib/engagement-survey.ts",
  ].sort());
  for (const [path, sha] of Object.entries(ENGAGEMENT_SOURCE_PINS)) {
    assert.match(sha, /^[0-9a-f]{40}$/);
    assert.equal(gitBlobSha(readFileSync(path)), sha, path + " changed without review");
  }
});

test("a real employee GET must carry only own survey and own participation flag", () => {
  const own = rsp(200, { admin: false,
    surveys: [{ id: 41, question: a.marker + " How do you feel at work?",
      status: "open", disclosure: "suppressed", submitted: false }] });
  assert.doesNotThrow(() => assertSurveyRead(own, a, [victim],
    { employee: true, submitted: false }));
  assert.throws(() => assertSurveyRead(rsp(200, { admin: true, surveys: own.json.surveys }),
    a, [victim], { employee: true, submitted: false }));
  assert.throws(() => assertSurveyRead(rsp(200, { admin: false,
    surveys: [{ ...own.json.surveys[0], submitted: true }] }),
  a, [victim], { employee: true, submitted: false }));
  assert.throws(() => assertSurveyRead(rsp(200, { admin: false,
    surveys: [{ ...own.json.surveys[0], responseCount: 1 }] }),
  a, [victim], { employee: true, submitted: false }));
  assert.throws(() => assertSurveyRead(rsp(200, { admin: false,
    surveys: [{ ...own.json.surveys[0], question: victim.marker }] }),
  a, [victim], { employee: true, submitted: false }));
  assert.throws(() => assertSurveyRead(rsp(200, own.json, { "cache-control": "public, max-age=60" }),
    a, [victim], { employee: true, submitted: false }));
});

test("count and average disclosure are blocked while open or below five", () => {
  const base = { id: 41, question: a.marker, status: "open",
    disclosure: "suppressed" };
  assert.doesNotThrow(() => assertSurveyRead(rsp(200, {
    admin: true, surveys: [base],
  }), a, [victim]));
  assert.throws(() => assertSurveyRead(rsp(200, {
    admin: true, surveys: [{ ...base, responses: 4, average: 3 }],
  }), a, [victim]));
  assert.throws(() => assertSurveyRead(rsp(200, {
    admin: true, surveys: [{ ...base, status: "closed", disclosure: "available",
      responses: 4, average: 3 }],
  }), a, [victim], { status: "closed", disclosed: false }));
  assert.doesNotThrow(() => assertSurveyRead(rsp(200, {
    admin: true, surveys: [{ ...base, status: "closed", disclosure: "available",
      responses: 5, average: 3 }],
  }), a, [victim], { status: "closed", disclosed: true, responses: 5, average: 3 }));
});

test("response POST cannot pretend success or echo a score or respondent", () => {
  assert.doesNotThrow(() => assertSubmittedAnswer(rsp(201, { submitted: true }), [victim]));
  for (const bad of [
    rsp(200, { submitted: true }), rsp(201, { submitted: true, score: 5 }),
    rsp(201, { submitted: true, employeeId: 99 }),
    rsp(201, { ok: true }), rsp(201, { submitted: true, private: victim.marker }),
  ]) assert.throws(() => assertSubmittedAnswer(bad, [victim]));
  assert.doesNotThrow(() => assertDenied(rsp(403), 403, [a, victim], "foreign"));
  assert.throws(() => assertDenied(rsp(200), 403, [a, victim], "false 403"));
  assert.throws(() => assertDenied(rsp(403, { error: victim.marker }), 403,
    [victim], "marker leaked"));
  assert.throws(() => assertNoForeignMarkers("\\u0054TBL-VICTIM-XYZ",
    [victim], "encoded marker"));
});

test("successful rating writes one anonymous participation row and no other records", () => {
  const before = snap();
  const after = structuredClone(before);
  after.engagementSurveys[0].responseCount = 1;
  after.engagementSurveys[0].scoreSum = 4;
  after.engagementSurveyParticipants.push({
    id: 20, organizationId: a.org.id, surveyId: a.survey.id, employeeId: 55,
  });
  assert.doesNotThrow(() => assertAnswerDelta(before, after, a, 55, 4));
  const noAggregate = structuredClone(after);
  noAggregate.engagementSurveys[0].scoreSum = 0;
  assert.throws(() => assertAnswerDelta(before, noAggregate, a, 55, 4));
  const leakyParticipant = structuredClone(after);
  leakyParticipant.engagementSurveyParticipants[0].score = 4;
  assert.throws(() => assertAnswerDelta(before, leakyParticipant, a, 55, 4));
  const auditedScore = structuredClone(after);
  auditedScore.auditEvents.push({ action: "Rating 4 by employee 55" });
  assert.throws(() => assertAnswerDelta(before, auditedScore, a, 55, 4));
  assert.doesNotThrow(() => assertUnchanged(before, structuredClone(before), "victim"));
  assert.throws(() => assertUnchanged(before, after, "unexpected victim write"));
});

test("closing changes only survey status/time and creates one own audit without ratings", () => {
  const before = snap();
  const after = structuredClone(before);
  after.engagementSurveys[0].status = "closed";
  after.engagementSurveys[0].closedAt = "2026-11-09T10:00:00.000Z";
  after.auditEvents.push({ organizationId: a.org.id, action: "Engagement survey closed",
    metadata: { surveyId: a.survey.id, actorUserId: a.owner.id } });
  assert.doesNotThrow(() => assertCloseDelta(before, after, a));
  const badAudit = structuredClone(after);
  badAudit.auditEvents[0].metadata.score = 5;
  assert.throws(() => assertCloseDelta(before, badAudit, a));
  const badState = structuredClone(after);
  badState.employees.push({ id: 555 });
  assert.throws(() => assertCloseDelta(before, badState, a));
});
