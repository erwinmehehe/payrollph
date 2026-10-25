import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  employees, jobProfiles, organizations, positionAssignments, positions, workerEmploymentEvents,
} from "../src/db/schema";
import { loadWorker360Summary } from "../src/lib/hcm-worker-360-server";

/**
 * Synthetic disposable PostgreSQL only. Exercises actual SQL predicates,
 * not just static source patterns; no production employers or payroll writes.
 */
test("Worker 360 isolates two employers and handles as-of ambiguity and event keyset caps", async () => {
  const code = randomUUID().slice(0, 9);
  const [alpha, beta] = await db.insert(organizations).values([
    { name: "W360 Fictional Alpha " + code, legalName: "W360 Fictional Alpha " + code, plan: "Core" },
    { name: "W360 Fictional Beta " + code, legalName: "W360 Fictional Beta " + code, plan: "Core" },
  ]).returning();

  try {
    // The two tenants deliberately share a worker NUMBER, not a global numeric
    // primary key. Global serial employee IDs cannot collide within one DB.
    const employeeNo = "W360-" + code;
    const [alphaWorker, betaWorker] = await db.insert(employees).values([
      {
        organizationId: alpha.id, employeeNo,
        firstName: "AlphaPrivate", lastName: "Fictional",
        title: "Current Alpha Title", avatarInitials: "AF",
        basicRate: "21000.00",
        startDate: "2025-01-01",
      },
      {
        organizationId: beta.id, employeeNo,
        firstName: "BetaPrivate", lastName: "Fictional",
        title: "Current Beta Title", avatarInitials: "BF",
        basicRate: "99000.00",
        startDate: "2025-01-01",
      },
    ]).returning();

    const [alphaProfile, betaProfile] = await db.insert(jobProfiles).values([
      { organizationId: alpha.id, title: "AlphaPrivate Job Profile" },
      { organizationId: beta.id, title: "BetaPrivate Job Profile" },
    ]).returning();
    const [alphaPosition, betaPosition] = await db.insert(positions).values([
      { organizationId: alpha.id, code: "W360-A-" + code, jobProfileId: alphaProfile.id },
      { organizationId: beta.id, code: "W360-B-" + code, jobProfileId: betaProfile.id },
    ]).returning();
    const [alphaAssignment, betaAssignment] = await db.insert(positionAssignments).values([
      {
        organizationId: alpha.id, positionId: alphaPosition.id, employeeId: alphaWorker.id,
        assignmentType: "primary", effectiveFrom: "2026-01-01", effectiveUntil: "2026-12-31",
      },
      {
        organizationId: beta.id, positionId: betaPosition.id, employeeId: betaWorker.id,
        assignmentType: "primary", effectiveFrom: "2026-01-01", effectiveUntil: "2026-12-31",
      },
    ]).returning();

    await db.insert(workerEmploymentEvents).values([
      {
        organizationId: alpha.id, employeeId: alphaWorker.id,
        effectiveDate: "2026-01-01", eventType: "hire",
        positionAssignmentId: alphaAssignment.id,
        reason: "AlphaPrivate source note never shown",
        metadata: { privateEmployeeNote: "AlphaPrivate metadata" },
      },
      {
        organizationId: alpha.id, employeeId: alphaWorker.id,
        effectiveDate: "2027-03-01", eventType: "transfer",
        reason: "AlphaPrivate future event",
      },
      {
        organizationId: beta.id, employeeId: betaWorker.id,
        effectiveDate: "2026-01-01", eventType: "hire",
        positionAssignmentId: betaAssignment.id,
        reason: "BetaPrivate source note never shown",
        metadata: { privateEmployeeNote: "BetaPrivate metadata" },
      },
    ]);

    const alphaSummary = await loadWorker360Summary(alpha.id, alphaWorker.id, "2026-07-01");
    assert.ok(alphaSummary);
    assert.equal(alphaSummary.tenantId, alpha.id);
    assert.equal(alphaSummary.employeeId, alphaWorker.id);
    assert.equal(alphaSummary.worker.employeeNo, employeeNo);
    assert.equal(alphaSummary.worker.currentTitle, "Current Alpha Title");
    assert.equal(alphaSummary.primaryAssignment.selection.status, "recorded");
    if (alphaSummary.primaryAssignment.selection.status !== "recorded") throw new Error("No source assignment");
    assert.equal(alphaSummary.primaryAssignment.selection.assignment.id, alphaAssignment.id);
    assert.deepEqual(alphaSummary.employmentEvents.preview.items.map((e) => e.eventType), ["hire"]);
    assert.equal(alphaSummary.employmentEvents.preview.hasMore, false);
    assert.equal(alphaSummary.employmentEvents.preview.nextCursor, null);
    const privateFields = JSON.stringify(alphaSummary);
    for (const denied of [
      "BetaPrivate", "99000.00", "21000.00",
      "privateEmployeeNote", "source note never shown",
      "AlphaPrivate Job Profile",
    ]) assert.ok(!privateFields.includes(denied), "Unexpected private field: " + denied);

    // A worker ID from Beta must not resolve when the employer is Alpha, even
    // when both workers share the same employee number.
    assert.equal(await loadWorker360Summary(alpha.id, betaWorker.id, "2026-07-01"), null);
    assert.equal(await loadWorker360Summary(beta.id, alphaWorker.id, "2026-07-01"), null);
    const betaSummary = await loadWorker360Summary(beta.id, betaWorker.id, "2026-07-01");
    assert.ok(betaSummary);
    assert.equal(betaSummary.worker.currentTitle, "Current Beta Title");
    assert.equal(betaSummary.primaryAssignment.selection.status, "recorded");
    assert.deepEqual(betaSummary.employmentEvents.preview.items.map((e) => e.eventType), ["hire"]);
    assert.ok(!JSON.stringify(betaSummary).includes("AlphaPrivate"));

    // Inclusive as-of boundary; missing past or expired assignment is an
    // explicit not-recorded state, never inferred from present-day title.
    const atStart = await loadWorker360Summary(alpha.id, alphaWorker.id, "2026-01-01");
    assert.equal(atStart?.primaryAssignment.selection.status, "recorded");
    const beforeStart = await loadWorker360Summary(alpha.id, alphaWorker.id, "2025-12-31");
    assert.equal(beforeStart?.primaryAssignment.selection.status, "not_recorded");
    assert.deepEqual(beforeStart?.employmentEvents.preview.items, []);
    const afterEnd = await loadWorker360Summary(alpha.id, alphaWorker.id, "2027-01-01");
    assert.equal(afterEnd?.primaryAssignment.selection.status, "not_recorded");

    // Equal-date events stress the effectiveDate+id cursor. All events remain
    // source-linked, tenant restricted, 25+1-capped and non-duplicating.
    await db.insert(workerEmploymentEvents).values(Array.from({ length: 26 }, (_, idx) => ({
      organizationId: alpha.id, employeeId: alphaWorker.id,
      effectiveDate: "2026-05-01", eventType: "transfer",
      reason: "AlphaPrivate synthetic HR note " + idx,
      metadata: { sourceSecret: "AlphaPrivate" },
    })));
    const first = await loadWorker360Summary(alpha.id, alphaWorker.id, "2026-07-01");
    assert.ok(first);
    const initial = first.employmentEvents.preview;
    assert.equal(initial.items.length, 25);
    assert.equal(initial.hasMore, true);
    assert.equal(initial.partial, true);
    assert.ok(initial.items.every((event) => event.effectiveDate === "2026-05-01"));
    const cursor = initial.nextCursor;
    assert.ok(cursor);
    const next = await loadWorker360Summary(alpha.id, alphaWorker.id, "2026-07-01", cursor);
    assert.ok(next);
    assert.equal(next.employmentEvents.preview.items.length, 2);
    assert.equal(next.employmentEvents.preview.hasMore, false);
    assert.equal(next.employmentEvents.preview.nextCursor, null);
    assert.equal(next.employmentEvents.preview.items.at(-1)?.eventType, "hire");
    const all = [...initial.items, ...next.employmentEvents.preview.items];
    assert.equal(new Set(all.map((event) => event.id)).size, 27);
    assert.ok(!JSON.stringify([first, next]).includes("sourceSecret"));
    assert.ok(!JSON.stringify([first, next]).includes("BetaPrivate"));
    const betaAfterAlphaWrites = await loadWorker360Summary(beta.id, betaWorker.id, "2026-07-01");
    assert.equal(betaAfterAlphaWrites?.employmentEvents.preview.items.length, 1);

    // Two historical primary assignments overlapping on the as-of date must
    // not silently select an arbitrary position. Both have finite end dates
    // so the existing "one open primary assignment" index still holds.
    const [overlapPosition] = await db.insert(positions).values({
      organizationId: alpha.id, code: "W360-OVERLAP-" + code, jobProfileId: alphaProfile.id,
    }).returning();
    await db.insert(positionAssignments).values({
      organizationId: alpha.id, employeeId: alphaWorker.id,
      positionId: overlapPosition.id, assignmentType: "primary",
      effectiveFrom: "2026-06-01", effectiveUntil: "2026-10-01",
    });
    const ambiguous = await loadWorker360Summary(alpha.id, alphaWorker.id, "2026-07-01");
    assert.equal(ambiguous?.primaryAssignment.selection.status, "ambiguous");
    assert.equal(ambiguous?.primaryAssignment.selection.assignment, null);
    assert.equal((await loadWorker360Summary(beta.id, betaWorker.id, "2026-07-01"))
      ?.primaryAssignment.selection.status, "recorded");
  } finally {
    // Deliberately delete only these isolated fictional tenants; cascade
    // removes the test's workers, events, positions and assignments.
    await db.delete(organizations).where(inArray(organizations.id, [alpha.id, beta.id]));
  }
});
