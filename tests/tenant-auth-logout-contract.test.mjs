import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AUTH_LOGOUT_METHOD, ROUTE_PATH, assertCookieCleared, assertLogoutOk, assertLogoutRefusal, assertRowsUnchanged,
  requireDisposableAuthLogout,
} from "../scripts/qa/tenant-auth-logout-contract.mjs";

const safeEnv = {
  GITHUB_ACTIONS: "true", CI: "true", TENANT_APPROVAL_TASK_MODE: "fictional-pg16-http", TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  NODE_ENV: "production", DEMO_MODE: "false", SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false", PAYMONGO_SECRET_KEY: "", XENDIT_SECRET_KEY: "", RESEND_API_KEY: "",
};

test("the proof names the method and route and carries no credit claim", () => {
  assert.equal(AUTH_LOGOUT_METHOD, "POST auth/logout");
  assert.equal(ROUTE_PATH, "/api/auth/logout");
});

test("the pre-import guard is the shared disposable-target contract", () => {
  assert.equal(requireDisposableAuthLogout(safeEnv), true);
  for (const change of [{ CI: "false" }, { NODE_ENV: "development" }, { WORKER_ENABLED: "true" }, { RESEND_API_KEY: "x" },
    { DATABASE_URL: "postgresql://postgres:postgres@neon.tech:5432/app_db" }]) {
    assert.throws(() => requireDisposableAuthLogout({ ...safeEnv, ...change }), /REFUSED/);
  }
});

test("a logout answer must be exactly { ok: true } with status 200", () => {
  assert.deepEqual(assertLogoutOk({ status: 200, text: "{}", json: { ok: true } }), { ok: true });
  assert.throws(() => assertLogoutOk({ status: 200, text: "{}", json: { ok: true, userId: 3 } }), "no extra field may be returned");
  assert.throws(() => assertLogoutOk({ status: 403, text: "{}", json: { ok: true } }));
});

test("the clearing cookie must be empty and already expired", () => {
  const cleared = new Headers();
  cleared.append("set-cookie", "__Host-linaw_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure");
  assert.ok(assertCookieCleared(cleared));
  const live = new Headers();
  live.append("set-cookie", "__Host-linaw_session=" + "A".repeat(43) + "; Path=/; HttpOnly");
  assert.throws(() => assertCookieCleared(live));
  assert.throws(() => assertCookieCleared(new Headers()));
});

test("a refusal must leak none of the forbidden values", () => {
  const refusal = (text) => ({ status: 403, text, json: null, headers: new Headers() });
  assert.equal(assertLogoutRefusal(refusal("{}"), 403, ["VICTIM-TOKEN"]), null);
  assert.throws(() => assertLogoutRefusal(refusal('{"t":"VICTIM-TOKEN"}'), 403, ["VICTIM-TOKEN"]));
  assert.throws(() => assertLogoutRefusal(refusal("{}"), 200, []));
});

test("snapshots must be identical row for row", () => {
  const before = { user: { id: 1 }, sessions: [{ id: 1, revokedAt: null }] };
  assert.equal(assertRowsUnchanged(before, structuredClone(before), "same"), undefined);
  assert.throws(() => assertRowsUnchanged(before, { ...before, sessions: [{ id: 1, revokedAt: "x" }] }, "changed"));
  assert.throws(() => assertRowsUnchanged(before, { user: before.user }, "removed"));
});

test("the harness proves own revocation, forged session IDs, no-ops, cross-site refusal and victim-unchanged, and never credits", () => {
  const harness = readFileSync("scripts/qa/tenant-auth-logout-http.mjs", "utf8");
  assert.ok(harness.indexOf("requireDisposableAuthLogout();") < harness.indexOf('import("../../src/db/index.ts")'), "guard before any DB import");
  for (const required of [
    "exactly the presented session is revoked", "the caller's other device still works", "sessionId: victimSession.id",
    "token: token(device.v.one)", "a cross-site logout must revoke nothing", "attacker A after anonymous and garbage logouts",
    "victim after both complete attacker journeys", "A's session evidence cannot satisfy B's", "logout replay must preserve every SQL field and the first revokedAt timestamp",
    "coverageCredits: 0", "independentlyAccepted: false", "for (let i = 0; i < 7; i++)",
  ]) assert.ok(harness.includes(required), "missing harness step " + required);
  assert.doesNotMatch(harness, /\bcoverageCredits: [1-9]/);
});

test("the workflow is fictional-only, path-scoped and runs the contract test and the harness", () => {
  const workflow = readFileSync(".github/workflows/tenant-auth-logout-http.yml", "utf8");
  for (const required of [
    "TENANT_APPROVAL_TASK_MODE: fictional-pg16-http", "image: postgres:16", "node --test tests/tenant-auth-logout-contract.test.mjs",
    "node --import tsx scripts/qa/tenant-auth-logout-http.mjs", "WORKER_ENABLED: 'false'", "XENDIT_PAYOUTS_ENABLED: 'false'",
    "persist-credentials: false", "contents: read", "'src/app/api/auth/logout/**'", "'scripts/qa/tenant-auth-logout-*.mjs'",
  ]) assert.ok(workflow.includes(required), "missing workflow content " + required);
  assert.doesNotMatch(workflow, /secrets\./);
});
