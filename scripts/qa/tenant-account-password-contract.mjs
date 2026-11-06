import assert from "node:assert/strict";
import { requireDisposableApprovalTask } from "./tenant-approval-task-contract.mjs";

export const ACCOUNT_PASSWORD_METHOD = "POST account/password";
export const ACCOUNT_PASSWORD_TITLE = "tenant-account-password-isolation";
export const ROUTE_PATH = "/api/account/password";

/** The same disposable-target contract as the other fictional approval/account proofs. No database or app import may precede it. */
export function requireDisposableAccountPassword(env = process.env) {
  return requireDisposableApprovalTask(env);
}

export const SESSION_COOKIE_NAME = "__Host-linaw_session";

/** The replacement session cookie the route sets on a successful change. */
export function replacementCookie(headers) {
  const all = typeof headers?.getSetCookie === "function" ? headers.getSetCookie() : [];
  const found = all.find((value) => value.startsWith(SESSION_COOKIE_NAME + "="));
  assert.ok(found, "a successful password change must set a replacement session cookie");
  const value = found.slice(SESSION_COOKIE_NAME.length + 1).split(";")[0];
  assert.match(value, /^[A-Za-z0-9_-]{20,}$/, "the replacement cookie must carry a session token");
  return SESSION_COOKIE_NAME + "=" + value;
}

/** A successful own change: 200, a constant public body, no account detail. */
export function assertOwnPasswordChange(response, { otherSessionsRevoked }) {
  assert.equal(response?.status, 200, "own password change must succeed over HTTP: " + response?.text?.slice(0, 200));
  assert.deepEqual(Object.keys(response.json).sort(), ["message", "note", "ok", "otherSessionsRevoked"]);
  assert.equal(response.json.ok, true);
  assert.equal(response.json.otherSessionsRevoked, otherSessionsRevoked, "the number of the caller's own other sessions revoked");
  return response.json;
}

/** A refusal must not leak a password, hash, email or another account's data. */
export function assertPasswordRefusal(response, status, forbidden = []) {
  assert.equal(response?.status, status, "incorrect refusal status: " + response?.text?.slice(0, 200));
  assert.ok(response.json && typeof response.json.error === "string" && response.json.error.length, "a generic error is required");
  const body = response.text + "\n" + [...(response.headers ?? [])].map(([name, value]) => name + ":" + value).join("\n");
  assert.ok(!/scrypt\$/.test(body), "no password hash may appear in a response");
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
