import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../src/db";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";
import {
  approvalTasks,
  auditEvents,
  compensationComponents,
  compensationEvents,
  compensationAutomationIntents,
  employeeCompensationComponents,
  employeePayProfiles,
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

test("same-day component approval records immutable notification snapshots in the financial commit", async () => {
  await withFixture("pending_approval", async (fixture) => {
    const approved = await decision(fixture, "approve");
    assert.equal(approved.nextStatus, "active");
    assert.deepEqual(approved.invalidatedPayrollRunIds, [fixture.payrollRunId]);

    const current = await state(fixture);
    assert.equal(current.assignment.status, "active");
    assert.equal(current.run.status, "Draft");
    assert.equal(current.entries.length, 0);
    const activationEvents = current.events.filter((event) => event.eventType === "component_activated");
    assert.equal(activationEvents.length, 1);
    const audits = current.audits.filter((event) =>
      event.action === "Recurring compensation component approved and activated"
    );
    assert.equal(audits.length, 1);
    assert.equal(
      (audits[0].metadata as { compensationEventId?: number }).compensationEventId,
      activationEvents[0].id,
      "the operational approval audit must link to the immediate financial activation",
    );

    const intents = await db.select().from(compensationAutomationIntents)
      .where(eq(compensationAutomationIntents.compensationEventId, activationEvents[0].id));
    assert.equal(intents.length, 2);
    assert.deepEqual(intents.map((row) => row.eventKey).sort(), [
      "compensation-component-active:" + fixture.assignmentId,
      "compensation-component-active:" + fixture.assignmentId + ":field-change:recurringcompensationamount",
    ]);
    assert.ok(intents.every((row) => row.status === "pending" && row.attempts === 0));

    const scheduler = await activateCompensationComponentAssignment(fixture.assignmentId, { now: NOW });
    assert.equal(scheduler.skipped, true);
    assert.equal(scheduler.reason, "already_active");
    assert.equal((await state(fixture)).events.filter((event) => event.eventType === "component_activated").length, 1);
  }, "2026-10-08");
});

test("same-day approval rolls back invalidation, activation and audit if durable delivery cannot be recorded", async () => {
  await withFixture("pending_approval", async (fixture) => {
    const token = randomUUID().replaceAll("-", "");
    const fn = "qa_today_outbox_" + token;
    const trg = "qa_today_outbox_trigger_" + token;
    const target = "compensation-component-active:" + fixture.assignmentId;
    await db.execute(sql.raw(
      'CREATE FUNCTION "' + fn + '"() RETURNS trigger AS $compfn$ BEGIN ' +
      "IF NEW.event_key = '" + target + "' THEN RAISE EXCEPTION 'QA same-day notification storage failure'; END IF; " +
      'RETURN NEW; END; $compfn$ LANGUAGE plpgsql'
    ));
    try {
      await db.execute(sql.raw(
        'CREATE TRIGGER "' + trg + '" BEFORE INSERT ON "compensation_automation_intents" ' +
        'FOR EACH ROW EXECUTE FUNCTION "' + fn + '"()'
      ));
      await assert.rejects(decision(fixture, "approve"));

      const failed = await state(fixture);
      assert.equal(failed.assignment.status, "pending_approval");
      assert.equal(failed.run.status, "Needs review");
      assert.equal(failed.run.employeeCount, 1);
      assert.equal(failed.entries.length, 1);
      assert.equal(failed.task.status, "Approved");
      assert.equal(failed.events.length, 0);
      assert.equal(failed.audits.length, 0);
      const orphaned = await db.select().from(compensationAutomationIntents)
        .where(eq(compensationAutomationIntents.organizationId, fixture.organizationId));
      assert.equal(orphaned.length, 0);
    } finally {
      await db.execute(sql.raw('DROP TRIGGER IF EXISTS "' + trg + '" ON "compensation_automation_intents"'));
      await db.execute(sql.raw('DROP FUNCTION IF EXISTS "' + fn + '"()'));
    }

    const retried = await decision(fixture, "approve");
    assert.equal(retried.nextStatus, "active");
    const recovered = await state(fixture);
    assert.equal(recovered.events.filter((event) => event.eventType === "component_activated").length, 1);
    const committed = await db.select().from(compensationAutomationIntents)
      .where(eq(compensationAutomationIntents.organizationId, fixture.organizationId));
    assert.equal(committed.length, 2);
  }, "2026-10-08");
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
    // Drizzle wraps the underlying PostgreSQL FK rejection as "Failed query".
    // The durable rollback assertions below verify the actual safety property,
    // independent of database adapter error-message formatting.
    await assert.rejects(decision(fixture, "approve", 2147483647));
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

test("past-effective compensation cannot be cancelled, even if activation races the attempted cancellation", async () => {
  await withFixture("scheduled", async (fixture) => {
    let rejection = "";
    await assert.rejects(decision(fixture, "cancel"), (error: unknown) => {
      rejection = error instanceof Error ? error.message : String(error);
      return /COMPONENT_CANCELLATION_RETROACTIVE|COMPONENT_ASSIGNMENT_STALE/.test(rejection);
    });
    const current = await state(fixture);
    assert.ok(["scheduled", "active"].includes(current.assignment.status),
      "cancellation must never undo a past-effective approved component");
    if (rejection.includes("COMPONENT_ASSIGNMENT_STALE")) {
      assert.equal(current.assignment.status, "active",
        "stale is allowed only if a competing scheduler already activated the assignment");
    }
    assert.equal(current.run.status, "Needs review");
    assert.equal(current.task.status, "Approved");
    assert.equal(current.entries.length, 1);
    assert.equal(current.events.filter((event) => event.eventType === "component_cancelled").length, 0);
    if (current.assignment.status === "active") {
      assert.equal(current.events.filter((event) => event.eventType === "component_activated").length, 1);
      assert.equal(current.audits.filter((event) => event.action === "Recurring compensation component activated").length, 1);
    } else {
      assert.equal(current.events.length, 0);
    }
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

test("a component effective today cannot be silently cancelled even if a scheduler wins activation", async () => {
  await withFixture("scheduled", async (fixture) => {
    let rejection = "";
    await assert.rejects(decision(fixture, "cancel"), (error: unknown) => {
      rejection = error instanceof Error ? error.message : String(error);
      return /COMPONENT_CANCELLATION_RETROACTIVE|COMPONENT_ASSIGNMENT_STALE/.test(rejection);
    });
    const current = await state(fixture);
    assert.ok(["scheduled", "active"].includes(current.assignment.status));
    if (rejection.includes("COMPONENT_ASSIGNMENT_STALE")) {
      assert.equal(current.assignment.status, "active");
    }
    assert.equal(current.run.status, "Needs review");
    assert.equal(current.entries.length, 1);
    assert.equal(current.events.filter((event) => event.eventType === "component_cancelled").length, 0);
    if (current.assignment.status === "active") {
      assert.equal(current.events.filter((event) => event.eventType === "component_activated").length, 1);
      assert.equal(current.audits.filter((event) => event.action === "Recurring compensation component activated").length, 1);
    } else {
      assert.equal(current.audits.length, 0);
    }
  }, "2026-10-08");
});

test("ended recurring compensation remains payable for an earlier overlapping cutoff", async () => {
  await withFixture("scheduled", async (fixture) => {
    await db.update(employeeCompensationComponents).set({
      status: "ended",
      effectiveUntil: "2026-10-12",
    }).where(eq(employeeCompensationComponents.id, fixture.assignmentId));
    await db.insert(employeePayProfiles).values({
      organizationId: fixture.organizationId,
      employeeId: fixture.employeeId,
      payBasis: "monthly",
      rateAmount: "30000.00",
      standardWorkDaysPerMonth: "22",
      standardHoursPerDay: "8",
    });
    await db.delete(payrollEntries).where(eq(payrollEntries.payrollRunId, fixture.payrollRunId));
    await db.update(payrollRuns).set({
      status: "Draft",
      employeeCount: 0,
      grossPay: "0",
      netPay: "0",
      processedChunks: 0,
      totalChunks: 0,
    }).where(eq(payrollRuns.id, fixture.payrollRunId));

    await enqueuePayrollRun(fixture.payrollRunId);
    await drainPayrollQueue(20, fixture.payrollRunId);

    const [calculated] = await db.select().from(payrollEntries).where(
      eq(payrollEntries.payrollRunId, fixture.payrollRunId),
    );
    assert.ok(calculated, "historical cutoff should recalculate");
    const lines = calculated.lineItems as Array<{ code?: string; amount?: string | number }>;
    const allowance = lines.find((line) => line.code === `COMP-${fixture.assignmentId}`);
    assert.ok(allowance, "ended but historically effective compensation must remain in payroll");
    assert.equal(Number(allowance.amount), 200);
  });
});


test("scheduled activation commits financial event and linked operational audit exactly once", async () => {
  await withFixture("scheduled", async (fixture) => {
    const activated = await activateCompensationComponentAssignment(fixture.assignmentId, {
      actor: "Atomic activation scheduler",
      now: new Date("2026-10-11T08:00:00Z"),
    });
    assert.equal(activated.skipped, false);
    assert.ok(activated.event.id > 0);
    assert.ok(activated.audit.id > 0);
    const after = await state(fixture);
    assert.equal(after.assignment.status, "active");
    assert.equal(after.events.filter((e) => e.eventType === "component_activated").length, 1);
    const audits = after.audits.filter((row) =>
      row.action === "Recurring compensation component activated"
      && (row.metadata as { componentAssignmentId?: number }).componentAssignmentId === fixture.assignmentId,
    );
    assert.equal(audits.length, 1);
    assert.equal((audits[0].metadata as { compensationEventId: number }).compensationEventId, activated.event.id);

    const repeated = await activateCompensationComponentAssignment(fixture.assignmentId, {
      actor: "Atomic activation scheduler",
      now: new Date("2026-10-11T08:01:00Z"),
    });
    assert.equal(repeated.skipped, true);
    assert.equal(repeated.reason, "already_active");
    assert.equal((await state(fixture)).audits.filter((a) => a.action === "Recurring compensation component activated").length, 1);
  });
});

test("concurrent scheduled activation workers cannot double-write financial or audit evidence", async () => {
  await withFixture("scheduled", async (fixture) => {
    const attempts = await Promise.all([
      activateCompensationComponentAssignment(fixture.assignmentId, {
        actor: "Activation worker 1", now: new Date("2026-10-11T08:00:00Z"),
      }),
      activateCompensationComponentAssignment(fixture.assignmentId, {
        actor: "Activation worker 2", now: new Date("2026-10-11T08:00:00Z"),
      }),
    ]);
    assert.equal(attempts.filter((v) => !v.skipped).length, 1);
    const after = await state(fixture);
    assert.equal(after.assignment.status, "active");
    assert.equal(after.events.filter((v) => v.eventType === "component_activated").length, 1);
    assert.equal(after.audits.filter((v) => v.action === "Recurring compensation component activated").length, 1);
  });
});

test("failed audit insertion rolls back activation and the financial event for a clean retry", async () => {
  await withFixture("scheduled", async (fixture) => {
    // Synthetic PostgreSQL fault injection, restricted to this test's
    // assignment ID. The trigger is always removed before the fixture ends.
    const suffix = randomUUID().replaceAll("-", "");
    const functionName = `qa_act_audit_${suffix}`;
    const triggerName = `qa_trg_${suffix}`;
    await db.execute(sql.raw(`CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'Recurring compensation component activated'
          AND NEW.metadata->>'componentAssignmentId' = '${fixture.assignmentId}'
        THEN
          RAISE EXCEPTION 'QA synthetic audit insertion failure';
        END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`));
    try {
      await db.execute(sql.raw(`CREATE TRIGGER "${triggerName}"
        BEFORE INSERT ON "audit_events" FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`));
      await assert.rejects(activateCompensationComponentAssignment(fixture.assignmentId, {
        actor: "Audit failure regression", now: new Date("2026-10-11T08:00:00Z"),
      }));
      const failed = await state(fixture);
      assert.equal(failed.assignment.status, "scheduled");
      assert.equal(failed.events.filter((v) => v.eventType === "component_activated").length, 0);
      assert.equal(failed.audits.filter((v) => v.action === "Recurring compensation component activated").length, 0);
      assert.equal(failed.run.status, "Needs review");
      assert.equal(failed.entries.length, 1);
      assert.equal(failed.task.status, "Approved");
    } finally {
      await db.execute(sql.raw(`DROP TRIGGER IF EXISTS "${triggerName}" ON "audit_events"`));
      await db.execute(sql.raw(`DROP FUNCTION IF EXISTS "${functionName}"()`));
    }

    const retried = await activateCompensationComponentAssignment(fixture.assignmentId, {
      actor: "Audit retry regression", now: new Date("2026-10-11T08:02:00Z"),
    });
    assert.equal(retried.skipped, false);
    const complete = await state(fixture);
    assert.equal(complete.assignment.status, "active");
    assert.equal(complete.events.filter((v) => v.eventType === "component_activated").length, 1);
    assert.equal(complete.audits.filter((v) => v.action === "Recurring compensation component activated").length, 1);
  });
});

test("activation cannot create audit evidence before the approved effective date", async () => {
  await withFixture("scheduled", async (fixture) => {
    const early = await activateCompensationComponentAssignment(fixture.assignmentId, {
      now: new Date("2026-10-09T12:00:00Z"),
    });
    assert.equal(early.skipped, true);
    assert.equal(early.reason, "not_due");
    const after = await state(fixture);
    assert.equal(after.assignment.status, "scheduled");
    assert.equal(after.events.filter((v) => v.eventType === "component_activated").length, 0);
    assert.equal(after.audits.filter((v) => v.action === "Recurring compensation component activated").length, 0);
  });
});


test("activation and its audit roll back if the transactional notification intent cannot be saved", async () => {
  await withFixture("scheduled", async (fixture) => {
    const token = randomUUID().replaceAll("-", "");
    const functionName = `qa_comp_outbox_${token}`;
    const triggerName = `qa_comp_outbox_trigger_${token}`;
    const target = `compensation-component-active:${fixture.assignmentId}`;
    await db.execute(sql.raw(`CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
      BEGIN
        IF NEW.event_key = '${target}' THEN
          RAISE EXCEPTION 'QA transactional outbox failure';
        END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`));
    try {
      await db.execute(sql.raw(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "compensation_automation_intents"
        FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`));
      await assert.rejects(activateCompensationComponentAssignment(fixture.assignmentId, {
        actor: "Outbox fault injection", now: new Date("2026-10-11T08:00:00Z"),
      }));
      const after = await state(fixture);
      assert.equal(after.assignment.status, "scheduled");
      assert.equal(after.events.filter((e) => e.eventType === "component_activated").length, 0);
      assert.equal(after.audits.filter((e) => e.action === "Recurring compensation component activated").length, 0);
      assert.equal(after.run.status, "Needs review");
      assert.equal(after.entries.length, 1);
    } finally {
      await db.execute(sql.raw(`DROP TRIGGER IF EXISTS "${triggerName}" ON "compensation_automation_intents"`));
      await db.execute(sql.raw(`DROP FUNCTION IF EXISTS "${functionName}"()`));
    }

    const done = await activateCompensationComponentAssignment(fixture.assignmentId, {
      actor: "Reliable activation retry", now: new Date("2026-10-11T08:02:00Z"),
    });
    assert.equal(done.skipped, false);
    const after = await state(fixture);
    assert.equal(after.assignment.status, "active");
    assert.equal(after.events.filter((e) => e.eventType === "component_activated").length, 1);
    assert.equal(after.audits.filter((e) => e.action === "Recurring compensation component activated").length, 1);
    const intents = await db.select().from(compensationAutomationIntents).where(
      eq(compensationAutomationIntents.compensationEventId, done.event.id),
    );
    assert.equal(intents.length, 2);
    assert.deepEqual(intents.map((v) => v.eventKey).sort(), [
      `compensation-component-active:${fixture.assignmentId}`,
      `compensation-component-active:${fixture.assignmentId}:field-change:recurringcompensationamount`,
    ]);
  });
});
