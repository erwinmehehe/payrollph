import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { nonceContentSecurityPolicy } from "../src/lib/nonce-csp";

const nonce = Buffer.from("fixture-per-request-uuid").toString("base64");

test("production nonce policy bans unsafe inline scripts and eval", () => {
  const csp = nonceContentSecurityPolicy(nonce, false);
  assert.match(csp, /script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  assert.doesNotMatch(csp.match(/script-src [^;]+/)?.[0] ?? "", /unsafe-inline|unsafe-eval/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /upgrade-insecure-requests/);
  assert.equal((csp.match(/nonce-/g) ?? []).length, 1);
});

test("development-only eval stays gated; no arbitrary incoming nonce injection", () => {
  assert.match(nonceContentSecurityPolicy(nonce, true), /script-src [^;]*'unsafe-eval'/);
  for (const invalid of ["", "bad nonce", "<script>", "'; default-src *", "abc="]) {
    assert.throws(() => nonceContentSecurityPolicy(invalid), /CSP_NONCE_INVALID_BASE64/);
  }
});

test("proxy forwards the same generated CSP to Next rendering and the response", () => {
  const proxy = readFileSync("src/proxy.ts", "utf8");
  const nextConfig = readFileSync("next.config.ts", "utf8");
  const layout = readFileSync("src/app/layout.tsx", "utf8");
  assert.match(proxy, /headers\.set\("x-nonce", nonce\)/);
  assert.match(proxy, /headers\.set\("Content-Security-Policy", csp\)/);
  assert.match(proxy, /response\.headers\.set\("Content-Security-Policy", csp\)/);
  assert.match(proxy, /NEXT_CSP_ENABLED/);
  assert.match(proxy, /ENTITY_HCM_DEFERRED/);
  assert.match(nextConfig, /NEXT_CSP_ENABLED/);
  assert.match(nextConfig, /"Content-Security-Policy"/);
  assert.match(layout, /await connection\(\)/);
});
