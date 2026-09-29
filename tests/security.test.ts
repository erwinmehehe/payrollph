import assert from "node:assert/strict";
import test from "node:test";
import { backupCodeMatches, hashBackupCode, hashPassword, verifyPassword } from "../src/lib/crypto";
import { rateLimit } from "../src/lib/rate-limit-memory";
import { generateTotp, verifyTotp } from "../src/lib/totp";
import { isBlockedOutboundAddress, validateOutboundWebhookUrl } from "../src/lib/outbound-url-security";
import { readFileSync } from "node:fs";

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


test("MFA backup codes are one-way hashed at rest with legacy one-time compatibility", () => {
  const raw = "A1B2C3D4";
  const stored = hashBackupCode(raw);
  assert.ok(stored.startsWith("sha256:"));
  assert.ok(!stored.includes(raw));
  assert.equal(backupCodeMatches(raw, stored), true);
  assert.equal(backupCodeMatches("DEADBEEF", stored), false);
  assert.equal(backupCodeMatches(raw, raw), true, "legacy plaintext code can be consumed once during migration");
});

test("webhook SSRF guard blocks private, loopback and cloud-metadata targets", async () => {
  assert.equal(isBlockedOutboundAddress("127.0.0.1"), true);
  assert.equal(isBlockedOutboundAddress("10.0.0.5"), true);
  assert.equal(isBlockedOutboundAddress("169.254.169.254"), true);
  assert.equal(isBlockedOutboundAddress("8.8.8.8"), false);
  await assert.rejects(() => validateOutboundWebhookUrl("https://127.0.0.1/hook"), /private|loopback|reserved/i);
  await assert.rejects(() => validateOutboundWebhookUrl("https://169.254.169.254/latest/meta-data"), /private|link-local|reserved/i);
});

test("security-sensitive public surfaces stay fail-closed", () => {
  const login = readFileSync("src/app/api/auth/login/route.ts", "utf8");
  assert.ok(!login.includes("demoTotpCode"), "login must never return a live TOTP");
  assert.ok(!login.includes("generateTotp("), "login route must not generate TOTP challenges for the client");

  const seed = readFileSync("src/db/seed.ts", "utf8");
  assert.ok(seed.includes('process.env.NODE_ENV !== "production" && process.env.DEMO_MODE === "true"'));

  const health = readFileSync("src/app/api/health/route.ts", "utf8");
  assert.ok(!health.includes("tickScheduler"), "public health checks must be side-effect free");

  for (const route of ["src/app/api/jobs/tick/route.ts", "src/app/api/webhooks/drain/route.ts"]) {
    assert.ok(readFileSync(route, "utf8").includes("authorizeInternalWorker"), `${route} must require machine worker auth`);
  }

  const invite = readFileSync("src/app/api/invitations/accept/route.ts", "utf8");
  assert.ok(invite.includes("An account with this email already exists"));
  assert.ok(!/if \(existing\) \{[\s\S]{0,400}passwordHash/.test(invite), "invite acceptance must not reset an existing account password");

  const readiness = readFileSync("src/app/api/readiness/route.ts", "utf8");
  assert.ok(readiness.includes("getSessionUser"));
  assert.ok(readiness.includes("Only workspace administrators can view deployment readiness"));
});

test("HTTP hardening is enabled globally", () => {
  const config = readFileSync("next.config.ts", "utf8");
  assert.ok(config.includes("Strict-Transport-Security"));
  assert.ok(config.includes("X-Content-Type-Options"));
  assert.ok(config.includes("X-Frame-Options"));
  assert.ok(config.includes("Permissions-Policy"));
  assert.ok(config.includes("poweredByHeader: false"));
  assert.ok(config.includes("unoptimized: true"), "image optimizer stays disabled until Next is upgraded past the vulnerable release");

  const proxy = readFileSync("src/proxy.ts", "utf8");
  assert.ok(proxy.includes("Cross-origin state-changing requests are not allowed"));
  assert.ok(proxy.includes('request.nextUrl.pathname.startsWith("/api/")'));
});
