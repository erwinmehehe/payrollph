import assert from "node:assert/strict";
import test from "node:test";
import { publicStatusResponse } from "../src/lib/public-status-response";
test("public status discards operational metrics and returns only up/down", () => {
  const internal = { ok: true, latencyMs: 12, databaseName: "private", deploymentSha: "private" };
  assert.deepEqual(publicStatusResponse(internal), { ok: true });
  assert.deepEqual(publicStatusResponse(null), { ok: false });
  assert.deepEqual(publicStatusResponse({ ok: false }), { ok: false });
});
