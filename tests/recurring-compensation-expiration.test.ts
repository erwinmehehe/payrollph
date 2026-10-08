import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  auditEvents,
  compensationComponents,
  compensationEvents,
  employeeCompensationComponents,
  employeePayProfiles,
  employees,
  organizations,
  payrollEntries,
  payrollRuns,
} from "../src/db/schema";
import {
  expireCompensationComponentAssignment,
  philippineBusinessDate,
  runScheduledCompensationGovernance,
} from "../src/lib/hcm-compensation";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";

const LAST_PAYABLE_DAY = "2026-10-12";
const LAST_DAY_BEFORE_MIDNIGHT = new Date("2026-10-12T15:59:59.000Z");
const FIRST_DAY_AFTER_MIDNIGHT = new Date("2026-10-12T16:00:00.000Z");
const AFTER_EXPIRATION = new Date("2026-10-14T08:00:00.000Z");

type TestAssignment = {
  organizationId: number;
  employeeId: number;
  componentId: number;
  assignmentId: number;
};

async function withAssignment(
  exercise: (assignment: TestAssignment) => Promise<void>,
  options: {
    status?: string;
    effectiveFrom?: string;
    effectiveUntil?: string | null;
  } = {},
) {
  const [org] = await db.insert(organizations).values({
    name: "Compensation Expiration QA",
    legalName: "Compensation Expiration QA Inc.",
    plan: "Core",
  }).returning();
  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "EXP-001",
      firstName: "Expiry",
      lastName: "Worker",
      title: "Operations",
      avatarInitials: "EW",
      basicRate: "30000.00",
      startDate: "2026-01-01",
      mobile: "09171234567",
    }).returning();
    const [component] = await db.insert(compensationComponents).values({
      organizationId: org.id,
      code: "EXPIRY-ALLOWANCE",
      name: "Expiry allowance",
      kind: "allowance",
      amountFrequency: "monthly",
      active: true,
    }).returning();
    const [assignment] = await db.insert(employeeCompensationComponents).values({
      organizationId: org.id,
      employeeId: employee.id,
      componentId: component.id,
      amount: "2000.00",
      effectiveFrom: options.effectiveFrom ?? "2026-10-10",
      effectiveUntil: options.effectiveUntil === undefined ? LAST_PAYABLE_DAY : options.effectiveUntil,
      status: options.status ?? "active",
      reason: "Approved recurring allowance with fixed last payable day",
      requestedBy: "Payroll QA",
      approvedBy: "Payroll checker",
      approvedAt: new Date("2026-10-01T08:00:00Z"),
    }).returning();

    await exercise({
      organizationId: org.id,
      employeeId: employee.id,
      componentId: component.id,
      assignmentId: assignment.id,
    });
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
}

async function snapshot(fixture: TestAssignment) {
  const [[assignment], events, auditRows] = await Promise.all([
    db.select().from(employeeCompensationComponents).where(
      eq(employeeCompensationComponents.id, fixture.assignmentId),
    ),
    db.select().from(compensationEvents).where(
      eq(compensationEvents.componentAssignmentId, fixture.assignmentId),
    ),
    db.select().from(auditEvents).where(eq(auditEvents.organizationId, fixture.organizationId)),
  ]);
  return {
    assignment,
    endedEvents: events.filter((event) => event.eventType === "component_ended"),
    endingAudits: auditRows.filter((row) =>
      row.action === "Recurring compensation component ended"
      && (row.metadata as { componentAssignmentId?: number }).componentAssignmentId === fixture.assignmentId,
    ),
  };
}

