import assert from "node:assert/strict";
import test from "node:test";
import nextConfig from "../next.config";

test("employer-scoped readiness remains private despite the general API cache rule", async () => {
  const rules = await nextConfig.headers?.();
  assert.ok(Array.isArray(rules), "Next header rules must exist");
  const general = rules.findIndex((rule) => rule.source === "/api/:path*");
  const specific = rules.findIndex((rule) => rule.source === "/api/readiness/workspace");
  assert.ok(general >= 0, "General API cache rule must exist");
  assert.ok(specific > general,
    "Readiness must override the earlier general API policy on the actual wire");

  const policy = rules[specific].headers.find(
    (header) => header.key.toLowerCase() === "cache-control",
  )?.value;
  assert.ok(policy, "Readiness must explicitly declare its cache policy");
  assert.match(policy, /(?:^|,\s*)private(?:,|$)/);
  assert.match(policy, /(?:^|,\s*)no-store(?:,|$)/);
  assert.doesNotMatch(policy, /public/i);
});
