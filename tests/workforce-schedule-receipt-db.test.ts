import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { auditEvents, employees, organizations, scheduleOverrides, shiftDefinitions, userOrganizations, users } from "../src/db/schema";
import { workforceScheduleReceipts as receipts } from "../src/lib/workforce-schedule-receipt-schema";
import { acknowledgeScheduleReceipt, readScheduleReceiptView, ScheduleReceiptError } from "../src/lib/workforce-schedule-receipt-server";

test("schedule receipt service isolates two employers, rejects stale content, and deduplicates concurrent acknowledgment", { timeout: 30000 }, async () => {
  const token = randomUUID();
  const orgs = await db.insert(organizations).values([
    { name: "Receipt test A " + token, legalName: "Fictional A" },
    { name: "Receipt test B " + token, legalName: "Fictional B" },
  ]).returning();
  const orgIds = orgs.map(org => org.id);
  let actorIds: number[] = [];
  try {
    const staff = await db.insert(employees).values(orgs.map((org, i) => ({
      organizationId: org.id, employeeNo: "SAME-EMPLOYEE-NO", firstName: "Fictional", lastName: String(i),
      title: "Synthetic worker", avatarInitials: "FW", basicRate: "20000.00", startDate: "2030-01-01", status: "Active",
    }))).returning();
    const actors = await db.insert(users).values(staff.map((person, i) => ({
      name: "Fictional receipt actor " + i, email: "receipt-" + i + "-" + token + "@example.invalid",
      passwordHash: "not-a-login-fixture", role: "employee", active: true, employeeId: person.id,
    }))).returning();
    actorIds = actors.map(actor => actor.id);
    await db.insert(userOrganizations).values(orgs.map((org, i) => ({
      organizationId: org.id, userId: actors[i].id, role: "employee", active: true,
    })));
    const shifts = await db.insert(shiftDefinitions).values(orgs.map(org => ({
      organizationId: org.id, code: "RECEIPT-DAY", name: "Synthetic day shift", startTime: "09:00", endTime: "17:00",
      breakMinutes: 60, spansMidnight: false,
    }))).returning();
    const today = "2031-01-01";
    await db.insert(scheduleOverrides).values(orgs.map((org, i) => ({
      organizationId: org.id, employeeId: staff[i].id, workDate: today, kind: "shift", isRestDay: false,
      segments: [{ shiftDefinitionId: shifts[i].id, segmentOrder: 1 }], status: "approved",
      reason: "Fictional receipt test", createdBy: "Synthetic fixture", approvedBy: "Synthetic checker",
    })));
    const who = { organizationId: orgs[0].id, employeeId: staff[0].id, userId: actors[0].id };
    const other = { organizationId: orgs[1].id, employeeId: staff[1].id, userId: actors[1].id };
    const first = await readScheduleReceiptView(who, today);
    assert.equal(first.days.length, 7);
    assert.equal(first.days[0].state, "pending");
    assert.ok(first.days[0].snapshotHash);
    assert.equal(first.days[1].state, "unavailable");
    const request = { workDate: today, snapshotHash: first.days[0].snapshotHash, acknowledged: true };
    await assert.rejects(() => acknowledgeScheduleReceipt(who, { ...request, snapshotHash: "0".repeat(64) }, today),
      error => error instanceof ScheduleReceiptError && error.code === "SCHEDULE_CHANGED");
    await assert.rejects(() => readScheduleReceiptView({ ...who, organizationId: other.organizationId }, today),
      error => error instanceof ScheduleReceiptError && error.status === 403);
    await assert.rejects(() => acknowledgeScheduleReceipt({ ...who, userId: other.userId }, request, today),
      error => error instanceof ScheduleReceiptError && error.status === 403);
    const responses = await Promise.all([acknowledgeScheduleReceipt(who, request, today), acknowledgeScheduleReceipt(who, request, today)]);
    assert.equal(responses.filter(row => row.created).length, 1);
    assert.equal(responses[0].acknowledgedAt, responses[1].acknowledgedAt);
    assert.equal((await db.select().from(receipts).where(eq(receipts.organizationId, who.organizationId))).length, 1);
    assert.equal((await db.select().from(auditEvents).where(and(eq(auditEvents.organizationId, who.organizationId),
      eq(auditEvents.action, "WFM employee schedule receipt acknowledged")))).length, 1);
    assert.equal((await readScheduleReceiptView(who, today)).days[0].state, "acknowledged");
    assert.equal((await readScheduleReceiptView(other, today)).days[0].state, "pending");
    await db.update(shiftDefinitions).set({ startTime: "10:00" }).where(eq(shiftDefinitions.id, shifts[0].id));
    const changed = await readScheduleReceiptView(who, today);
    assert.equal(changed.days[0].state, "changed");
    assert.notEqual(changed.days[0].snapshotHash, request.snapshotHash);
    await assert.rejects(() => acknowledgeScheduleReceipt(who, request, today),
      error => error instanceof ScheduleReceiptError && error.code === "SCHEDULE_CHANGED");
    await acknowledgeScheduleReceipt(who, { ...request, snapshotHash: changed.days[0].snapshotHash }, today);
    assert.equal((await db.select().from(receipts).where(eq(receipts.organizationId, who.organizationId))).length, 2);
    assert.equal((await db.select().from(scheduleOverrides).where(eq(scheduleOverrides.organizationId, who.organizationId))).length, 1);
    // Yesterday is outside the seven-day response, but its overnight hours can
    // invalidate both the first visible day and a one-date acknowledgment POST.
    const [night] = await db.insert(shiftDefinitions).values({ organizationId: who.organizationId,
      code: "RECEIPT-NIGHT", name: "Synthetic conflicting night shift", startTime: "22:00", endTime: "12:00",
      breakMinutes: 60, spansMidnight: true }).returning();
    const [nightOverride] = await db.insert(scheduleOverrides).values({ organizationId: who.organizationId,
      employeeId: who.employeeId, workDate: "2030-12-31", kind: "shift", isRestDay: false,
      segments: [{ shiftDefinitionId: night.id, segmentOrder: 1 }], status: "approved",
      reason: "Synthetic adjacent-day conflict", createdBy: "Synthetic fixture", approvedBy: "Synthetic checker" }).returning();
    const conflicting = await readScheduleReceiptView(who, today);
    assert.equal(conflicting.days.length, 7);
    assert.equal(conflicting.days[0].state, "unavailable");
    assert.ok(!conflicting.days.some(day => day.date === "2030-12-31"));
    await assert.rejects(() => acknowledgeScheduleReceipt(who, { ...request, snapshotHash: changed.days[0].snapshotHash }, today),
      error => error instanceof ScheduleReceiptError && error.code === "SCHEDULE_UNAVAILABLE");
    assert.equal((await db.select().from(receipts).where(eq(receipts.organizationId, who.organizationId))).length, 2);
    assert.equal((await db.select().from(auditEvents).where(and(eq(auditEvents.organizationId, who.organizationId),
      eq(auditEvents.action, "WFM employee schedule receipt acknowledged")))).length, 2);
    assert.equal((await readScheduleReceiptView(other, today)).days[0].state, "pending");
    await db.delete(scheduleOverrides).where(and(eq(scheduleOverrides.organizationId, who.organizationId), eq(scheduleOverrides.id, nightOverride.id)));
    assert.equal((await readScheduleReceiptView(who, today)).days[0].state, "acknowledged");
    // A malformed live split shift cannot produce a receipt or success audit, even with a formerly valid hash.
    await db.update(scheduleOverrides).set({ segments: [
      { shiftDefinitionId: shifts[0].id, segmentOrder: 1 },
      { shiftDefinitionId: shifts[0].id, segmentOrder: 2 },
    ] }).where(and(eq(scheduleOverrides.organizationId, who.organizationId),
      eq(scheduleOverrides.employeeId, who.employeeId), eq(scheduleOverrides.workDate, today)));
    assert.equal((await readScheduleReceiptView(who, today)).days[0].state, "unavailable");
    await assert.rejects(() => acknowledgeScheduleReceipt(who, { ...request, snapshotHash: changed.days[0].snapshotHash }, today),
      error => error instanceof ScheduleReceiptError && error.code === "SCHEDULE_UNAVAILABLE");
    assert.equal((await db.select().from(receipts).where(eq(receipts.organizationId, who.organizationId))).length, 2);
    assert.equal((await db.select().from(auditEvents).where(and(eq(auditEvents.organizationId, who.organizationId),
      eq(auditEvents.action, "WFM employee schedule receipt acknowledged")))).length, 2);
    await db.update(userOrganizations).set({ active: false }).where(and(eq(userOrganizations.organizationId, who.organizationId), eq(userOrganizations.userId, who.userId)));
    await assert.rejects(() => readScheduleReceiptView(who, today), error => error instanceof ScheduleReceiptError && error.status === 403);
  } finally {
    await db.delete(receipts).where(inArray(receipts.organizationId, orgIds));
    if (actorIds.length) await db.delete(users).where(inArray(users.id, actorIds));
    await db.delete(organizations).where(inArray(organizations.id, orgIds));
  }
});
