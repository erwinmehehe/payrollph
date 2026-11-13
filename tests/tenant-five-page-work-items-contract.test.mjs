import assert from "node:assert/strict";
import test from "node:test";
import {
  ORIGIN, PINS, gitBlobSha, verifyWorkItemsSource, requireFictionalEnv,
  assertOwnedPage, assertOwnedApi, assertDenied,
} from "../scripts/qa/tenant-five-page-work-items-contract.mjs";
const safe = {
  CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
  TENANT_FIVE_PAGE_WORK_ITEMS: "fictional-pg16-only",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL: ORIGIN, SECURITY_SMOKE_URL: ORIGIN, TRUSTED_APP_ORIGINS: ORIGIN,
  DEMO_MODE: "false", MULTI_ENTITY_ENABLED: "false", NEXT_CSP_ENABLED: "false",
  REQUIRE_PRIVILEGED_MFA: "true", WORKER_ENABLED: "false",
  CENTRAL_SCHEDULER_ENABLED: "false", PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  FINAL_PAY_SIGNED_REVIEW_ENABLED: "false",
  EXACT_THIRTEENTH_CENTAVOS_ENABLED: "false", PAYROLL_CALCULATION_HISTORY_ENABLED: "false",
};
const a = { label: "ATTA", marker: "TTBL-ATTA-abc", org: { id: 8 } };
const b = { label: "VICTIM", marker: "TTBL-VICTIM-abc", org: { id: 10 } };
const result = (status, json, body = JSON.stringify(json || {})) =>
  ({ status, json, text: body });
test("local-only no-provider, no-payroll, no-CSP hard-refusal before DB imports", () => {
  assert.equal(requireFictionalEnv(safe), true);
  for (const override of [
    { CI: "false" }, { GITHUB_ACTIONS: "false" }, { NODE_ENV: "development" },
    { DATABASE_URL: "postgresql://postgres:postgres@production.invalid:5432/app_db" },
    { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/neondb" },
    { APP_BASE_URL: "https://real.invalid" }, { NEXT_CSP_ENABLED: "true" },
    { MULTI_ENTITY_ENABLED: "true" }, { WORKER_ENABLED: "true" },
    { PAYROLL_CALCULATION_HISTORY_ENABLED: "true" },
    { PAYMONGO_DISBURSEMENTS_ENABLED: "true" },
    { S3_SECRET_ACCESS_KEY: "fake" }, { OPENAI_API_KEY: "fake" },
  ]) assert.throws(() => requireFictionalEnv({ ...safe, ...override }));
});
test("all current source blobs and order guards are independently sealed", () => {
  assert.equal(Object.keys(PINS).length, 11);
  for (const sha of Object.values(PINS)) assert.match(sha, /^[0-9a-f]{40}$/);
  assert.equal(verifyWorkItemsSource(), true);
  assert.notEqual(gitBlobSha("tenant"), gitBlobSha("tenant!"));
});
test("fake own 200 or foreign data are never evidence", () => {
  const owned = result(200, { items: [
    { id: 17, organizationId: 8, title: a.marker + " protected HR case" },
  ] });
  assert.doesNotThrow(() => assertOwnedPage(result(200, null,
    "<h1>HR Work Queue</h1>Employer <strong>#8</strong>"), a, [b]));
  // React/Next SSR can split static "#" and dynamic employer ID.
  assert.doesNotThrow(() => assertOwnedPage(result(200, null,
    "<h1>HR Work Queue</h1>Employer <strong>#<!-- -->8</strong>"), a, [b]));
  for (const forged of [
    "<h1>HR Work Queue</h1>Employer <strong>#<!-- -->10</strong>",
    "<h1>HR Work Queue</h1>Employer <strong>#<!-- -->88</strong>",
    "<h1>HR Work Queue</h1>Employer <strong>#<!-- -->8</strong> " + b.marker,
    "<h1>HR Work Queue</h1>Employer <strong>8</strong>",
  ]) assert.throws(() => assertOwnedPage(result(200, null, forged), a, [b]));
  assert.doesNotThrow(() => assertOwnedApi(owned, a, [b], 17));
  for (const bad of [
    result(200, { items: [] }),
    result(200, { items: [{ id: 17, organizationId: 10, title: a.marker }] }),
    result(200, { items: [{ id: 17, organizationId: 8, title: b.marker }] }),
    result(404, { error: "missing" }),
  ]) assert.throws(() => assertOwnedApi(bad, a, [b], 17));
  assert.throws(() => assertOwnedPage(result(200, null, "<div>Generic shell</div>"), a, [b]));
  assert.throws(() => assertOwnedPage(result(200, null,
    "<h1>HR Work Queue</h1>Employer <strong>#8</strong> " + b.marker), a, [b]));
});
test("a denied page can never carry protected victim/owned data", () => {
  assert.doesNotThrow(() => assertDenied(result(404, { error: "Not found" }), 404, [a,b], "foreign"));
  assert.throws(() => assertDenied(result(200, { items: [] }), 404, [a,b], "fake"));
  assert.throws(() => assertDenied(result(404, { items: [{ id: 7 }] }), 404, [a,b], "private payload"));
  assert.throws(() => assertDenied(result(404, { error: b.marker }), 404, [a,b], "victim marker"));
});