test("expiry respects the Philippine last payable day and atomically writes both evidence records", async () => {
  await withAssignment(async (fixture) => {
    assert.equal(philippineBusinessDate(LAST_DAY_BEFORE_MIDNIGHT), "2026-10-12");
    assert.equal(philippineBusinessDate(FIRST_DAY_AFTER_MIDNIGHT), "2026-10-13");

    const before = await expireCompensationComponentAssignment(fixture.assignmentId, {
      actor: "Payroll scheduler",
      now: LAST_DAY_BEFORE_MIDNIGHT,
    });
    assert.equal(before.skipped, true);
    assert.equal(before.reason, "not_expired");

    const ended = await expireCompensationComponentAssignment(fixture.assignmentId, {
      actor: "Payroll scheduler",
      now: FIRST_DAY_AFTER_MIDNIGHT,
    });
    assert.equal(ended.skipped, false);
    assert.equal(ended.assignment.status, "ended");
    assert.equal(ended.event.id > 0, true);
    assert.equal(ended.audit.id > 0, true);

    const current = await snapshot(fixture);
    assert.equal(current.assignment.status, "ended");
    assert.equal(current.endedEvents.length, 1);
    assert.equal(String(current.endedEvents[0].effectiveDate), LAST_PAYABLE_DAY);
    assert.equal(current.endingAudits.length, 1);
    const evidence = current.endedEvents[0].metadata as {
      effectiveUntil: string; endedOnPhilippineDate: string;
    };
    assert.equal(evidence.effectiveUntil, LAST_PAYABLE_DAY);
    assert.equal(evidence.endedOnPhilippineDate, "2026-10-13");
    assert.equal(
      (current.endingAudits[0].metadata as { compensationEventId: number }).compensationEventId,
      current.endedEvents[0].id,
    );

    const second = await expireCompensationComponentAssignment(fixture.assignmentId, {
      now: AFTER_EXPIRATION,
    });
    assert.equal(second.skipped, true);
    assert.equal(second.reason, "already_ended");
    assert.equal((await snapshot(fixture)).endedEvents.length, 1);
  });
});

test("simultaneous scheduler workers create only one expiration and audit", async () => {
  await withAssignment(async (fixture) => {
    const outcomes = await Promise.all([
      expireCompensationComponentAssignment(fixture.assignmentId, { now: AFTER_EXPIRATION }),
      expireCompensationComponentAssignment(fixture.assignmentId, { now: AFTER_EXPIRATION }),
    ]);
    assert.equal(outcomes.filter((result) => !result.skipped).length, 1);
    assert.equal(outcomes.filter((result) => result.skipped).length, 1);
    const after = await snapshot(fixture);
    assert.equal(after.assignment.status, "ended");
    assert.equal(after.endedEvents.length, 1);
    assert.equal(after.endingAudits.length, 1);
  });
});

test("failed compensation evidence rolls back the status and can be retried", async () => {
  await withAssignment(async (fixture) => {
    // PostgreSQL rejects the non-existent actorUserId FK on event insertion.
    // The preceding status update must roll back together with the event.
    await assert.rejects(expireCompensationComponentAssignment(fixture.assignmentId, {
      actor: "Invalid reviewer regression",
      actorUserId: 2147483647,
      now: AFTER_EXPIRATION,
    }));
    const failed = await snapshot(fixture);
    assert.equal(failed.assignment.status, "active");
    assert.equal(failed.endedEvents.length, 0);
    assert.equal(failed.endingAudits.length, 0);

    const retry = await expireCompensationComponentAssignment(fixture.assignmentId, {
      actor: "System retry",
      now: AFTER_EXPIRATION,
    });
    assert.equal(retry.skipped, false);
    const completed = await snapshot(fixture);
    assert.equal(completed.assignment.status, "ended");
    assert.equal(completed.endedEvents.length, 1);
    assert.equal(completed.endingAudits.length, 1);
  });
});

test("scheduled and cancelled components cannot be prematurely ended", async () => {
  for (const status of ["scheduled", "cancelled"]) {
    await withAssignment(async (fixture) => {
      const result = await expireCompensationComponentAssignment(fixture.assignmentId, {
        now: AFTER_EXPIRATION,
      });
      assert.equal(result.skipped, true);
      assert.equal(result.reason, "not_active");
      const after = await snapshot(fixture);
      assert.equal(after.assignment.status, status);
      assert.equal(after.endedEvents.length, 0);
      assert.equal(after.endingAudits.length, 0);
    }, { status });
  }

  await withAssignment(async (fixture) => {
    const result = await expireCompensationComponentAssignment(fixture.assignmentId, {
      now: AFTER_EXPIRATION,
    });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "not_expired");
    assert.equal((await snapshot(fixture)).assignment.status, "active");
  }, { effectiveUntil: null });
});

