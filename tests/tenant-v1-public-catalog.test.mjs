import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  requireDisposableV1Catalog, assertV1PublicCatalog, assertV1CatalogEqual,
} from "../scripts/qa/tenant-v1-public-contract.mjs";

const file = "src/app/api/v1/route.ts";
function gitSha(source) {
  return createHash("sha1").update("blob " + Buffer.byteLength(source) + "\0" + source).digest("hex");
}
function response(json, status = 200) {
  return { status, json, text: JSON.stringify(json) };
}
function sample() {
  return {
    name: "Linaw Public API", version: "v1", openApi: "/openapi/v1.json",
    authentication: { scheme: "Bearer token" },
    endpoints: Array.from({ length: 6 }, (_, i) => ({ method: "GET", path: "/api/v1/endpoint-" + i })),
    webhooks: { events: [] },
  };
}

test("GET /api/v1 stays a reviewed static public-by-design method, never tenant data", () => {
  const source = readFileSync(file, "utf8");
  const manifest = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const entry = manifest.allApiRouteFiles[file];
  const method = entry.methods.find(m => m.name === "GET");
  assert.equal(method.status, "PUBLIC-BY-DESIGN");
  assert.equal(method.testedBy, null, "static public metadata is not a tenant-scoped COVERED credit");
  assert.match(method.reason, /tenant-independent|tenant data/i);
  assert.equal(entry.gitBlobSha, gitSha(source), "handler source must match its declared Git blob");
  assert.match(source, /export async function GET\(\)/);
  assert.match(source, /criticalReleaseFlagEnabled\("publicApiV1Extended"\)/);
  assert.match(source, /return Response\.json\(\{/);
  for (const unsafe of [
    /@\/db(?:\b|\/)/, /getSessionUser|assertOrganizationRole|getAccess/,
    /searchParams|request\.headers|cookies\(/, /organizationId|employeeId|legalEntityId|payrollRunId/,
    /process\.env|fetch\(|db\.select|pool\.query/,
  ]) {
    assert.doesNotMatch(source, unsafe,
      "public API metadata route must not start reading caller-selected tenant data");
  }
});

test("proof environment refuses non-CI, remote DB, provider credentials and live flags", () => {
  const safe = {
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
    TENANT_V1_PUBLIC_MODE: "isolated-ci-only",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    APP_BASE_URL: "https://payroll.example.test", DEMO_MODE: "false",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  };
  assert.doesNotThrow(() => requireDisposableV1Catalog(safe));
  for (const [name, value] of [
    ["GITHUB_ACTIONS", "false"], ["CI", "false"],
    ["TENANT_V1_PUBLIC_MODE", ""],
    ["DATABASE_URL", "postgresql://postgres:postgres@db.example.com/app_db"],
    ["SECURITY_SMOKE_URL", "https://example.com"],
    ["WORKER_ENABLED", "true"], ["XENDIT_BILLING_ENABLED", "true"],
    ["PAYMONGO_DISBURSEMENTS_ENABLED", "true"], ["RESEND_API_KEY", "live-secret"],
    ["PAYMONGO_SECRET_KEY", "live-secret"],
  ]) {
    assert.throws(() => requireDisposableV1Catalog({ ...safe, [name]: value }),
      /V1_CATALOG_REFUSED/, name);
  }
});

test("public catalog contract rejects empty, inaccurate, private or leaked responses", () => {
  assert.doesNotThrow(() => assertV1PublicCatalog(response(sample()), ["VICTIM-EMPLOYER"]));
  assert.throws(() => assertV1PublicCatalog(response(sample(), 401)), /200/);
  assert.throws(() => assertV1PublicCatalog(response({ ...sample(), endpoints: [] })), /catalog/);
  assert.throws(() => assertV1PublicCatalog(response(sample()), ["Linaw Public API"]), /employer/);
  assert.throws(() => assertV1PublicCatalog(response({
    ...sample(), authorizationDebug: "sk_live_123456789012345678901",
  })), /real API key/);
});

test("public catalog equality fails on caller-specific or tenant-specific data", () => {
  const baseline = response(sample());
  assert.doesNotThrow(() => assertV1CatalogEqual(baseline, response(sample())));
  assert.throws(() => assertV1CatalogEqual(baseline, response({
    ...sample(), organizationId: 42,
  })), /caller or tenant-specific|match exactly/);
});
