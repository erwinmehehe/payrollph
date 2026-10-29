import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { publicApiV1RateGate } from "../src/lib/public-api-v1-rate-guard";

test("public API fails closed for either permitted or denied single-instance fallback", async () => {
  for (const allowed of [true, false]) {
    const decision = publicApiV1RateGate({
      allowed, remaining: allowed ? 19 : 0, retryAfterMs: allowed ? 0 : 4000,
      mode: "single-instance",
    });
    assert.ok(decision);
    assert.equal(decision.status, 503);
    assert.equal(decision.headers.get("Cache-Control"), "no-store");
    assert.equal(decision.headers.get("Retry-After"), null);
    assert.deepEqual(await decision.json(), { error: "Public API temporarily unavailable." });
  }
});

test("public API preserves an authoritative shared-limiter pass", () => {
  assert.equal(publicApiV1RateGate({
    allowed: true, remaining: 70, retryAfterMs: 0, mode: "distributed-postgres",
  }), null);
});

test("public API differentiates authoritative shared throttling from a limiter outage", async () => {
  const decision = publicApiV1RateGate({
    allowed: false, remaining: 0, retryAfterMs: 1501, mode: "distributed-postgres",
  });
  assert.ok(decision);
  assert.equal(decision.status, 429);
  assert.equal(decision.headers.get("Cache-Control"), "no-store");
  assert.equal(decision.headers.get("Retry-After"), "2");
  assert.deepEqual(await decision.json(), { error: "Rate limit exceeded." });
});

test("extended API authorization enforces the shared decision before API-key processing", () => {
  const source = readFileSync(new URL("../src/lib/public-api-v1-extended.ts", import.meta.url), "utf8");
  assert.match(source, /const rateDenied = publicApiV1RateGate\(limited\);/);
  assert.match(source, /if \(rateDenied\) return \{ ok: false, response: rateDenied \};/);
  assert.ok(source.indexOf("const rateDenied = publicApiV1RateGate(limited);") <
    source.indexOf("const auth = await authenticateApiKey(request);"));
  assert.equal((source.match(/rateLimitDistributed\(/g) ?? []).length, 1);
});
