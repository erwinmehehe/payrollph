import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../src/app/api/readiness/deployment/route";

test("private deployment metadata denies unauthenticated or forged calls", async () => {
  const previous = process.env.READINESS_TOKEN;
  const testToken = "private-readiness-probe-token-synthetic-test-2026";
  process.env.READINESS_TOKEN = testToken;
  try {
    const url = "https://payroll.example/api/readiness/deployment";
    const unauthenticated = await GET(new Request(url));
    assert.equal(unauthenticated.status, 404);
    assert.equal(unauthenticated.headers.get("Cache-Control"), "no-store");
    assert.ok(!JSON.stringify(await unauthenticated.json()).includes("deploymentSha"));

    const forged = await GET(new Request(url, {
      headers: { "x-readiness-token": "not-the-private-token" },
    }));
    assert.equal(forged.status, 404);

    const authorized = await GET(new Request(url, {
      headers: { "x-readiness-token": testToken },
    }));
    assert.equal(authorized.status, 200);
    assert.ok(Object.hasOwn(await authorized.json(), "deploymentSha"));
    assert.equal(authorized.headers.get("Cache-Control"), "no-store");
  } finally {
    if (previous === undefined) delete process.env.READINESS_TOKEN;
    else process.env.READINESS_TOKEN = previous;
  }
});

test("malformed readiness secret fails closed without exposing infrastructure", async () => {
  const previous = process.env.READINESS_TOKEN;
  process.env.READINESS_TOKEN = "weak";
  try {
    const response = await GET(new Request("https://payroll.example/api/readiness/deployment", {
      headers: { "x-readiness-token": "weak" },
    }));
    assert.equal(response.status, 503);
    const data = await response.json();
    assert.ok(!JSON.stringify(data).includes("deploymentSha"));
  } finally {
    if (previous === undefined) delete process.env.READINESS_TOKEN;
    else process.env.READINESS_TOKEN = previous;
  }
});

test("production smoke workers authenticate the private deployment probe", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const script = readFileSync("scripts/live-production-readiness.ts", "utf8");
  const workflow = readFileSync(".github/workflows/live-rbac-sandbox-smoke.yml", "utf8");
  assert.ok(script.includes('headers: { "x-readiness-token": token }'));
  assert.ok(script.includes('PRODUCTION_READINESS_TOKEN is required to verify a private production deployment'));
  assert.ok(workflow.includes('secrets.PRODUCTION_READINESS_TOKEN'));
  assert.ok(workflow.includes('-H "x-readiness-token: ${PRODUCTION_READINESS_TOKEN}"'));
});
