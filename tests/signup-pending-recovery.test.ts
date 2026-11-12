import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { rateLimit } from "../src/lib/rate-limit-memory";
import { signupRateLimitResponse } from "../src/lib/saas-launch-config";
import {
  expiredUnverifiedSignup, PENDING_SIGNUP_MAX_AGE_MS, GENERIC_SIGNUP_ACCEPTED,
  signupAcceptedResponse, signupLockKey, isSignupEmailConflict,
} from "../src/lib/signup-pending-recovery";

const now = Date.parse("2026-11-12T00:00:00.000Z");

test("only a never-verified inactive signup expires, including the exact 24-hour boundary", () => {
  const createdAt = new Date(now - PENDING_SIGNUP_MAX_AGE_MS);
  const pending = { active: false, verifiedAt: null, createdAt };
  assert.equal(PENDING_SIGNUP_MAX_AGE_MS, 24 * 60 * 60_000);
  assert.equal(expiredUnverifiedSignup(pending, now - 1), false);
  assert.equal(expiredUnverifiedSignup(pending, now), true);
  assert.equal(expiredUnverifiedSignup(pending, now + 1), true);
  assert.equal(expiredUnverifiedSignup({ ...pending, active: true }, now), false);
  assert.equal(expiredUnverifiedSignup({ ...pending, verifiedAt: new Date(now - 1) }, now), false);
  assert.equal(expiredUnverifiedSignup({ ...pending, createdAt: null }, now), false);
  assert.equal(expiredUnverifiedSignup({ ...pending, createdAt: new Date("invalid") }, now), false);
});

test("normal, duplicate, verified and invited acknowledgements have identical public shape", async () => {
  const responses = await Promise.all([1, 2, 3, 4].map(() => signupAcceptedResponse(Date.now() - 2000)));
  const samples = await Promise.all(responses.map(async r => ({
    status: r.status, headers: [...r.headers.entries()].sort(), body: await r.text(),
  })));
  for (const sample of samples) assert.deepEqual(sample, samples[0]);
  assert.equal(samples[0].status, 202);
  assert.deepEqual(JSON.parse(samples[0].body), GENERIC_SIGNUP_ACCEPTED);
  assert.equal(responses[0].headers.get("cache-control"), "no-store");
  assert.deepEqual(Object.keys(JSON.parse(samples[0].body)).sort(), ["message", "ok"]);
});

test("same normalized mailbox gets one transaction lock, unrelated mailboxes get distinct fixture keys", () => {
  assert.equal(signupLockKey("one@example.invalid"), signupLockKey("one@example.invalid"));
  assert.notEqual(signupLockKey("one@example.invalid"), signupLockKey("two@example.invalid"));
  const key = BigInt(signupLockKey("one@example.invalid"));
  assert.ok(key >= -(BigInt(1) << BigInt(63)) && key < (BigInt(1) << BigInt(63)));
});

test("wrapped unique-email conflicts are generic, not unrelated PostgreSQL failures", () => {
  const conflict = { code: "23505", constraint: "users_email_unique" };
  assert.equal(isSignupEmailConflict(conflict), true);
  assert.equal(isSignupEmailConflict({ cause: conflict }), true);
  assert.equal(isSignupEmailConflict({ cause: { cause: conflict } }), true);
  for (const other of [null, "23505", { code: "23505" }, { code: "23505", constraint: "other_unique" }, { code: "40P01" }]) {
    assert.equal(isSignupEmailConflict(other), false);
  }
  const cycle: { cause?: unknown } = {}; cycle.cause = cycle;
  assert.equal(isSignupEmailConflict(cycle), false);
});

test("an allowed in-memory rate-limit fallback still refuses signup", () => {
  const first = rateLimit("signup-finding-fictional", { limit: 1, windowMs: 60_000 });
  const second = rateLimit("signup-finding-fictional", { limit: 1, windowMs: 60_000 });
  assert.equal(first.mode, "single-instance");
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
  assert.equal(signupRateLimitResponse(first)?.status, 503);
  assert.equal(signupRateLimitResponse(first)?.headers.get("cache-control"), "no-store");
});

test("runtime guards retain expiry, one-use tokens and a consistent verification-before-owner lock order", () => {
  const signup = readFileSync("src/app/api/signup/route.ts", "utf8");
  const resend = readFileSync("src/app/api/signup/resend/route.ts", "utf8");
  const verify = readFileSync("src/app/api/signup/verify/route.ts", "utf8");
  assert.match(signup, /pg_advisory_xact_lock/);
  assert.ok(signup.indexOf("const [verification]") < signup.indexOf("const [owner]"));
  assert.match(signup, /eq\(users.active, false\)/);
  for (const source of [signup, resend, verify]) assert.match(source, /isNull\(saasSignupVerifications.verifiedAt\)/);
  for (const source of [resend, verify]) assert.match(source, /gt\(saasSignupVerifications.createdAt/);
  assert.match(verify, /gt\(saasSignupVerifications.expiresAt/);
  assert.doesNotMatch(signup, /status: 201|delivery: sent.delivered/);
});
