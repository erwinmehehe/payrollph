import assert from "node:assert/strict";
import test from "node:test";
import { clientIp, rateLimit } from "../src/lib/rate-limit-memory";

const request = (headers: Record<string, string> = {}) =>
  new Request("https://payroll.example/api/auth/login", { headers });

test("Vercel IP resolution ignores attacker-controlled forwarded and real-IP headers", () => {
  const req = request({
    "x-vercel-forwarded-for": "203.0.113.88",
    "x-forwarded-for": "8.8.8.8, 9.9.9.9",
    "x-real-ip": "1.1.1.1",
  });
  assert.equal(clientIp(req, { VERCEL: "1" }), "203.0.113.88");
});

test("on Vercel missing or malformed platform IP fails to a shared bucket", () => {
  const headers = [
    { "x-forwarded-for": "198.51.100.22" },
    { "x-vercel-forwarded-for": "spoofed@example.com" },
    { "x-vercel-forwarded-for": "198.51.100.22:not-an-ip" },
  ];
  for (const h of headers) assert.equal(clientIp(request(h), { VERCEL: "1" }), "unknown");
});

test("self-hosted direct requests never trust X-Forwarded-For or X-Real-IP", () => {
  for (const spoof of ["203.0.113.1", "203.0.113.2", "203.0.113.3"]) {
    const req = request({ "x-forwarded-for": spoof, "x-real-ip": spoof, "x-vercel-forwarded-for": spoof });
    assert.equal(clientIp(req, {}), "unknown");
  }
});

test("trusted one-hop proxy chooses its appended rightmost IP, not a spoofed left hop", () => {
  const env = { TRUSTED_PROXY_HOPS: "1" };
  for (const spoof of ["203.0.113.1", "203.0.113.2", "203.0.113.3"]) {
    const req = request({ "x-forwarded-for": `${spoof}, 198.51.100.17` });
    assert.equal(clientIp(req, env), "198.51.100.17");
  }
});

test("two trusted proxies select the first upstream IP appended by the trusted chain", () => {
  const req = request({ "x-forwarded-for": "8.8.8.8, 203.0.113.17, 198.51.100.240" });
  assert.equal(clientIp(req, { TRUSTED_PROXY_HOPS: "2" }), "203.0.113.17");
});

test("invalid proxy-hop config cannot be used to mint spoofed buckets", () => {
  for (const count of ["0", "-1", "not-set", "11", "1.2", " 1 "]) {
    assert.equal(clientIp(request({ "x-forwarded-for": "8.8.8.8, 9.9.9.9" }), { TRUSTED_PROXY_HOPS: count }), "unknown");
  }
  assert.equal(clientIp(request(), { TRUSTED_PROXY_HOPS: "1" }), "unknown");
});

test("a rotating forged header cannot reset the fallback in-memory bucket", () => {
  const opts = { limit: 2, windowMs: 60_000 };
  const prefix = `trusted-ip-regression:${Date.now()}:${Math.random()}`;
  for (const spoof of ["203.0.113.1", "203.0.113.2", "203.0.113.3"]) {
    const ip = clientIp(request({ "x-forwarded-for": spoof }), {});
    const outcome = rateLimit(`${prefix}:${ip}`, opts);
    assert.equal(outcome.allowed, spoof !== "203.0.113.3");
  }
});

test("both IPv4 and IPv6 supplied by a trusted proxy are supported", () => {
  assert.equal(clientIp(request({ "x-forwarded-for": "2001:db8::123" }), { TRUSTED_PROXY_HOPS: "1" }), "2001:db8::123");
  assert.equal(clientIp(request({ "x-vercel-forwarded-for": "2001:db8::10" }), { VERCEL: "1" }), "2001:db8::10");
});
