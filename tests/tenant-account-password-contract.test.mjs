import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ACCOUNT_PASSWORD_METHOD, ROUTE_PATH, assertOwnPasswordChange, assertPasswordRefusal, assertRowsUnchanged, replacementCookie,
  requireDisposableAccountPassword,
} from "../scripts/qa/tenant-account-password-contract.mjs";

const safeEnv = {
  GITHUB_ACTIONS: "true", CI: "true", TENANT_APPROVAL_TASK_MODE: "fictional-pg16-http", TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  NODE_ENV: "production", DEMO_MODE: "false", SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false", PAYMONGO_SECRET_KEY: "", XENDIT_SECRET_KEY: "", RESEND_API_KEY: "",
};
const ok = (change = {}) => ({ status: 200, text: "{}", json: { ok: true, message: "Password updated.", otherSessionsRevoked: 1, note: "n", ...change } });

test("the proof names the method and the route and is never a credit by itself", () => {
  assert.equal(ACCOUNT_PASSWORD_METHOD, "POST account/password");
  assert.equal(ROUTE_PATH, "/api/account/password");
});

test("the pre-import guard is the shared disposable-target contract", () => {
  assert.equal(requireDisposableAccountPassword(safeEnv), true);
  for (const change of [{ CI: "false" }, { NODE_ENV: "development" }, { WORKER_ENABLED: "true" }, { RESEND_API_KEY: "x" },
    { DATABASE_URL: "postgresql://postgres:postgres@neon.tech:5432/app_db" }]) {
    assert.throws(() => requireDisposableAccountPassword({ ...safeEnv, ...change }), /REFUSED/);
  }
});

test("an own change must be a constant public body with the exact own-session revocation count", () => {
  assert.ok(assertOwnPasswordChange(ok(), { otherSessionsRevoked: 1 }));
  assert.throws(() => assertOwnPasswordChange(ok({ otherSessionsRevoked: 2 }), { otherSessionsRevoked: 1 }));
  assert.throws(() => assertOwnPasswordChange(ok({ email: "a@b.c" }), { otherSessionsRevoked: 1 }), "no extra account field may be returned");
  assert.throws(() => assertOwnPasswordChange({ ...ok(), status: 422 }, { otherSessionsRevoked: 1 }));
});

test("a refusal is a generic error with no hash and none of the forbidden values", () => {
  const refusal = (text, extra = {}) => ({ status: 422, text, json: { error: "Password not changed.", ...extra }, headers: new Headers() });
  assert.ok(assertPasswordRefusal(refusal('{"error":"Password not changed."}'), 422, ["VICTIM-SECRET"]));
  assert.throws(() => assertPasswordRefusal(refusal('{"error":"x","hash":"scrypt$1$2"}'), 422, []));
  assert.throws(() => assertPasswordRefusal(refusal('{"error":"x","v":"VICTIM-SECRET"}'), 422, ["VICTIM-SECRET"]));
  assert.throws(() => assertPasswordRefusal(refusal("{}"), 401, []));
});

test("the replacement cookie is parsed from Set-Cookie and a missing one fails", () => {
  const headers = new Headers();
  headers.append("set-cookie", "__Host-linaw_session=" + "A".repeat(43) + "; Path=/; HttpOnly; Secure");
  assert.equal(replacementCookie(headers), "__Host-linaw_session=" + "A".repeat(43));
  assert.throws(() => replacementCookie(new Headers()));
});

test("snapshots must be identical row for row", () => {
  const before = { user: { id: 1, passwordHash: "h" }, sessions: [{ id: 1 }] };
  assert.equal(assertRowsUnchanged(before, structuredClone(before), "same"), undefined);
  assert.throws(() => assertRowsUnchanged(before, { ...before, user: { id: 1, passwordHash: "h2" } }, "changed"));
  assert.throws(() => assertRowsUnchanged(before, { user: before.user }, "removed"));
});

test("the harness proves own change, victim password as current, forged principals, session revocation and victim-unchanged, and never credits", () => {
  const harness = readFileSync("scripts/qa/tenant-account-password-http.mjs", "utf8");
  assert.ok(harness.indexOf("requireDisposableAccountPassword();") < harness.indexOf('import("../../src/db/index.ts")'), "guard before any DB import");
  for (const required of [
    "currentPassword: oldPassword.v", "...forged(victim)", "the victim's password is not the attacker's current password",
    "the caller's other device is revoked", "the replacement session works", "exactly one own audit row", "the audit row holds no password material",
    "victim after both complete attacker journeys", "A's change must not satisfy B's own-object proof",
    "coverageCredits: 0", "independentlyAccepted: false", "for (let i = 0; i < 7; i++)",
  ]) assert.ok(harness.includes(required), "missing harness step " + required);
  assert.doesNotMatch(harness, /\bcoverageCredits: [1-9]/);
});

test("the workflow is fictional-only, path-scoped and runs the contract test and the harness", () => {
  const workflow = readFileSync(".github/workflows/tenant-account-password-http.yml", "utf8");
  for (const required of [
    "TENANT_APPROVAL_TASK_MODE: fictional-pg16-http", "image: postgres:16", "node --test tests/tenant-account-password-contract.test.mjs",
    "node --import tsx scripts/qa/tenant-account-password-http.mjs", "WORKER_ENABLED: 'false'", "XENDIT_PAYOUTS_ENABLED: 'false'",
    "persist-credentials: false", "contents: read", "'src/app/api/account/**'", "'scripts/qa/tenant-account-password-*.mjs'",
  ]) assert.ok(workflow.includes(required), "missing workflow content " + required);
  assert.doesNotMatch(workflow, /secrets\./);
});
