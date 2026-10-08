import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  approvalTasks,
  auditEvents,
  compensationComponents,
  compensationEvents,
  employeeCompensationComponents,
  employees,
  organizations,
  payrollEntries,
  payrollRuns,
  users,
} from "../src/db/schema";
import {
  activateCompensationComponentAssignment,
  decideRecurringCompensationComponent,
} from "../src/lib/hcm-compensation";

const NOW = new Date("2026-10-08T08:00:00.000Z");

async function withFixture(
  status: "pending_approval" | "scheduled",
  exercise: (fixture: {
    organizationId: number;
    employeeId: number;
    assignmentId: number;
    payrollRunId: number;
    approvalTaskId: number;
    makerUserId: number;
    checkerUserId: number;
  }) => Promise<void>,
  effectiveFrom = "2026-10-10",
) {
  const [org] = await db.insert(organizations).values({
    name: "Recurring Component Atomicity QA",
    legalName: "Recurring Component Atomicity QA Inc.",
    plan: "Core",
  }).returning();
  const disposableUsers: number[] = [];

  try {
    const uid = randomUUID();
    const [maker, checker] = await db.insert(users).values([
      { email: `component-maker-${uid}@example.invalid`, name: "Component Maker", passwordHash: "test-only" },
      { email: `component-checker-${uid}@example.invalid`, name: "Component Checker", passwordHash: "test-only" },
    ]).returning();
    disposableUsers.push(maker.id, checker.id);

    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "COMP-ATOMIC-01",
      firstName: "Component",
      lastName: "Worker",
      title: "Operations",
      avatarInitials: "CW",
      basicRate: "30000.00",
      startDate: "2026-01-01",
      mobile: "09171234567",
    }).returning();

    const [component] = await db.insert(compensationComponents).values({
      organizationId: org.id,
      code: "ATOMIC-ALLOWANCE",
      name: "Atomic allowance QA",
      kind: "allowance",
      amountFrequency: "monthly",
      active: true,
    }).returning();

    const [assignment] = await db.insert(employeeCompensationComponents).values({
      organizationId: org.id,
      employeeId: employee.id,
      componentId: component.id,
      amount: "2000.00",
      effectiveFrom,
      status,
      reason: "Approved eligible recurring pay review",
      requestedByUserId: maker.id,
      requestedBy: maker.name,
      ...(status === "scheduled" ? { approvedByUserId: checker.id, approvedBy: checker.name, approvedAt: NOW } : {}),
    }).returning();

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Oct 1-15 component atomicity",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-15",
      payDate: "2026-10-15",
      status: "Needs review",
      scopeLabel: "All locations",
      employeeCount: 1,
      grossPay: "30000.00",
      netPay: "25000.00",
      processedChunks: 1,
      totalChunks: 1,
    }).returning();

    await db.insert(payrollEntries).values({
      payrollRunId: run.id,
      employeeId: employee.id,
      grossPay: "30000.00",
      deductions: "5000.00",
      netPay: "25000.00",
      status: "Ready",
    });

    const [task] = await db.insert(approvalTasks).values({
      organizationId: org.id,
      payrollRunId: run.id,
      title: "Review compensation-affected payroll",
      detail: `Payroll run #${run.id} - component QA`,
      approver: checker.name,
      dueLabel: "Required before release",
      status: "Approved",
    }).returning();

    await exercise({
      organizationId: org.id,
      employeeId: employee.id,
      assignmentId: assignment.id,
      payrollRunId: run.id,
      approvalTaskId: task.id,
      makerUserId: maker.id,
      checkerUserId: checker.id,
    });
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
    if (disposableUsers.length > 0) {
      await db.delete(users).where(inArray(users.id, disposableUsers));
    }
  }
}

type Fixture = Parameters<Parameters<typeof withFixture>[1]>[0];

function decision(fixture: Fixture, action: "approve" | "cancel" | "decline", actorUserId = fixture.checkerUserId) {
  return decideRecurringCompensationComponent({
    assignmentId: fixture.assignmentId,
    organizationId: fixture.organizationId,
    employeeId: fixture.employeeId,
    decision: action,
    actorUserId,
    actorName: "Component Checker",
    now: NOW,
  });
}

async function state(fixture: Fixture) {
  const [assignment] = await db.select().from(employeeCompensationComponents).where(eq(employeeCompensationComponents.id, fixture.assignmentId));
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, fixture.payrollRunId));
  const [task] = await db.select().from(approvalTasks).where(eq(approvalTasks.id, fixture.approvalTaskId));
  const entries = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, fixture.payrollRunId));
  const events = await db.select().from(compensationEvents).where(eq(compensationEvents.componentAssignmentId, fixture.assignmentId));
  const audits = await db.select().from(auditEvents).where(eq(auditEvents.organizationId, fixture.organizationId));
  return { assignment, run, task, entries, events, audits };
}

