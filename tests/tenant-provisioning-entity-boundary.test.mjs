import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { requireDisposableProvisioningEnv } from "../scripts/qa/tenant-provisioning-entity-http.mjs";

const route = readFileSync("src/app/api/provisioning/route.ts", "utf8");
const helper = readFileSync("src/lib/provisioning.ts", "utf8");
const get = route.slice(route.indexOf("export async function GET("),
  route.indexOf("export async function PATCH("));
const patch = route.slice(route.indexOf("export async function PATCH("));
const proof = readFileSync("scripts/qa/tenant-provisioning-entity-http.mjs", "utf8");
const wf = readFileSync(".github/workflows/tenant-provisioning-entity-qa.yml", "utf8");

test("GET authorizes legal employer before seeding cross-entity IT workflow or fetching workers", () => {
  const auth = get.indexOf("assertOrganizationRole(");
  const selected = get.indexOf("resolveMultiEntityContext(");
  const seeds = get.indexOf("await ensureLifecycleProvisioning(organizationId, legalEntityId, scopedUnitId)");
  const sql = get.indexOf("const [tasks, staff] = await Promise.all(");
  assert.ok(auth >= 0 && selected > auth && seeds > selected && sql > seeds);
  for (const check of [
    "if (!entity.ok) return entity.response",
    "entity.context.group || entity.context.legalEntityId === null",
    "entity.context.enabled ? entity.context.legalEntityId : null",
    "eq(employees.legalEntityId, legalEntityId)",
    "scopedUnitId === null ? undefined : eq(employees.orgUnitId, scopedUnitId)",
    "inArray(", "provisioningTasks.employeeId",
    "db.select({ id: employees.id }).from(employees).where(visibleWorkers)",
    "db.select().from(employees).where(visibleWorkers)",
  ]) assert.ok(get.includes(check), "GET must scope worker and task SQL: " + check);
  assert.ok(get.indexOf("eq(employees.legalEntityId, legalEntityId)") < sql,
    "Read SQL must receive the already authorized legal employer");
});

test("lifecycle lazy seeding restricts both onboarding and IT offboarding side effects", () => {
  const start = helper.indexOf("export async function ensureLifecycleProvisioning(");
  assert.ok(start >= 0);
  const body = helper.slice(start);
  for (const check of [
    "legalEntityId: number | null = null", "orgUnitId: number | null = null",
    "eq(employees.organizationId, organizationId)",
    "legalEntityId === null ? undefined : eq(employees.legalEntityId, legalEntityId)",
    "orgUnitId === null ? undefined : eq(employees.orgUnitId, orgUnitId)",
    'seedProvisioning(organizationId, employee.id, "onboarding")',
    'seedProvisioning(organizationId, employee.id, "offboarding")',
    "await requestOffboardingIT(organizationId, employee.id)",
  ]) assert.ok(body.includes(check), "Lazy seeding lost its scope: " + check);
  assert.ok(body.indexOf("const rows = await db.select()") <
    body.indexOf("for (const employee of rows)"),
    "Only the authorized SQL worker list may drive lazy seeding");
});

test("PATCH binds original task lookup and worker read to selected legal employer", () => {
  const role = patch.indexOf("assertOrganizationRole(");
  const selected = patch.indexOf("resolveMultiEntityContext(");
  const target = patch.indexOf("const [target] = await db.select(");
  const mutation = patch.indexOf("tx.update(provisioningTasks)");
  assert.ok(role >= 0 && selected > role && target > selected && mutation > target);
  for (const check of [
    "requested: body.legalEntityId",
    "if (!entity.ok) return entity.response",
    "entity.context.group || entity.context.legalEntityId === null",
    "eq(provisioningTasks.id, id)",
    "eq(provisioningTasks.organizationId, organizationId)",
    "eq(provisioningTasks.employeeId, employeeId)",
    "legalEntityId === null ? undefined : inArray(",
    "eq(employees.legalEntityId, legalEntityId)",
    'if (!target) return Response.json({ error: "Task not found." }, { status: 404 })',
    "assertScope(access, employee.orgUnitId)",
    'if (done && target.kind === "offboarding")',
    'target.title.startsWith("Revoke email")',
    'target.title.startsWith("Recover laptop")',
  ]) assert.ok(patch.includes(check), "Missing original safety gate or entity-bound lookup: " + check);
  assert.ok(patch.indexOf("legalEntityId === null ? undefined : inArray(") < mutation);
});

