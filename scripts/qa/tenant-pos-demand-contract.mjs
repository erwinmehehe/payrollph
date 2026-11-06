/**
 * WRK-01 POS demand four-method tenant isolation proof contract.
 * Exact executable target: disposable PG16 + localhost Next + synthetic fetch interception.
 * Source/provider credentials are NEVER accepted from the environment.
 * This file is contract-only: no coverage manifest credit is awarded here.
 */
import assert from "node:assert/strict";

export const POS_DEMAND_METHODS = Object.freeze([
  "GET workforce/demand-observations/loyverse",
  "POST workforce/demand-observations/loyverse",
  "GET workforce/demand-observations/square-sandbox",
  "POST workforce/demand-observations/square-sandbox",
]);
export const POS_PROVIDERS = Object.freeze({
  loyverse: { path: "/api/workforce/demand-observations/loyverse", source: "loyverse_pos_sales" },
  square: { path: "/api/workforce/demand-observations/square-sandbox", source: "square_sandbox_payments" },
});
export const REQUIRED_POS_DEMAND_COUNTS = Object.freeze({
  ownGet: 6, ownDryRun: 6, ownPersistedPost: 6, ownReadAfterPost: 6,
  foreignEmployerGet403: 4, foreignEmployerPost403: 4,
  stolenWorksiteGet403: 4, stolenWorksitePost403: 4,
  anonymousGet401: 4, anonymousPost401: 4,
  invalidGet400: 4, invalidPost400: 4,
  excludedEmployerGet403: 4, excludedEmployerPost403: 4,
  responseSwapRejected: 2,
});
export function assertCompletePosDemandCounts(actual) {
  assert.deepEqual(actual, REQUIRED_POS_DEMAND_COUNTS,
    "POS_DEMAND_PROOF_INCOMPLETE: all method-specific A/B/victim and negative probes required");
}
export const FORBIDDEN_EXTERNAL_SECRETS = Object.freeze([
  "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
  "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL", "STRIPE_SECRET_KEY",
  "WFM_LOYVERSE_ACCESS_TOKEN", "WFM_SQUARE_SANDBOX_ACCESS_TOKEN",
]);
export function requireDisposablePosDemand(env = process.env) {
  const exact = {
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only", TENANT_TABLE_PROFILE: "allowlisted-reads",
    TENANT_POS_DEMAND_PROOF: "fictional-provider-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    TRUSTED_APP_ORIGINS: "http://127.0.0.1:3000",
    APP_BASE_URL: "https://payroll.example.test", DEMO_MODE: "false",
    REQUIRE_PRIVILEGED_MFA: "true", WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false", PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
    HCM_OVERPAYMENT_PREVIEW_ENABLED: "false",
    PAYROLL_OVERPAYMENT_REVIEW_ENABLED: "false",
    PAYROLL_LOAN_DEDUCTION_ACTIVATION_ENABLED: "false", NEXT_CSP_ENABLED: "false",
    WFM_OPERATIONAL_DEMAND_ENABLED: "true",
    WFM_LOYVERSE_POS_ENABLED: "true", WFM_SQUARE_SANDBOX_ENABLED: "true",
  };
  for (const [key, value] of Object.entries(exact))
    assert.equal(env[key], value, "POS_DEMAND_REFUSED: exact fictional CI value " + key);
  for (const key of FORBIDDEN_EXTERNAL_SECRETS)
    assert.ok(!env[key], "POS_DEMAND_REFUSED: external credential " + key);
  assert.match(env.TENANT_TABLE_ALLOWLIST_FIXTURE ?? "",
    /^\/tmp\/payrollph-tenant-allowlist-[A-Za-z0-9]{6}\/fixture\.json$/,
    "POS_DEMAND_REFUSED: only private bootstrap fixture is accepted");
  const names = [
    "WFM_OPERATIONAL_DEMAND_ALLOWED_ORGANIZATION_IDS",
    "WFM_LOYVERSE_POS_ALLOWED_ORGANIZATION_IDS",
    "WFM_SQUARE_SANDBOX_ALLOWED_ORGANIZATION_IDS",
  ];
  const ids = env[names[0]] ?? "";
  assert.match(ids, /^[1-9][0-9]{0,9},[1-9][0-9]{0,9},[1-9][0-9]{0,9}$/,
    "POS_DEMAND_REFUSED: exactly three real fictional employer IDs");
  for (const name of names.slice(1))
    assert.equal(env[name], ids, "POS_DEMAND_REFUSED: all three flags must share same IDs");
  const parsed = ids.split(",").map(Number);
  assert.ok(parsed.every(id => Number.isSafeInteger(id) && id > 0 && id <= 2147483647)
    && new Set(parsed).size === 3
    && parsed[2] > parsed[0] && parsed[2] > parsed[1],
  "POS_DEMAND_REFUSED: victim must have a distinct higher real SQL ID");
  return parsed;
}
export function assertPrivatePosResponse(r) {
  const directives = (r.headers?.get?.("cache-control") ?? "").toLowerCase()
    .split(",").map(x => x.trim());
  assert.ok(directives.includes("no-store") && directives.includes("private"),
    "POS source response must be private and non-cacheable");
}
export function assertNoForeignLeak(r, markers) {
  const visible = r.text + "\n" + [...(r.headers ?? [])]
    .map(([name, value]) => name + ":" + value).join("\n");
  for (const marker of markers)
    assert.ok(!visible.toLowerCase().includes(marker.toLowerCase()),
      "POS_DEMAND_LEAK: foreign employer marker was returned");
}
export function assertPosDenial(r, status, markers) {
  assert.equal(r.status, status, "an actual HTTP denial with correct status is required");
  assert.equal(typeof r.json?.error, "string");
  assert.ok(r.text.length < 2000);
  for (const field of ["scope", "source", "applied", "batchId", "importBatchId",
    "lastStoredRevisionRows", "changedIntervals", "countedSales", "completedPayments"])
    assert.equal(r.json[field], undefined, "denied response returned success field " + field);
  assertNoForeignLeak(r, markers);
}
export function assertOwnGet(r, actor, provider, site, expectedRows = 1) {
  assert.equal(r.status, 200, "own populated GET must be real HTTP 200");
  assertPrivatePosResponse(r);
  assert.equal(r.json?.readOnly, true);
  assert.equal(r.json?.scope?.organizationId, actor.org.id);
  assert.equal(r.json?.scope?.worksiteId, site.id);
  assert.equal(r.json?.scope?.sourceKey, POS_PROVIDERS[provider].source);
  assert.equal(r.json?.scope?.intervalMinutes, 60);
  assert.equal(r.json?.lastStoredRevisionRows, expectedRows,
    "own GET must expose an actual seeded populated SQL batch, not empty 200");
  assert.ok(Date.parse(r.json?.lastStoredImportAt) > 0);
}
export function assertOwnPost(r, provider, dryRun) {
  assert.equal(r.status, 200, "synthetic source POST must succeed over real HTTP");
  assertPrivatePosResponse(r);
  assert.equal(r.json?.source, POS_PROVIDERS[provider].source);
  assert.equal(r.json?.readOnly, dryRun);
  assert.equal(r.json?.applied, !dryRun);
  assert.ok(r.json?.changedIntervals > 0,
    "real source simulation must yield nonempty interval differences");
  assert.equal(provider === "loyverse" ? r.json?.countedSales : r.json?.completedPayments, 1);
  if (!dryRun) assert.ok(Number.isSafeInteger(
    provider === "loyverse" ? r.json?.importBatchId : r.json?.batchId));
}
