/**
 * Source-bound, no-credit WRK-01 greedy roster GET tenant-isolation receipt.
 * The runner must refuse non-local or hosted infrastructure before DB imports.
 */
import assert from "node:assert/strict";

export const METHOD = "GET workforce/greedy-roster";
export const ENDPOINT = "/api/workforce/greedy-roster";

export function requireDisposableGreedyRoster(env = process.env) {
  const required = {
    GITHUB_ACTIONS: "true",
    CI: "true",
    NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    TENANT_TABLE_PROFILE: "flagged-reads",
    TENANT_GREEDY_ROSTER_MODE: "fictional-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    APP_BASE_URL: "https://payroll.example.test",
    DEMO_MODE: "false",
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    HCM_OVERPAYMENT_PREVIEW_ENABLED: "false",
    PAYROLL_OVERPAYMENT_REVIEW_ENABLED: "false",
    WFM_GREEDY_ROSTER_ENABLED: "true",
    WFM_ROSTER_SCALE_RULES_ENABLED: "true",
    REQUIRE_PRIVILEGED_MFA: "true",
  };
  for (const [name, value] of Object.entries(required)) {
    assert.equal(env[name], value, "GREEDY_ROSTER_REFUSED: exact " + name);
  }
  for (const name of [
    "DATABASE_URL_DIRECT", "NEON_DATABASE_URL", "NEON_API_KEY",
    "VERCEL", "VERCEL_URL", "VERCEL_ENV",
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY",
    "XENDIT_PAYOUT_SECRET_KEY", "RESEND_API_KEY",
    "POSTMARK_SERVER_TOKEN", "SMTP_URL", "STRIPE_SECRET_KEY",
  ]) {
    assert.ok(!env[name], "GREEDY_ROSTER_REFUSED: hosted/provider input " + name);
  }
  assert.ok(String(env.WORKER_TOKEN ?? "").startsWith("ci-worker-token-"),
    "GREEDY_ROSTER_REFUSED: only fictional worker token");
}

function combined(response) {
  assert.ok(response && typeof response.text === "string");
  assert.ok(response.headers && typeof response.headers.get === "function");
  return response.text + "\n" +
    [...response.headers].map(([key, value]) => key + ": " + value).join("\n");
}

export function assertNoGreedyLeak(response, markers = []) {
  const text = combined(response);
  for (const marker of markers) {
    assert.ok(typeof marker === "string" && marker.length > 0,
      "must explicitly specify genuine foreign marker");
    assert.ok(!text.includes(marker),
      "cross-employer/other-unit private marker disclosed by HTTP");
  }
}

export function assertGreedyNoStore(headers) {
  const raw = headers?.get?.("cache-control") ?? "";
  const parts = raw.toLowerCase().split(",").map(x => x.trim()).filter(Boolean);
  assert.ok(parts.includes("no-store"), "private roster response must prohibit caching");
  const safe = new Set(["private", "no-store", "no-cache", "max-age=0",
    "must-revalidate", "proxy-revalidate"]);
  assert.ok(parts.every(part => safe.has(part)),
    "public, stale or positive-TTL caching is forbidden for personnel forecasts");
}

export function assertOwnGreedyRoster(response, own, forbidden = []) {
  assert.equal(response.status, 200,
    "genuine own manager GET must succeed, not feature-off/empty/409: " +
    String(response.text).slice(0, 180));
  assertGreedyNoStore(response.headers);
  const result = response.json;
  assert.ok(result && typeof result === "object" && !Array.isArray(result));
  assert.equal(result.status, "review_required");
  assert.equal(result.automaticallyPublished, false);
  assert.deepEqual(Object.keys(result).sort(),
    ["status", "automaticallyPublished", "roster", "unfilled",
      "summary", "boundary", "source"].sort());
  assert.ok(result.boundary.includes("No roster, payroll or funds were changed."));
  assert.equal(result.source.organizationId, own.org.id);
  assert.equal(result.source.worksiteId, own.site.id);
  assert.equal(result.source.startDate, own.workDate);
  assert.equal(result.source.endDate, own.workDate);
  assert.equal(result.source.slotCount, 1, "one actual stored requirement required");
  assert.equal(result.source.candidateCount, 1,
    "must load real own employee population, not empty fallback");
  assert.equal(result.source.sourceVersion, "wfm-greedy-roster-v1");
  assert.equal(result.summary.required, own.headcount);
  assert.equal(result.summary.existing, 0);
  assert.equal(result.summary.suggested, 0);
  assert.equal(result.summary.unfilled, own.headcount);
  assert.ok(Array.isArray(result.roster) && result.roster.length === 0);
  assert.ok(Array.isArray(result.unfilled) &&
    result.unfilled.length === own.headcount,
    "must return source-bound, genuinely unfilled staffing slots");
  for (const unfilled of result.unfilled) {
    assert.equal(unfilled.requirementId, own.requirement.id,
      "response must refer to the real own-employer SQL requirement");
    assert.equal(unfilled.workDate, own.workDate);
    assert.equal(unfilled.reason, "site_ineligible",
      "explicit own-worker worksite denial must drive preview evidence");
    assert.ok(unfilled.evidence.some(item =>
      item.code === "site_ineligible" && item.candidates === 1),
    "must actually evaluate own stored denial, not a generic fallback");
  }
  assert.deepEqual(result.summary.fairnessProjectedMinutes, [{
    employeeId: own.worker.id, scheduledMinutes: 0, unpopularShifts: 0,
  }], "source must include only own signed-in employer's real worker");
  assertNoGreedyLeak(response, forbidden);
  return result;
}

export function assertGreedyDenied(response, status, forbidden = []) {
  assert.equal(response.status, status,
    "unexpected failed GET: " + String(response.text).slice(0, 160));
  assert.ok(typeof response.json?.error === "string",
    "denial must be explicit, not a 200 empty roster");
  for (const name of ["roster", "unfilled", "summary", "source", "boundary"]) {
    assert.ok(!Object.hasOwn(response.json, name),
      "denied GET disclosed private roster source: " + name);
  }
  assertNoGreedyLeak(response, forbidden);
}

export function assertGreedySqlUnchanged(before, after, label) {
  assert.deepEqual(after, before,
    label + ": no read or denial may mutate employer staffing, audit, payroll or personnel");
}
