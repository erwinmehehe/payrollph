import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ISSUE_PATH, SCORE_PATH, ISSUED_DEMAND_POST_METHODS,
  FORBIDDEN_PROVIDER_ENV, requireDisposableIssuedDemand,
  assertDemandWriteDenied, assertDemandPrivate, assertNoOtherEmployerLeak,
  assertIssuedOwnHttp, assertScoredOwnHttp, assertImmutableIssuedDemandSql,
} from "../scripts/qa/tenant-issued-demand-contract.mjs";

const path = name => readFileSync(name, "utf8");
function isolatedEnv() {
  return {
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    TENANT_TABLE_PROFILE: "allowlisted-reads",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    TRUSTED_APP_ORIGINS: "http://127.0.0.1:3000",
    APP_BASE_URL: "https://payroll.example.test",
    DEMO_MODE: "false", REQUIRE_PRIVILEGED_MFA: "true",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
    HCM_OVERPAYMENT_PREVIEW_ENABLED: "false", PAYROLL_OVERPAYMENT_REVIEW_ENABLED: "false",
    WFM_OPERATIONAL_DEMAND_ENABLED: "true",
    WFM_ISSUED_DEMAND_FORECASTS_ENABLED: "true",
    WFM_SQUARE_SANDBOX_ENABLED: "false", WFM_LOYVERSE_POS_ENABLED: "false",
    TENANT_TABLE_ALLOWLIST_FIXTURE: "/tmp/payrollph-tenant-allowlist-AbC123/fixture.json",
    WFM_OPERATIONAL_DEMAND_ALLOWED_ORGANIZATION_IDS: "11,12,14",
    WFM_ISSUED_DEMAND_FORECASTS_ALLOWED_ORGANIZATION_IDS: "11,12,14",
  };
}
const okHeaders = () => new Headers({ "cache-control": "private, no-store" });
const mock = (status, json, headers = okHeaders()) =>
  ({ status, json, text: JSON.stringify(json), headers });

test("only two exact issued POST methods are claimed, with no GET or provider method", () => {
  assert.deepEqual(ISSUED_DEMAND_POST_METHODS, [
    "POST workforce/demand-observations/issued",
    "POST workforce/demand-observations/issued/score",
  ]);
  assert.equal(ISSUE_PATH, "/api/workforce/demand-observations/issued");
  assert.equal(SCORE_PATH, ISSUE_PATH + "/score");
});

