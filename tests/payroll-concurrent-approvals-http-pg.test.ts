import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../src/db";
import {
  approvalTasks, auditEvents, organizations, payrollRuns, userOrganizations, users,
} from "../src/db/schema";

const require = createRequire(import.meta.url);

// HTTP handler + real PostgreSQL CAS, not an in-memory approval simulator.
// Only auth, payroll certification and notification adapters are controlled:
// those gates have separate tests and are not being certified by this scenario.
function isolatedDatabase() {
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return process.env.CI === "true"
      && process.env.GITHUB_ACTIONS === "true"
      && url.hostname === "127.0.0.1" && url.port === "5432"
      && url.pathname === "/app_db" && url.username === "postgres"
      && !url.search && !url.hash;
  } catch { return false; }
}

test("two simultaneous HTTP checker decisions commit exactly one approval and one audit", {
  skip: !isolatedDatabase(), timeout: 60_000,
}, async () => {
  const suffix = randomUUID();
  const [org] = await db.insert(organizations).values({
    name: "Synthetic Concurrent Approval " + suffix,
    legalName: "Fictional Checker Employer",
  }).returning();
  const [maker, checker] = await db.insert(users).values([
    { email: "concurrency-maker-" + suffix + "@example.invalid",
      name: "Fictional Maker", role: "payroll", passwordHash: "not-a-login" },
    { email: "concurrency-checker-" + suffix + "@example.invalid",
      name: "Fictional Checker", role: "owner", passwordHash: "not-a-login" },
  ]).returning();
  const restores: Array<() => void> = [];
  function patch(path: string, fields: Record<string, unknown>) {
    const id = require.resolve(path);
    const prior = require(id);
    require.cache[id]!.exports = { ...prior, ...fields };
    restores.push(() => { require.cache[id]!.exports = prior; });
  }

  try {
    await db.insert(userOrganizations).values([
      { organizationId: org.id, userId: maker.id, role: "payroll", active: true },
      { organizationId: org.id, userId: checker.id, role: "owner", active: true },
    ]);
    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id, periodLabel: "Synthetic Oct approval",
      periodStart: "2026-10-01", periodEnd: "2026-10-15",
      payDate: "2026-10-16", status: "Pending approval",
      employeeCount: 1, grossPay: "20000.00", netPay: "18000.00",
    }).returning();
    const [task] = await db.insert(approvalTasks).values({
      organizationId: org.id, title: "Review payroll",
      detail: "Payroll run #" + run.id, approver: checker.name,
      dueLabel: "Current", priority: "High",
      payrollRunId: run.id, payrollFingerprint: "f".repeat(64),
      payrollGross: run.grossPay, payrollNet: run.netPay,
      payrollEmployeeCount: run.employeeCount,
    }).returning();
    await db.insert(auditEvents).values({
      organizationId: org.id, actor: maker.name,
      action: "Payroll submitted for review", resource: run.periodLabel,
      metadata: { runId: run.id, taskId: task.id, makerUserId: maker.id,
        approverUserId: checker.id },
    });

    patch("../src/lib/auth", { getSessionUser: async () => checker });
    patch("../src/lib/multi-entity-run-guard", { requireRunEmployer: async () => null });
    patch("../src/lib/critical-release-flags", { criticalReleaseFlagEnabled: () => false });
    patch("../src/lib/payroll-approval-integrity", {
      verifyPayrollApprovalSnapshot: async () => ({ valid: true }),
    });
    patch("../src/lib/payroll-assurance-server", {
      buildPayrollAssurance: async () => ({ assurance: { findings: [] } }),
    });
    patch("../src/lib/delegation", {
      canDecide: async () => ({
        permitted: true, roleMatched: true, effectiveApprover: checker.name, chain: [],
      }),
    });
    patch("../src/lib/payroll-connected-release-gate-server", {
      connectedPayrollReleaseGateEnabled: () => false,
    });
    patch("../src/lib/webhooks", { dispatchWebhook: async () => [] });
    patch("../src/lib/automation", {
      runAutomationEventSafely: async () => [],
      resumeAutomationExecutionFromApproval: async () => null,
    });

    const { PATCH } = await import("../src/app/api/approvals/[id]/route");
    const decide = (status: "Approved" | "Declined") => PATCH(
      new Request("http://127.0.0.1:3000/api/approvals/" + task.id, {
        method: "PATCH",
        headers: { origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin",
          "content-type": "application/json" },
        body: JSON.stringify({ status }),
      }),
      { params: Promise.resolve({ id: String(task.id) }) },
    );

    // A real audit INSERT veto must roll back both the task and payroll state.
    const veto = "qa_payroll_decision_veto_" + org.id;
    await pool.query(`CREATE FUNCTION ${veto}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.organization_id = ${org.id} AND NEW.action IN ('Approval approved', 'Approval declined') THEN
        RAISE EXCEPTION 'FICTIONAL_DECISION_AUDIT_VETO'; END IF; RETURN NEW; END $$`);
    try {
      await pool.query(`CREATE TRIGGER ${veto} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${veto}()`);
      await assert.rejects(decide("Approved"), (error: unknown) => {
        let current = error;
        while (current instanceof Error) {
          if (current.message.includes("FICTIONAL_DECISION_AUDIT_VETO")) return true;
          current = current.cause;
        }
        return false;
      });
      assert.equal((await db.select().from(approvalTasks).where(eq(approvalTasks.id, task.id)))[0].status, "Pending");
      assert.equal((await db.select().from(payrollRuns).where(eq(payrollRuns.id, run.id)))[0].status, "Pending approval");
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${veto} ON audit_events`);
      await pool.query(`DROP FUNCTION IF EXISTS ${veto}()`);
    }

    // Different decisions race for the same pre-transaction Pending snapshot.
    const responses = await Promise.all([decide("Approved"), decide("Declined")]);
    assert.deepEqual(responses.map((r) => r.status).sort((a, b) => a - b), [200, 409]);
    const [savedTask] = await db.select().from(approvalTasks).where(eq(approvalTasks.id, task.id));
    const [savedRun] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, run.id));
    assert.ok(savedTask.status === "Approved" || savedTask.status === "Declined");
    assert.equal(savedRun.status, savedTask.status === "Approved" ? "Ready for release" : "Needs review");
    const decisions = await db.select().from(auditEvents).where(and(
      eq(auditEvents.organizationId, org.id),
      inArray(auditEvents.action, ["Approval approved", "Approval declined"]),
    ));
    assert.equal(decisions.length, 1, "one durable decision event, not two competing approvals");
    assert.equal((await decide("Approved")).status, 409, "stale retries cannot re-decide");
    const retryDecisions = await db.select().from(auditEvents).where(and(
      eq(auditEvents.organizationId, org.id),
      inArray(auditEvents.action, ["Approval approved", "Approval declined"]),
    ));
    assert.equal(retryDecisions.length, 1);
  } finally {
    for (const restore of restores.reverse()) restore();
    await db.delete(organizations).where(eq(organizations.id, org.id));
    await db.delete(users).where(inArray(users.id, [maker.id, checker.id]));
  }
});
