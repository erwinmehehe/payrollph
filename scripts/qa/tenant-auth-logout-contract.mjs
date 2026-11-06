import assert from "node:assert/strict";
import { requireDisposableApprovalTask } from "./tenant-approval-task-contract.mjs";

export const AUTH_LOGOUT_METHOD = "POST auth/logout";
export const AUTH_LOGOUT_TITLE = "tenant-auth-logout-isolation";
export const ROUTE_PATH = "/api/auth/logout";
export const SESSION_COOKIE_NAME = "__Host-linaw_session";

/** The shared disposable-target contract. No database or application import may precede it. */
export function requireDisposableAuthLogout(env = process.env) {
  return requireDisposableApprovalTask(env);
}

/** A logout answers the same constant body whether a session existed, was already revoked or was never valid. */
export function assertLogoutOk(response) {
  assert.equal(response?.status, 200, "logout must answer 200: " + response?.text?.slice(0, 200));
  assert.deepEqual(response.json, { ok: true }, "logout must return only { ok: true }");
  return response.json;
}

/** The response clears the session cookie (empty value, already expired). */
export function assertCookieCleared(headers) {
  const all = typeof headers?.getSetCookie === "function" ? headers.getSetCookie() : [];
  const found = all.find((value) => value.startsWith(SESSION_COOKIE_NAME + "="));
  assert.ok(found, "logout must set a clearing cookie");
  assert.match(found, new RegExp("^" + SESSION_COOKIE_NAME + "=;"), "the cleared cookie must have an empty value");
  assert.match(found, /expires=Thu, 01 Jan 1970/i, "the cleared cookie must be expired");
  return found;
}

/** A refusal must be a generic error that leaks no session token. */
export function assertLogoutRefusal(response, status, forbidden = []) {
  assert.equal(response?.status, status, "incorrect refusal status: " + response?.text?.slice(0, 200));
  const body = response.text + "\n" + [...(response.headers ?? [])].map(([name, value]) => name + ":" + value).join("\n");
  for (const marker of forbidden) {
    assert.ok(typeof marker === "string" && marker.length > 0, "missing forbidden marker");
    assert.ok(!body.includes(marker), "a forbidden value leaked into a refusal");
  }
  return response.json;
}

/** Rows keyed by name must be identical (JSON) before and after. */
export function assertRowsUnchanged(before, after, label) {
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), label + ": row set changed");
  for (const name of Object.keys(before)) assert.deepEqual(after[name], before[name], label + ": " + name + " changed");
}
