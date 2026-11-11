import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { rateLimit } from "../src/lib/rate-limit-memory";
import { signupRateLimitResponse } from "../src/lib/saas-launch-config";
import {
  expiredUnverifiedSignup, PENDING_SIGNUP_MAX_AGE_MS,
  GENERIC_SIGNUP_ACCEPTED, signupAcceptedResponse,
} from "../src/lib/signup-pending-recovery";

const now = Date.parse("2026-11-12T00:00:00.000Z");

test("only an unverified, inactive pending owner becomes reclaimable after a bounded time", () => {
  const older = new Date(now - PENDING_SIGNUP_MAX_AGE_MS - 1);
  const fresh = new Date(now - PENDING_SIGNUP_MAX_AGE_MS + 1);
  assert.equal(PENDING_SIGNUP_MAX_AGE_MS, 24 * 60 * 60_000);
  assert.equal(expiredUnverifiedSignup({ active: false, verifiedAt: null, createdAt: older }, now), true);
  assert.equal(expiredUnverifiedSignup({ active: false, verifiedAt: null, createdAt: fresh }, now), false);
  assert.equal(expiredUnverifiedSignup({ active: true, verifiedAt: null, createdAt: older }, now), false);
  assert.equal(expiredUnverifiedSignup({ active: false, verifiedAt: new Date(now - 1), createdAt: older }, now), false);
  assert.equal(expiredUnverifiedSignup({ active: false, verifiedAt: null, createdAt: null }, now), false);
  assert.equal(expiredUnverifiedSignup({ active: false, verifiedAt: null, createdAt: new Date("invalid") }, now), false);
});

test("normal, duplicate, verified and invited acknowledgements have identical public shape", async () => {
  const responses = await Promise.all([1, 2, 3, 4].map(() => signupAcceptedResponse(Date.now() - 2000)));
  const shape = async (r: Response) => ({ status: r.status, headers: [...r.headers.entries()].sort(), body: await r.text() });
  const samples = await Promise.all(responses.map(shape));
  for (const sample of samples) assert.deepEqual(sample, samples[0]);
  assert.equal(samples[0].status, 202);
  assert.equal(JSON.parse(samples[0].body).ok, true);
  assert.deepEqual(JSON.parse(samples[0].body), GENERIC_SIGNUP_ACCEPTED);
  assert.equal(responses[0].headers.get("Cache-Control"), "no-store");
  assert.ok(!samples[0].body.includes("activated"));
  assert.ok(!samples[0].body.includes("delivery"));
  assert.ok(!samples[0].body.includes("sign in using your account password"));
});

test("the in-memory distributed-rate-limit fallback cannot enable signup", () => {
  const first = rateLimit("signup-finding-fictional", { limit: 1, windowMs: 60_000 });
  const second = rateLimit("signup-finding-fictional", { limit: 1, windowMs: 60_000 });
  assert.equal(first.mode, "single-instance");
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
  const rejected = signupRateLimitResponse(first);
  assert.ok(rejected instanceof Response);
  assert.equal(rejected.status, 503, "even an allowed in-memory fallback refuses signup");
  assert.equal(rejected.headers.get("cache-control"), "no-store");
});

test("signup requires exact pending expiry and preserves one-use verification and active-account boundary", () => {
  const signup = readFileSync("src/app/api/signup/route.ts", "utf8");
  const resend = readFileSync("src/app/api/signup/resend/route.ts", "utf8");
  const verify = readFileSync("src/app/api/signup/verify/route.ts", "utf8");
  assert.match(signup, /expiredUnverifiedSignup/);
  assert.match(signup, /eq\(users.active, false\)/);
  assert.match(signup, /isNull\(saasSignupVerifications.verifiedAt\)/);
  assert.match(resend, /gt\(saasSignupVerifications.createdAt/);
  assert.match(resend, /isNull\(saasSignupVerifications.verifiedAt\)/);
  assert.match(verify, /gt\(saasSignupVerifications.createdAt/);
  assert.match(verify, /isNull\(saasSignupVerifications.verifiedAt\)/);
  assert.match(verify, /gt\(saasSignupVerifications.expiresAt/);
  assert.doesNotMatch(signup, /status: 201/);
  assert.doesNotMatch(signup, /delivery: sent.delivered/);
});
