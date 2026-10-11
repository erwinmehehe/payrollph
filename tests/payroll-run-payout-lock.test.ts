import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { withPayrollRunPayoutLock } from "../src/lib/payroll-run-payout-lock";

// Never use real employer or non-local databases for advisory-lock tests.
let isolated = false;
try {
  const url = new URL(process.env.DATABASE_URL ?? "");
  isolated = process.env.CI === "true"
    && process.env.GITHUB_ACTIONS === "true"
    && ["localhost", "127.0.0.1"].includes(url.hostname)
    && url.port === "5432"
    && url.pathname === "/app_db"
    && url.username === "postgres"
    && !url.search && !url.hash;
} catch {
  isolated = false;
}

test("final bank files, PayMongo and Xendit stage under the same per-run claim lock", () => {
  const exportRoute = readFileSync("src/app/api/payroll-runs/[id]/exports/route.ts", "utf8");
  const xendit = readFileSync("src/lib/xendit-payroll-operations.ts", "utf8");
  const staging = readFileSync("src/lib/payout-ledger.ts", "utf8");
  assert.ok(exportRoute.includes("() => readPayrollExport(request, params, true)"));
  assert.ok(exportRoute.includes("return await withPayrollRunPayoutLock(run.organizationId, run.id, async () => {"));
  assert.ok(xendit.includes("await withPayrollRunPayoutLock(run.organizationId, run.id, async () => {"));
  assert.ok(xendit.includes("await assertNoPriorPayrollDisbursement(run);"));
  assert.ok(staging.includes('"bank export generated"'));
  assert.ok(staging.includes("COALESCE("));
});

test("isolated Postgres serializes one payroll claim and releases it for later review", {
  skip: !isolated,
}, async () => {
  let started!: () => void;
  const acquired = new Promise<void>((resolve) => { started = resolve; });
  let finish!: () => void;
  const held = new Promise<void>((resolve) => { finish = resolve; });
  const first = withPayrollRunPayoutLock(919991, 919992, async () => {
    started();
    await held;
    return "first-finished";
  });
  try {
    await Promise.race([
      acquired,
      first.then(() => { throw new Error("Payroll lock released before test acquired it."); }),
    ]);
    await assert.rejects(
      () => withPayrollRunPayoutLock(919991, 919992, async () => "unsafe-second"),
      /PAYROLL_PAYOUT_CLAIM_ALREADY_IN_PROGRESS/,
    );
    assert.equal(
      await withPayrollRunPayoutLock(919991, 919993, async () => "other-run-safe"),
      "other-run-safe",
    );
  } finally {
    finish();
    assert.equal(await first, "first-finished");
  }
  assert.equal(
    await withPayrollRunPayoutLock(919991, 919992, async () => "reconciled-run"),
    "reconciled-run",
  );
});
