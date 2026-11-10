/**
 * Workspace readiness is an employer-only, read-only boundary.
 * No deployment, release, payroll approval, money or method credit is implied.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const ORIGIN = "http://127.0.0.1:3000";
export const API_PATH = "/api/readiness/workspace";
export const SOURCE_SHA = Object.freeze({
  "src/app/api/readiness/workspace/route.ts": "5fdf10244467ddee8e5ccd1e98f07930b2ce7086",
  "src/lib/workspace-readiness-boundary.ts": "782853dada317783100dd1ee40004fa7e6126244",
  "src/lib/access.ts": "08d3481dbd20279a4a8aef64f0932f79bec48444",
});

export function gitBlobSha(bytes) {
  const raw = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return createHash("sha1").update(Buffer.from("blob " + raw.length + "\0"))
    .update(raw).digest("hex");
}
export function requireDisposableWorkspaceReadiness(env = process.env) {
  const expected = {
    CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
    TENANT_WORKSPACE_READINESS_PROOF: "fictional-pg16-only",
    BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    APP_BASE_URL: ORIGIN, SECURITY_SMOKE_URL: ORIGIN,
    TRUSTED_APP_ORIGINS: ORIGIN,
    DEMO_MODE: "false", REQUIRE_PRIVILEGED_MFA: "true",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false", FINAL_PAY_SIGNED_REVIEW_ENABLED: "false",
  };
  for (const [key, value] of Object.entries(expected)) assert.equal(env[key], value,
    "WORKSPACE_READINESS_REFUSED: unsafe " + key);
  for (const key of [
    "PAYMONGO_SECRET_KEY", "PAYMONGO_WEBHOOK_SECRET", "XENDIT_SECRET_KEY",
    "XENDIT_PAYOUT_SECRET_KEY", "STRIPE_SECRET_KEY", "RESEND_API_KEY",
    "POSTMARK_SERVER_TOKEN", "SMTP_URL", "SMTP_PASSWORD",
    "OPENAI_API_KEY", "CRON_SECRET", "WORKER_TOKEN",
  ]) assert.ok(!env[key], "WORKSPACE_READINESS_REFUSED: external secret " + key);
  return true;
}

export function verifyReadinessSources(root = process.cwd()) {
  for (const [file, sha] of Object.entries(SOURCE_SHA)) {
    assert.equal(gitBlobSha(readFileSync(root + "/" + file)), sha,
      "WORKSPACE_READINESS_REFUSED: source changed " + file);
  }
  const route = readFileSync(root + "/src/app/api/readiness/workspace/route.ts", "utf8");
  const loader = readFileSync(root + "/src/lib/workspace-readiness-boundary.ts", "utf8");
  assert.ok(route.indexOf("assertOrganizationRole(") <
    route.indexOf("buildTenantWorkspaceReadiness(organizationId)"),
    "Authorization must occur before employer queries");
  for (const needle of [
    "eq(organizations.id, organizationId)",
    "eq(employees.organizationId, organizationId)",
    "eq(payrollRuns.organizationId, organizationId)",
    "status: \"not-launch-ready\"",
    "ready: false",
  ]) assert.ok(loader.includes(needle), "Missing tenant/provisional boundary: " + needle);
  assert.equal(loader.includes("buildReadinessPayload"), false,
    "Platform-wide readiness must never be reused as a tenant loader");
  return true;
}

export function assertOwnedReadiness(response, organizationId, ownCounts) {
  assert.equal(response.status, 200, "Authenticated own employer must return HTTP 200");
  assert.match(response.headers.get("cache-control") ?? "", /\bno-store\b/);
  const body = response.json;
  assert.equal(body?.organizationId, organizationId);
  assert.equal(body?.status, "not-launch-ready");
  assert.equal(body?.manualLaunch?.ready, false);
  assert.ok(body?.launchBlockersRemaining > 0);
  assert.ok(body?.scaleGapsRemaining > 0);
  assert.equal(body?.evidence?.scope, "employer-only");
  assert.ok(ownCounts.employeeRecords > 0, "Own employer must have real roster rows");
  assert.deepEqual({
    employeeRecords: body.evidence.employeeRecords,
    payrollRunRecords: body.evidence.payrollRunRecords,
    employeesWithoutRestDay: body.evidence.employeesWithoutRestDay,
  }, ownCounts);
  assert.ok(Array.isArray(body.gates) && body.gates.some(g =>
    g.key === "external-pilot-acceptance" && g.blocks === "launch" && g.ready === false));
  assert.ok(body.gates.some(g =>
    g.key === "operational-scale-evidence" && g.ready === false));
  for (const forbidden of ["users","invoices","secrets","globalCounts",
    "bankAccount","tin","productionPilotSignoffs"]) {
    assert.equal(Object.hasOwn(body, forbidden), false,
      "No platform or employee-private field: " + forbidden);
  }
}
