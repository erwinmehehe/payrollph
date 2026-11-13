import assert from "node:assert/strict";
import test from "node:test";
import { requireDisposableOidcIdentityEnv } from "../scripts/qa/tenant-oidc-identity-binding-contract.mjs";
const safe = {
  OIDC_IDENTITY_BINDING_PROOF: "fictional-pg16-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:55442/tenant_oidc_membership_test",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false", PAYMONGO_DISBURSEMENTS_ENABLED: "false", FINAL_PAY_SIGNED_REVIEW_ENABLED: "false",
  EXACT_THIRTEENTH_CENTAVOS_ENABLED: "false", PAYROLL_CALCULATION_HISTORY_ENABLED: "false", NEXT_CSP_ENABLED: "false",
};
test("identity PG fixture accepts only the private local instance or explicit disposable CI service", () => {
  assert.equal(requireDisposableOidcIdentityEnv(safe), true);
  assert.equal(requireDisposableOidcIdentityEnv({ ...safe, CI: "true", GITHUB_ACTIONS: "true",
    DATABASE_URL: safe.DATABASE_URL.replace(":55442/", ":5432/") }), true);
});
test("identity fixture refuses existing/default/remote targets, live credentials and protected flag activation", () => {
  for (const change of [
    { DATABASE_URL: safe.DATABASE_URL.replace("127.0.0.1", "production.invalid") },
    { DATABASE_URL: safe.DATABASE_URL.replace("tenant_oidc_membership_test", "app_db") },
    { DATABASE_URL: safe.DATABASE_URL.replace(":55442/", ":5432/") },
    { DATABASE_URL: safe.DATABASE_URL + "?host=production.invalid" },
    { OIDC_IDENTITY_BINDING_PROOF: "" }, { PAYMONGO_SECRET_KEY: "synthetic-refused" },
    ...Object.keys(safe).filter(key => key.endsWith("_ENABLED")).map(key => ({ [key]: "true" })),
  ]) assert.throws(() => requireDisposableOidcIdentityEnv({ ...safe, ...change }));
});