test("approved recurring component and payroll reset/audit commit as one decision", async () => {
  await withFixture("pending_approval", async (fixture) => {
    const result = await decision(fixture, "approve");
    assert.equal(result.nextStatus, "scheduled");
    assert.deepEqual(result.invalidatedPayrollRunIds, [fixture.payrollRunId]);
    const current = await state(fixture);
    assert.equal(current.assignment.status, "scheduled");
    assert.equal(current.run.status, "Draft");
    assert.equal(current.run.employeeCount, 0);
    assert.equal(current.entries.length, 0);
    assert.equal(current.task.status, "Superseded");
    assert.equal(current.events.length, 1);
    assert.equal(current.events[0].eventType, "component_scheduled");
    assert.ok(current.audits.some((event) => event.action === "Recurring compensation component approved and scheduled"));
  });
});

test("cancelling scheduled compensation atomically invalidates payroll and prevents later activation", async () => {
  await withFixture("scheduled", async (fixture) => {
    const result = await decision(fixture, "cancel");
    assert.equal(result.nextStatus, "cancelled");
    assert.deepEqual(result.invalidatedPayrollRunIds, [fixture.payrollRunId]);
    const activation = await activateCompensationComponentAssignment(fixture.assignmentId, {
      actor: "Test scheduler",
      now: new Date("2026-10-11T08:00:00.000Z"),
    });
    assert.equal(activation.skipped, true);
    const current = await state(fixture);
    assert.equal(current.assignment.status, "cancelled");
    assert.equal(current.run.status, "Draft");
    assert.equal(current.task.status, "Superseded");
    assert.equal(current.entries.length, 0);
    assert.deepEqual(current.events.map((event) => event.eventType), ["component_cancelled"]);
  });
});

test("failed downstream component mutation rolls back earlier payroll invalidation", async () => {
  await withFixture("pending_approval", async (fixture) => {
    await assert.rejects(
      decision(fixture, "approve", 2147483647),
      /foreign key|violates|constraint/i,
    );
    const current = await state(fixture);
    assert.equal(current.assignment.status, "pending_approval");
    assert.equal(current.run.status, "Needs review");
    assert.equal(current.run.employeeCount, 1);
    assert.equal(current.run.grossPay, "30000.00");
    assert.equal(current.task.status, "Approved");
    assert.equal(current.entries.length, 1);
    assert.equal(current.events.length, 0);
    assert.equal(current.audits.length, 0);
  });
});

test("two competing component approvals cannot both commit events or invalidate twice", async () => {
  await withFixture("pending_approval", async (fixture) => {
    const attempts = await Promise.allSettled([
      decision(fixture, "approve"),
      decision(fixture, "approve"),
    ]);
    assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((result) => result.status === "rejected").length, 1);
    const current = await state(fixture);
    assert.equal(current.assignment.status, "scheduled");
    assert.equal(current.run.status, "Draft");
    assert.equal(current.events.length, 1);
    assert.equal(current.audits.length, 1);
  });
});

test("past-effective scheduled component cannot be cancelled without audited retro workflow", async () => {
  await withFixture("scheduled", async (fixture) => {
    await assert.rejects(decision(fixture, "cancel"), /COMPONENT_CANCELLATION_RETROACTIVE/);
    const current = await state(fixture);
    assert.equal(current.assignment.status, "scheduled");
    assert.equal(current.run.status, "Needs review");
    assert.equal(current.task.status, "Approved");
    assert.equal(current.entries.length, 1);
    assert.equal(current.events.length, 0);
  }, "2026-10-07");
});

test("declining pending component writes audit without mutating calculated payroll", async () => {
  await withFixture("pending_approval", async (fixture) => {
    const result = await decision(fixture, "decline");
    assert.equal(result.nextStatus, "declined");
    assert.deepEqual(result.invalidatedPayrollRunIds, []);
    const current = await state(fixture);
    assert.equal(current.assignment.status, "declined");
    assert.equal(current.run.status, "Needs review");
    assert.equal(current.task.status, "Approved");
    assert.equal(current.entries.length, 1);
    assert.equal(current.events.length, 0);
    assert.ok(current.audits.some((event) => event.action === "Recurring compensation component declined"));
  });
});
