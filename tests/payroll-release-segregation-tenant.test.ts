import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { auditEvents, organizations } from "../src/db/schema";
import { checkPayrollReleaseSegregation } from "../src/lib/payroll-release-segregation";

test("release segregation reads tenant- and task-linked authenticated evidence", async () => {
  const code = randomUUID().slice(0, 12);
  const [alpha, beta] = await db.insert(organizations).values([
    { name: "SOD Alpha " + code, legalName: "SOD Alpha " + code, plan: "Core" },
    { name: "SOD Beta " + code, legalName: "SOD Beta " + code, plan: "Core" },
  ]).returning();
  try {
    const baseTask = 99123;
    const run = 81925;
    await db.insert(auditEvents).values([
      {
        organizationId: alpha.id, actor: "Synthetic submitter", action: "Payroll submitted for review",
        resource: "Synthetic payroll",
        metadata: { taskId: baseTask, runId: run, makerUserId: 14, approverUserId: 15 },
      },
      {
        organizationId: alpha.id, actor: "Synthetic checker", action: "Approval approved",
        resource: "Synthetic payroll",
        metadata: {
          taskId: baseTask, payrollRunId: run, makerUserId: 14,
          approverUserId: 15, deciderUserId: 15,
        },
      },
      {
        organizationId: beta.id, actor: "Other employer", action: "Approval approved",
        resource: "Synthetic other payroll",
        metadata: {
          taskId: baseTask, payrollRunId: run, makerUserId: 14,
          approverUserId: 15, deciderUserId: 21,
        },
      },
    ]);

    const allowed = await checkPayrollReleaseSegregation({
      organizationId: alpha.id, payrollRunId: run, approvalTaskId: baseTask,
      releaserUserId: 17, managedClientApproverUserId: null,
    });
    assert.equal(allowed.allowed, true);
    if (allowed.allowed) assert.equal(allowed.checkerUserId, 15);

    const checkerReleases = await checkPayrollReleaseSegregation({
      organizationId: alpha.id, payrollRunId: run, approvalTaskId: baseTask,
      releaserUserId: 15, managedClientApproverUserId: null,
    });
    assert.equal(checkerReleases.allowed, false);
    if (!checkerReleases.allowed) assert.equal(checkerReleases.status, 403);

    const otherEmployer = await checkPayrollReleaseSegregation({
      organizationId: beta.id, payrollRunId: run, approvalTaskId: baseTask,
      releaserUserId: 17, managedClientApproverUserId: null,
    });
    assert.equal(otherEmployer.allowed, false, "never supplement missing beta evidence with alpha's audit rows");
    if (!otherEmployer.allowed) assert.equal(otherEmployer.status, 409);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, alpha.id));
    await db.delete(organizations).where(eq(organizations.id, beta.id));
  }
});
