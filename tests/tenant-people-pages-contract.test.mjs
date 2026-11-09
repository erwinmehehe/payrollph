import assert from "node:assert/strict";
import test from "node:test";
import {
  PEOPLE_PAGE_ORIGIN, requireDisposablePeoplePagesEnv,
  assertOwnGoalsPage, assertOwnEngagementPage, assertOwnSurveyApi,
  assertDeniedPage, assertDeniedApi,
} from "../scripts/qa/tenant-people-pages-contract.mjs";

const safe = {
  CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
  BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
  TENANT_PEOPLE_PAGES_PROOF: "fictional-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL: PEOPLE_PAGE_ORIGIN, TRUSTED_APP_ORIGINS: PEOPLE_PAGE_ORIGIN,
  DEMO_MODE: "false", ENGAGEMENT_SURVEY_ENABLED: "true",
  GOALS_REVIEW_CYCLE_ENABLED: "true", WORKER_ENABLED: "false",
  CENTRAL_SCHEDULER_ENABLED: "false", PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  FINAL_PAY_SIGNED_REVIEW_ENABLED: "false", EXACT_THIRTEENTH_CENTAVOS_ENABLED: "false",
  PAYROLL_CALCULATION_HISTORY_ENABLED: "false",
};
const own = { label: "ATTA", marker: "TTBL-ATTA-111", org: { id: 11 } };
const victim = { label: "VICTIM", marker: "TTBL-VICTIM-111", org: { id: 99 } };
const response = (status, text, json = undefined) => ({ status, text, json });

test("PG16-only contract refuses hosted databases, providers and non-fictional execution", () => {
  assert.doesNotThrow(() => requireDisposablePeoplePagesEnv(safe));
  for (const change of [
    { CI: "false" }, { GITHUB_ACTIONS: "false" },
    { NODE_ENV: "development" }, { DEMO_MODE: "true" },
    { TENANT_PEOPLE_PAGES_PROOF: "production" },
    { DATABASE_URL: "postgresql://postgres@remote.invalid:5432/app_db" },
    { APP_BASE_URL: "https://example.invalid" },
    { TRUSTED_APP_ORIGINS: "https://example.invalid" },
    { ENGAGEMENT_SURVEY_ENABLED: "false" },
    { GOALS_REVIEW_CYCLE_ENABLED: "false" },
    { WORKER_ENABLED: "true" }, { CENTRAL_SCHEDULER_ENABLED: "true" },
    { PAYMONGO_DISBURSEMENTS_ENABLED: "true" }, { XENDIT_PAYOUTS_ENABLED: "true" },
    { XENDIT_BILLING_ENABLED: "true" },
    { PAYMONGO_SECRET_KEY: "unsafe" }, { RESEND_API_KEY: "unsafe" },
    { OPENAI_API_KEY: "unsafe" }, { CRON_SECRET: "unsafe" },
  ]) {
    assert.throws(() => requireDisposablePeoplePagesEnv({ ...safe, ...change }),
      /PEOPLE_PAGE_REFUSED/, JSON.stringify(change));
  }
});

test("own Goals success requires an actual persisted own employer cycle", () => {
  assertOwnGoalsPage(response(200, "Goals and review cycles " + own.marker + " review cycle"),
    own, [victim]);
  assert.throws(() => assertOwnGoalsPage(response(200, "Goals and review cycles"), own, [victim]));
  assert.throws(() => assertOwnGoalsPage(response(200,
    "Goals and review cycles " + own.marker + " review cycle " + victim.marker),
  own, [victim]));
});

test("Engagement page must mount the explicitly scoped owner, paired with real survey data", () => {
  assertOwnEngagementPage(response(200, 'Engagement survey /app?organizationId=11'), own, [victim]);
  assert.throws(() => assertOwnEngagementPage(response(200, "Engagement survey"), own, [victim]));
  assertOwnSurveyApi(response(200, JSON.stringify({ admin: true,
    surveys: [{ question: own.marker + " How is your work experience?" }] }), {
    admin: true, surveys: [{ question: own.marker + " How is your work experience?" }],
  }), own, [victim]);
  assert.throws(() => assertOwnSurveyApi(response(200, '{"admin":true,"surveys":[]}',
    { admin: true, surveys: [] }), own, [victim]));
});

test("foreign and malformed responses must deny and include no tenant markers", () => {
  assertDeniedPage(response(404, "Not Found"), [own, victim], "foreign");
  assertDeniedApi(response(403, "Forbidden"), [own, victim], "API foreign");
  assert.throws(() => assertDeniedPage(response(200, "Not Found"), [victim], "fake denial"));
  assert.throws(() => assertDeniedPage(response(404, "Not Found " + victim.marker),
    [victim], "leak"));
  assert.throws(() => assertDeniedApi(response(200, "Forbidden"), [victim], "fake API denial"));
});
