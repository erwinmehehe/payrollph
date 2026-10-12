import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { publicStatusResponse } from "../src/lib/public-status-response";
test("public status discards operational metrics and returns only up/down", () => {
  const internal = { ok: true, latencyMs: 12, databaseName: "private", deploymentSha: "private" };
  assert.deepEqual(publicStatusResponse(internal), { ok: true });
  assert.deepEqual(publicStatusResponse(null), { ok: false });
  assert.deepEqual(publicStatusResponse({ ok: false }), { ok: false });
});

test("readiness Next.js route exports only supported entrypoints and runtime config", () => {
  const source = readFileSync("src/app/api/readiness/route.ts", "utf8");
  assert.match(source, /async function buildReadinessPayload\(\)/);
  assert.doesNotMatch(source, /export\s+(?:async\s+)?function buildReadinessPayload\b/);
  assert.match(source, /export async function GET\(/);
  assert.match(source, /export const dynamic = "force-dynamic"/);
});
