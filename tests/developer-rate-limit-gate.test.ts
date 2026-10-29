import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { developerMutationRateLimitResponse } from "../src/lib/developer-rate-limit";

test("developer mutation fails closed if the limiter fell back to one process (allowed)", async () => {
  const response = developerMutationRateLimitResponse({
    mode: "single-instance", allowed: true, retryAfterMs: 0,
  });
  assert.equal(response?.status, 503);
  assert.equal(response?.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response?.json(), {
    error: "Developer security changes are temporarily unavailable.",
    code: "DEVELOPER_RATE_LIMIT_BACKEND_UNAVAILABLE",
  });
});

test("developer mutation fails closed if the process-local fallback denied", () => {
  const response = developerMutationRateLimitResponse({
    mode: "single-instance", allowed: false, retryAfterMs: 3500,
  });
  assert.equal(response?.status, 503, "A degraded backend cannot prove authoritative shared quota");
  assert.equal(response?.headers.get("Cache-Control"), "no-store");
});

test("developer mutation passes only an authoritative distributed allow", () => {
  assert.equal(developerMutationRateLimitResponse({
    mode: "distributed-postgres", allowed: true, retryAfterMs: 0,
  }), null);
});

test("developer mutation preserves an authoritative shared throttle", async () => {
  const response = developerMutationRateLimitResponse({
    mode: "distributed-postgres", allowed: false, retryAfterMs: 1501,
  });
  assert.equal(response?.status, 429);
  assert.equal(response?.headers.get("Cache-Control"), "no-store");
  assert.equal(response?.headers.get("Retry-After"), "2");
  assert.deepEqual(await response?.json(), {
    error: "Too many developer-security changes. Try again later.",
  });
});

test("every developer POST action is gated before credential/webhook behavior", () => {
  const route = readFileSync(new URL("../src/app/api/developer/route.ts", import.meta.url), "utf8");
  const limited = route.indexOf("developerMutationRateLimitResponse(mutationLimit)");
  const firstAction = route.indexOf('if (action === "create-key")');
  assert.ok(limited > 0 && firstAction > limited);
  assert.match(route, /if \(limiterDenied\) return limiterDenied;/);
  for (const action of ["create-key", "revoke-key", "create-webhook", "test-webhook"]) {
    assert.ok(route.includes('if (action === "' + action + '")'));
  }
});
