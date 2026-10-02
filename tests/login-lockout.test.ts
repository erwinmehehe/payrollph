import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  LOGIN_LOCKOUT_MS,
  LOGIN_LOCKOUT_THRESHOLD,
  currentLoginLock,
  nextFailedLoginState,
} from "../src/lib/login-lockout";

const NOW = Date.parse("2026-10-02T12:00:00Z");

test("account lockout starts at the configured failed-attempt threshold", () => {
  const before = nextFailedLoginState({
    failedLoginAttempts: LOGIN_LOCKOUT_THRESHOLD - 2,
    lockedUntil: null,
    now: NOW,
  });
  assert.equal(before.failedLoginAttempts, LOGIN_LOCKOUT_THRESHOLD - 1);
  assert.equal(before.lockedUntil, null);

  const threshold = nextFailedLoginState({
    failedLoginAttempts: LOGIN_LOCKOUT_THRESHOLD - 1,
    lockedUntil: null,
    now: NOW,
  });
  assert.equal(threshold.failedLoginAttempts, LOGIN_LOCKOUT_THRESHOLD);
  assert.equal(threshold.justLocked, true);
  assert.equal(threshold.lockedUntil?.getTime(), NOW + LOGIN_LOCKOUT_MS);
});

test("an active account lock blocks attempts until its expiry", () => {
  const lock = currentLoginLock(new Date(NOW + 60_000), NOW);
  assert.equal(lock.locked, true);
  assert.equal(lock.retryAfterMs, 60_000);

  const expired = currentLoginLock(new Date(NOW - 1), NOW);
  assert.deepEqual(expired, { locked: false, retryAfterMs: 0 });
});

test("a failed attempt after an expired lock starts a fresh failure window", () => {
  const failure = nextFailedLoginState({
    failedLoginAttempts: 999,
    lockedUntil: new Date(NOW - 1),
    now: NOW,
  });
  assert.equal(failure.failedLoginAttempts, 1);
  assert.equal(failure.lockedUntil, null);
});

test("login route enforces the durable lock and does not expose lock state", () => {
  const route = readFileSync("src/app/api/auth/login/route.ts", "utf8");
  assert.ok(route.includes("currentLoginLock(user.lockedUntil)"));
  assert.ok(route.includes("nextFailedLoginState"));
  assert.ok(!route.includes("lockedUntil: null,\n    }).where(eq(users.id, user.id));\n    return Response.json({ error: \"Invalid email or password.\" }"));
  assert.ok(route.includes('return Response.json({ error: "Invalid email or password." }, { status: 401 });'));
});
