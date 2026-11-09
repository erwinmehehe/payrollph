/**
 * Standalone HCM My Team SSR/API tenant-proof contract. Method and page ledger
 * statuses are unchanged: this is fictional-PG16 engineering evidence only.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const ORIGIN = "http://127.0.0.1:3000";
export const PAGE_PATH = "/hcm/my-team";
export const API_PATH = "/api/hcm/my-team";

export const SOURCE_PINS = Object.freeze({
  "src/app/hcm/my-team/page.tsx": "8f7386f007b7a498777ba2549d5fec27e3dd69b8",
  "src/app/api/hcm/my-team/route.ts": "5facc74efb3ae5bccb06777f72389c91f7cccc5c",
  "src/lib/hcm-my-team-server.ts": "3a4b978f7d822e51639ebf4167b81a47308ebc6b",
  "src/lib/hcm-my-team-contract.ts": "5bfde02d9b963fc5e8fe7b18a87bcaac17c73fed",
  "src/components/hcm-my-team.tsx": "77480e8e0cb83f21932d4cacf8fc1a24e29f973f",
  "src/lib/hcm-scoped-read-validation.ts": "b7f58511b0d732dd85a7335a0fbbe7002f9f8a6f",
  "src/lib/access.ts": "08d3481dbd20279a4a8aef64f0932f79bec48444",
  "src/lib/auth.ts": "b13275e0e09b629ddb679c55e7898da44c72ad20",
  "src/lib/permissions.ts": "9878a2ab0afb6f0b14a0e9c0e24a095a3f2e0288",
  "src/lib/organization-auth-policy.ts": "b38486fda78ac0da767bf79d7b9b6e9f4cfec08e",
  "scripts/qa/tenant-table-http.mjs": "31894982d768e34c1653be7c4335194f60233c6e",
});

export function gitBlobSha(bytes) {
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return createHash("sha1")
    .update(Buffer.from(`blob ${data.length}\0`)).update(data).digest("hex");
}

export function verifyMyTeamSourcePins(root = process.cwd()) {
  for (const [path, expected] of Object.entries(SOURCE_PINS)) {
    assert.equal(gitBlobSha(readFileSync(resolve(root, path))), expected,
      "MY_TEAM_REFUSED: reviewed exact source changed " + path);
  }
  const page = readFileSync(resolve(root, "src/app/hcm/my-team/page.tsx"), "utf8");
  const route = readFileSync(resolve(root, "src/app/api/hcm/my-team/route.ts"), "utf8");
  const loader = readFileSync(resolve(root, "src/lib/hcm-my-team-server.ts"), "utf8");
  for (const key of ["getSessionUser", "assertOrganizationRole(", "deriveMyTeamScope", "HCM_MY_TEAM_ENABLED"])
    assert.ok(page.includes(key), "MY_TEAM_REFUSED: page authorization missing " + key);
  for (const key of ["getSessionUser", "assertOrganizationRole(", "deriveMyTeamScope", "loadHcmMyTeam(", "HCM_MY_TEAM_ENABLED"])
    assert.ok(route.includes(key), "MY_TEAM_REFUSED: API authorization missing " + key);
  for (const key of [
    "eq(employees.organizationId, organizationId)",
    "eq(employees.orgUnitId, scope.orgUnitId)",
    "eq(leaveRequests.organizationId, organizationId)",
    "eq(overtimeRequests.organizationId, organizationId)",
    "eq(attendanceCorrectionRequests.organizationId, organizationId)",
    "eq(timePunches.organizationId, organizationId)",
    "gt(employees.id, cursor)", "PAGE_SIZE + 1",
  ]) assert.ok(loader.includes(key), "MY_TEAM_REFUSED: missing tenant-filtered source " + key);
  return true;
}

export function requireDisposableMyTeamEnv(env = process.env) {
  const required = {
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
    TENANT_HCM_MY_TEAM_PROOF: "fictional-pg16-only",
    BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    APP_BASE_URL: ORIGIN, SECURITY_SMOKE_URL: ORIGIN, TRUSTED_APP_ORIGINS: ORIGIN,
    HCM_MY_TEAM_ENABLED: "true", DEMO_MODE: "false",
    REQUIRE_PRIVILEGED_MFA: "true", WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false", FINAL_PAY_SIGNED_REVIEW_ENABLED: "false",
    EXACT_THIRTEENTH_CENTAVOS_ENABLED: "false", PAYROLL_CALCULATION_HISTORY_ENABLED: "false",
  };
  for (const [name, value] of Object.entries(required)) assert.equal(env[name], value,
    "MY_TEAM_REFUSED: unsafe " + name);
  for (const key of [
    "PAYMONGO_SECRET_KEY", "PAYMONGO_WEBHOOK_SECRET", "XENDIT_SECRET_KEY",
    "XENDIT_PAYOUT_SECRET_KEY", "XENDIT_CALLBACK_TOKEN", "STRIPE_SECRET_KEY",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_PASSWORD", "SMTP_URL",
    "OPENAI_API_KEY", "CRON_SECRET", "WORKER_TOKEN",
  ]) assert.ok(!env[key], "MY_TEAM_REFUSED: forbidden external provider secret " + key);
  return true;
}

export function assertNoMarkers(result, forbidden, label) {
  assert.equal(typeof result?.text, "string", label + ": HTTP body required");
  const decoded = result.text.replace(/\\u([0-9a-fA-F]{4})/g,
    (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
  for (const subject of forbidden) {
    assert.ok(!decoded.includes(subject.marker),
      label + ": disclosed private employer marker from " + subject.label);
  }
}

export function assertOwnedPage(result, actor, others) {
  assert.equal(result.status, 200, "Own signed-in SSR page must return 200");
  assert.ok(result.text.includes("My Team"), "My Team page shell must render");
  assert.ok(result.text.includes("organizationId=" + actor.org.id),
    "Own page must contain the authorized employer selector");
  assertNoMarkers(result, others, "own SSR");
}

export function assertOwnedApi(result, actor, others, expectedRows, scope,
  { cursor = 0, query = "", status = "all" } = {}) {
  assert.equal(result.status, 200, "Own source API must return HTTP 200");
  assert.ok(result.headers?.get("cache-control")?.includes("no-store"),
    "Private employee data must not be cached");
  const body = result.json;
  assert.equal(body?.organizationId, actor.org.id);
  assert.equal(body?.query, query);
  assert.equal(body?.statusFilter, status);
  assert.deepEqual(body?.scope, scope);
  assert.ok(Number.isFinite(Date.parse(body?.observedAt)),
    "Response must carry real observation timestamp");
  assert.ok(Array.isArray(body?.items) && expectedRows.length > 0 &&
    body.items.length === expectedRows.length,
  "An actual populated authorized source, not empty success or stub, is required");
  const wanted = [...expectedRows].sort((a,b) => a.id - b.id);
  assert.deepEqual(body.items.map(x => x.id), wanted.map(x => x.id),
    "Must return exactly the persisted authorized employee IDs in keyset order");
  assert.ok(body.items.every(x => x.id > cursor), "Cursor must exclude earlier employees");
  for (const row of body.items) {
    const expected = wanted.find(x => x.id === row.id);
    assert.ok(expected && row.employeeNo === expected.employeeNo &&
      row.status === expected.status &&
      row.name.includes(actor.marker),
      "Employee source, name, employer and status must match persisted rows");
    assert.equal(row.orgUnitIntegrity, "verified");
    assert.ok(row.orgUnitName?.includes(actor.marker), "Expected real authorized unit");
    assert.equal(row.pendingLeaveRecords, 1,
      "Only the one persisted pending source leave may appear");
    for (const key of [
      "pendingOvertimeRecords", "pendingAttendanceCorrections", "incompletePunchRecords",
    ]) assert.equal(row[key], 0, "No fictitious workflow action counts: " + key);
  }
  assert.equal(body.page?.size, 25);
  assert.equal(body.page?.hasMore, false);
  assert.equal(body.page?.nextCursor, null);
  assert.equal(body.summary?.employeeRecordsThisPage, wanted.length);
  assert.equal(body.summary?.pendingLeaveRecordsThisPage, wanted.length);
  for (const key of ["pendingOvertimeRecordsThisPage",
    "pendingAttendanceCorrectionsThisPage", "incompletePunchRecordsThisPage"])
    assert.equal(body.summary?.[key], 0);
  assertNoMarkers(result, others, "own API");
  for (const privateValue of [
    actor.privateBank, actor.privateTax, actor.privateLeaveReason,
  ]) assert.ok(!result.text.includes(privateValue),
    "Private employee payroll, tax or leave reason must not leak");
}

export function assertDenied(result, expectedCode, allSubjects, label) {
  assert.equal(result.status, expectedCode, label + ": exact refusal status required");
  assert.ok(!result.json?.items, label + ": denied response cannot contain employees");
  assertNoMarkers(result, allSubjects, label);
}

export function assertUnchangedSql(before, after, label) {
  assert.deepEqual(after, before, label + ": GET/denial mutated scoped SQL");
}
