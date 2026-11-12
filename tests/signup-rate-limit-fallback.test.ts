import assert from "node:assert/strict";
import test from "node:test";

/** Fault injection only: the pool must never open a connection or deliver mail. */
test("actual distributed limiter failure reaches the in-memory fallback but signup fails before reading the body", async t => {
  const fixture = {
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    PUBLIC_SIGNUP_MODE: "pilot", APP_BASE_URL: "https://signup.example.invalid",
    TRUSTED_APP_ORIGINS: "https://signup.example.invalid", TRUSTED_PROXY_HOPS: "1",
    SMTP_URL: "smtp://127.0.0.1:2525", RESEND_API_KEY: "", POSTMARK_SERVER_TOKEN: "",
    PRIVATE_PILOT_INVITE_ENABLED: "false", VERCEL: "",
  };
  const prior = Object.fromEntries(Object.keys(fixture).map(key => [key, process.env[key]]));
  Object.assign(process.env, fixture);
  try {
    const { db, pool } = await import("../src/db");
    const noConnect = t.mock.method(pool, "connect", () => { throw new Error("NO_DATABASE_CONNECTION_ALLOWED"); });
    const outage = t.mock.method(db, "execute", () => { throw new Error("SYNTHETIC_DISTRIBUTED_LIMITER_OUTAGE"); });
    const noSelect = t.mock.method(db, "select", () => { throw new Error("ACCOUNT_LOOKUP_FORBIDDEN"); });
    const noTransaction = t.mock.method(db, "transaction", () => { throw new Error("ACCOUNT_WRITE_FORBIDDEN"); });
    const { rateLimitDistributed } = await import("../src/lib/rate-limit");
    const result = await rateLimitDistributed("signup-fallback-fixture", { limit: 4, windowMs: 60_000 });
    assert.equal(result.mode, "single-instance");
    assert.equal(result.allowed, true);
    const { POST } = await import("../src/app/api/signup/route");
    const request = new Request("https://signup.example.invalid/api/signup", {
      method: "POST", headers: { origin: "https://signup.example.invalid", "content-type": "application/json", "x-forwarded-for": "198.51.100.249" },
      body: "{}",
    });
    const noBody = t.mock.method(request, "json", async () => { throw new Error("BODY_MUST_NOT_BE_READ"); });
    const response = await POST(request);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: "Registration security check is temporarily unavailable." });
    assert.equal(outage.mock.callCount(), 2);
    for (const spy of [noConnect, noSelect, noTransaction, noBody]) assert.equal(spy.mock.callCount(), 0);
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
