import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../src/db";
import { organizations, employees, schedulePatterns, schedulePatternDays, schedulePatternSegments,
  shiftDefinitions, employeeScheduleAssignments } from "../src/db/schema";
import { acquireSchedulerLease, refreshSchedulerLease, releaseSchedulerLease } from "../src/lib/scheduler-lease";
import { ClockWatchLeaseLostError } from "../src/lib/workforce-clock-watch-lease";

test("1000 fictional workers: actual watch lanes stop after DB lease takeover at page, batch and dispatch boundaries", { timeout: 180_000 }, async t => {
  const target = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.pathname, "/app_db");
  const require = createRequire(import.meta.url);
  const automationPath = require.resolve("../src/lib/automation");
  const original = require(automationPath);
  const cache = require.cache[automationPath]!;
  type Event = { organizationId: number; employeeId: number; eventKey: string; context: { clockInWatchStatus: string } };
  let deliveries: Event[] = [], afterDelivery: (() => Promise<void>) | undefined;
  // Replace delivery only. Production SQL, paging, schedule resolution, signal
  // selection and real PostgreSQL lease acquisition/takeover remain executable.
  cache.exports = { ...original, runAutomationEventSafely: async (event: Event) => {
    deliveries.push(event); await afterDelivery?.(); return null;
  } };
  const { emitWorkforceClockInWatch } = await import("../src/lib/workforce-clock-in-watch-server");
  const flags = ["WFM_CLOCK_WATCH_PAGING_ENABLED", "WFM_ROSTER_SCALE_RULES_ENABLED"];
  const prior = flags.map(name => process.env[name]);
  const tag = randomUUID().slice(0, 10), orgIds: number[] = [], dayIds: number[] = [];
  const expectedEmployer = new Map<number, number>();
  try {
    for (const label of ["A", "B"]) {
      const [org] = await db.insert(organizations).values({ name: "Clock lease fictional " + label + tag, legalName: "Fictional " + label + tag }).returning();
      orgIds.push(org.id);
      const [pattern] = await db.insert(schedulePatterns).values({ organizationId: org.id, code: "P-" + tag, name: "Fictional daily", cycleDays: 7 }).returning();
      const [shift] = await db.insert(shiftDefinitions).values({ organizationId: org.id, code: "D-" + tag, name: "Fictional day", startTime: "09:00", endTime: "17:00", breakMinutes: 0 }).returning();
      const days = await db.insert(schedulePatternDays).values(Array.from({ length: 7 }, (_, dayIndex) => ({ patternId: pattern.id, dayIndex, isRestDay: false }))).returning();
      dayIds.push(...days.map(row => row.id));
      await db.insert(schedulePatternSegments).values(days.map(day => ({ patternDayId: day.id, shiftDefinitionId: shift.id, segmentOrder: 1 })));
      for (let start = 0; start < 500; start += 100) {
        const workers = await db.insert(employees).values(Array.from({ length: 100 }, (_, i) => ({ organizationId: org.id,
          employeeNo: "CW-" + tag + "-" + (start + i), firstName: "Fictional", lastName: label + (start + i), title: "Operator",
          avatarInitials: "FW", basicRate: "21000.00", startDate: "2026-01-01" }))).returning();
        for (const worker of workers) expectedEmployer.set(worker.id, org.id);
        await db.insert(employeeScheduleAssignments).values(workers.map(worker => ({ organizationId: org.id, employeeId: worker.id, patternId: pattern.id,
          effectiveFrom: "2026-01-01", anchorDate: "2026-01-01", reason: "Fictional lease regression" })));
      }
    }
    for (const enhanced of [false, true]) for (const scenario of ["complete", "page", "batch", "dispatch"]) {
      await t.test((enhanced ? "roster-scale" : "legacy-paged") + " / " + scenario, async () => {
        process.env.WFM_CLOCK_WATCH_PAGING_ENABLED = "true";
        process.env.WFM_ROSTER_SCALE_RULES_ENABLED = String(enhanced);
        deliveries = []; afterDelivery = undefined;
        const lease = "clock-watch-test-" + randomUUID(), first = randomUUID(), next = randomUUID();
        let probes = 0, replaced = false;
        const takeover = async () => {
          assert.equal(replaced, false); replaced = true;
          await db.execute(sql`UPDATE scheduler_state SET last_run_at=NOW()-INTERVAL '16 minutes' WHERE job_name=${lease}`);
          assert.equal(await acquireSchedulerLease(next, lease), true);
        };
        assert.equal(await acquireSchedulerLease(first, lease), true);
        const authority = async () => {
          probes++;
          if ((scenario === "page" && probes === 2) || (scenario === "batch" && probes === 7)) await takeover();
          if (!(await refreshSchedulerLease(first, lease))) throw Error("replaced owner");
        };
        if (scenario === "dispatch") afterDelivery = async () => { if (!replaced) await takeover(); };
        try {
          const run = () => emitWorkforceClockInWatch(new Date("2026-10-26T02:00:00Z"), 20, authority);
          if (scenario === "complete") {
            const result = await run();
            assert.equal(result.skipped, false); assert.equal("emitted" in result && result.emitted, 1000);
            assert.equal(deliveries.length, 1000); assert.equal(new Set(deliveries.map(event => event.eventKey)).size, 1000);
            assert.deepEqual(new Set(deliveries.map(event => event.organizationId)), new Set(orgIds));
            for (const event of deliveries) { assert.equal(expectedEmployer.get(event.employeeId), event.organizationId); assert.equal(event.context.clockInWatchStatus, "unconfirmed"); }
          } else {
            await assert.rejects(run(), ClockWatchLeaseLostError);
            assert.equal(replaced, true);
            assert.equal(deliveries.length, scenario === "dispatch" ? 1 : 0, "no later advisory event may start after observed lease loss");
            assert.equal(await refreshSchedulerLease(first, lease), false);
            assert.equal(await releaseSchedulerLease(first, "completed", lease), false, "stale attempt cannot release replacement lease");
            assert.equal(await refreshSchedulerLease(next, lease), true);
          }
        } finally { await db.execute(sql`DELETE FROM scheduler_state WHERE job_name=${lease}`); }
      });
    }
  } finally {
    cache.exports = original;
    flags.forEach((name, i) => { if (prior[i] === undefined) delete process.env[name]; else process.env[name] = prior[i]; });
    if (dayIds.length) await db.delete(schedulePatternSegments).where(inArray(schedulePatternSegments.patternDayId, dayIds));
    for (const id of orgIds) await db.delete(organizations).where(eq(organizations.id, id));
  }
});
