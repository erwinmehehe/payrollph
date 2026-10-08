import assert from "node:assert/strict";
import test from "node:test";
import { db } from "../src/db";
import {
  auditEvents,
  compensationComponents,
  compensationEvents,
  employeeCompensationComponents,
  employees,
  organizations,
} from "../src/db/schema";
import { inspectEndedCompensationEvidence } from "../src/lib/compensation-expiry-evidence-audit";

async function withOrganization(exercise: (input: {
  organizationId: number;
  employeeId: number;
  componentId: number;
  addEnded: (effectiveUntil?: string | null) => Promise<number>;
}) => Promise<void>) {
  const [org] = await db.insert(organizations).values({
    name: "Expiry Evidence Review QA",
    legalName: "Expiry Evidence Review QA Inc.",
    plan: "Core",
  }).returning();
  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "EXP-AUDIT-01",
      firstName: "Evidence",
      lastName: "QA",
      title: "Operations",
      avatarInitials: "EQ",
      basicRate: "30000.00",
      startDate: "2026-01-01",
    }).returning();
    const [component] = await db.insert(compensationComponents).values({
      organizationId: org.id,
      code: "EXP-AUDIT",
      name: "Expiry audit allowance",
      kind: "allowance",
      amountFrequency: "monthly",
    }).returning();

    let index = 0;
    const addEnded = async (effectiveUntil: string | null = "2026-10-12") => {
      index++;
      const [assignment] = await db.insert(employeeCompensationComponents).values({
        organizationId: org.id,
        employeeId: employee.id,
        componentId: component.id,
        amount: "2000.00",
        effectiveFrom: "2026-10-01",
        effectiveUntil,
        status: "ended",
        reason: `Review historical evidence ${index}`,
        requestedBy: "Payroll QA",
        approvedBy: "Payroll reviewer",
      }).returning();
      return assignment.id;
    };
    await exercise({
      organizationId: org.id,
      employeeId: employee.id,
      componentId: component.id,
      addEnded,
    });
  } finally {
    await db.delete(organizations).where(
      // Inline import keeps the mutation strictly fixture-only.
      (await import("drizzle-orm")).eq(organizations.id, org.id),
    );
  }
}

async function addEndEvent(input: {
  organizationId: number;
  employeeId: number;
  assignmentId: number;
  effectiveDate?: string;
}) {
  const [event] = await db.insert(compensationEvents).values({
    organizationId: input.organizationId,
    employeeId: input.employeeId,
    componentAssignmentId: input.assignmentId,
    eventType: "component_ended",
    effectiveDate: input.effectiveDate ?? "2026-10-12",
    metadata: { source: "explicit historical evidence for QA" },
    actorName: "Test scheduler",
  }).returning();
  return event.id;
}

async function addEndAudit(input: {
  organizationId: number;
  assignmentId: number;
  compensationEventId: number;
}) {
  const [audit] = await db.insert(auditEvents).values({
    organizationId: input.organizationId,
    actor: "Test scheduler",
    action: "Recurring compensation component ended",
    resource: "QA fixture",
    metadata: {
      componentAssignmentId: input.assignmentId,
      compensationEventId: input.compensationEventId,
    },
  }).returning();
  return audit.id;
}

test("legacy ended assignments with missing events/audits are reported and never backfilled", async () => {
  await withOrganization(async ({ organizationId, employeeId, addEnded }) => {
    const missingAll = await addEnded();
    const missingAudit = await addEnded();
    const complete = await addEnded();
    await addEndEvent({ organizationId, employeeId, assignmentId: missingAudit });
    const completeEvent = await addEndEvent({ organizationId, employeeId, assignmentId: complete });
    await addEndAudit({ organizationId, assignmentId: complete, compensationEventId: completeEvent });

    const report = await inspectEndedCompensationEvidence({ organizationId });
    assert.equal(report.examined, 3);
    assert.equal(report.completeCount, 1);
    assert.equal(report.needsReviewCount, 2);
    assert.equal(report.nextCursor, null);
    assert.equal(report.readOnly, true);
    assert.equal(report.independentlyVerified, false);
    assert.deepEqual(report.findings.find((f) => f.assignmentId === missingAll)?.codes,
      ["missing_financial_event", "missing_operational_audit"]);
    assert.deepEqual(report.findings.find((f) => f.assignmentId === missingAudit)?.codes,
      ["missing_operational_audit"]);

    // A read-only review must not manufacture financial or audit evidence.
    const repeated = await inspectEndedCompensationEvidence({ organizationId });
    assert.deepEqual(repeated.findings, report.findings);
  });
});

