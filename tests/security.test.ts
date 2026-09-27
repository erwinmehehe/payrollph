import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "../src/lib/crypto";
import { rateLimit } from "../src/lib/rate-limit-memory";
import { generateTotp, verifyTotp } from "../src/lib/totp";

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
