import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertDenied, requireDisposableItPatch,
} from "../scripts/qa/tenant-it-operations-patch-http.mjs";

const env = {
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  APP_BASE_URL: "https://payroll.example.test",
  DEMO_MODE: "false", WORKER_ENABLED: "false",
  CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  REQUIRE_PRIVILEGED_MFA: "true",
};

test("IT PATCH proof refuses non-disposable DB/server, production flags and real credentials", () => {
  assert.doesNotThrow(() => requireDisposableItPatch(env));
  for (const [key, value] of [
    ["CI", "false"], ["GITHUB_ACTIONS", undefined],
    ["NODE_ENV", "development"], ["TENANT_SECOND_PASS_MODE", ""],
    ["DATABASE_URL", "postgresql://postgres:postgres@prod.example/app_db"],
    ["SECURITY_SMOKE_URL", "https://payroll.example.test"],
    ["WORKER_ENABLED", "true"], ["XENDIT_PAYOUTS_ENABLED", "true"],
    ["XENDIT_BILLING_ENABLED", "true"], ["REQUIRE_PRIVILEGED_MFA", "false"],
    ["PAYMONGO_SECRET_KEY", "live-secret"], ["SMTP_URL", "smtp://external.example"],
  ]) {
    const changed = { ...env, [key]: value };
    assert.throws(() => requireDisposableItPatch(changed), /EDG02_IT_REFUSED/,
      "Must refuse unsafe " + key);
  }
});

test("HTTP denial contract rejects wrong statuses and leaked victim body or headers", () => {
  const denied = (status, text = '{"error":"Not found."}', headers = new Headers()) =>
    ({ status, text, headers });
  assert.doesNotThrow(() => assertDenied(denied(404), 404, "SECRET-VICTIM", "foreign"));
  assert.throws(() => assertDenied(denied(200), 404, "SECRET-VICTIM", "foreign"), /unexpected status/);
  assert.throws(() => assertDenied(denied(403, "SECRET-VICTIM"), 403,
    "SECRET-VICTIM", "foreign"), /victim body leak/);
  assert.throws(() => assertDenied(denied(403, "Denied",
    new Headers({ "x-details": "SECRET-VICTIM" })), 403,
    "SECRET-VICTIM", "foreign"), /victim header leak/);
});

test("PATCH tenant authorization precedes either resource lookup and both lookups are employer-scoped", () => {
  const route = readFileSync("src/app/api/it-operations/route.ts", "utf8");
  const patch = route.slice(route.indexOf("export async function PATCH(request: Request)"));
  assert.ok(patch.startsWith("export async function PATCH("));
  const validate = patch.indexOf("if (!valid(id) || !valid(org))");
  const authorize = patch.indexOf("const auth = await context(user.id, org);");
  const grantLookup = patch.indexOf("const [grant] = await db.select().from(itAccessGrants)");
  const deviceLookup = patch.indexOf("const [device] = await db.select().from(itManagedDevices)");
  assert.ok(validate > 0 && authorize > validate && grantLookup > authorize &&
    deviceLookup > authorize, "selected employer must be authorized before either ID is fetched");
  const grantPart = patch.slice(grantLookup, deviceLookup);
  const devicePart = patch.slice(deviceLookup);
  assert.ok(grantPart.includes("eq(itAccessGrants.organizationId, org)"),
    "access-grant preflight must bind the caller-selected employer");
  assert.ok(devicePart.includes("eq(itManagedDevices.organizationId, org)"),
    "device preflight must bind the caller-selected employer");
  assert.ok(!patch.includes("context(user.id, grant.organizationId)"));
  assert.ok(!patch.includes("context(user.id, device.organizationId)"));
  assert.ok(!patch.includes("where(eq(itAccessGrants.id, id)).limit(1)"));
  assert.ok(!patch.includes("where(eq(itManagedDevices.id, id)).limit(1)"));
  for (const finalGuard of [
    "eq(itAccessGrants.organizationId, grant.organizationId)",
    "eq(itManagedDevices.organizationId, device.organizationId)",
    "eq(assets.organizationId, device.organizationId)",
  ]) {
    assert.ok(patch.includes(finalGuard), "final write must retain " + finalGuard);
  }
  assert.ok(patch.includes('resourceId: org + ":" + id'),
    "rate limit may not share an ID-only bucket between employers");
});

test("existing IT UI sends explicit selected employer on every write", () => {
  const ui = readFileSync("src/components/it-operations-panel.tsx", "utf8");
  assert.ok(ui.includes('fetch("/api/it-operations", { method'));
  assert.ok(ui.includes("body: JSON.stringify({ organizationId, ...body })"));
  assert.ok(ui.includes('write("PATCH", { action: "access"'));
  assert.ok(ui.includes('write("PATCH", { action: "device"'));
});
