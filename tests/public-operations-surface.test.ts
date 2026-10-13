import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("anonymous status page never serializes historical or latency diagnostics", () => {
  const page = read("src/app/status/page.tsx");
  assert.match(page, /select\(\{ ok: healthSnapshots\.ok \}\)/);
  assert.doesNotMatch(page, /\blatencyMs\b|\bsummarizeUptime\b|rows\.map\(/);
  assert.match(page, /Detailed measurements and historical diagnostics are available to authorized operators only/);
});

test("health API keeps detailed timing behind monitor authentication", () => {
  const route = read("src/app/api/health/route.ts");
  assert.match(route, /recordSnapshot \? \{ ok: true, latencyMs \} : \{ ok: true \}/);
  assert.match(route, /recordSnapshot \? \{ ok: false, latencyMs \} : \{ ok: false \}/);
  assert.match(route, /"Cache-Control": "no-store"/);
});

test("real HTTP security smoke asserts unauthenticated responses for every S-9 endpoint", () => {
  const smoke = read("scripts/security-http-smoke.ts");
  for (const path of [
    "/api/capabilities",
    "/api/status",
    "/api/health",
    "/api/readiness",
    "/api/readiness/billing",
    "/api/readiness/deployment",
    "/api/readiness/pilot-status",
    "/api/readiness/workspace",
    "/api/billing",
    "/api/billing/subscription",
    "/status",
  ]) {
    assert.ok(smoke.includes('"' + path + '"'), path + " is missing from the HTTP visibility suite");
  }
  assert.match(smoke, /anonymous access must be denied/);
  assert.match(smoke, /public health must not disclose latency/);
  assert.match(smoke, /public status exposes only up\/down/);
  assert.match(smoke, /public status HTML must not expose historical or latency diagnostics/);
});
