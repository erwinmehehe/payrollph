/**
 * Tenant isolation contract for the two POST issued-demand methods.
 * Disposable PG16 / localhost only; no POS adapters, external providers,
 * real payroll/scheduling actions or automatic manifest credit.
 */
import assert from "node:assert/strict";

export const ISSUED_DEMAND_POST_METHODS = Object.freeze([
  "POST workforce/demand-observations/issued",
  "POST workforce/demand-observations/issued/score",
]);
export const ISSUE_PATH = "/api/workforce/demand-observations/issued";
export const SCORE_PATH = ISSUE_PATH + "/score";
export const FORBIDDEN_PROVIDER_ENV = Object.freeze([
  "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
  "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL", "STRIPE_SECRET_KEY",
  "WFM_LOYVERSE_ACCESS_TOKEN", "WFM_LOYVERSE_STORE_ID",
  "WFM_SQUARE_SANDBOX_ACCESS_TOKEN", "WFM_SQUARE_SANDBOX_LOCATION_ID",
]);

export function requireDisposableIssuedDemand(env = process.env) {
  const exact = {
    GITHUB_ACTIONS: "true",
    CI: "true",
    NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    TENANT_TABLE_PROFILE: "allowlisted-reads",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    TRUSTED_APP_ORIGINS: "http://127.0.0.1:3000",
    APP_BASE_URL: "https://payroll.example.test",
    DEMO_MODE: "false",
    REQUIRE_PRIVILEGED_MFA: "true",
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
    HCM_OVERPAYMENT_PREVIEW_ENABLED: "false",
    PAYROLL_OVERPAYMENT_REVIEW_ENABLED: "false",
    WFM_OPERATIONAL_DEMAND_ENABLED: "true",
    WFM_ISSUED_DEMAND_FORECASTS_ENABLED: "true",
    WFM_SQUARE_SANDBOX_ENABLED: "false",
    WFM_LOYVERSE_POS_ENABLED: "false",
  };
  for (const [key, value] of Object.entries(exact)) {
    assert.equal(env[key], value, "ISSUED_DEMAND_REFUSED: exact disposable " + key);
  }
  for (const key of FORBIDDEN_PROVIDER_ENV) {
    assert.ok(!env[key], "ISSUED_DEMAND_REFUSED: external/provider credential " + key);
  }
  assert.match(env.TENANT_TABLE_ALLOWLIST_FIXTURE ?? "",
    /^\/tmp\/payrollph-tenant-allowlist-[A-Za-z0-9]{6}\/fixture\.json$/,
    "ISSUED_DEMAND_REFUSED: private CI-generated fixture required");
  const names = [
    "WFM_OPERATIONAL_DEMAND_ALLOWED_ORGANIZATION_IDS",
    "WFM_ISSUED_DEMAND_FORECASTS_ALLOWED_ORGANIZATION_IDS",
  ];
  const ids = env[names[0]] ?? "";
  assert.match(ids, /^[1-9][0-9]{0,9},[1-9][0-9]{0,9},[1-9][0-9]{0,9}$/,
    "ISSUED_DEMAND_REFUSED: exactly three distinct allowlisted employer IDs required");
  assert.equal(env[names[1]], ids, "ISSUED_DEMAND_REFUSED: pilot allowlists must match");
  const parsed = ids.split(",").map(Number);
  assert.ok(parsed.every(id => Number.isSafeInteger(id) && id > 0 && id <= 2147483647)
    && new Set(parsed).size === 3
    && parsed[2] > parsed[0] && parsed[2] > parsed[1],
  "ISSUED_DEMAND_REFUSED: the real victim must have a higher SQL employer ID");
  return parsed;
}

