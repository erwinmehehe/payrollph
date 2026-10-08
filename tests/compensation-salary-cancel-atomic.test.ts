import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  approvalTasks,
  auditEvents,
  compensationBands,
  compensationCycles,
  compensationEvents,
  compensationProposals,
  employeePayProfiles,
  employeePayRevisions,
  employees,
  organizations,
  payrollEntries,
  payrollRuns,
  users,
} from "../src/db/schema";
import {
  applyScheduledCompensationProposal,
  cancelGovernedCompensationProposal,
} from "../src/lib/hcm-compensation";

const NOW = new Date("2026-10-08T08:00:00Z");
type ProposalStatus = "proposed" | "scheduled" | "failed";
type RunStatus = "Needs review" | "Released" | "Processing";

type Fixture = {
  organizationId: number;
  employeeId: number;
  proposalId: number;
  cycleId: number;
  revisionId: number | null;
  runId: number;
  taskId: number;
  actorUserId: number;
  effectiveDate: string;
};

async function withFixture(
  status: ProposalStatus,
  exercise: (fixture: Fixture) => Promise<void>,
  options: { effectiveDate?: string; payrollStatus?: RunStatus } = {},
) {
  const [organization] = await db.insert(organizations).values({
    name: "Salary Cancel Atomicity QA",
    legalName: "Salary Cancel Atomicity QA Inc.",
    plan: "Core",
  }).returning();
  const userIds: number[] = [];
  try {
    const suffix = randomUUID();
    const [maker, checker] = await db.insert(users).values([
      { email: `salary-cancel-maker-${suffix}@example.invalid`, name: "Salary Maker", passwordHash: "test-only" },
      { email: `salary-cancel-checker-${suffix}@example.invalid`, name: "Salary Checker", passwordHash: "test-only" },
    ]).returning();
    userIds.push(maker.id, checker.id);

    const [worker] = await db.insert(employees).values({
      organizationId: organization.id,
      employeeNo: "SALARY-CANCEL-01",
      firstName: "Salary",
      lastName: "Worker",
      title: "Operations",
      avatarInitials: "SW",
      basicRate: "30000.00",
      startDate: "2026-01-01",
      mobile: "09171234567",
    }).returning();
    await db.insert(employeePayProfiles).values({
      organizationId: organization.id,
      employeeId: worker.id,
      payBasis: "monthly",
      rateAmount: "30000.00",
      standardWorkDaysPerMonth: "22",
      standardHoursPerDay: "8",
    });

    const [band] = await db.insert(compensationBands).values({
      organizationId: organization.id,
      minimumAnnual: "300000.00",
      midpointAnnual: "400000.00",
      maximumAnnual: "500000.00",
      effectiveFrom: "2026-01-01",
      locationCode: "PH",
    }).returning();

    const effectiveDate = options.effectiveDate ?? "2026-10-20";
    const [cycle] = await db.insert(compensationCycles).values({
      organizationId: organization.id,
      name: "Salary Cancellation QA",
      startDate: "2026-10-01",
      endDate: "2026-11-30",
      effectiveDate,
      budgetPool: "100000.00",
      status: "active",
      createdBy: maker.name,
      createdByUserId: maker.id,
    }).returning();

    let revisionId: number | null = null;
    if (status !== "proposed") {
      const [revision] = await db.insert(employeePayRevisions).values({
        organizationId: organization.id,
        employeeId: worker.id,
        effectiveDate,
        previousPayBasis: "monthly",
        previousRateAmount: "30000.00",
        previousStandardWorkDaysPerMonth: "22.00",
        previousStandardHoursPerDay: "8.00",
        newPayBasis: "monthly",
        newRateAmount: "32000.00",
        newStandardWorkDaysPerMonth: "22.00",
        newStandardHoursPerDay: "8.00",
        reason: "Approved compensation cycle: Salary Cancellation QA",
        createdBy: checker.name,
      }).returning();
      revisionId = revision.id;
    }

    const [proposal] = await db.insert(compensationProposals).values({
      organizationId: organization.id,
      cycleId: cycle.id,
      employeeId: worker.id,
      bandId: band.id,
      status,
      currentAnnual: "360000.00",
      proposedAnnual: "384000.00",
      reason: "Approved annual pay adjustment review",
      submittedByUserId: maker.id,
      approvedByUserId: status !== "proposed" ? checker.id : null,
      approvedAt: status !== "proposed" ? NOW : null,
      appliedPayRevisionId: revisionId,
    }).returning();

    const [run] = await db.insert(payrollRuns).values({
      organizationId: organization.id,
      periodLabel: "Oct 16-31 salary cancellation QA",
      periodStart: "2026-10-16",
      periodEnd: "2026-10-31",
      payDate: "2026-10-31",
      scopeLabel: "All locations",
      status: options.payrollStatus ?? "Needs review",
      employeeCount: 1,
      processedChunks: 1,
      totalChunks: 1,
      grossPay: "30000.00",
      netPay: "25000.00",
    }).returning();

    await db.insert(payrollEntries).values({
      payrollRunId: run.id,
      employeeId: worker.id,
      grossPay: "30000.00",
      deductions: "5000.00",
      netPay: "25000.00",
      status: "Ready",
    });
    const [task] = await db.insert(approvalTasks).values({
      organizationId: organization.id,
      payrollRunId: run.id,
      title: "Salary cancellation payroll review",
      detail: `Payroll run #${run.id} · salary revision`,
      approver: checker.name,
      dueLabel: "Required before release",
      status: "Approved",
    }).returning();

    await exercise({
      organizationId: organization.id,
      employeeId: worker.id,
      proposalId: proposal.id,
      cycleId: cycle.id,
      revisionId,
      runId: run.id,
      taskId: task.id,
      actorUserId: checker.id,
      effectiveDate,
    });
  } finally {
    await db.delete(organizations).where(eq(organizations.id, organization.id));
    if (userIds.length > 0) await db.delete(users).where(inArray(users.id, userIds));
  }
}

