import assert from "node:assert/strict";

export const PEOPLE_PAGE_ORIGIN = "http://127.0.0.1:3000";
const DB = "postgresql://postgres:postgres@127.0.0.1:5432/app_db";

/**
 * No application/DB imports before this guard. A valid result is not permission
 * to run against production, connect a provider, or activate any payroll flag.
 */
export function requireDisposablePeoplePagesEnv(env = process.env) {
  const required = {
    CI: "true",
    GITHUB_ACTIONS: "true",
    NODE_ENV: "production",
    BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
    TENANT_PEOPLE_PAGES_PROOF: "fictional-only",
    DATABASE_URL: DB,
    APP_BASE_URL: PEOPLE_PAGE_ORIGIN,
    TRUSTED_APP_ORIGINS: PEOPLE_PAGE_ORIGIN,
    DEMO_MODE: "false",
    ENGAGEMENT_SURVEY_ENABLED: "true",
    GOALS_REVIEW_CYCLE_ENABLED: "true",
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
    assert.equal(env[key], expected, "PEOPLE_PAGE_REFUSED: unsafe " + key);
  }
  for (const key of [
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "RESEND_API_KEY",
    "OPENAI_API_KEY", "CRON_SECRET", "WORKER_TOKEN",
  ]) {
    assert.ok(!env[key], "PEOPLE_PAGE_REFUSED: external credential " + key);
  }
}

export function assertNoOtherEmployerMarkers(text, otherEmployers, context) {
  assert.ok(typeof text === "string", "PEOPLE_PAGE_REFUSED: missing response " + context);
  const decoded = text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)));
  for (const other of otherEmployers) {
    assert.ok(!decoded.includes(other.marker),
      context + ": private employer marker leaked (" + other.label + ")");
  }
}

export function assertOwnGoalsPage(response, actor, otherEmployers) {
  assert.equal(response.status, 200, "Own Goals page must return HTTP 200");
  assert.ok(response.text.includes("Goals and review cycles"),
    "Must render the actual Goals page, not a generic authenticated shell");
  assert.ok(response.text.includes(actor.marker + " review cycle"),
    "Must render the persisted own-employer review cycle");
  assertNoOtherEmployerMarkers(response.text, otherEmployers, "own Goals SSR/RSC");
}

export function assertOwnEngagementPage(response, actor, otherEmployers) {
  assert.equal(response.status, 200, "Own Engagement page must return HTTP 200");
  assert.ok(response.text.includes("Engagement survey"),
    "Must render the actual Engagement survey page");
  assert.ok(response.text.includes("/app?organizationId=" + actor.org.id),
    "SSR must bind the authenticated own employer ID");
  assertNoOtherEmployerMarkers(response.text, otherEmployers, "own Engagement SSR/RSC");
}

export function assertOwnSurveyApi(response, actor, otherEmployers) {
  assert.equal(response.status, 200, "Own survey API must return HTTP 200");
  assert.equal(response.json?.admin, true, "Owner must have actual company-wide People grant");
  assert.ok(Array.isArray(response.json?.surveys) &&
    response.json.surveys.some(s => s.question?.includes(actor.marker)),
  "Own survey API must return a persisted employer-specific question");
  assertNoOtherEmployerMarkers(response.text, otherEmployers, "own surveys API");
}

export function assertDeniedPage(response, allEmployers, context) {
  assert.equal(response.status, 404, context + ": expected not-found denial");
  assertNoOtherEmployerMarkers(response.text, allEmployers, context);
}

export function assertDeniedApi(response, allEmployers, context) {
  assert.equal(response.status, 403, context + ": expected cross-employer API denial");
  assertNoOtherEmployerMarkers(response.text, allEmployers, context);
}