test("mismatched effective date, duplicates and unmatched audit links fail visibly", async () => {
  await withOrganization(async ({ organizationId, employeeId, addEnded }) => {
    const broken = await addEnded();
    const one = await addEndEvent({
      organizationId, employeeId, assignmentId: broken, effectiveDate: "2026-10-11",
    });
    await addEndEvent({ organizationId, employeeId, assignmentId: broken });
    await addEndAudit({ organizationId, assignmentId: broken, compensationEventId: one + 99999 });
    await addEndAudit({ organizationId, assignmentId: broken, compensationEventId: one });
    const invalidDate = await addEnded(null);
    const report = await inspectEndedCompensationEvidence({ organizationId });
    const row = report.findings.find((f) => f.assignmentId === broken);
    assert.deepEqual(row?.codes, [
      "duplicate_financial_events",
      "financial_date_mismatch",
      "duplicate_operational_audits",
      "audit_event_link_mismatch",
    ]);
    const missingEnd = report.findings.find((f) => f.assignmentId === invalidDate);
    assert.ok(missingEnd?.codes.includes("missing_effective_end"));
    assert.ok(missingEnd?.codes.includes("missing_financial_event"));
  });
});

test("bounded keyset pagination forces review of all tenant pages", async () => {
  await withOrganization(async ({ organizationId, employeeId, addEnded }) => {
    const ids = [await addEnded(), await addEnded(), await addEnded()];
    for (const id of ids) {
      const event = await addEndEvent({ organizationId, employeeId, assignmentId: id });
      await addEndAudit({ organizationId, assignmentId: id, compensationEventId: event });
    }

    const first = await inspectEndedCompensationEvidence({ organizationId, limit: 2 });
    assert.equal(first.completeCount, 2);
    assert.equal(first.nextCursor, ids[1]);
    assert.equal(first.findings.length, 0);
    const second = await inspectEndedCompensationEvidence({
      organizationId, afterAssignmentId: first.nextCursor!, limit: 2,
    });
    assert.equal(second.completeCount, 1);
    assert.equal(second.nextCursor, null);
    assert.equal(second.examined, 1);
    await assert.rejects(inspectEndedCompensationEvidence({ organizationId: 0 }));
    await assert.rejects(inspectEndedCompensationEvidence({ organizationId, limit: 251 }));
    await assert.rejects(inspectEndedCompensationEvidence({ organizationId, afterAssignmentId: -1 }));
  });
});

test("organization scoping rejects foreign events and audit rows even if assignment IDs match", async () => {
  await withOrganization(async (first) => {
    await withOrganization(async (other) => {
      const target = await first.addEnded();
      await addEndEvent({
        organizationId: other.organizationId,
        employeeId: other.employeeId,
        assignmentId: target,
      });
      await addEndAudit({
        organizationId: other.organizationId,
        assignmentId: target,
        compensationEventId: 42,
      });
      const report = await inspectEndedCompensationEvidence({ organizationId: first.organizationId });
      assert.equal(report.examined, 1);
      assert.deepEqual(report.findings[0].codes,
        ["missing_financial_event", "missing_operational_audit"]);
      assert.equal(report.findings[0].financialEventIds.length, 0);
      assert.equal(report.findings[0].auditEventIds.length, 0);
    });
  });
});
