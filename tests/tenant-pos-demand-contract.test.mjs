import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  POS_DEMAND_METHODS, POS_PROVIDERS, REQUIRED_POS_DEMAND_COUNTS,
  requireDisposablePosDemand, assertCompletePosDemandCounts,
  assertOwnGet, assertOwnPost, assertPosDenial, assertNoForeignLeak,
} from "../scripts/qa/tenant-pos-demand-contract.mjs";

const safe = {
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
  HCM_OVERPAYMENT_PREVIEW_ENABLED: "false", PAYROLL_OVERPAYMENT_REVIEW_ENABLED: "false",
  PAYROLL_LOAN_DEDUCTION_ACTIVATION_ENABLED: "false", NEXT_CSP_ENABLED: "false",
  WFM_OPERATIONAL_DEMAND_ENABLED: "true", WFM_LOYVERSE_POS_ENABLED: "true",
  WFM_SQUARE_SANDBOX_ENABLED: "true",
  TENANT_TABLE_ALLOWLIST_FIXTURE: "/tmp/payrollph-tenant-allowlist-AbC123/fixture.json",
  WFM_OPERATIONAL_DEMAND_ALLOWED_ORGANIZATION_IDS: "11,12,14",
  WFM_LOYVERSE_POS_ALLOWED_ORGANIZATION_IDS: "11,12,14",
  WFM_SQUARE_SANDBOX_ALLOWED_ORGANIZATION_IDS: "11,12,14",
};
const actor = { org: { id: 11 } }, site = { id: 91 };
const headers = new Headers({ "cache-control": "private, no-store" });
const response = json => ({ status: 200, json, text: JSON.stringify(json), headers });
const get = provider => response({
  readOnly: true, scope: { organizationId: 11, worksiteId: 91,
    sourceKey: POS_PROVIDERS[provider].source, intervalMinutes: 60 },
  lastStoredRevisionRows: 1, lastStoredImportAt: "2026-10-01T00:00:00.000Z",
});
const post = (provider, dryRun) => response({
  readOnly: dryRun, applied: !dryRun,
  source: POS_PROVIDERS[provider].source,
  changedIntervals: 24, countedSales: 1, completedPayments: 1,
  importBatchId: 37, batchId: 38,
});
test("four method keys, no provider-free POST substitution or overlapping issued method", () => {
  assert.deepEqual(POS_DEMAND_METHODS, [
    "GET workforce/demand-observations/loyverse",
    "POST workforce/demand-observations/loyverse",
    "GET workforce/demand-observations/square-sandbox",
    "POST workforce/demand-observations/square-sandbox",
  ]);
  for (const [provider, config] of Object.entries(POS_PROVIDERS)) {
    assert.match(config.path, new RegExp(provider === "loyverse" ? "loyverse$" : "square-sandbox$"));
    assert.ok(config.source.length > 8);
    const route = readFileSync("src/app" + config.path + "/route.ts", "utf8");
    assert.match(route, /export async function GET/);
    assert.match(route, /export async function POST/);
    assert.match(route, /assertOrganizationRole/);
    assert.match(route, /operationalDemandSiteAuthorized/);
  }
});
test("hard-disposable guard accepts only synthetic allowlist and refuses every changed selector", () => {
  assert.deepEqual(requireDisposablePosDemand(safe), [11, 12, 14]);
  for (const [key, value] of Object.entries(safe)) {
    assert.throws(() => requireDisposablePosDemand({ ...safe, [key]: undefined }), /POS_DEMAND_REFUSED|AssertionError/, key);
    assert.throws(() => requireDisposablePosDemand({ ...safe, [key]: "unsafe" }), /POS_DEMAND_REFUSED|AssertionError/, key);
    assert.equal(typeof value, "string");
  }
});
test("reject non-local database/server and provider credentials before DB imports", () => {
  const bad = [
    { DATABASE_URL: "postgresql://prod.internal.example.com/company" },
    { SECURITY_SMOKE_URL: "https://production.example.com" },
    { TENANT_TABLE_ALLOWLIST_FIXTURE: "/tmp/leaked.json" },
    { WFM_LOYVERSE_POS_ALLOWED_ORGANIZATION_IDS: "*" },
    { WFM_SQUARE_SANDBOX_ALLOWED_ORGANIZATION_IDS: "11,12" },
    { WFM_OPERATIONAL_DEMAND_ALLOWED_ORGANIZATION_IDS: "14,11,12" },
    { XENDIT_PAYOUTS_ENABLED: "true" }, { WORKER_ENABLED: "true" },
    { WFM_LOYVERSE_ACCESS_TOKEN: "real-bearer-secret" },
    { WFM_SQUARE_SANDBOX_ACCESS_TOKEN: "real-bearer-secret" },
    { PAYMONGO_SECRET_KEY: "not-allowed" },
  ];
  for (const change of bad) assert.throws(() => requireDisposablePosDemand({ ...safe, ...change }));
});
test("both read surfaces bind actual employer/site/source and a populated SQL batch", () => {
  for (const provider of Object.keys(POS_PROVIDERS)) {
    assert.equal(assertOwnGet(get(provider), actor, provider, site), undefined);
    const cases = [
      { scope: { ...get(provider).json.scope, organizationId: 14 } },
      { scope: { ...get(provider).json.scope, worksiteId: 99 } },
      { scope: { ...get(provider).json.scope, sourceKey: "forged" } },
      { lastStoredRevisionRows: 0 }, { lastStoredImportAt: null },
    ];
    for (const change of cases) {
      const wrong = get(provider); wrong.json = { ...wrong.json, ...change };
      wrong.text = JSON.stringify(wrong.json);
      assert.throws(() => assertOwnGet(wrong, actor, provider, site));
    }
    const unsafeCache = get(provider);
    unsafeCache.headers = new Headers({ "cache-control": "public, max-age=3600" });
    assert.throws(() => assertOwnGet(unsafeCache, actor, provider, site));
  }
});
test("both POST success checks reject empty/mislabeled provider scans and bad status", () => {
  for (const provider of Object.keys(POS_PROVIDERS)) {
    for (const dry of [true, false]) {
      assert.equal(assertOwnPost(post(provider, dry), provider, dry), undefined);
      for (const jsonPatch of [
        { source: "other-tenant" }, { changedIntervals: 0 },
        { applied: dry }, { readOnly: !dry },
        { [provider === "loyverse" ? "countedSales" : "completedPayments"]: 0 },
      ]) {
        const wrong = post(provider, dry);
        wrong.json = { ...wrong.json, ...jsonPatch };
        assert.throws(() => assertOwnPost(wrong, provider, dry));
      }
    }
  }
});
test("denied response must carry exact HTTP code without successful object or victim marker", () => {
  const good = { status: 403, json: { error: "Tenant denied" },
    text: '{"error":"Tenant denied"}', headers: new Headers() };
  assert.equal(assertPosDenial(good, 403, ["PRIVATE-VICTIM"]), undefined);
  for (const wrong of [
    { ...good, status: 404 },
    { ...good, json: { error: "denied", source: "loyverse_pos_sales" } },
    { ...good, text: "PRIVATE-VICTIM" },
    { ...good, headers: new Headers({ "x-debug": "PRIVATE-VICTIM" }) },
  ]) assert.throws(() => assertPosDenial(wrong, 403, ["PRIVATE-VICTIM"]));
  assert.throws(() => assertNoForeignLeak(get("square"), ["square_sandbox_payments"]));
});
test("required count ratchet rejects green partial or duplicated positive evidence", () => {
  assert.equal(assertCompletePosDemandCounts({ ...REQUIRED_POS_DEMAND_COUNTS }), undefined);
  for (const key of Object.keys(REQUIRED_POS_DEMAND_COUNTS)) {
    assert.throws(() => assertCompletePosDemandCounts({
      ...REQUIRED_POS_DEMAND_COUNTS, [key]: REQUIRED_POS_DEMAND_COUNTS[key] - 1,
    }), /INCOMPLETE/);
  }
});
test("offline provider interception is mandatory on all three app boots, no manifest credit", () => {
  const mock = readFileSync("scripts/qa/tenant-pos-demand-provider-mock.cjs", "utf8");
  const runner = readFileSync("scripts/qa/tenant-pos-demand-http.mjs", "utf8");
  const workflow = readFileSync(".github/workflows/tenant-pos-demand-http.yml", "utf8");
  for (const required of [
    "POS_MOCK_BLOCKED_EXTERNAL_NETWORK", "api.loyverse.com",
    "connect.squareupsandbox.com", "originalFetch(input, init)",
    "WFM_POS_MOCK_ONLY",
  ]) assert.ok(mock.includes(required), "mock guard missing: " + required);
  for (const required of [
    "requireDisposablePosDemand()", "startServer(actor)",
    "readAllowlistPreseed(", "workforceDemandImportBatches",
    "workforceDemandObservationRevisions", "auditBusinessSnapshot(",
    "responseSwapRejected", "assertCompletePosDemandCounts(counts)",
    "newManifestCredits: 0",
  ]) assert.ok(runner.includes(required), "real HTTP proof missing: " + required);
  assert.ok(workflow.includes("node --import tsx scripts/qa/tenant-pos-demand-http.mjs"));
  assert.ok(!workflow.includes("tenant:repin --write"));
});