function visible(response) {
  assert.ok(response && typeof response.text === "string");
  return response.text + "\n" +
    [...(response.headers ?? [])].map(([key, value]) => key + ":" + value).join("\n");
}
export function assertNoOtherEmployerLeak(response, markers) {
  for (const marker of markers) {
    assert.ok(typeof marker === "string" && marker.length > 0);
    assert.ok(!visible(response).toLowerCase().includes(marker.toLowerCase()),
      "ISSUED_DEMAND_PROOF_FAILED: other employer's marker leaked");
  }
}
export function assertDemandPrivate(headers) {
  const raw = headers?.get?.("cache-control") ?? "";
  const parts = raw.toLowerCase().split(",").map(v => v.trim()).filter(Boolean);
  assert.ok(parts.includes("no-store"), "successful demand write must be non-cacheable");
  const allowed = new Set(["private", "no-store", "no-cache", "max-age=0",
    "must-revalidate", "proxy-revalidate"]);
  assert.ok(parts.every(v => allowed.has(v)),
    "public, shared, or stale caching forbidden on demand evidence");
}
export function assertDemandWriteDenied(response, expectedStatus, markers = []) {
  assert.equal(response?.status, expectedStatus,
    "denial must be a real HTTP response with its exact expected status");
  assert.ok(response.json && typeof response.json.error === "string",
    "denial needs a bounded error, not a fake positive");
  assert.ok(response.text.length < 2000, "denial response must be bounded");
  for (const field of ["issueId", "scoreId", "report", "snapshot",
    "readOnlyScore", "readOnlyForecast", "boundary", "scope"]) {
    assert.equal(response.json[field], undefined,
      "denied request cannot return a successful demand field: " + field);
  }
  assertNoOtherEmployerLeak(response, markers);
}
export function assertIssuedOwnHttp(response, row, actor, forbidden = []) {
  assert.equal(response?.status, 201, "real owned issued POST must return 201");
  assertDemandPrivate(response.headers);
  assert.equal(response.json?.replayed, false,
    "a 200 idempotency replay cannot substitute for actual issued insertion");
  assert.equal(response.json?.readOnlyForecast, true);
  assert.match(response.json?.boundary ?? "", /No worker schedule, wages or payroll were changed/);
  assert.ok(Number.isSafeInteger(row?.id) && row.id > 0);
  assert.equal(response.json.issueId, row.id);
  assert.equal(response.json.pointsCount, row.pointsCount);
  assert.equal(response.json.snapshotSha256, row.snapshotSha256);
  assert.equal(row.organizationId, actor.org.id);
  assert.equal(row.issuedByUserId, actor.owner.id);
  assert.equal(row.snapshot?.scope?.organizationId, actor.org.id);
  assert.equal(row.snapshot?.scope?.worksiteId, row.worksiteId);
  assert.ok(row.pointsCount > 0 && row.snapshot.points.length === row.pointsCount);
  assert.ok(row.snapshot.points.every(p => Date.parse(p.intervalStart) > row.issuedAt.getTime()),
    "the issued points must be strictly future relative to persisted issue time");
  assert.match(row.snapshotSha256, /^[a-f0-9]{64}$/);
  assert.match(row.trainingEvidenceSha256, /^[a-f0-9]{64}$/);
  assertNoOtherEmployerLeak(response, forbidden);
}
export function assertScoredOwnHttp(response, row, issue, actor, forbidden = []) {
  assert.equal(response?.status, 201, "real own frozen score POST must return 201");
  assertDemandPrivate(response.headers);
  assert.equal(response.json?.replayed, false,
    "a 200 replay cannot masquerade as a new frozen score");
  assert.equal(response.json?.readOnlyScore, true);
  assert.match(response.json?.boundary ?? "", /No employee, schedule, payroll or payout decision/);
  assert.ok(Number.isSafeInteger(row?.id) && row.id > 0);
  assert.equal(response.json.scoreId, row.id);
  assert.equal(response.json.issueId, issue.id);
  assert.equal(response.json.reportSha256, row.reportSha256);
  assert.deepEqual(response.json.report, row.report);
  assert.equal(row.organizationId, actor.org.id);
  assert.equal(row.issueId, issue.id);
  assert.equal(row.scoredByUserId, actor.owner.id);
  assert.equal(row.report.issuedSnapshotSha256, issue.snapshotSha256);
  assert.equal(row.pointsCount, issue.pointsCount);
  assert.equal(row.report.comparisonCount, row.pointsCount);
  assert.ok(row.pointsCount > 0);
  assert.ok(row.report.points.every(p => Number.isSafeInteger(p.observationRevisionId)
    && p.observationRevisionId > 0));
  assert.match(row.reportSha256, /^[a-f0-9]{64}$/);
  assertNoOtherEmployerLeak(response, forbidden);
}
export function assertImmutableIssuedDemandSql(before, after, label) {
  assert.deepEqual(after, before,
    label + ": denial/replay or another employer mutated source, forecast, worker, payroll, schedule or audit SQL");
}