test("PATCH locks worker + legal employer, rechecks unit and entity before final update", () => {
  const start = patch.indexOf("const result = await db.transaction(async (tx) => {");
  const write = patch.indexOf("tx.update(provisioningTasks)");
  const tx = patch.slice(start, write);
  assert.ok(start >= 0 && write > start);
  for (const check of [
    "if (legalEntityId === null)",
    "for share", "and legal_entity_id = ",
    "const [freshEmployee] = await tx.select(",
    "legalEntityId === null ? undefined : eq(employees.legalEntityId, legalEntityId)",
    "assertScope(access, freshEmployee.orgUnitId)",
  ]) assert.ok(tx.includes(check), "Transaction lacks locked worker recheck: " + check);
  assert.ok(tx.indexOf("and legal_entity_id = ") <
    tx.indexOf("const [freshEmployee]") &&
    tx.indexOf("const [freshEmployee]") <
    tx.indexOf("assertScope(access, freshEmployee.orgUnitId)"));
  assert.ok(patch.slice(write).includes("eq(provisioningTasks.organizationId, organizationId)"));
  assert.ok(patch.slice(write).includes("eq(provisioningTasks.employeeId, employeeId)"));
  assert.ok(patch.slice(write).includes("recordAuditEvent({"));
});

test("fixture runs real signed-in own/foreign task reads and writes with unchanged victim snapshots", () => {
  for (const check of [
    "requireDisposableProvisioningEnv();",
    'fixture.seedEmployer("ATTA"',
    'fixture.seedEmployer("ATTB"',
    'fixture.seedEmployer("VICTIM"',
    "organizationId: a.org.id, userId: b.owner.id, legalEntityId: entityB.id",
    "victimTask.id > Math.max(taskA.id, taskB.id)",
    'const response = await call(readPath(actor.entity.id), actor.cookie)',
    'const success = await call(endpoint, actor.cookie, "PATCH", payload)',
    'const deniedForeign = await deny(actor, endpoint, 404, "PATCH", foreign)',
    "assert.deepEqual(deniedForeign.json, missingId.json",
    "await unchanged(before,",
    "unseededB.id",
    "await db.delete(schema.userLegalEntityGrants)",
    "assert.equal(ownReads, 2)", "assert.equal(ownWrites, 2)",
    "assert.equal(refused, 25)",
    "newCoverageCredits: 0",
    'independentSecurityReview: "PENDING"',
  ]) assert.ok(proof.includes(check), "Missing meaningful real HTTP/PG16 control: " + check);
  assert.ok(proof.indexOf("requireDisposableProvisioningEnv();") <
    proof.indexOf('import("../../src/db/index.ts")'),
    "No database or fixture import before environment refusal");
  for (const check of [
    "postgres:16", "npm run db:push",
    "node scripts/qa/apply-isolated-baseline.mjs", "npm run build",
    "npm run start -- --hostname 127.0.0.1 --port 3000",
    "node --import tsx scripts/qa/tenant-provisioning-entity-http.mjs",
    'MULTI_ENTITY_ENABLED: "true"', 'XENDIT_PAYOUTS_ENABLED: "false"',
    'PAYMONGO_DISBURSEMENTS_ENABLED: "false"',
    "github.event.pull_request.head.sha",
  ]) assert.ok(wf.includes(check), "Workflow missing exact-head/CI-only proof: " + check);
});

test("fixture refuses non-CI, non-local, provider or release-flag mismatch", () => {
  const safe = {
    CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
    TENANT_PROVISIONING_ENTITY_PROOF: "fictional-pg16-only",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    APP_BASE_URL: "http://127.0.0.1:3000",
    TRUSTED_APP_ORIGINS: "http://127.0.0.1:3000",
    BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
    MULTI_ENTITY_ENABLED: "true", DEMO_MODE: "false",
    REQUIRE_PRIVILEGED_MFA: "true", WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false", PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  };
  assert.equal(requireDisposableProvisioningEnv(safe), true);
  for (const changed of [
    { CI: "false" }, { GITHUB_ACTIONS: "false" },
    { NODE_ENV: "development" }, { MULTI_ENTITY_ENABLED: "false" },
    { DATABASE_URL: "postgresql://production.invalid/hr" },
    { SECURITY_SMOKE_URL: "https://production.invalid" },
    { TENANT_SECOND_PASS_MODE: "live" }, { WORKER_ENABLED: "true" },
    { XENDIT_PAYOUTS_ENABLED: "true" }, { PAYMONGO_SECRET_KEY: "secret" },
    { RESEND_API_KEY: "secret" },
  ]) assert.throws(() => requireDisposableProvisioningEnv({ ...safe, ...changed }),
    /PROVISIONING_ENTITY_REFUSED/);
});