test("scheduled expiration scan closes due rows once and keeps operational evidence visible", async () => {
  await withAssignment(async (fixture) => {
    const [secondComponent] = await db.insert(compensationComponents).values({
      organizationId: fixture.organizationId,
      code: "SECOND-EXPIRY",
      name: "Second expiry allowance",
      kind: "allowance",
      amountFrequency: "monthly",
      active: true,
    }).returning();
    const [secondAssignment] = await db.insert(employeeCompensationComponents).values({
      organizationId: fixture.organizationId,
      employeeId: fixture.employeeId,
      componentId: secondComponent.id,
      amount: "1500.00",
      effectiveFrom: "2026-10-10",
      effectiveUntil: "2026-10-12",
      status: "active",
      reason: "Second approved recurring allowance",
      requestedBy: "Payroll QA",
      approvedBy: "Payroll checker",
      approvedAt: new Date("2026-10-01T08:00:00Z"),
    }).returning();
    const first = await runScheduledCompensationGovernance({
      actor: "Compensation expiry scheduler",
      now: AFTER_EXPIRATION,
      limit: 100,
    });
    assert.ok(first.ended.includes(fixture.assignmentId));
    assert.ok(first.ended.includes(secondAssignment.id));
    assert.equal(first.expirationFailures.filter((failure) =>
      [fixture.assignmentId, secondAssignment.id].includes(failure.id),
    ).length, 0);

    const replay = await runScheduledCompensationGovernance({
      actor: "Compensation expiry scheduler",
      now: AFTER_EXPIRATION,
      limit: 100,
    });
    assert.equal(replay.ended.includes(fixture.assignmentId), false);
    assert.equal(replay.ended.includes(secondAssignment.id), false);
    const firstState = await snapshot(fixture);
    assert.equal(firstState.endedEvents.length, 1);
    assert.equal(firstState.endingAudits.length, 1);
    const secondState = await snapshot({
      ...fixture, componentId: secondComponent.id, assignmentId: secondAssignment.id,
    });
    assert.equal(secondState.endedEvents.length, 1);
    assert.equal(secondState.endingAudits.length, 1);
  });
});

test("actual expiration preserves earned recurring compensation for past cutoff but not later cutoffs", async () => {
  await withAssignment(async (fixture) => {
    const ended = await expireCompensationComponentAssignment(fixture.assignmentId, {
      now: AFTER_EXPIRATION,
    });
    assert.equal(ended.skipped, false);
    await db.insert(employeePayProfiles).values({
      organizationId: fixture.organizationId,
      employeeId: fixture.employeeId,
      payBasis: "monthly",
      rateAmount: "30000.00",
      standardWorkDaysPerMonth: "22",
      standardHoursPerDay: "8",
    });

    async function calculate(periodStart: string, periodEnd: string) {
      const [run] = await db.insert(payrollRuns).values({
        organizationId: fixture.organizationId,
        periodLabel: `Expiry QA ${periodStart}-${periodEnd}`,
        periodStart,
        periodEnd,
        payDate: periodEnd,
        scopeLabel: "All locations",
        status: "Draft",
      }).returning();
      await enqueuePayrollRun(run.id);
      await drainPayrollQueue(20, run.id);
      const [entry] = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
      assert.ok(entry, "historical and later payroll cutoffs must remain calculable");
      const items = entry.lineItems as Array<{ code?: string; amount?: number | string }>;
      return items.find((item) => item.code === `COMP-${fixture.assignmentId}`) ?? null;
    }

    const historic = await calculate("2026-10-01", "2026-10-15");
    assert.ok(historic, "expired but earned component remains payable in its historical cutoff");
    assert.equal(Number(historic.amount), 200);
    const future = await calculate("2026-10-16", "2026-10-31");
    assert.equal(future, null, "no component pay after the approved effective-until date");
    const after = await snapshot(fixture);
    assert.equal(after.endedEvents.length, 1);
    assert.equal(after.endingAudits.length, 1);
  });
});
