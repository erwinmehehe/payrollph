import assert from "node:assert/strict";
import test from "node:test";
import { CRITICAL_RELEASE_FLAGS, criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";
import type { db } from "../src/db";

test("inline first payroll is default-off and requires the exact string true", () => {
  assert.equal(CRITICAL_RELEASE_FLAGS.firstPayrollInline.env, "FIRST_PAYROLL_INLINE_ENABLED");
  for (const value of [undefined, "", "TRUE", "1", "false", "on"]) {
    assert.equal(criticalReleaseFlagEnabled("firstPayrollInline", { FIRST_PAYROLL_INLINE_ENABLED: value }), false);
  }
  assert.equal(criticalReleaseFlagEnabled("firstPayrollInline", { FIRST_PAYROLL_INLINE_ENABLED: "true" }), true);
});

test("flag-off never asks for a new DB table; partial migration fails closed", async () => {
  process.env.DATABASE_URL ??= "postgresql://local:local@127.0.0.1:1/offline";
  const { firstPayrollInlineAvailable } = await import("../src/lib/first-payroll-inline-gate");
  let reads = 0;
  const missingTable = { select() { reads++; throw new Error("42P01"); } } as unknown as Pick<typeof db, "select">;
  assert.equal(await firstPayrollInlineAvailable({}, missingTable), false);
  assert.equal(reads, 0, "Disabled feature must perform zero extra table reads");
  assert.equal(await firstPayrollInlineAvailable({ FIRST_PAYROLL_INLINE_ENABLED: "true" }, missingTable), false);
  assert.equal(reads, 1);
});

test("configured 0117 progress storage can enable only the gated inline journey", async () => {
  process.env.DATABASE_URL ??= "postgresql://local:local@127.0.0.1:1/offline";
  const { firstPayrollInlineAvailable } = await import("../src/lib/first-payroll-inline-gate");
  let reads = 0;
  const existingTable = {
    select() {
      reads++;
      return { from() { return { limit() { return Promise.resolve([]); } }; } };
    },
  } as unknown as Pick<typeof db, "select">;
  assert.equal(await firstPayrollInlineAvailable({ FIRST_PAYROLL_INLINE_ENABLED: "true" }, existingTable), true);
  assert.equal(reads, 1);
});

test("multi-entity mode holds tenant-wide onboarding before any storage access", async () => {
  process.env.DATABASE_URL ??= "postgresql://local:local@127.0.0.1:1/offline";
  const { firstPayrollInlineAvailable } = await import("../src/lib/first-payroll-inline-gate");
  let reads = 0;
  const forbidden = { select() { reads++; throw new Error("Tenant-wide query must not execute"); } } as unknown as Pick<typeof db, "select">;
  assert.equal(await firstPayrollInlineAvailable({
    FIRST_PAYROLL_INLINE_ENABLED: "true", MULTI_ENTITY_ENABLED: "true",
  }, forbidden), false);
  assert.equal(reads, 0, "Entity-scoped onboarding must be held before table lookup");
});

test("real preview and progress handlers cannot expose unscoped onboarding in multi-entity mode", async () => {
  process.env.DATABASE_URL ??= "postgresql://local:local@127.0.0.1:1/offline";
  const previousInline = process.env.FIRST_PAYROLL_INLINE_ENABLED;
  const previousEntity = process.env.MULTI_ENTITY_ENABLED;
  process.env.FIRST_PAYROLL_INLINE_ENABLED = "true";
  process.env.MULTI_ENTITY_ENABLED = "true";
  try {
    const preview = await import("../src/app/api/first-payroll/preview/route");
    const progress = await import("../src/app/api/first-payroll/progress/route");
    const url = "https://example.test/api/first-payroll?organizationId=1";
    for (const response of [
      await preview.GET(new Request(url)),
      await progress.GET(new Request(url)),
      await progress.PATCH(new Request(url, { method: "PATCH", body: "{}" })),
    ]) {
      assert.equal(response.status, 404);
      const body = await response.json();
      assert.deepEqual(Object.keys(body), ["error"]);
      assert.match(body.error, /unavailable/i);
    }
  } finally {
    if (previousInline === undefined) delete process.env.FIRST_PAYROLL_INLINE_ENABLED;
    else process.env.FIRST_PAYROLL_INLINE_ENABLED = previousInline;
    if (previousEntity === undefined) delete process.env.MULTI_ENTITY_ENABLED;
    else process.env.MULTI_ENTITY_ENABLED = previousEntity;
  }
});
