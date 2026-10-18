import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { auditEvents, employees, hcmEmploymentTerms, organizations, workerEmploymentEvents } from "../src/db/schema";
import { activateEmploymentTerm, runScheduledEmploymentTerms } from "../src/lib/hcm-employment-terms";

// The scheduler lease fences completion receipts, not in-flight work: after a
// takeover the previous owner can still be inside a job while the new owner starts
// the same job. Every scheduled job must therefore be safe when run twice at once.

test("overlapping employment-term activations apply the change exactly once", async () => {
  const marker = randomUUID().slice(0, 10);
  const [org] = await db.insert(organizations).values({ name: "Overlap terms " + marker, legalName: "Overlap terms " + marker }).returning();
  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id, employeeNo: "OV-" + marker, firstName: "Overlap", lastName: "Worker", title: "Analyst",
      avatarInitials: "OW", basicRate: "30000.00", startDate: "2025-01-01", employmentType: "probationary",
    }).returning();
    const [prior] = await db.insert(hcmEmploymentTerms).values({
      organizationId: org.id, employeeId: employee.id, employmentType: "probationary", termKind: "probationary",
      effectiveFrom: "2025-01-01", status: "active", reason: "Initial probation", requestedBy: "CI",
    }).returning();
    const [next] = await db.insert(hcmEmploymentTerms).values({
      organizationId: org.id, employeeId: employee.id, employmentType: "regular", termKind: "regular",
      effectiveFrom: "2026-01-01", status: "scheduled", reason: "Regularization", requestedBy: "CI",
    }).returning();

    // Force the overlap: hold the employee row lock so every worker reads the term as
    // "scheduled" and then blocks. They all resume with that stale view once it is released.
    let release!: () => void;
    let locked!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const lockedPromise = new Promise<void>((resolve) => { locked = resolve; });
    const holder = db.transaction(async (tx) => {
      await tx.execute(sql`select id from employees where id = ${employee.id} for update`);
      locked();
      await gate;
    });
    await lockedPromise;
    const workers = Promise.allSettled([1, 2, 3, 4].map(() => activateEmploymentTerm({ termId: next.id, actor: "CI overlap" })));
    await new Promise((resolve) => setTimeout(resolve, 500));
    release();
    await holder;
    const settled = await workers;
    assert.ok(settled.some((r) => r.status === "fulfilled"), "one worker activates the term");
    // Losers may fail, but only with a clean rejection (their whole transaction rolls back).
    // With hcm_employment_terms_valid_range installed, a stale loser trips the CHECK
    // when it tries to end the just-activated term before it starts (SQLSTATE 23514).
    for (const r of settled) {
      if (r.status !== "rejected") continue;
      const cause = (r.reason as { cause?: { code?: string } })?.cause?.code;
      assert.ok(cause === "23514" || /changed before activation|Only scheduled/.test(String(r.reason)), String(r.reason));
    }
    // The scheduler job itself must also be a harmless no-op afterwards.
    assert.deepEqual(await runScheduledEmploymentTerms({ actor: "CI overlap", now: new Date() }), []);

    const [after] = await db.select().from(hcmEmploymentTerms).where(eq(hcmEmploymentTerms.id, next.id));
    assert.equal(after.status, "active", "the scheduled term is active, not failed or superseded by a racing worker");
    assert.equal(after.failure, null, "a losing worker must not leave a failure on a successfully activated term");

    const [oldTerm] = await db.select().from(hcmEmploymentTerms).where(eq(hcmEmploymentTerms.id, prior.id));
    assert.equal(oldTerm.status, "superseded");
    assert.equal(String(oldTerm.effectiveUntil), "2025-12-31", "the prior term ends the day before the new one starts");

    const active = await db.select().from(hcmEmploymentTerms).where(and(
      eq(hcmEmploymentTerms.employeeId, employee.id), eq(hcmEmploymentTerms.status, "active"),
    ));
    assert.equal(active.length, 1, "exactly one active term per employee");

    const events = await db.select().from(workerEmploymentEvents).where(eq(workerEmploymentEvents.employeeId, employee.id));
    assert.equal(events.length, 1, "exactly one employment-change event");

    const [updated] = await db.select().from(employees).where(eq(employees.id, employee.id));
    assert.equal(updated.employmentType, "regular");

    const audits = await db.select().from(auditEvents).where(and(
      eq(auditEvents.organizationId, org.id), eq(auditEvents.action, "HCM employment terms activated"),
    ));
    assert.equal(audits.length, 1, "exactly one activation audit event");
  } finally {
    await db.delete(workerEmploymentEvents).where(eq(workerEmploymentEvents.organizationId, org.id));
    await db.delete(hcmEmploymentTerms).where(eq(hcmEmploymentTerms.organizationId, org.id));
    await db.delete(organizations).where(eq(organizations.id, org.id)).catch(() => undefined);
  }
});
