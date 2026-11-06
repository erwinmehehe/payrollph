/**
 * CI-only preflight for MWE PATCH tenant isolation. No DB/app is imported here.
 * Real PG16 results are mandatory; pure tests cannot grant a method credit.
 */
import assert from "node:assert/strict";

export function requireDisposableMweDecision(env = process.env) {
  const exact = {
    CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    TENANT_MWE_DECISION_MODE: "isolated-ci-only",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    APP_BASE_URL: "https://payroll.example.test",
    MULTI_ENTITY_ENABLED: "true",
    REQUIRE_PRIVILEGED_MFA: "true",
    DEMO_MODE: "false", WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  };
  for (const [key, value] of Object.entries(exact)) {
    assert.equal(env[key], value, "MWE_DECISION_REFUSED: " + key);
  }
  for (const key of [
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "OPENAI_API_KEY", "RESEND_API_KEY",
    "STRIPE_SECRET_KEY", "SMTP_URL", "MAILGUN_API_KEY",
  ]) {
    assert.ok(!env[key], "MWE_DECISION_REFUSED: provider credential " + key);
  }
}
export function requireDecisionPositive(response, employer, record, kind) {
  assert.equal(response.status, 200, "A real owner must be able to decide an owned pending classification");
  assert.equal(response.json?.kind, kind, "Correct approve/reject branch required");
  assert.equal(response.json?.classification?.id, record.id, "The actual owned classification must change");
  assert.equal(response.json?.classification?.organizationId, employer.org.id, "No foreign employer result");
  assert.equal(response.json?.classification?.employeeId, employer.worker.id, "No foreign employee result");
  assert.equal(response.json?.classification?.status, kind === "approved" ? "approved" : "rejected");
}
export function requireTenantDenial(response, statuses, forbiddenMarkers) {
  assert.ok(statuses.includes(response.status), "Cross-employer or cross-entity request must be denied");
  assert.ok(!response.json?.classification, "A denied request cannot include tax evidence");
  for (const marker of forbiddenMarkers) {
    assert.ok(!response.text.includes(marker), "Foreign employer or worker marker leaked in denial");
  }
}
