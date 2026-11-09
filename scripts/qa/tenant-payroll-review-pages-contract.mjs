import assert from "node:assert/strict";

export const TAX_REVIEW_ORIGIN = "http://127.0.0.1:3000";

/** This proof may only connect to disposable localhost PG16 with fictional rows. */
export function requireDisposableTaxReviewPageEnv(env = process.env) {
  const required = {
    GITHUB_ACTIONS: "true",
    CI: "true",
    NODE_ENV: "production",
    BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
    TENANT_TAX_REVIEW_PAGE_PROOF: "fictional-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    APP_BASE_URL: TAX_REVIEW_ORIGIN,
    TRUSTED_APP_ORIGINS: TAX_REVIEW_ORIGIN,
    DEMO_MODE: "false",
    YEAR_END_PRIOR_EVIDENCE_ENABLED: "true",
    BIR_2316_CERTIFICATE_DRAFT_ENABLED: "true",
    BIR_2316_RECONCILIATION_ENABLED: "true",
    BIR_2316_WITHHOLDING_EVIDENCE_ENABLED: "true",
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
    MULTI_ENTITY_ENABLED: "false",
  };
  for (const [key, value] of Object.entries(required)) {
    assert.equal(env[key], value, "TAX_REVIEW_PAGE_REFUSED: " + key);
  }
  for (const key of [
    "PAYMONGO_SECRET_KEY", "PAYMONGO_WEBHOOK_SECRET", "XENDIT_SECRET_KEY",
    "XENDIT_PAYOUT_SECRET_KEY", "XENDIT_CALLBACK_TOKEN", "RESEND_API_KEY",
    "POSTMARK_SERVER_TOKEN", "SMTP_URL", "WORKER_TOKEN", "CRON_SECRET",
    "OPENAI_API_KEY",
  ]) assert.ok(!env[key], "TAX_REVIEW_PAGE_REFUSED: provider credential " + key);
}

export function assertTaxReviewOwnPage(response, path, actor, subjects) {
  assert.equal(response.status, 200, path + ": owned employer must open actual tax review");
  assert.match(response.contentType, /text\/html/i);
  assert.ok(response.text.includes(path.includes("2316")
    ? "Prepare an unsigned Form 2316" : "Previous employer"),
    path + ": an empty or error page is not an own-page positive");
  assert.ok(response.text.includes('data-organization-id="' + actor.org.id + '"'),
    path + ": SSR must bind the authenticated employer, not an arbitrary selection");
  assertTaxReviewNoForeignMarkers(response.text,
    subjects.filter(subject => subject.org.id !== actor.org.id), path + " own");
}

export function assertTaxReviewNoForeignMarkers(text, subjects, label) {
  for (const subject of subjects) {
    assert.ok(!text.includes(subject.org.name), label + ": leaked foreign employer name");
    assert.ok(!text.includes(subject.worker.employeeNo), label + ": leaked private worker");
    assert.ok(!text.includes('data-organization-id="' + subject.org.id + '"'),
      label + ": reflected unauthorized employer binding");
  }
}

export function assertTaxReviewDeniedPage(response, subjects, label) {
  assert.equal(response.status, 404, label + ": expected hard notFound denial");
  assertTaxReviewNoForeignMarkers(response.text, subjects, label);
}
