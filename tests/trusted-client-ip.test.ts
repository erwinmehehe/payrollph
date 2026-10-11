import assert from "node:assert/strict";
import test from "node:test";
import { clientIp, rateLimit, requestMeta } from "../src/lib/rate-limit-memory";

const previousEnv = {
  VERCEL: process.env.VERCEL,
  TRUSTED_PROXY_HOPS: process.env.TRUSTED_PROXY_HOPS,
};

function restore(name: keyof typeof previousEnv) {
  const value = previousEnv[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function withProxySettings(vercel: string | undefined, hops: string | undefined, check: () => void) {
  if (vercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = vercel;
  if (hops === undefined) delete process.env.TRUSTED_PROXY_HOPS;
  else process.env.TRUSTED_PROXY_HOPS = hops;
  try { check(); } finally { restore("VERCEL"); restore("TRUSTED_PROXY_HOPS"); }
}

const request = (headers: Record<string, string>) => new Request("https://payroll.example.com/login", { headers });

test("Vercel-provided client IP is stable when a caller spoofs X-Forwarded-For", () => {
  withProxySettings("1", undefined, () => {
    const first = request({ "x-vercel-forwarded-for": "203.0.113.9", "x-forwarded-for": "10.1.2.3" });
    const second = request({ "x-vercel-forwarded-for": "203.0.113.9", "x-forwarded-for": "198.51.100.77" });
    assert.equal(clientIp(first), "203.0.113.9");
    assert.equal(clientIp(second), clientIp(first));
    assert.equal(requestMeta(first).ip, "203.0.113.9");
    const key = "spoofed-forwarded-for:" + clientIp(first);
    assert.equal(rateLimit(key, { limit: 2 }).allowed, true);
    assert.equal(rateLimit(key, { limit: 2 }).allowed, true);
    assert.equal(rateLimit("spoofed-forwarded-for:" + clientIp(second), { limit: 2 }).allowed, false);
  });
});

test("a Vercel deployment can use the platform-overwritten X-Forwarded-For fallback", () => {
  withProxySettings("1", undefined, () => {
    assert.equal(clientIp(request({ "x-forwarded-for": "198.51.100.10" })), "198.51.100.10");
    assert.equal(clientIp(request({ "x-vercel-forwarded-for": "invalid", "x-forwarded-for": "203.0.113.1" })), "203.0.113.1");
  });
});

test("self-hosted deployments ignore all client-supplied proxy headers by default", () => {
  withProxySettings(undefined, undefined, () => {
    const fake = request({ "x-forwarded-for": "198.51.100.101", "x-real-ip": "198.51.100.102", "x-vercel-forwarded-for": "203.0.113.2" });
    assert.equal(clientIp(fake), "unknown");
    assert.equal(clientIp(request({ "x-forwarded-for": "203.0.113.7" })), "unknown");
    assert.equal(clientIp(request({})), "unknown");
  });
});

test("configured trusted reverse proxies use only the correct right-side hop", () => {
  withProxySettings(undefined, "1", () => {
    assert.equal(clientIp(request({ "x-forwarded-for": "198.51.100.200, 203.0.113.9" })), "203.0.113.9");
    assert.equal(clientIp(request({ "x-forwarded-for": "anything, 203.0.113.9" })), "203.0.113.9");
  });
  withProxySettings(undefined, "2", () => {
    assert.equal(clientIp(request({ "x-forwarded-for": "192.0.2.60, 198.51.100.1, 203.0.113.9" })), "198.51.100.1");
    assert.equal(clientIp(request({ "x-forwarded-for": "203.0.113.9" })), "unknown");
  });
});

test("invalid trusted-hop configuration and malformed IPs fail closed", () => {
  for (const config of ["0", "9x", "-1", "99", "100", "1.0"]) {
    withProxySettings(undefined, config, () => {
      assert.equal(clientIp(request({ "x-forwarded-for": "203.0.113.9" })), "unknown");
    });
  }
  withProxySettings(undefined, "1", () => {
    assert.equal(clientIp(request({ "x-forwarded-for": "203.0.113.9, attacker" })), "unknown");
    assert.equal(clientIp(request({ "x-real-ip": "203.0.113.9" })), "unknown");
    assert.equal(clientIp(request({ "x-forwarded-for": "2001:db8::1" })), "2001:db8::1");
  });
});
