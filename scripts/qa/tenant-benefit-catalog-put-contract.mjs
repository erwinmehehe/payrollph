import assert from "node:assert/strict";

const SAFE_ENV = Object.freeze({
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  APP_BASE_URL: "https://payroll.example.test",
  DEMO_MODE: "false", WORKER_ENABLED: "false",
  CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
});
export { SAFE_ENV };

export function requireDisposableBenefitCatalog(env = process.env) {
  for (const [key, value] of Object.entries(SAFE_ENV)) {
    if (env[key] !== value) throw new Error("BENEFIT_CATALOG_PROOF_REFUSED: " + key);
  }
  for (const key of [
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL",
    "NEON_API_KEY", "NEON_DATABASE_URL", "STRIPE_SECRET_KEY",
  ]) {
    if (env[key]) throw new Error("BENEFIT_CATALOG_PROOF_REFUSED: external provider credential " + key);
  }
  return true;
}
export function assertCatalogResponse(response, seeded, label) {
  assert.equal(response.status, 200, label + ": real PUT must succeed");
  assert.deepEqual(response.json, { ok: true, seeded }, label + ": exact seed outcome");
  const cache = response.headers?.get("cache-control") ?? "";
  assert.ok(cache.split(",").map(x => x.trim().toLowerCase()).includes("no-store"),
    label + ": catalogue mutation responses must not be cached");
  return true;
}
export function assertOwnedDefaultPlans(rows, organizationId) {
  assert.equal(rows.length, 5, "exactly five real persisted default plans required");
  assert.deepEqual(rows.map(row => row.name).sort(), [
    "Group life & accident", "HMO, Maxicare Plan A", "Pag-IBIG MP2",
    "Rice allowance", "SSS Flexi-Fund",
  ].sort(), "owned defaults must be the full existing template set");
  assert.ok(rows.every(row => row.organizationId === organizationId),
    "every seed must be employer-owned, never global or foreign");
  assert.equal(new Set(rows.map(row => row.id)).size, 5, "persisted IDs must be unique");
  return true;
}
export function assertCatalogUnchanged(before, after, label) {
  assert.deepEqual(after, before, label + ": no foreign, global or denied state may change");
  return true;
}
export function assertNoForeignMarker(response, marker) {
  assert.ok(!String(response.text).includes(marker), "Foreign employer private marker in body");
  assert.ok(![...(response.headers ?? [])].some(([key, value]) => (key + value).includes(marker)),
    "Foreign employer private marker in headers");
  return true;
}
