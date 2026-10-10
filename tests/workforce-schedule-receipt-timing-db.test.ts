import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { auditEvents, employees, organizations, scheduleOverrides, shiftDefinitions, userOrganizations, users } from "../src/db/schema";
import { workforceScheduleReceipts as receipts } from "../src/lib/workforce-schedule-receipt-schema";
import { acknowledgeScheduleReceipt, readScheduleReceiptView, ScheduleReceiptError } from "../src/lib/workforce-schedule-receipt-server";

type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };
async function whileRosterLocked<T>(organizationId: number, operation: () => Promise<T>, beforeRelease: () => void = () => {}) {
  const pending: { value?: Promise<Outcome<T>> } = {};
  let releaseBound: Date | undefined;
  try {
    await db.transaction(async holder => {
      await holder.execute(sql`select pg_advisory_xact_lock(6107, ${organizationId})`);
      // Attach rejection handling immediately, before any await in the holder.
      pending.value = operation().then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const result = await holder.execute(sql`select exists (
          select 1 from pg_locks where locktype = 'advisory'
          and classid = 6107::oid and objid = ${organizationId}::oid and not granted
        ) as waiting`);
        if (result.rows[0]?.waiting === true) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(blocked, true, "receipt operation must really be waiting on the roster lock");
      // Separate the blocked transaction's start from the release bound, even
      // after conversion of PostgreSQL microseconds to JavaScript milliseconds.
      await holder.execute(sql`select pg_sleep(0.025)`);
      const observed = await holder.execute(sql`select clock_timestamp() as observed_at`);
      releaseBound = new Date(observed.rows[0]?.observed_at as string);
      assert.ok(Number.isFinite(releaseBound.getTime()));
      beforeRelease();
    });
  } catch (error) {
    if (pending.value) await pending.value; // holder rollback has released its lock
    throw error;
  }
  assert.ok(pending.value && releaseBound);
  return { outcome: await pending.value, releaseBound };
}

test("real PostgreSQL receipt lock wait rechecks midnight and timestamps after release", { timeout: 30000 }, async t => {
  if (Number(process.env.PG_POOL_MAX) === 1) {
    t.skip("Two-connection lock test needs a pool with at least two connections."); return;
  }
  const token = randomUUID();
  const [org] = await db.insert(organizations).values({ name: "Receipt clock " + token, legalName: "Fictional clock fixture" }).returning();
  let actorId: number | undefined;
  try {
    const [employee] = await db.insert(employees).values({ organizationId: org.id, employeeNo: "CLOCK-FIXTURE",
      firstName: "Fictional", lastName: "Clock", title: "Synthetic worker", avatarInitials: "FC",
      basicRate: "20000.00", startDate: "2030-01-01", status: "Active" }).returning();
    const [actor] = await db.insert(users).values({ name: "Fictional clock actor", email: "clock-" + token + "@example.invalid",
      passwordHash: "not-a-login-fixture", role: "employee", active: true, employeeId: employee.id }).returning();
    actorId = actor.id;
    await db.insert(userOrganizations).values({ organizationId: org.id, userId: actor.id, role: "employee", active: true });
    const [shift] = await db.insert(shiftDefinitions).values({ organizationId: org.id, code: "CLOCK-DAY",
      name: "Synthetic clock shift", startTime: "09:00", endTime: "17:00", breakMinutes: 60, spansMidnight: false }).returning();
    await db.insert(scheduleOverrides).values({ organizationId: org.id, employeeId: employee.id,
      workDate: "2031-01-01", kind: "shift", isRestDay: false, segments: [{ shiftDefinitionId: shift.id, segmentOrder: 1 }],
      status: "approved", reason: "Synthetic receipt clock test", createdBy: "Synthetic fixture", approvedBy: "Synthetic checker" });
    const who = { organizationId: org.id, employeeId: employee.id, userId: actor.id };
    const initial = await readScheduleReceiptView(who, "2031-01-01");
    assert.ok(initial.days[0].snapshotHash);
    const body = { workDate: "2031-01-01", snapshotHash: initial.days[0].snapshotHash, acknowledged: true };
    let today = "2031-01-01";
    const expired = await whileRosterLocked(org.id,
      () => acknowledgeScheduleReceipt(who, body, () => today), () => { today = "2031-01-02"; });
    assert.equal(expired.outcome.ok, false);
    if (expired.outcome.ok) assert.fail("A receipt for yesterday must not be committed after midnight.");
    assert.ok(expired.outcome.error instanceof ScheduleReceiptError);
    assert.equal(expired.outcome.error.code, "SCHEDULE_RECEIPT_WINDOW_CHANGED");
    assert.equal((await db.select().from(receipts).where(eq(receipts.organizationId, org.id))).length, 0);
    assert.equal((await db.select().from(auditEvents).where(and(eq(auditEvents.organizationId, org.id),
      eq(auditEvents.action, "WFM employee schedule receipt acknowledged")))).length, 0);

    today = "2031-01-01";
    const refreshed = await whileRosterLocked(org.id,
      () => readScheduleReceiptView(who, () => today), () => { today = "2031-01-02"; });
    if (!refreshed.outcome.ok) throw refreshed.outcome.error;
    assert.equal(refreshed.outcome.value.days[0].date, "2031-01-02");

    // The fixed date is only a synthetic test clock; timestamp evidence is
    // independently checked against the real PostgreSQL wall clock.
    const recorded = await whileRosterLocked(org.id, () => acknowledgeScheduleReceipt(who, body, "2031-01-01"));
    if (!recorded.outcome.ok) throw recorded.outcome.error;
    assert.equal(recorded.outcome.value.created, true);
    assert.ok(Date.parse(recorded.outcome.value.acknowledgedAt) >= recorded.releaseBound.getTime(),
      "Receipt timestamp must not predate validation after the roster lock.");
    const duplicate = await acknowledgeScheduleReceipt(who, body, "2031-01-01");
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.acknowledgedAt, recorded.outcome.value.acknowledgedAt);
    assert.equal((await db.select().from(receipts).where(eq(receipts.organizationId, org.id))).length, 1);
    assert.equal((await db.select().from(auditEvents).where(and(eq(auditEvents.organizationId, org.id),
      eq(auditEvents.action, "WFM employee schedule receipt acknowledged")))).length, 1);
  } finally {
    await db.delete(receipts).where(eq(receipts.organizationId, org.id));
    if (actorId) await db.delete(users).where(eq(users.id, actorId));
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