test("preflight rejects all hosted, wildcard, provider-enabled, money-enabled and non-CI environments", () => {
  const safe = isolatedEnv();
  assert.deepEqual(requireDisposableIssuedDemand(safe), [11, 12, 14]);
  for (const [key, value] of [
    ["GITHUB_ACTIONS", "false"], ["CI", "false"], ["NODE_ENV", "development"],
    ["TENANT_TABLE_PROFILE", "default"], ["TENANT_SECOND_PASS_MODE", "preview"],
    ["DATABASE_URL", "postgresql://postgres:postgres@db.example.com:5432/app_db"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/production"],
    ["SECURITY_SMOKE_URL", "https://payroll.example.com"],
    ["TRUSTED_APP_ORIGINS", "https://payroll.example.com"],
    ["APP_BASE_URL", "https://real-payroll.example.com"],
    ["REQUIRE_PRIVILEGED_MFA", "false"], ["WORKER_ENABLED", "true"],
    ["CENTRAL_SCHEDULER_ENABLED", "true"],
    ["PAYMONGO_DISBURSEMENTS_ENABLED", "true"],
    ["XENDIT_PAYOUTS_ENABLED", "true"], ["XENDIT_BILLING_ENABLED", "true"],
    ["WFM_OPERATIONAL_DEMAND_ENABLED", "false"],
    ["WFM_ISSUED_DEMAND_FORECASTS_ENABLED", "false"],
    ["WFM_SQUARE_SANDBOX_ENABLED", "true"],
    ["WFM_LOYVERSE_POS_ENABLED", "true"],
    ["WFM_OPERATIONAL_DEMAND_ALLOWED_ORGANIZATION_IDS", "11,12,16,18"],
    ["WFM_ISSUED_DEMAND_FORECASTS_ALLOWED_ORGANIZATION_IDS", "11,12"],
    ["WFM_ISSUED_DEMAND_FORECASTS_ALLOWED_ORGANIZATION_IDS", "11,12,13"],
    ["TENANT_TABLE_ALLOWLIST_FIXTURE", "/tmp/shared.json"],
  ]) {
    assert.throws(() => requireDisposableIssuedDemand({ ...safe, [key]: value }),
      "must fail closed when " + key + " is " + value);
  }
  for (const name of FORBIDDEN_PROVIDER_ENV) {
    assert.throws(() => requireDisposableIssuedDemand({ ...safe, [name]: "fictional-secret" }),
      "external credential must prevent the runner: " + name);
  }
  assert.throws(() => requireDisposableIssuedDemand({
    ...safe,
    WFM_OPERATIONAL_DEMAND_ALLOWED_ORGANIZATION_IDS: "11,11,14",
    WFM_ISSUED_DEMAND_FORECASTS_ALLOWED_ORGANIZATION_IDS: "11,11,14",
  }), "duplicate attacker ID cannot fabricate a third victim");
});

test("denial contract fails closed on wrong status, response swap, leaked victim and fake successful writes", () => {
  const denial = mock(403, { error: "Worksite unavailable in the selected employer." });
  assert.doesNotThrow(() => assertDemandWriteDenied(denial, 403, ["PRIVATE-VICTIM"]));
  assert.throws(() => assertDemandWriteDenied(denial, 404));
  assert.throws(() => assertDemandWriteDenied(mock(403,
    { error: "denied", scoreId: 19 }), 403));
  assert.throws(() => assertDemandWriteDenied(mock(403,
    { error: "denied", report: { private: "VICTIM" } }), 403));
  assert.throws(() => assertDemandWriteDenied(mock(403,
    { error: "TTBL-VICTIM-FAKE confidential" }), 403, ["TTBL-VICTIM-FAKE"]));
  assert.throws(() => assertDemandWriteDenied(mock(200,
    { error: "not denied" }), 403));
  assert.throws(() => assertNoOtherEmployerLeak(mock(200, { ok: true },
    new Headers({ "x-private-info": "synthetic-victim" })), ["synthetic-victim"]));
  assertDemandPrivate(okHeaders());
  for (const bad of ["public,max-age=60", "private,max-age=3600",
    "no-cache", "s-maxage=30,no-store"]) {
    assert.throws(() => assertDemandPrivate(new Headers({ "cache-control": bad })),
      "no cacheable or missing no-store response may qualify: " + bad);
  }
});

test("owned HTTP issue requires a genuine own DB row, future points, exact hash and non-replay", () => {
  const actor = { org: { id: 11 }, owner: { id: 21 } };
  const issuedAt = new Date("2026-10-01T08:00:00.000Z");
  const hash = "a".repeat(64);
  const row = {
    id: 41, organizationId: 11, issuedByUserId: 21, worksiteId: 31,
    issuedAt, pointsCount: 1, snapshotSha256: hash, trainingEvidenceSha256: "b".repeat(64),
    snapshot: { scope: { organizationId: 11, worksiteId: 31 },
      points: [{ intervalStart: "2026-10-03T01:00:00.000Z" }] },
  };
  const positive = mock(201, { issueId: 41, pointsCount: 1,
    issuedAt: issuedAt.toISOString(), snapshotSha256: hash, replayed: false,
    readOnlyForecast: true,
    boundary: "Issued aggregate workload estimates only. No worker schedule, wages or payroll were changed." });
  assertIssuedOwnHttp(positive, row, actor);
  assert.throws(() => assertIssuedOwnHttp(mock(200, positive.json), row, actor));
  assert.throws(() => assertIssuedOwnHttp(mock(201,
    { ...positive.json, replayed: true }), row, actor));
  assert.throws(() => assertIssuedOwnHttp(positive,
    { ...row, organizationId: 19 }, actor));
  assert.throws(() => assertIssuedOwnHttp(positive,
    { ...row, pointsCount: 0 }, actor));
  assert.throws(() => assertIssuedOwnHttp(positive,
    { ...row, snapshot: { ...row.snapshot, points: [
      { intervalStart: "2026-09-01T01:00:00.000Z" },
    ] } }, actor));
});

test("owned score requires exact SQL report/actor/issue, settled revision identifiers and 201", () => {
  const actor = { org: { id: 12 }, owner: { id: 22 } };
  const issue = { id: 53, pointsCount: 1, snapshotSha256: "a".repeat(64) };
  const report = { issuedSnapshotSha256: issue.snapshotSha256,
    comparisonCount: 1, points: [{ observationRevisionId: 101 }] };
  const score = { id: 67, organizationId: 12, issueId: 53,
    scoredByUserId: 22, pointsCount: 1,
    reportSha256: "b".repeat(64), report };
  const positive = mock(201, { scoreId: 67, issueId: 53,
    reportSha256: score.reportSha256, report, replayed: false,
    readOnlyScore: true,
    boundary: "Final source-reported workload score. No employee, schedule, payroll or payout decision." });
  assertScoredOwnHttp(positive, score, issue, actor);
  assert.throws(() => assertScoredOwnHttp(mock(200, positive.json),
    score, issue, actor));
  assert.throws(() => assertScoredOwnHttp(positive,
    { ...score, organizationId: 14 }, issue, actor));
  assert.throws(() => assertScoredOwnHttp(positive,
    { ...score, report: { ...report, comparisonCount: 0 } },
    issue, actor));
  assert.throws(() => assertScoredOwnHttp(positive,
    { ...score, reportSha256: "c".repeat(64) }, issue, actor));
  assert.throws(() => assertScoredOwnHttp(positive, score,
    { ...issue, id: 54 }, actor));
});

test("runner executes actual localhost HTTP own success, forged selectors, real victim and unchanged SQL", () => {
  const runner = path("scripts/qa/tenant-issued-demand-http.mjs");
  const workflow = path(".github/workflows/tenant-issued-demand-http.yml");
  const route = path("src/app/api/workforce/demand-observations/issued/route.ts");
  const scoreRoute = path("src/app/api/workforce/demand-observations/issued/score/route.ts");
  assert.ok(runner.indexOf("requireDisposableIssuedDemand()")
    < runner.indexOf('import("../../src/db/index.ts")'),
  "the provider/PG16 guard must execute before any application DB import");
  for (const anchor of [
    "readAllowlistPreseed", "readPrivateAllowlistFixture",
    "victim.site.id > Math.max(a.site.id, b.site.id)",
    "victim.realIssue.id > Math.max(a.realIssue.id, b.realIssue.id)",
    "victim.scorableIssue.id > Math.max(", "standaloneMakeSession",
    "assertDemandWriteDenied", "assertIssuedOwnHttp", "assertScoredOwnHttp",
    "assertImmutableIssuedDemandSql", "newRows(", "assertAudit(",
    "forecast.forecastObservedWorkload", "evidence.makeIssuedDemandSnapshot",
    "sourceSha", "realPG16: true", "realLocalhostHttp: true",
    "coverageCredits: 0", "productionTested: false",
    "externalProviderCalls: 0", "loyverseEnabled: false",
    "squareSandboxEnabled: false",
  ]) assert.ok(runner.includes(anchor), "missing actual evidence or safety anchor: " + anchor);
  assert.doesNotMatch(runner,
    /fetch\(\s*["']https:|readLoyversePosDay|readSquareSandboxDay|submitXendit|createPaymongo/);
  assert.match(route, /await issueOperationalDemandForecast\(/);
  assert.match(scoreRoute, /await finalizeOperationalDemandScore\(/);
  assert.match(route, /requireSensitiveActionMfa\(user\)/);
  assert.match(scoreRoute, /requireSensitiveActionMfa\(user\)/);
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /tenant-table-env\.mjs allowlisted-reads/);
  assert.match(workflow, /tenant-table-allowlist-bootstrap\.mjs/);
  assert.match(workflow, /npm start -- -H 127\.0\.0\.1/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-issued-demand-http\.mjs/);
  assert.match(workflow, /WFM_SQUARE_SANDBOX_ENABLED=false/);
  assert.match(workflow, /WFM_LOYVERSE_POS_ENABLED=false/);
  assert.match(workflow, /permissions:\n  contents: read/);
});

test("source/denial snapshot equality rejects any changed payroll, worker or audit row", () => {
  const before = { employees: [{ id: 1, salary: "100" }],
    payrollRuns: [{ id: 2, status: "Draft" }], audit: [{ id: 3, action: "issue" }] };
  assertImmutableIssuedDemandSql(before, structuredClone(before), "unchanged");
  assert.throws(() => assertImmutableIssuedDemandSql(before,
    { ...before, payrollRuns: [{ id: 2, status: "Released" }] }, "illicit payroll action"));
  assert.throws(() => assertImmutableIssuedDemandSql(before,
    { ...before, employees: [{ id: 1, salary: "500" }] }, "illicit worker action"));
  assert.throws(() => assertImmutableIssuedDemandSql(before,
    { ...before, audit: [] }, "audit removal"));
});
