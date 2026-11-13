import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  ORIGIN, WRITE_SOURCE_PINS, requireDisposableHrWriteEnv,
  verifyHrWriteSourcePins, assertCreatedEmployeeCase, assertOwnCasePatch,
  assertDeniedCaseMutation, assertForeignSqlUnchanged, allProtectedEmployers,
} from "../scripts/qa/tenant-hr-cases-write-contract.mjs";

const safe = {
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
  TENANT_HR_CASE_PAGE_PROOF: "fictional-pg16-only",
  TENANT_HR_CASE_WRITE_PROOF: "fictional-pg16-post-patch-only",
  BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL: ORIGIN, SECURITY_SMOKE_URL: ORIGIN, TRUSTED_APP_ORIGINS: ORIGIN,
  EMPLOYEE_HR_CASES_ENABLED: "true", MULTI_ENTITY_ENABLED: "false",
  EMPLOYEE_DOCUMENT_VAULT_ENABLED: "false",
  DEMO_MODE: "false", REQUIRE_PRIVILEGED_MFA: "true",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false", FINAL_PAY_SIGNED_REVIEW_ENABLED: "false",
  EXACT_THIRTEENTH_CENTAVOS_ENABLED: "false",
  PAYROLL_CALCULATION_HISTORY_ENABLED: "false",
};
const actor = { label: "ATTA", marker: "TTBL-ATTA-fixture", org: { id: 8 },
  worker: { id: 23 } };
const victim = { label: "VICTIM", marker: "TTBL-VICTIM-fixture",
  org: { id: 10 }, worker: { id: 33 } };
const wrap = (status, payload) =>
  ({ status, json: payload, text: JSON.stringify(payload) });

