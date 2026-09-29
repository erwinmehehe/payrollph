import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { hashPassword, verifyPassword } from "../src/lib/crypto";
import { rateLimit } from "../src/lib/rate-limit-memory";
import { generateTotp, verifyTotp } from "../src/lib/totp";
import { isForbiddenIp } from "../src/lib/security-network";

// RFC 6238 Appendix B test vector (SHA1, 8 digits originally; we verify 6-digit mode with known secret)
// Using the standard secret "12345678901234567890" encoded in base32: GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("scrypt password hash verifies with timing-safe compare", () => {
  const hash = hashPassword("LinawDemo2026!");
  assert.equal(verifyPassword("LinawDemo2026!", hash), true);
  assert.equal(verifyPassword("wrong-password", hash), false);
});

test("TOTP generates and verifies within the current window", () => {
  const now = Date.UTC(2026, 2, 16, 8, 0, 0);
  const code = generateTotp(RFC_SECRET, undefined, now);
  assert.match(code, /^\d{6}$/);
  assert.equal(verifyTotp(code, RFC_SECRET, { now }), true);
  assert.equal(verifyTotp("000000", RFC_SECRET, { now }), false);
});

test("TOTP remains valid across a ±1 step window", () => {
  const now = Date.UTC(2026, 2, 16, 8, 0, 0);
  const previous = generateTotp(RFC_SECRET, Math.floor(now / 1000 / 30) - 1);
  assert.equal(verifyTotp(previous, RFC_SECRET, { now, window: 1 }), true);
});

test("single-instance rate limiter blocks after the configured threshold", () => {
  const key = `test-${Date.now()}-${Math.random()}`;
  for (let i = 0; i < 3; i += 1) {
    const result = rateLimit(key, { limit: 3, windowMs: 60_000 });
    assert.equal(result.allowed, true);
    assert.equal(result.mode, "single-instance");
  }
  const blocked = rateLimit(key, { limit: 3, windowMs: 60_000 });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
});


test("webhook network guard blocks private and metadata ranges", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.5",
    "::1",
    "fc00::1",
  ]) {
    assert.equal(isForbiddenIp(address), true, `${address} must be blocked`);
  }
  assert.equal(isForbiddenIp("8.8.8.8"), false);
  assert.equal(isForbiddenIp("1.1.1.1"), false);
});

test("public health check cannot execute scheduler work", () => {
  const source = readFileSync("src/app/api/health/route.ts", "utf8");
  assert.ok(!source.includes("tickScheduler"), "health route must be side-effect free");
});

test("production worker endpoints require WORKER_TOKEN", () => {
  for (const path of ["src/app/api/jobs/tick/route.ts", "src/app/api/webhooks/drain/route.ts"]) {
    const source = readFileSync(path, "utf8");
    assert.ok(source.includes('process.env.NODE_ENV === "production"'));
    assert.ok(source.includes("WORKER_TOKEN"));
    assert.ok(source.includes("constantTimeSecretEqual"));
  }
});

test("demo login never returns a generated TOTP code", () => {
  const source = readFileSync("src/app/api/auth/login/route.ts", "utf8");
  assert.ok(!source.includes("demoTotpCode"));
  assert.ok(!source.includes("generateTotp(user.totpSecret)"));
});

test("public demo cannot inherit the production host allow-list implicitly", () => {
  const source = readFileSync("src/app/api/auth/demo-switch/route.ts", "utf8");
  assert.ok(source.includes("rateLimitDistributed"));
  assert.ok(!source.includes("productionHost: process.env.VERCEL_PROJECT_PRODUCTION_URL"));
  assert.ok(source.includes('DEMO_MODE && process.env.NODE_ENV !== "production"'));
});

test("developer webhooks are SSRF-guarded and demo identities cannot mint credentials", () => {
  const developer = readFileSync("src/app/api/developer/route.ts", "utf8");
  const webhooks = readFileSync("src/lib/webhooks.ts", "utf8");
  assert.ok(developer.includes("validateWebhookTarget"));
  assert.ok(developer.includes("isDemoIdentity"));
  assert.ok(webhooks.includes("validateWebhookTarget(endpoint.url)"));
  assert.ok(webhooks.includes('redirect: "manual"'));
});

test("first-run production setup is token protected and serialized", () => {
  const source = readFileSync("src/app/api/setup/route.ts", "utf8");
  assert.ok(source.includes("SETUP_TOKEN"));
  assert.ok(source.includes("constantTimeSecretEqual"));
  assert.ok(source.includes("pg_advisory_xact_lock"));
});

test("password reset uses the shared password policy and rotates old links", () => {
  const reset = readFileSync("src/app/api/auth/reset-password/route.ts", "utf8");
  const forgot = readFileSync("src/app/api/auth/forgot-password/route.ts", "utf8");
  assert.ok(reset.includes("passwordIssues(password)"));
  assert.ok(forgot.includes("isNull(passwordResetTokens.usedAt)"));
});

test("baseline browser hardening headers are configured", () => {
  const source = readFileSync("next.config.ts", "utf8");
  for (const header of [
    "Content-Security-Policy",
    "X-Frame-Options",
    "X-Content-Type-Options",
    "Strict-Transport-Security",
  ]) {
    assert.ok(source.includes(header), `${header} must be configured`);
  }
});
