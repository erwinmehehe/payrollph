import assert from "node:assert/strict";
import test from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import {
  auditEvents, employees, organizations, scheduleOverrides,
  shiftDefinitions, workforceTimesheets,
} from "../src/db/schema";

/**
 * Fictional isolation fixture. This is a DB rollback rehearsal, not a direct
 * authenticated endpoint test, statutory payroll certification or live release.
 */
test("duplicate override aborts every batch write, stale timecard and audit", async () => {
  const [org] = await db.insert(organizations).values({
    name: "WFM synthetic atomic rollback", legalName: "WFM Test-Only Synthetic Corp.",
    plan: "Core",
  }).returning();
  try {
    const people = await db.insert(employees).values([
      { organizationId: org.id, employeeNo: "WFM-BATCH-A",
        firstName: "Fictional", lastName: "One", title: "Associate",
        avatarInitials: "FO", basicRate: "20000.00", startDate: "2026-01-01" },
      { organizationId: org.id, employeeNo: "WFM-BATCH-B",
        firstName: "Fictional", lastName: "Two", title: "Associate",
        avatarInitials: "FT", basicRate: "20000.00", startDate: "2026-01-01" },
    ]).returning();
    assert.equal(people.length, 2);
    const [shift] = await db.insert(shiftDefinitions).values({
      organizationId: org.id, code: "SYN-SHIFT", name: "Fictional ordinary shift",
      startTime: "09:00", endTime: "17:00", breakMinutes: 60,
      spansMidnight: false,
    }).returning();
    const workDate = "2026-10-20";
    const override = (employeeId: number) => ({
      organizationId: org.id, employeeId, workDate, kind: "shift",
      isRestDay: false,
      segments: [{ shiftDefinitionId: shift.id, segmentOrder: 1 }],
      reason: "Synthetic concurrency test - no actual roster change",
      createdBy: "Synthetic fixture", status: "approved",
    });
    await db.insert(scheduleOverrides).values(override(people[1].id));
    const [timesheet] = await db.insert(workforceTimesheets).values({
      organizationId: org.id, employeeId: people[0].id,
      periodStart: "2026-10-16", periodEnd: "2026-10-31",
      status: "approved", version: 1, snapshotHash: "a".repeat(64),
    }).returning();

    await assert.rejects(() => db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(6107, ${org.id})`);
      await tx.insert(scheduleOverrides).values(override(people[0].id));
      await tx.update(workforceTimesheets).set({
        status: "stale", updatedAt: new Date(),
      }).where(and(
        eq(workforceTimesheets.organizationId, org.id),
        eq(workforceTimesheets.id, timesheet.id),
      ));
      await tx.insert(auditEvents).values({
        organizationId: org.id, actor: "Synthetic checker",
        action: "WFM synthetic batch publish attempted",
        resource: "Fictional rejected transaction",
      });
      // Conflict with a preexisting single-worker approval. The entire batch
      // must roll back, including the first worker, timecard and audit receipt.
      await tx.insert(scheduleOverrides).values(override(people[1].id));
    }, { isolationLevel: "serializable" }));

    const recorded = await db.select().from(scheduleOverrides).where(
      eq(scheduleOverrides.organizationId, org.id),
    );
    assert.deepEqual(recorded.map(row => row.employeeId), [people[1].id]);
    const [persistedTimecard] = await db.select().from(workforceTimesheets).where(
      eq(workforceTimesheets.id, timesheet.id),
    );
    assert.equal(persistedTimecard.status, "approved");
    const receipts = await db.select().from(auditEvents).where(
      eq(auditEvents.organizationId, org.id),
    );
    assert.equal(receipts.length, 0, "aborted batch cannot emit a success audit receipt");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