function cancel(fixture: Fixture, actorUserId = fixture.actorUserId) {
  return cancelGovernedCompensationProposal({
    proposalId: fixture.proposalId,
    organizationId: fixture.organizationId,
    employeeId: fixture.employeeId,
    actorUserId,
    actorName: "Salary Checker",
    now: NOW,
  });
}

async function snapshot(fixture: Fixture) {
  const [[proposal], [run], [task], entries, revisions, events, audits] = await Promise.all([
    db.select().from(compensationProposals).where(eq(compensationProposals.id, fixture.proposalId)),
    db.select().from(payrollRuns).where(eq(payrollRuns.id, fixture.runId)),
    db.select().from(approvalTasks).where(eq(approvalTasks.id, fixture.taskId)),
    db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, fixture.runId)),
    db.select().from(employeePayRevisions).where(eq(employeePayRevisions.employeeId, fixture.employeeId)),
    db.select().from(compensationEvents).where(eq(compensationEvents.proposalId, fixture.proposalId)),
    db.select().from(auditEvents).where(eq(auditEvents.organizationId, fixture.organizationId)),
  ]);
  return { proposal, run, task, entries, revisions, events, audits };
}

test("scheduled salary cancellation atomically resets payroll, supersedes approval and records revision evidence", async () => {
  await withFixture("scheduled", async (fixture) => {
    const result = await cancel(fixture);
    assert.deepEqual(result.invalidatedPayrollRunIds, [fixture.runId]);
    assert.equal(result.cancelledPayRevisionId, fixture.revisionId);
    const after = await snapshot(fixture);
    assert.equal(after.proposal.status, "cancelled");
    assert.equal(after.proposal.appliedPayRevisionId, null);
    assert.equal(after.run.status, "Draft");
    assert.equal(after.run.employeeCount, 0);
    assert.equal(after.entries.length, 0);
    assert.equal(after.task.status, "Superseded");
    assert.equal(after.revisions.length, 0);
    assert.equal(after.events.length, 1);
    assert.equal(after.events[0].eventType, "salary_change_cancelled");
    assert.equal((after.events[0].metadata as { cancelledPayRevisionId: number }).cancelledPayRevisionId, fixture.revisionId);
    assert.ok(after.audits.some((entry) => entry.action === "Scheduled compensation proposal cancelled"));
    const activation = await applyScheduledCompensationProposal(fixture.proposalId, {
      actor: "Test scheduler", now: new Date("2026-10-21T08:00:00Z"),
    });
    assert.equal(activation.skipped, true);
  });
});

test("proposed salary cancellation leaves a calculated payroll and checker approval intact", async () => {
  await withFixture("proposed", async (fixture) => {
    const result = await cancel(fixture);
    assert.deepEqual(result.invalidatedPayrollRunIds, []);
    assert.equal(result.cancelledPayRevisionId, null);
    const after = await snapshot(fixture);
    assert.equal(after.proposal.status, "cancelled");
    assert.equal(after.run.status, "Needs review");
    assert.equal(after.entries.length, 1);
    assert.equal(after.task.status, "Approved");
    assert.equal(after.events.length, 1);
    assert.ok(after.audits.some((event) => event.action === "Compensation proposal cancelled"));
  });
});