test("source and safe CI proof mode are mandatory before DB imports", () => {
  assert.equal(requireDisposableHrWriteEnv(safe), true);
  for (const change of [
    { TENANT_HR_CASE_WRITE_PROOF: undefined }, { TENANT_HR_CASE_WRITE_PROOF: "live" },
    { GITHUB_ACTIONS: "false" }, { NODE_ENV: "development" },
    { DATABASE_URL: "postgresql://postgres:postgres@prod.invalid:5432/app_db" },
    { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/neondb" },
    { APP_BASE_URL: "https://app.example.invalid" },
    { EMPLOYEE_HR_CASES_ENABLED: "false" },
    { EMPLOYEE_DOCUMENT_VAULT_ENABLED: "true" },
    { MULTI_ENTITY_ENABLED: "true" }, { REQUIRE_PRIVILEGED_MFA: "false" },
    { S3_SECRET_ACCESS_KEY: "test" }, { OPENAI_API_KEY: "test" },
    { XENDIT_SECRET_KEY: "test" }, { WORKER_ENABLED: "true" },
  ]) assert.throws(() => requireDisposableHrWriteEnv({ ...safe, ...change }),
    /REFUSED|unsafe|wrong explicit proof mode/, JSON.stringify(change));
  assert.equal(Object.keys(WRITE_SOURCE_PINS).length, 5);
  for (const sha of Object.values(WRITE_SOURCE_PINS)) assert.match(sha, /^[0-9a-f]{40}$/);
  if (process.env.CI === "true" || existsSync("src/app/api/hr-cases/route.ts"))
    assert.equal(verifyHrWriteSourcePins(), true);
});

test("fake 201 and forged employer/worker/self-link cannot count as own POST", () => {
  const good = { case: { id: 41, organizationId: 8, employeeId: 23,
    createdByUserId: 90, caseType: "general", subject: actor.marker + " genuine question" } };
  assert.equal(assertCreatedEmployeeCase(wrap(201, good), actor, 90, "general"), 41);
  for (const invalid of [
    wrap(200, good),
    wrap(201, { ok: true }),
    wrap(201, { case: { ...good.case, id: "41" } }),
    wrap(201, { case: { ...good.case, organizationId: victim.org.id } }),
    wrap(201, { case: { ...good.case, employeeId: victim.worker.id } }),
    wrap(201, { case: { ...good.case, createdByUserId: 91 } }),
    wrap(201, { case: { ...good.case, subject: victim.marker } }),
  ]) assert.throws(() => assertCreatedEmployeeCase(invalid, actor, 90, "general"));
});

test("fake or unscoped 200 cannot count as successful PATCH", () => {
  assert.doesNotThrow(() => assertOwnCasePatch(
    wrap(200, { case: { id: 41, organizationId: 8 } }), 41, 8));
  for (const response of [
    wrap(403, { case: { id: 41, organizationId: 8 } }),
    wrap(200, {}),
    wrap(200, { case: { id: 42, organizationId: 8 } }),
    wrap(200, { case: { id: 41, organizationId: 10 } }),
  ]) assert.throws(() => assertOwnCasePatch(response, 41, 8));
});

test("foreign denials reject false positives, private case and leaked victim markers", () => {
  assert.doesNotThrow(() => assertDeniedCaseMutation(wrap(404, { error: "Case not found." }),
    404, [actor, victim], "real denial"));
  for (const response of [
    wrap(200, { case: { id: 48 } }),
    wrap(404, { case: { id: 48, organizationId: victim.org.id } }),
    wrap(404, { error: victim.marker }),
    wrap(403, { error: "Case not found." }),
  ]) assert.throws(() => assertDeniedCaseMutation(response, 404,
    [actor, victim], "forged denial"));
});

test("all three populated employers are protected even when only actor and target are selected", () => {
  const otherAttacker = { label: "ATTB", org: { id: 9 } };
  const everyone = [actor, otherAttacker, victim];
  const selected = allProtectedEmployers(everyone, [actor, victim]);
  assert.deepEqual(selected.map(item => item.org.id), [8, 9, 10],
    "Never drop unrelated victim or second attacker from a denial comparator");
  assert.equal(allProtectedEmployers(everyone, [otherAttacker]).length, 3);
  assert.throws(() => allProtectedEmployers([actor, { org: { id: 0 } }, victim]),
    /real employer ID/);
});

test("protect exact SQL snapshots, including audit and private messages", () => {
  const source = { cases: [{ id: 52 }], messages: [{ id: 99, body: "private" }],
    audit: [{ id: 71 }] };
  assert.doesNotThrow(() => assertForeignSqlUnchanged(source, structuredClone(source), "denial"));
  assert.throws(() => assertForeignSqlUnchanged(source,
    { ...source, audit: [] }, "audit changed"));
  assert.throws(() => assertForeignSqlUnchanged(source,
    { ...source, messages: [] }, "message changed"));
});

test("workflow enforces exact PR head, disposable PG16 and real production HTTP proof", () => {
  const path = ".github/workflows/tenant-hr-cases-write-qa.yml";
  if (!existsSync(path)) {
    assert.ok(process.env.CI !== "true", "CI missing new required PG16 job");
    return;
  }
  const yml = readFileSync(path, "utf8");
  for (const must of [
    "github.event.pull_request.head.sha", "git rev-parse HEAD",
    "postgres:16", "db:push", "apply-isolated-baseline.mjs",
    "npm run build", "--hostname 127.0.0.1",
    "tenant-hr-cases-write-http.mjs", "tenant-hr-cases-write-contract.test.mjs",
    "TENANT_HR_CASE_WRITE_PROOF:", "MULTI_ENTITY_ENABLED: \"false\"",
    "EMPLOYEE_DOCUMENT_VAULT_ENABLED: \"false\"",
    "scripts/qa/tenant-table-http.mjs", "src/lib/security-request.ts",
    "src/lib/auth.ts", "src/db/schema.ts", "package-lock.json",
  ]) assert.ok(yml.includes(must), "PG16 workflow missing " + must);
  assert.ok(!yml.includes("DATABASE_URL: ${{ secrets."),
    "Unsafe secret-backed database forbidden");
});
