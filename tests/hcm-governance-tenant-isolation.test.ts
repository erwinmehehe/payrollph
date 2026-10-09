import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  approvalTasks, employees, hcmBusinessProcessDefinitions,
  hcmBusinessProcessInstances, hcmBusinessProcessInstanceSteps,
  organizations, separationRecords,
} from "../src/db/schema";
import { loadHcmGovernanceReadiness } from "../src/lib/hcm-governance-readiness-server";

test("HCM aggregate read is strictly organization-scoped and does not reveal worker identities", async () => {
  const unique = randomUUID().slice(0, 12);
  const [alpha, beta] = await db.insert(organizations).values([
    { name: `Governance Alpha ${unique}`, legalName: `Governance Alpha ${unique}`, plan: "Core" },
    { name: `Governance Beta ${unique}`, legalName: `Governance Beta ${unique}`, plan: "Core" },
  ]).returning();
  try {
    await db.insert(employees).values({
      organizationId: alpha.id,
      employeeNo: "ONLY-ALPHA",
      firstName: "One",
      lastName: "Private",
      title: "Staff",
      status: "Active",
      avatarInitials: "OP",
      basicRate: "22000.00",
      region: "NCR",
      startDate: "2099-01-01",
    }).returning();

    const [betaEmployee] = await db.insert(employees).values({
      organizationId: beta.id,
      employeeNo: "ONLY-BETA",
      firstName: "Two",
      lastName: "Private",
      title: "Staff",
      status: "Active",
      avatarInitials: "TP",
      basicRate: "23000.00",
      region: "UNSUPPORTED-REGION",
      startDate: "2026-01-01",
    }).returning();
    await db.insert(hcmBusinessProcessDefinitions).values({
      organizationId: beta.id,
      code: "private-hire-review",
      name: "Beta only approval",
      processType: "hire",
      effectiveFrom: "2020-01-01",
      active: true,
      steps: [{ type: "approval", label: "Review", assignee: "role:owner" }],
    });
    await db.insert(separationRecords).values({
      organizationId: beta.id,
      employeeId: betaEmployee.id,
      separationType: "resignation",
      noticeDate: "2026-01-01",
      lastDay: "2026-02-01",
      status: "released",
    });
    // The tenant-specific workflow examples contain no real employee data:
    // one overdue pending approval with a lost task, one stalled workflow,
    // and one healthy current approval linked to an open approval task.
    const [missingTask, stalled, healthy] = await db.insert(hcmBusinessProcessInstances).values(
      ["missing-task", "stalled", "healthy"].map((key) => ({
        organizationId: beta.id,
        definitionCode: "system-hire-default",
        definitionVersion: 1,
        processType: "hire",
        sourceType: "readiness-fixture",
        sourceKey: `beta-${key}-${unique}`,
        currentStepIndex: 0,
        definitionSnapshot: { code: "system-hire-default", steps: [{ type: "approval", label: "Review", assignee: "role:hr" }] },
        initiatedByName: "QA",
        status: "in_progress",
      })),
    ).returning();
    const [healthyTask] = await db.insert(approvalTasks).values({
      organizationId: beta.id,
      title: "HCM current review",
      detail: "Synthetic workflow integrity evidence",
      approver: "role:hr",
      dueLabel: "Due 2099-01-01",
      status: "Pending",
    }).returning();
    await db.insert(hcmBusinessProcessInstanceSteps).values([
      {
        organizationId: beta.id, instanceId: missingTask.id, stepIndex: 0,
        stepType: "approval", label: "Missing task", assignee: "role:hr",
        status: "pending", dueAt: new Date("2020-01-01T00:00:00Z"),
      },
      {
        organizationId: beta.id, instanceId: healthy.id, stepIndex: 0,
        stepType: "approval", label: "Healthy pending", assignee: "role:hr",
        approvalTaskId: healthyTask.id, status: "pending",
        dueAt: new Date("2099-01-01T00:00:00Z"),
      },
    ]);
    assert.ok(stalled.id !== healthy.id);

    // Intentionally only READ the tenant's aggregates; no migration, action
    // or PII-containing row should be returned from the service.
    const a = await loadHcmGovernanceReadiness(alpha.id);
    const b = await loadHcmGovernanceReadiness(beta.id);
    assert.equal(a.summary.employeeCount, 1);
    assert.equal(b.summary.employeeCount, 1);
    assert.equal(a.findings.find(x => x.code === "UNKNOWN_WAGE_REGION"), undefined);
    assert.equal(b.findings.find(x => x.code === "UNKNOWN_WAGE_REGION")?.affected, 1);
    assert.equal(a.findings.find(x => x.code === "FINAL_PAY_REFERENCE_MISSING"), undefined);
    assert.equal(b.findings.find(x => x.code === "FINAL_PAY_REFERENCE_MISSING")?.affected, 1);
    assert.equal(b.findings.find(x => x.code === "FINAL_PAY_EMPLOYEE_STATUS_MISMATCH")?.affected, 1);
    assert.equal(a.findings.find(x => x.code === "FUTURE_EMPLOYMENT_START_DATE")?.affected, 1);
    assert.equal(a.processes.find(x => x.processType === "hire")?.configuredDefinitions, 0);
    assert.equal(b.processes.find(x => x.processType === "hire")?.configuredDefinitions, 1);
    assert.equal(a.summary.pendingHcmSteps, 0);
    assert.equal(a.summary.overdueHcmSteps, 0);
    assert.equal(b.summary.pendingHcmSteps, 2);
    assert.equal(b.summary.overdueHcmSteps, 1);
    assert.equal(b.summary.inProgressBusinessProcesses, 3);
    assert.equal(b.findings.find(x => x.code === "HCM_OVERDUE_WORK_ITEMS")?.affected, 1);
    assert.equal(b.findings.find(x => x.code === "HCM_APPROVAL_TASK_MISMATCH")?.affected, 1);
    assert.equal(b.findings.find(x => x.code === "HCM_PROCESS_NO_ACTIVE_STEP")?.affected, 1);
    assert.equal(a.findings.find(x => x.code === "HCM_APPROVAL_TASK_MISMATCH"), undefined);
    assert.equal(a.findings.find(x => x.code === "HCM_PROCESS_NO_ACTIVE_STEP"), undefined);
    for (const report of [a, b]) {
      const body = JSON.stringify(report);
      assert.ok(!body.includes("ONLY-ALPHA"));
      assert.ok(!body.includes("ONLY-BETA"));
      assert.ok(!body.includes("Private"));
      assert.ok(!body.includes("22000.00"));
      assert.ok(!body.includes("23000.00"));
    }
    await assert.rejects(() => loadHcmGovernanceReadiness(-1), /Valid organizationId/);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, alpha.id));
    await db.delete(organizations).where(eq(organizations.id, beta.id));
  }
});