test("failed salary cancellation downstream error rolls back revision deletion, payroll reset and checker state", async () => {
  await withFixture("scheduled", async (fixture) => {
    // Invalid reviewer ID makes the compensation-event FK fail after the
    // payroll entries and pay revision were changed inside the transaction.
    await assert.rejects(cancel(fixture, 2147483647));
    const after = await snapshot(fixture);
    assert.equal(after.proposal.status, "scheduled");
    assert.equal(after.proposal.appliedPayRevisionId, fixture.revisionId);
    assert.equal(after.run.status, "Needs review");
    assert.equal(after.run.employeeCount, 1);
    assert.equal(after.run.grossPay, "30000.00");
    assert.equal(after.task.status, "Approved");
    assert.equal(after.entries.length, 1);
    assert.deepEqual(after.revisions.map((row) => row.id), [fixture.revisionId]);
    assert.equal(after.events.length, 0);
    assert.equal(after.audits.length, 0);
  });
});

test("released or busy payroll cannot be rewritten by cancellation", async () => {
  for (const payrollStatus of ["Released", "Processing"] as const) {
    await withFixture("scheduled", async (fixture) => {
      await assert.rejects(cancel(fixture), /Payroll run #|Compensation cannot change/);
      const after = await snapshot(fixture);
      assert.equal(after.proposal.status, "scheduled");
      assert.equal(after.run.status, payrollStatus);
      assert.equal(after.entries.length, 1);
      assert.equal(after.task.status, "Approved");
      assert.equal(after.revisions.length, 1);
      assert.equal(after.events.length, 0);
    }, { payrollStatus });
  }
});

test("salary already effective today requires an audited correction instead of deleting a pay revision", async () => {
  await withFixture("scheduled", async (fixture) => {
    await assert.rejects(cancel(fixture), /COMPENSATION_CANCELLATION_RETROACTIVE/);
    const after = await snapshot(fixture);
    assert.equal(after.proposal.status, "scheduled");
    assert.equal(after.run.status, "Needs review");
    assert.equal(after.entries.length, 1);
    assert.equal(after.revisions.length, 1);
  }, { effectiveDate: "2026-10-08" });
});

test("cancellation rejects later pay revisions that depend on the approved salary", async () => {
  await withFixture("scheduled", async (fixture) => {
    await db.insert(employeePayRevisions).values({
      organizationId: fixture.organizationId,
      employeeId: fixture.employeeId,
      effectiveDate: "2026-11-15",
      previousPayBasis: "monthly",
      previousRateAmount: "32000.00",
      previousStandardWorkDaysPerMonth: "22.00",
      previousStandardHoursPerDay: "8.00",
      newPayBasis: "monthly",
      newRateAmount: "33000.00",
      newStandardWorkDaysPerMonth: "22.00",
      newStandardHoursPerDay: "8.00",
      reason: "Follow-on salary revision",
      createdBy: "Salary Checker",
    });
    await assert.rejects(cancel(fixture), /COMPENSATION_CANCELLATION_DOWNSTREAM_REVISION/);
    const after = await snapshot(fixture);
    assert.equal(after.proposal.status, "scheduled");
    assert.equal(after.run.status, "Needs review");
    assert.equal(after.task.status, "Approved");
    assert.equal(after.entries.length, 1);
    assert.equal(after.revisions.length, 2);
  });
});

test("two concurrent salary cancellations commit only one decision and one event", async () => {
  await withFixture("scheduled", async (fixture) => {
    const results = await Promise.allSettled([cancel(fixture), cancel(fixture)]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    const after = await snapshot(fixture);
    assert.equal(after.proposal.status, "cancelled");
    assert.equal(after.run.status, "Draft");
    assert.equal(after.events.length, 1);
    assert.equal(after.audits.length, 1);
  });
});

test("unapproved proposal cannot erase an unexpectedly linked pay revision", async () => {
  await withFixture("proposed", async (fixture) => {
    const [revision] = await db.insert(employeePayRevisions).values({
      organizationId: fixture.organizationId,
      employeeId: fixture.employeeId,
      effectiveDate: fixture.effectiveDate,
      previousPayBasis: "monthly",
      previousRateAmount: "30000.00",
      previousStandardWorkDaysPerMonth: "22.00",
      previousStandardHoursPerDay: "8.00",
      newPayBasis: "monthly",
      newRateAmount: "32000.00",
      newStandardWorkDaysPerMonth: "22.00",
      newStandardHoursPerDay: "8.00",
      reason: "Orphan linked revision QA",
      createdBy: "Salary Checker",
    }).returning();
    await db.update(compensationProposals).set({
      appliedPayRevisionId: revision.id,
    }).where(eq(compensationProposals.id, fixture.proposalId));
    await assert.rejects(cancel(fixture), /COMPENSATION_CANCELLATION_REVISION_STALE/);
    const after = await snapshot(fixture);
    assert.equal(after.proposal.status, "proposed");
    assert.equal(after.run.status, "Needs review");
    assert.equal(after.revisions.length, 1);
    assert.equal(after.events.length, 0);
  });
});
