import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  auditEvents,
  compensationAutomationIntents,
  compensationBands,
  compensationCycles,
  compensationEvents,
  compensationProposals,
  employeePayRevisions,
  employees,
  organizations,
} from "../src/db/schema";
import { inspectAppliedSalaryEvidence } from "../src/lib/compensation-salary-evidence-preflight";

type AppliedSalaryFixture = {
  proposalId: number;
  employeeId: number;
  revisionId: number;
  financialEventId: number | null;
  operationalAuditId: number | null;
  intentIds: number[];
};

async function withOrganization(work: (fixture: {
  organizationId: number;
  addApplied: (withEvidence?: boolean) => Promise<AppliedSalaryFixture>;
}) => Promise<void>) {
  const [org] = await db.insert(organizations).values({
    name: "Salary Evidence Preflight QA",
    legalName: "Salary Evidence Preflight QA Inc.",
    plan: "Core",
  }).returning();
  try {
    const [band] = await db.insert(compensationBands).values({
      organizationId: org.id,
      minimumAnnual: "300000.00",
      midpointAnnual: "400000.00",
      maximumAnnual: "500000.00",
      effectiveFrom: "2026-01-01",
      locationCode: "PH",
    }).returning();
    const [cycle] = await db.insert(compensationCycles).values({
      organizationId: org.id,
      name: "Salary Evidence QA",
      startDate: "2026-10-01",
      endDate: "2026-11-30",
      effectiveDate: "2026-10-20",
      budgetPool: "90000.00",
      status: "active",
      createdBy: "Independent QA",
    }).returning();
    let counter = 0;
    const addApplied = async (withEvidence = true): Promise<AppliedSalaryFixture> => {
      counter++;
      const [employee] = await db.insert(employees).values({
        organizationId: org.id,
        employeeNo: `SAL-EVID-${counter}`,
        firstName: "Evidence",
        lastName: `Person ${counter}`,
        title: "Operations",
        avatarInitials: "EP",
        basicRate: "32000.00",
        startDate: "2026-01-01",
      }).returning();
      const [revision] = await db.insert(employeePayRevisions).values({
        organizationId: org.id,
        employeeId: employee.id,
        effectiveDate: "2026-10-20",
        previousPayBasis: "monthly",
        previousRateAmount: "30000.00",
        previousStandardWorkDaysPerMonth: "22",
        previousStandardHoursPerDay: "8",
        newPayBasis: "monthly",
        newRateAmount: "32000.00",
        newStandardWorkDaysPerMonth: "22",
        newStandardHoursPerDay: "8",
        reason: "Governed compensation salary evidence QA",
        createdBy: "Payroll checker",
      }).returning();
      const [proposal] = await db.insert(compensationProposals).values({
        organizationId: org.id,
        employeeId: employee.id,
        cycleId: cycle.id,
        bandId: band.id,
        currentAnnual: "360000.00",
        proposedAnnual: "384000.00",
        reason: "Independent salary evidence verification",
        status: "applied",
        appliedAt: new Date("2026-10-20T08:00:00Z"),
        appliedPayRevisionId: revision.id,
      }).returning();

      if (!withEvidence) return {
        proposalId: proposal.id,
        employeeId: employee.id,
        revisionId: revision.id,
        financialEventId: null,
        operationalAuditId: null,
        intentIds: [],
      };

      const [event] = await db.insert(compensationEvents).values({
        organizationId: org.id,
        employeeId: employee.id,
        proposalId: proposal.id,
        payRevisionId: revision.id,
        eventType: "salary_change",
        effectiveDate: "2026-10-20",
        previousAnnual: "360000.00",
        newAnnual: "384000.00",
        actorName: "Independent QA",
      }).returning();
      const [audit] = await db.insert(auditEvents).values({
        organizationId: org.id,
        actor: "Independent QA",
        action: "Scheduled compensation change applied",
        resource: `Employee #${employee.id}`,
        metadata: {
          proposalId: proposal.id,
          compensationEventId: event.id,
          payRevisionId: revision.id,
          effectiveDate: "2026-10-20",
        },
      }).returning();

      const [payout, annual, monthly] = await db.insert(compensationAutomationIntents).values([
        {
          organizationId: org.id,
          employeeId: employee.id,
          compensationEventId: event.id,
          trigger: "compensation.changed",
          eventKey: `compensation-applied:${proposal.id}`,
          context: { sensitiveAnnualSalary: 384000 },
          status: "pending",
        },
        {
          organizationId: org.id,
          employeeId: employee.id,
          compensationEventId: event.id,
          trigger: "employee.field_changed",
          eventKey: `compensation-applied:${proposal.id}:field-change:annualsalary`,
          context: { sensitiveAnnualSalary: 384000 },
          status: "dispatched",
        },
        {
          organizationId: org.id,
          employeeId: employee.id,
          compensationEventId: event.id,
          trigger: "employee.field_changed",
          eventKey: `compensation-applied:${proposal.id}:field-change:monthlyequivalentsalary`,
          context: { sensitiveMonthlySalary: 32000 },
          status: "dispatched",
        },
      ]).returning();
      return {
        proposalId: proposal.id,
        employeeId: employee.id,
        revisionId: revision.id,
        financialEventId: event.id,
        operationalAuditId: audit.id,
        intentIds: [payout.id, annual.id, monthly.id],
      };
    };
    await work({ organizationId: org.id, addApplied });
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
}

test("a fully linked applied salary passes structural evidence review without exposing pay", async () => {
  await withOrganization(async ({ organizationId, addApplied }) => {
    const salary = await addApplied();
    const report = await inspectAppliedSalaryEvidence({ organizationId });
    assert.equal(report.examined, 1);
    assert.equal(report.completeEvidenceCount, 1);
    assert.equal(report.needsReviewCount, 0);
    assert.equal(report.pendingDeliveryCount, 1,
      "a structurally complete record may still have an undelivered notification");
    assert.equal(report.findings.length, 0);
    assert.equal(report.nextCursor, null);
    assert.equal(report.readOnly, true);
    assert.equal(report.independentlyVerified, false);
    const visible = JSON.stringify(report);
    assert.ok(!visible.includes("sensitiveAnnualSalary"));
    assert.ok(!visible.includes("384000"));
    assert.ok(!visible.includes("32000"));
    assert.ok(!visible.includes(String(salary.employeeId) + ":employee"));

    const [eventBefore] = await db.select().from(compensationEvents)
      .where(eq(compensationEvents.id, salary.financialEventId!));
    const after = await inspectAppliedSalaryEvidence({ organizationId });
    const [eventAfter] = await db.select().from(compensationEvents)
      .where(eq(compensationEvents.id, salary.financialEventId!));
    assert.deepEqual(after.findings, report.findings);
    assert.deepEqual(eventAfter, eventBefore,
      "read-only evidence inspection must never mutate financial records");
  });
});

test("legacy applied salary with missing audit and intents is flagged, not silently backfilled", async () => {
  await withOrganization(async ({ organizationId, addApplied }) => {
    const legacy = await addApplied(false);
    const report = await inspectAppliedSalaryEvidence({ organizationId });
    assert.equal(report.needsReviewCount, 1);
    assert.equal(report.completeEvidenceCount, 0);
    assert.equal(report.findings[0].proposalId, legacy.proposalId);
    assert.deepEqual(report.findings[0].issues, [
      "missing_salary_event",
      "missing_operational_audit",
      "missing_notification_intent",
    ]);
    assert.deepEqual(report.findings[0].salaryEventIds, []);
    assert.deepEqual(report.findings[0].operationalAuditIds, []);
    assert.deepEqual(report.findings[0].notificationIntentIds, []);
    const events = await db.select().from(compensationEvents)
      .where(eq(compensationEvents.organizationId, organizationId));
    assert.equal(events.length, 0, "historical evidence must not be manufactured");
  });
});

test("incorrect audit links, event dates and missing notification types fail visibly", async () => {
  await withOrganization(async ({ organizationId, addApplied }) => {
    const data = await addApplied();
    await db.update(compensationEvents).set({
      effectiveDate: "2026-10-21",
      payRevisionId: null,
    }).where(eq(compensationEvents.id, data.financialEventId!));
    await db.update(auditEvents).set({
      metadata: {
        proposalId: data.proposalId,
        compensationEventId: data.financialEventId! + 90000,
        payRevisionId: data.revisionId + 90000,
      },
    }).where(eq(auditEvents.id, data.operationalAuditId!));
    await db.delete(compensationAutomationIntents).where(
      eq(compensationAutomationIntents.id, data.intentIds[2]),
    );
    const report = await inspectAppliedSalaryEvidence({ organizationId });
    assert.equal(report.needsReviewCount, 1);
    const codes = report.findings[0].issues;
    for (const expected of [
      "event_date_mismatch",
      "event_revision_mismatch",
      "audit_event_link_mismatch",
      "audit_revision_mismatch",
      "missing_notification_intent",
    ] as const) assert.ok(codes.includes(expected), `Missing expected issue ${expected}`);
  });
});

test("duplicate salary events and events needing notification review are separately detected", async () => {
  await withOrganization(async ({ organizationId, addApplied }) => {
    const data = await addApplied();
    await db.insert(compensationEvents).values({
      organizationId,
      employeeId: data.employeeId,
      proposalId: data.proposalId,
      payRevisionId: data.revisionId,
      eventType: "salary_change",
      effectiveDate: "2026-10-20",
    });
    await db.update(compensationAutomationIntents).set({ status: "needs_review" })
      .where(eq(compensationAutomationIntents.id, data.intentIds[0]));
    const report = await inspectAppliedSalaryEvidence({ organizationId });
    assert.equal(report.needsReviewCount, 1);
    assert.ok(report.findings[0].issues.includes("duplicate_salary_events"));
    assert.ok(report.findings[0].issues.includes("notification_needs_review"));
    assert.equal(report.findings[0].salaryEventIds.length, 2);
  });
});

test("keyset pagination requires every page and arguments are strictly bounded", async () => {
  await withOrganization(async ({ organizationId, addApplied }) => {
    const rows = [await addApplied(), await addApplied(), await addApplied()];
    const first = await inspectAppliedSalaryEvidence({ organizationId, limit: 2 });
    assert.equal(first.examined, 2);
    assert.equal(first.completeEvidenceCount, 2);
    assert.equal(first.nextCursor, rows[1].proposalId);
    const second = await inspectAppliedSalaryEvidence({
      organizationId, afterProposalId: first.nextCursor!, limit: 2,
    });
    assert.equal(second.examined, 1);
    assert.equal(second.completeEvidenceCount, 1);
    assert.equal(second.nextCursor, null);
    assert.deepEqual(second.findings, []);
    await assert.rejects(inspectAppliedSalaryEvidence({ organizationId: 0 }));
    await assert.rejects(inspectAppliedSalaryEvidence({ organizationId, limit: 0 }));
    await assert.rejects(inspectAppliedSalaryEvidence({ organizationId, limit: 251 }));
    await assert.rejects(inspectAppliedSalaryEvidence({ organizationId, afterProposalId: -1 }));
  });
});

test("an unrelated employer cannot supply substitute salary financial or audit evidence", async () => {
  await withOrganization(async (first) => {
    await withOrganization(async (foreign) => {
      const legacy = await first.addApplied(false);
      const external = await foreign.addApplied();
      await db.insert(compensationEvents).values({
        organizationId: foreign.organizationId,
        employeeId: external.employeeId,
        proposalId: legacy.proposalId,
        eventType: "salary_change",
        effectiveDate: "2026-10-20",
      });
      await db.insert(auditEvents).values({
        organizationId: foreign.organizationId,
        actor: "Foreign employer auditor",
        action: "Scheduled compensation change applied",
        resource: "Other employer",
        metadata: {
          proposalId: legacy.proposalId,
          compensationEventId: external.financialEventId,
        },
      });
      const report = await inspectAppliedSalaryEvidence({
        organizationId: first.organizationId,
      });
      assert.equal(report.examined, 1);
      assert.equal(report.needsReviewCount, 1);
      assert.deepEqual(report.findings[0].issues, [
        "missing_salary_event",
        "missing_operational_audit",
        "missing_notification_intent",
      ]);
      assert.deepEqual(report.findings[0].salaryEventIds, []);
      assert.deepEqual(report.findings[0].operationalAuditIds, []);
    });
  });
});
