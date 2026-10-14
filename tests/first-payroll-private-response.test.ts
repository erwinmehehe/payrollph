import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PRIVATE_PREVIEW_CACHE_CONTROL,
  privatePreviewDenied,
  privatePreviewJson,
} from "../src/lib/first-payroll-private-response";

test("first-payroll preview success and every error status disable caching", async () => {
  for (const status of [200, 400, 401, 403, 404, 422]) {
    const body = { status, synthetic: true };
    const result = privatePreviewJson(body, status);
    assert.equal(result.status, status);
    assert.equal(result.headers.get("Cache-Control"), "private, no-store");
    assert.deepEqual(await result.json(), body);
  }
  assert.equal(PRIVATE_PREVIEW_CACHE_CONTROL, "private, no-store");
});

test("role denial retains status, payload and other headers but never caches", async () => {
  const denial = Response.json(
    { error: "Fictional role denial" },
    { status: 403, headers: { "X-Reason": "role", "Cache-Control": "public, max-age=3600" } },
  );
  const result = privatePreviewDenied(denial);
  assert.equal(result, denial);
  assert.equal(result.status, 403);
  assert.equal(result.headers.get("X-Reason"), "role");
  assert.equal(result.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(await result.json(), { error: "Fictional role denial" });
});

test("protected read-only payroll route cannot bypass private response helpers", () => {
  const source = readFileSync("src/app/api/first-payroll/preview/route.ts", "utf8");
  assert.match(source, /import \{ privatePreviewDenied, privatePreviewJson \} from/);
  assert.doesNotMatch(source, /Response\.json\(/);
  assert.equal((source.match(/privatePreviewJson\(/g) ?? []).length, 6);
  assert.match(source, /if\(denied\)return privatePreviewDenied\(denied\);/);
  assert.match(source, /PAYROLL_VIEW_ROLES/);
  assert.match(source, /access\?\.companyWide/);
  assert.match(source, /READ ONLY/);
  assert.match(source, /loadReadOnlyFirstPayrollPreview/);
});
