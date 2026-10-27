/**
 * Read-only employee pay privacy contract. No salary certification, production
 * data, payout, filing or tenant coverage credit follows from this helper.
 */
import assert from "node:assert/strict";

export const TAKE_HOME_RATES = Object.freeze({
  ATTA: "24000.00",
  ATTB: "37000.00",
  VICTIM: "52000.00",
  PEER: "31500.00",
});

export function requireDisposableTakeHome(env = process.env) {
  assert.equal(env.GITHUB_ACTIONS, "true", "TAKE_HOME_REFUSED: GitHub Actions only");
  assert.equal(env.CI, "true");
  assert.equal(env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(env.NODE_ENV, "production");
  assert.equal(env.TZ, "Asia/Manila");
  assert.equal(env.DEMO_MODE, "false");
  assert.equal(env.SECURITY_SMOKE_URL, "http://127.0.0.1:3000");
  assert.equal(env.DATABASE_URL, "postgresql://postgres:postgres@127.0.0.1:5432/app_db");
  for (const key of [
    "PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED",
    "XENDIT_BILLING_ENABLED", "CENTRAL_SCHEDULER_ENABLED",
  ]) assert.equal(env[key], "false", key + ": no external providers/scheduler");
  for (const key of [
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL",
  ]) assert.ok(!env[key], "TAKE_HOME_REFUSED: live provider secret " + key);
  return true;
}

export function assertNoForeignSalary(response, prohibitedRates) {
  const baseline = response.json?.baseline;
  for (const rate of prohibitedRates) {
    assert.notEqual(baseline?.monthlyBasic, Number(rate),
      "response must not disclose a different employee's recorded monthly rate");
  }
  assert.ok(!response.text?.includes("__Host-linaw_session="),
    "response body must never echo session cookies");
}

export function assertOwnTakeHome(response, expectedRate, otherRates = []) {
  assert.equal(response.status, 200, "employee's own real HTTP request must succeed");
  const cacheControl = response.headers?.get("cache-control") ?? "";
  assert.match(cacheControl, /(?:^|,)\s*no-store(?:\s*,|$)/i,
    "private pay response must not be stored by caches");
  assert.doesNotMatch(cacheControl, /(?:^|,)\s*(?:public|s-maxage)\b/i);
  const data = response.json;
  assert.ok(data && typeof data === "object" && !Array.isArray(data));
  assert.match(data.asOf ?? "", /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(data.baseline?.monthlyBasic, Number(expectedRate),
    "own persisted salary must be the returned baseline, not an empty/default response");
  assert.equal(data.baseline?.payBasis, "monthly");
  assert.equal(data.baseline?.mwe, false);
  assert.ok(typeof data.estimate?.netPay === "number" &&
    Number.isFinite(data.estimate.netPay) && data.estimate.netPay > 0,
    "estimated take-home amount must be an actual positive calculation");
  assert.ok(data.estimate.netPay < data.baseline.monthlyBasic,
    "fictional payroll estimate must be below the fictional gross baseline");
  assert.match(data.note ?? "", /estimate/i, "response must not claim an official released payslip");
  for (const key of ["organizationId", "employeeId", "userId", "sessions", "bankAccount"]) {
    assert.ok(!Object.hasOwn(data, key), "must not disclose " + key);
  }
  assertNoForeignSalary(response, otherRates);
  return data;
}

export function assertTakeHomeDenied(response, status, otherRates = []) {
  assert.equal(response.status, status);
  assert.ok(response.json && typeof response.json.error === "string",
    "denial must be a real error response, not an empty success");
  assert.ok(!Object.hasOwn(response.json, "baseline"), "no salary on denial");
  assert.ok(!Object.hasOwn(response.json, "estimate"), "no estimate on denial");
  assertNoForeignSalary(response, otherRates);
}
