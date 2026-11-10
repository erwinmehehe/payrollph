import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  ORIGIN, SOURCE_SHA, gitBlobSha,
  requireDisposableWorkspaceReadiness, verifyReadinessSources,
  assertOwnedReadiness,
} from "../scripts/qa/tenant-workspace-readiness-contract.mjs";

const env = {
  CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
  TENANT_WORKSPACE_READINESS_PROOF: "fictional-pg16-only",
  BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL: ORIGIN, SECURITY_SMOKE_URL: ORIGIN, TRUSTED_APP_ORIGINS: ORIGIN,
  DEMO_MODE: "false", REQUIRE_PRIVILEGED_MFA: "true",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false", FINAL_PAY_SIGNED_REVIEW_ENABLED: "false",
};
test("refuse any production, worker, money, provider or off-host proof configuration", () => {
  assert.equal(requireDisposableWorkspaceReadiness(env), true);
  for (const change of [
    { GITHUB_ACTIONS: "false" }, { CI: "false" },
    { NODE_ENV: "development" }, { TENANT_WORKSPACE_READINESS_PROOF: "production" },
    { BUILD_BLOCK_ACCEPTANCE_MODE: "real" },
    { DATABASE_URL: "postgresql://admin@remote.invalid/payroll" },
    { APP_BASE_URL: "https://production.invalid" },
    { TRUSTED_APP_ORIGINS: "https://production.invalid" },
    { DEMO_MODE: "true" }, { REQUIRE_PRIVILEGED_MFA: "false" },
    { WORKER_ENABLED: "true" }, { CENTRAL_SCHEDULER_ENABLED: "true" },
    { PAYMONGO_DISBURSEMENTS_ENABLED: "true" }, { XENDIT_PAYOUTS_ENABLED: "true" },
    { XENDIT_BILLING_ENABLED: "true" },
    { PAYMONGO_SECRET_KEY: "forbidden" }, { OPENAI_API_KEY: "forbidden" },
    { WORKER_TOKEN: "forbidden" },
  ]) assert.throws(() => requireDisposableWorkspaceReadiness({ ...env, ...change }),
    /WORKSPACE_READINESS_REFUSED/);
});
const counts = { employeeRecords: 4, payrollRunRecords: 3, employeesWithoutRestDay: 1 };
const owned = {
  organizationId: 19, status: "not-launch-ready",
  manualLaunch: { ready: false, summary: "Not signed off" },
  launchBlockersRemaining: 1, scaleGapsRemaining: 1,
  evidence: { scope: "employer-only", ...counts },
  gates: [
    { key: "external-pilot-acceptance", ready: false, blocks: "launch" },
    { key: "operational-scale-evidence", ready: false, blocks: "scale" },
  ],
};
const response = (status, body = owned, cache = "private, no-store") => ({
  status, json: body, text: JSON.stringify(body),
  headers: new Headers({ "cache-control": cache }),
});
test("only populated own-employer HTTP 200 is a candidate, never a ready claim", () => {
  assert.doesNotThrow(() => assertOwnedReadiness(response(200), 19, counts));
  for (const bad of [
    response(503), response(403), response(200, { ...owned, organizationId: 999 }),
    response(200, { ...owned, status: "launch-ready" }),
    response(200, { ...owned, manualLaunch: { ready: true, summary: "Unverified" } }),
    response(200, { ...owned, evidence: { scope: "employer-only",
      employeeRecords: 45, payrollRunRecords: 3, employeesWithoutRestDay: 1 } }),
    response(200, { ...owned, gates: [] }),
    response(200, { ...owned, invoices: 1 }),
    response(200, owned, "public, max-age=60"),
  ]) assert.throws(() => assertOwnedReadiness(bad, 19, counts));
  assert.throws(() => assertOwnedReadiness(response(200), 19,
    { ...counts, employeeRecords: 0 }));
});
test("reviewed runtime gate, helper and access boundaries are exact-blob pinned", () => {
  assert.equal(Object.keys(SOURCE_SHA).length, 3);
  for (const sha of Object.values(SOURCE_SHA)) assert.match(sha, /^[a-f0-9]{40}$/);
  assert.notEqual(gitBlobSha("tenant"), gitBlobSha("tenant changed"));
  assert.equal(verifyReadinessSources(), true);
});

test("RDY-01: one canonical employer selector; no duplicate-key fallback", () => {
  const route = readFileSync("src/app/api/readiness/workspace/route.ts", "utf8");
  assert.ok(route.includes('searchParams.getAll("organizationId").length === 1'));
  assert.ok(route.includes(String.raw`/^[1-9]\d*$/.test(rawOrganizationId)`));
  assert.ok(route.indexOf('searchParams.getAll("organizationId")') <
    route.indexOf('await assertOrganizationRole('));
});
