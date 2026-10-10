import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sql } from "drizzle-orm";
import { db } from "../src/db";

const sources = [
  "src/app/api/workforce/roster-batches/route.ts",
  "src/app/api/workforce/schedules/route.ts",
  "src/app/api/workforce/schedule-swaps/route.ts",
  "src/app/api/workforce/coverage/route.ts",
] as const;

test("every schedule-override publisher acquires the same organization lock", () => {
  for (const file of sources) {
    const code = readFileSync(file, "utf8");
    assert.ok(code.includes("pg_advisory_xact_lock(6107, ${organizationId})"), file);
    assert.ok(code.includes('isolationLevel: "serializable"'), file);
    assert.ok(code.includes("tx.insert(scheduleOverrides)"), file);
    assert.ok(code.includes("tx.insert(auditEvents)"), file);
  }
});

test("single-worker writers re-evaluate effective roster and policy after acquiring lock", () => {
  const schedules = readFileSync(sources[1], "utf8");
  assert.ok(schedules.includes("const lockedWindow = await resolveEmployeeScheduleWindow("));
  assert.ok(schedules.includes("executor: tx,"));
  assert.ok(schedules.includes("scheduleGuardrailPolicy(organizationId, tx)"));
  assert.ok(schedules.includes("employeeSiteEligibility({"));
  assert.ok(schedules.includes("worksiteId, date:"));
  assert.ok(schedules.includes("staleTimesheetIds: result.staleTimesheets.map("));
  assert.ok(!schedules.includes("db.insert(scheduleOverrides).values("));
  assert.ok(!schedules.includes("db.insert(employeeScheduleAssignments).values("));
});

test("swap and open-shift approval revalidate under the lock, with stale timesheet receipts", () => {
  const swaps = readFileSync(sources[2], "utf8");
  const coverage = readFileSync(sources[3], "utf8");
  assert.ok(swaps.includes("const lockedPair = await resolveSchedulesForPair("));
  assert.ok(swaps.includes("scheduleSwapSnapshotsMatch(storedRequester, lockedRequester)"));
  assert.ok(swaps.includes("resolveEmployeeScheduleWindow({"));
  assert.ok(swaps.includes("executor: tx,"));
  assert.ok(swaps.includes("markTimesheetsStaleForEmployeeDate({"));
  assert.ok(swaps.includes("tx.insert(auditEvents).values("));
  assert.ok(coverage.includes("currentShift.slots"));
  assert.ok(coverage.includes("eq(openShiftClaims.status, \"pending\")"));
  assert.ok(coverage.includes("resolveEmployeeScheduleWindow({"));
  assert.ok(coverage.includes("employeeSiteEligibility({"));
  assert.ok(coverage.includes("executor: tx,"));
  assert.ok(coverage.includes("tx.insert(auditEvents).values("));
});

test("transaction-capable helpers never read schedules or invalidate timecards on another connection", () => {
  const window = readFileSync("src/lib/workforce-schedule-window.ts", "utf8");
  const timesheets = readFileSync("src/lib/workforce-timesheet-server.ts", "utf8");
  const sites = readFileSync("src/lib/hcm-worksite-eligibility-server.ts", "utf8");
  assert.ok(window.includes("const executor = input.executor ?? db"));
  assert.ok(window.includes("executor.select().from(scheduleOverrides)"));
  assert.ok(timesheets.includes("return executor.update(workforceTimesheets)"));
  assert.ok(timesheets.includes("executor: input.executor,"));
  assert.ok(sites.includes("input.executor ?? db"));
});

test("two connections cannot simultaneously acquire an organization roster lock", async () => {
  // Isolated fictional organization; PostgreSQL lock only, no payroll or
  // schedule records are written. This tests the exact namespace in the routes.
  const fakeOrganizationId = 1777777001;
  let startSecond!: () => void;
  const firstLocked = new Promise<void>(resolve => { startSecond = resolve; });
  let releaseFirst!: () => void;
  const allowFirstCommit = new Promise<void>(resolve => { releaseFirst = resolve; });
  // The test needs two pool connections. A one-connection staging pool cannot
  // run a two-connection concurrency rehearsal, but still runs source checks.
  if (Number(process.env.PG_POOL_MAX) === 1) return;
  const first = db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(6107, ${fakeOrganizationId})`);
    startSecond();
    await allowFirstCommit;
  });
  try {
    await Promise.race([
      firstLocked,
      first.then(() => { throw new Error("Lock-holder transaction ended unexpectedly."); }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timed out acquiring test lock.")), 10000)),
    ]);
    const unavailable = await db.transaction(async tx => {
      const result = await tx.execute(sql`select pg_try_advisory_xact_lock(6107, ${fakeOrganizationId}) as acquired`);
      return result.rows[0]?.acquired;
    });
    assert.equal(unavailable, false, "the competing connection must not acquire the lock");
  } finally {
    releaseFirst();
    await first;
  }
  const acquired = await db.transaction(async tx => {
    const result = await tx.execute(sql`select pg_try_advisory_xact_lock(6107, ${fakeOrganizationId}) as acquired`);
    return result.rows[0]?.acquired;
  });
  assert.equal(acquired, true, "the advisory lock must be released at transaction end");
});
