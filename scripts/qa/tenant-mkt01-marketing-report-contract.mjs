/**
 * MKT-01: separate platform-operator marketing analytics proof.
 * This route is NOT a tenant-private route. No blanket tenant coverage credit.
 */
import assert from "node:assert/strict";

export const MKT01_ROUTE = "src/app/api/marketing/leads/route.ts";
export const MKT01_REPORT = "src/lib/marketing-report.ts";
export const MKT01_ROUTE_SHA = "69a046c25fb59ccc75c47b41d44c26b585e898b3";
export const MKT01_REPORT_SHA = "7371a252be449829b09e7a0ff501d77eb6d811fd";
export const MKT01_OPERATOR = "mkt01.operator@example.test";
export const MKT01_STALE = "mkt01.stale@example.test";
export const MKT01_ALLOWLIST = MKT01_OPERATOR + "," + MKT01_STALE;
const NO_PROVIDERS = [
  "PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED",
  "XENDIT_BILLING_ENABLED", "WORKER_ENABLED", "CENTRAL_SCHEDULER_ENABLED",
  "NEXT_CSP_ENABLED", "MULTI_ENTITY_ENABLED",
  "HCM_OVERPAYMENT_PREVIEW_ENABLED", "PAYROLL_OVERPAYMENT_REVIEW_ENABLED",
  "PAYROLL_LOAN_DEDUCTION_ACTIVATION_ENABLED",
  "CALCULATION_HISTORY_ENABLED", "PAYROLL_CALCULATION_HISTORY_ENABLED",
];
const EMPTY_CREDENTIALS = [
  "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
  "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL", "STRIPE_SECRET_KEY",
];

export function requireDisposableMkt01(env = process.env) {
  const refuse = why => { throw new Error("MKT01_REFUSED: " + why); };
  for (const [key, expected] of Object.entries({
    CI: "true", GITHUB_ACTIONS: "true",
    TENANT_MKT01_MODE: "fictional-pg16-http",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    NODE_ENV: "production", DEMO_MODE: "false",
    REQUIRE_PRIVILEGED_MFA: "true",
    APP_BASE_URL: "https://payroll.example.test",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    MARKETING_REPORT_EMAILS: MKT01_ALLOWLIST,
  })) {
    if (env[key] !== expected) refuse(key + " must be " + expected);
  }
  let target;
  try { target = new URL(env.DATABASE_URL); } catch { refuse("database URL required"); }
  if (target.protocol !== "postgresql:" ||
      target.hostname !== "127.0.0.1" || target.port !== "5432" ||
      target.pathname !== "/app_db" || target.username !== "postgres" ||
      target.password !== "postgres" || target.search || target.hash) {
    refuse("only disposable localhost PostgreSQL app_db is permitted");
  }
  for (const key of NO_PROVIDERS) if (env[key] !== "false") refuse(key + " must be false");
  for (const key of EMPTY_CREDENTIALS) if (env[key] !== "") refuse(key + " must be empty");
  return true;
}

export function assertMkt01Denied(response, expectedStatus, forbidden = []) {
  assert.equal(response.status, expectedStatus,
    "MKT-01 authentication/allowlist/MFA denial status changed");
  assert.ok(response.json && typeof response.json.error === "string",
    "refused operator must receive an error, not a report");
  assert.equal(response.json.totalRequests, undefined,
    "failed authentication must never disclose aggregate counts");
  for (const value of forbidden) {
    assert.ok(!response.text.includes(value),
      "refused operator response leaked fictional private lead data");
  }
  return response;
}

export function assertMkt01Aggregate(response, expected, privateValues = []) {
  assert.equal(response.status, 200, "allowlisted recent-MFA operator must be authorized");
  const data = response.json;
  assert.ok(data && typeof data === "object");
  assert.equal(data.periodDays, expected.days);
  assert.equal(data.totalRequests, expected.total);
  assert.equal(data.attributedRequests, expected.attributed);
  assert.equal(data.unattributedRequests, expected.total - expected.attributed);
  assert.ok(String(data.privacy ?? "").includes("Aggregated report only"));
  const allowedTop = [
    "periodDays", "since", "totalRequests", "attributedRequests",
    "unattributedRequests", "byRequestType", "byLandingPath",
    "bySourceMedium", "byCampaign", "byHeadcount", "byDay", "privacy",
  ];
  assert.deepEqual(Object.keys(data).sort(), allowedTop.sort(),
    "unexpected direct prospect data in report JSON");
  const buckets = ["byRequestType", "byLandingPath", "bySourceMedium",
    "byCampaign", "byHeadcount", "byDay"];
  for (const key of buckets) {
    assert.ok(Array.isArray(data[key]), key + " must be an aggregate");
    for (const row of data[key]) {
      assert.deepEqual(Object.keys(row).sort(), ["count", "key"]);
      assert.equal(typeof row.key, "string");
      assert.ok(Number.isInteger(row.count) && row.count > 0);
    }
  }
  for (const value of privateValues) {
    assert.ok(!response.text.includes(value),
      "marketing report exposed a fictional name, email, company or message");
  }
  return data;
}

export function assertMkt01Unchanged(before, after, label) {
  assert.deepEqual(after, before, label + ": marketing, audit or payroll state changed");
}
