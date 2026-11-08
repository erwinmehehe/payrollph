import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  METHODS, requireDisposablePerformanceHr, assertDenied, assertEquivalentNotFound, assertNewOwnedRow,
} from "../scripts/qa/tenant-performance-hr-edge-contract.mjs";

const good = {
  CI: "true", GITHUB_ACTIONS: "true", TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  TENANT_PERFORMANCE_HR_EDGE_MODE: "fictional-disposable-only",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  DEMO_MODE: "false", WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false",
};

test("dedicated proof refuses non-disposable, hosted, provider, worker or production settings", () => {
  assert.doesNotThrow(() => requireDisposablePerformanceHr(good));
  for (const [key, value] of Object.entries({
    CI: "false", GITHUB_ACTIONS: "false", TENANT_SECOND_PASS_MODE: "",
    TENANT_PERFORMANCE_HR_EDGE_MODE: "",
    SECURITY_SMOKE_URL: "https://payroll.example.test",
    DATABASE_URL: "postgresql://postgres:postgres@prod.example.test/app_db",
    DEMO_MODE: "true", WORKER_ENABLED: "true",
    CENTRAL_SCHEDULER_ENABLED: "true", PAYMONGO_DISBURSEMENTS_ENABLED: "true",
    XENDIT_PAYOUTS_ENABLED: "true", XENDIT_BILLING_ENABLED: "true",
    PAYMONGO_SECRET_KEY: "bad", XENDIT_SECRET_KEY: "bad", RESEND_API_KEY: "bad",
    SMTP_URL: "smtp://external.example.test", NEON_DATABASE_URL: "bad",
    NODE_ENV: "production",
  })) {
    assert.throws(() => requireDisposablePerformanceHr({ ...good, [key]: value }),
      /PERFORMANCE_HR_EDGE_REFUSED/, key + " must fail closed");
  }
  for (const target of [
    "http://127.0.0.1:3030", "http://localhost:3000",
    "http://127.0.0.1:3000/other", "http://127.0.0.1:3000/?scope=all",
  ]) assert.throws(() => requireDisposablePerformanceHr({ ...good, SECURITY_SMOKE_URL: target }));
  for (const target of [
    "postgresql://postgres:postgres@127.0.0.1:5433/app_db",
    "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
    "postgresql://postgres:postgres@127.0.0.1:5432/app_db?host=prod.example.test",
  ]) assert.throws(() => requireDisposablePerformanceHr({ ...good, DATABASE_URL: target }));
});

test("negative HTTP contract rejects false successes and victim data leaks, including headers", () => {
  const denial = (status, text = '{"error":"Not found."}', headers = new Headers()) =>
    ({ status, text, headers });
  assert.doesNotThrow(() => assertDenied(denial(403), 403, ["VICTIM-SECRET"]));
  assert.throws(() => assertDenied(denial(200), 403), /incorrect refusal/);
  assert.throws(() => assertDenied(denial(403, "VICTIM-SECRET"), 403, ["VICTIM-SECRET"]), /foreign marker/);
  assert.throws(() => assertDenied(denial(403, "Denied", new Headers({ "x-victim": "VICTIM-SECRET" })),
    403, ["VICTIM-SECRET"]), /foreign marker/);
  assert.doesNotThrow(() => assertEquivalentNotFound(denial(404), denial(404)));
  assert.throws(() => assertEquivalentNotFound(denial(404), denial(403)), /incorrect refusal/);
  assert.throws(() => assertEquivalentNotFound(denial(404), denial(404, '{"error":"Different"}')),
    /indistinguishable/);
});

test("owned evidence requires a real persisted row, precise employer and discriminating data", () => {
  const before = [{ id: 1, organizationId: 2, title: "existing" }];
  const after = [...before, { id: 9, organizationId: 2, title: "ATTA new" }];
  const result = { status: 201, json: { id: 9, organizationId: 2, title: "ATTA new" } };
  assert.equal(assertNewOwnedRow(before, after, result, { organizationId: 2, title: "ATTA new" }).id, 9);
  assert.throws(() => assertNewOwnedRow(before, before, result, { organizationId: 2 }), /exactly one/);
  assert.throws(() => assertNewOwnedRow(before, after, { ...result, status: 200 }, { organizationId: 2 }));
  assert.throws(() => assertNewOwnedRow(before, after, result, { organizationId: 3 }));
  assert.throws(() => assertNewOwnedRow(before, after, result, { title: "ATTB new" }));
  assert.throws(() => assertNewOwnedRow(before, [...after, { id: 10, organizationId: 2 }], result, {}));
});

test("scope is exactly two POST methods with all supported action variants; no payroll routes", () => {
  assert.deepEqual(METHODS, {
    "POST performance/continuous": ["one_on_one", "feedback"],
    "POST performance/development-plans": ["plan", "milestone"],
  });
  for (const [route, actions] of Object.entries(METHODS)) {
    const file = "src/app/api/" + route.slice(5) + "/route.ts";
    const source = readFileSync(file, "utf8");
    const post = source.split("export async function POST")[1]?.split("export async function PATCH")[0];
    assert.ok(post, "POST handler must exist: " + file);
    const found = [...post.matchAll(/if \(entityType === "([^"]+)"\)/g)].map(m => m[1]);
    assert.deepEqual(found, actions, "new action branches need their own review and fixture");
    assert.match(post, /enforceSameOriginMutation\(request\)/);
    assert.match(post, /getSessionUser\(\)/);
    assert.match(post, /enforceSensitiveActionRateLimit\(request/);
  }
});

test("edge runner contains explicit own, peer-unit, real foreign, absent, revoked and immutable victim proof", () => {
  const source = readFileSync("scripts/qa/tenant-performance-hr-edge-http.mjs", "utf8");
  for (const marker of [
    "requireDisposablePerformanceHr(process.env)",
    "current_database()", "server_version_num",
    "seedEmployer(", "standaloneMakeSession",
    "performance/continuous", "performance/development-plans",
    "assertNewOwnedRow(", "assertEquivalentNotFound(",
    "peerWorker.id", "peerPlan.id", "victim.worker.id",
    "eq(t.userOrganizations.active, false)",
    "assert.deepEqual(await snapshot(victim.org.id), victimBefore",
    "coverageCredits: 0", "productionTested: false",
  ]) assert.ok(source.includes(marker), "missing evidence barrier: " + marker);
  assert.doesNotMatch(source, /DROP TABLE|TRUNCATE|DELETE FROM|payrollRuns\)\.set|employeePayProfiles\)\.set/);
});
