/**
 * Standalone, source-pinned Worker 360 tenant/worker boundary proof.
 * Pins current Worker 360 runtime scope; historical page/API proof receipts
 * are not repurposed as multi-entity legal-employer acceptance.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const ORIGIN = "http://127.0.0.1:3000";
export const PAGE = "/hcm/worker-360";
export const API = "/api/hcm/worker-360";
export const AS_OF = "2026-11-09";

export const SOURCE_PINS = Object.freeze({
  "src/app/hcm/worker-360/page.tsx": "3b506b27e0af73ec370c448c6a0ad02a80c8f75c",
  "src/app/api/hcm/worker-360/route.ts": "19875021d750b722fc69e0fe939e57928a158af9",
  "src/lib/hcm-worker-360-server.ts": "eb96de991ca31589f195e3e4e10eeccaeccf8ec6",
  "src/lib/hcm-worker-360-contract.ts": "ed4741dab306ed2b4081bb4319f96d04f6462690",
  "src/lib/hcm-worker-360-projection.ts": "0890a4e22d1404152ffa7a5b5ab8c77c7c916e14",
  "src/lib/hcm-worker-360-response.ts": "9107293ba8692614fb721cddfd1c9351353ebefb",
  "src/components/hcm-worker-360.tsx": "13e10c357f6b744aa9280c1c8f5eb8a01ddd6878",
  "src/lib/hcm-enterprise-plan-server.ts": "b436a61f091871e02bb662393429667cadb71b35",
  "src/lib/hcm-enterprise-plan-policy.ts": "6c02b69e0b9a5526aa40ff3aa92ce09085866aba",
  "src/lib/access.ts": "08d3481dbd20279a4a8aef64f0932f79bec48444",
  "src/lib/auth.ts": "b13275e0e09b629ddb679c55e7898da44c72ad20",
  "src/lib/permissions.ts": "9878a2ab0afb6f0b14a0e9c0e24a095a3f2e0288",
  "src/lib/organization-auth-policy.ts": "b38486fda78ac0da767bf79d7b9b6e9f4cfec08e",
  "scripts/qa/tenant-table-http.mjs": "31894982d768e34c1653be7c4335194f60233c6e",
});

export function gitBlobSha(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`))
    .update(bytes).digest("hex");
}

export function verifyWorker360SourcePins(root = process.cwd()) {
  for (const [name, sha] of Object.entries(SOURCE_PINS)) {
    assert.equal(gitBlobSha(readFileSync(resolve(root, name))), sha,
      "WORKER360_REFUSED: exact reviewed source changed: " + name);
  }
  const page = readFileSync(resolve(root, "src/app/hcm/worker-360/page.tsx"), "utf8");
  const api = readFileSync(resolve(root, "src/app/api/hcm/worker-360/route.ts"), "utf8");
  const server = readFileSync(resolve(root, "src/lib/hcm-worker-360-server.ts"), "utf8");
  for (const required of [
    "getSessionUser()", "assertOrganizationRole(", "access?.companyWide",
    "HCM_WORKER_360_ENABLED", "denyOptInEnterpriseHcmPlan(",
    "eq(employees.organizationId, organizationId)",
    "eq(employees.id, employeeId)",
    "if (!verifiedWorker) notFound();",
    "eq(employees.legalEntityId, authorizedLegalEntityId)",
  ]) assert.ok(page.includes(required), "WORKER360_REFUSED: page guard missing: " + required);
  const authIndex = page.indexOf("await assertOrganizationRole(");
  const planIndex = page.indexOf("await denyOptInEnterpriseHcmPlan(organizationId)");
  const workerIndex = page.indexOf("const [verifiedWorker] = await db.select(");
  const renderIndex = page.indexOf("<Worker360Client");
  assert.ok(0 < authIndex && authIndex < planIndex &&
    planIndex < workerIndex && workerIndex < renderIndex,
    "WORKER360_REFUSED: employer, role and plan checks must precede the worker SQL existence probe, which must precede mounting the private client");

  for (const required of [
    "getSessionUser()", "assertOrganizationRole(", "access?.companyWide",
    "HCM_WORKER_360_ENABLED", "denyOptInEnterpriseHcmPlan(",
    "loadWorker360Summary(", "authorizedLegalEntityId",
    "resolveMultiEntityContext(",
  ]) assert.ok(api.includes(required), "WORKER360_REFUSED: API guard missing: " + required);
  for (const required of [
    "eq(employees.organizationId, organizationId)",
    "eq(employees.id, employeeId)",
    "eq(positionAssignments.organizationId, organizationId)",
    "eq(positionAssignments.employeeId, employeeId)",
    "eq(workerEmploymentEvents.organizationId, organizationId)",
    "eq(workerEmploymentEvents.employeeId, employeeId)",
    "lte(workerEmploymentEvents.effectiveDate, asOfDate)",
    "WORKER_360_EVENT_PAGE_SIZE + 1",
    "eq(employees.legalEntityId, authorizedLegalEntityId)",
    "eq(positions.legalEntityId, authorizedLegalEntityId)",
    "eq(workerEmploymentEvents.fromLegalEntityId, authorizedLegalEntityId)",
    "eq(workerEmploymentEvents.toLegalEntityId, authorizedLegalEntityId)",
  ]) assert.ok(server.includes(required),
    "WORKER360_REFUSED: SQL source boundary missing: " + required);
  return true;
}

export function requireDisposableWorker360Env(env = process.env) {
  const expected = {
    CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
    BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
    TENANT_HCM_WORKER360_PROOF: "fictional-pg16-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: ORIGIN, APP_BASE_URL: ORIGIN, TRUSTED_APP_ORIGINS: ORIGIN,
    HCM_WORKER_360_ENABLED: "true", HCM_ENTERPRISE_PLAN_GATE_ENABLED: "false",
    DEMO_MODE: "false", WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false", PAYROLL_CALCULATION_HISTORY_ENABLED: "false",
    EXACT_THIRTEENTH_CENTAVOS_ENABLED: "false", FINAL_PAY_SIGNED_REVIEW_ENABLED: "false",
    REQUIRE_PRIVILEGED_MFA: "true",
  };
  for (const [key, value] of Object.entries(expected))
    assert.equal(env[key], value, "WORKER360_REFUSED: unsafe or absent " + key);
  for (const key of [
    "PAYMONGO_SECRET_KEY", "PAYMONGO_WEBHOOK_SECRET", "XENDIT_SECRET_KEY",
    "XENDIT_PAYOUT_SECRET_KEY", "XENDIT_CALLBACK_TOKEN", "STRIPE_SECRET_KEY",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_PASSWORD", "SMTP_URL",
    "OPENAI_API_KEY", "CRON_SECRET", "WORKER_TOKEN", "MALWARE_SCAN_URL",
    "MALWARE_SCAN_TOKEN",
  ]) assert.ok(!env[key], "WORKER360_REFUSED: live provider/worker configuration " + key);
  return true;
}

export function assertNoForeignOrPrivateMarkers(result, others, actor, label) {
  assert.equal(typeof result?.text, "string", label + ": HTTP body required");
  const raw = result.text.replace(/\\u([0-9a-fA-F]{4})/g,
    (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
  for (const target of others) {
    assert.ok(!raw.includes(target.marker), label + ": foreign employer marker " + target.label);
  }
  for (const secret of [actor?.privateBank, actor?.privateTax, actor?.privateEventReason]) {
    if (secret) assert.ok(!raw.includes(secret), label + ": private employee source exposed");
  }
}

export function assertOwnPage(result, actor, employee, others) {
  assert.equal(result.status, 200, "Authenticated authorized Worker 360 SSR must succeed");
  for (const key of ["Worker 360", "Employer ID", "Worker ID",
    "organizationId=" + actor.org.id])
    assert.ok(result.text.includes(key), "SSR shell must identify authorized context " + key);
  assert.ok(result.text.includes(String(employee.id)),
    "SSR shell must identify authorized requested employee");
  assertNoForeignOrPrivateMarkers(result, others, actor, "own SSR");
}

export function assertOwnWorkerApi(result, actor, employee, assignment, events,
  others, { asOfDate = AS_OF, before = null } = {}) {
  assert.equal(result.status, 200, "Own populated worker query must be HTTP 200");
  assert.ok(result.headers?.get("cache-control")?.includes("no-store"),
    "Private worker response must disable caches");
  const x = result.json;
  assert.equal(x?.tenantId, actor.org.id);
  assert.equal(x?.employeeId, employee.id);
  assert.equal(x?.asOfDate, asOfDate);
  assert.ok(Number.isFinite(Date.parse(x?.observedAt)), "Must report source observation time");
  assert.equal(x?.worker?.source, "employees");
  assert.equal(x?.worker?.id, employee.id);
  assert.equal(x?.worker?.employeeNo, employee.employeeNo);
  assert.equal(x?.worker?.name, [employee.firstName, employee.lastName].join(" "));
  assert.equal(x?.worker?.currentTitle, employee.title);
  assert.equal(x?.worker?.currentStatus, employee.status);
  assert.equal(x?.worker?.startedOn, employee.startDate);
  assert.equal(x?.primaryAssignment?.source, "position_assignments");
  if (assignment) {
    assert.equal(x?.primaryAssignment?.selection?.status, "recorded");
    const a = x.primaryAssignment.selection.assignment;
    assert.equal(a?.id, assignment.id);
    assert.equal(a?.positionId, assignment.positionId);
    assert.equal(a?.assignmentType, "primary");
    assert.equal(a?.effectiveFrom, assignment.effectiveFrom);
    assert.equal(a?.effectiveUntil, assignment.effectiveUntil);
  } else {
    assert.deepEqual(x?.primaryAssignment?.selection,
      { status: "not_recorded", assignment: null });
  }
  assert.equal(x?.employmentEvents?.source, "worker_employment_events");
  const actual = x?.employmentEvents?.preview;
  assert.ok(actual && Array.isArray(actual.items));
  assert.deepEqual(actual.items.map(item => ({
    id: item.id, effectiveDate: item.effectiveDate, eventType: item.eventType,
    positionAssignmentId: item.positionAssignmentId,
  })), events.map(item => ({
    id: item.id, effectiveDate: item.effectiveDate, eventType: item.eventType,
    positionAssignmentId: item.positionAssignmentId,
  })), "Event history must match the exact authorized SQL source rows and keyset");
  assert.equal(actual.hasMore, false);
  assert.equal(actual.partial, false);
  assert.equal(actual.nextCursor, null);
  for (const item of actual.items) {
    assert.ok(item.effectiveDate <= asOfDate, "Future events cannot appear");
    if (before) assert.ok(item.effectiveDate < before.effectiveDate ||
      (item.effectiveDate === before.effectiveDate && item.id < before.id),
      "Event cursor must exclude later or equal events");
  }
  assertNoForeignOrPrivateMarkers(result, others, actor, "own API");
}

export function assertDenied(result, status, subjects, label) {
  assert.equal(result.status, status, label + ": exact refusal code");
  assert.ok(!result.json?.worker && !result.json?.employmentEvents,
    label + ": denied response must never contain worker history");
  assertNoForeignOrPrivateMarkers(result, subjects, null, label);
}

export function assertUnchangedSql(before, after, label) {
  assert.deepEqual(after, before, label + ": read request mutated protected SQL");
}
