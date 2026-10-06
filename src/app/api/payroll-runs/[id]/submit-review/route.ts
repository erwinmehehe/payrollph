import { enforceSameOriginMutation } from "@/lib/security-request";
import { and, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { approvalTasks, auditEvents, payrollEntries, payrollRuns, userOrganizations, users } from "@/db/schema";
import {
  assertOrganizationRole,
  assertOrganizationUnitAccess,
  PAYROLL_CHECKER_ROLES,
  PAYROLL_OPERATOR_ROLES,
  roleAllowed,
} from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { buildPayrollReleaseChecklist } from "@/lib/payroll-release-checklist";
import { isPublicDemoIdentity } from "@/lib/demo-security";
import { runAutomationEventSafely } from "@/lib/automation";

const SUBMITTABLE = ["Needs review", "Processed"];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId)) {
    return Response.json({ error: "Invalid run id." }, { status: 400 });
  }

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const sharedDemo = isPublicDemoIdentity(user.email);

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run) return Response.json({ error: "Payroll run not found." }, { status: 404 });

  const denied = await assertOrganizationRole(
    user.id,
    run.organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can submit payroll for review.",
  );
  if (denied) return denied;
  const scopeDenied = await assertOrganizationUnitAccess(
    user.id,
    run.organizationId,
    run.scopeOrgUnitId,
    "This payroll run is outside your assigned organization unit.",
  );
  if (scopeDenied) return scopeDenied;

  if (run.status === "Released") {
    return Response.json({ error: "Released payroll cannot be submitted again." }, { status: 409 });
  }
  if (!SUBMITTABLE.includes(run.status)) {
    return Response.json({
      error: `Payroll must be fully calculated before review submission (currently ${run.status}).`,
    }, { status: 409 });
  }

  const [{ value: entryCount }] = await db
    .select({ value: count() })
    .from(payrollEntries)
    .where(eq(payrollEntries.payrollRunId, run.id));
  if (entryCount === 0) {
    return Response.json({ error: "Payroll has no calculated entries yet." }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const approverUserId = Number(body.approverUserId);
  if (!Number.isInteger(approverUserId)) {
    return Response.json({ error: "Choose a valid checker before submitting payroll for review." }, { status: 400 });
  }
  if (approverUserId === user.id) {
    return Response.json({ error: "Maker and checker must be different people." }, { status: 409 });
  }

  const [checker] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: userOrganizations.role,
    })
    .from(userOrganizations)
    .innerJoin(users, eq(userOrganizations.userId, users.id))
    .where(and(
      eq(userOrganizations.organizationId, run.organizationId),
      eq(users.id, approverUserId),
    ))
    .limit(1);

  if (!checker || !roleAllowed(checker.role, PAYROLL_CHECKER_ROLES)) {
    return Response.json({ error: "That account is not an authorized payroll checker for this workspace." }, { status: 422 });
  }

  const reviewReadiness = await buildPayrollReleaseChecklist(runId, {
    allowRedactedDemoPayout: sharedDemo,
  });
  if (!reviewReadiness) {
    return Response.json({ error: "Payroll review readiness could not be loaded." }, { status: 409 });
  }

  const requiredWorkflowItems = reviewReadiness.items.filter(
    (item) => (item.key === "inputs" || item.key === "calculation") && !item.passed,
  );
  if (requiredWorkflowItems.length > 0) {
    return Response.json({
      error: "Payroll inputs and calculation must be complete before checker submission.",
      blockingWorkflowItems: requiredWorkflowItems,
    }, { status: 409 });
  }

  const assuranceResult = reviewReadiness.assurance;
  const blockers = assuranceResult?.findings.filter(
    (finding) => finding.blocking && !(sharedDemo && finding.code === "MISSING_BANK_DETAILS"),
  ) ?? [];
  if (blockers.length > 0) {
    return Response.json({
      error: `Payroll assurance found ${blockers.length} blocking issue(s). Resolve them before submitting for approval.`,
      blockingFindings: blockers,
    }, { status: 409 });
  }

  const tasks = await db
    .select()
    .from(approvalTasks)
    .where(eq(approvalTasks.organizationId, run.organizationId));
  const linkedTasks = tasks
    .filter((task) => task.detail.includes(`Payroll run #${run.id}`))
    .sort((a, b) => b.id - a.id);
  const latest = linkedTasks[0];

  if (latest?.status === "Pending") {
    return Response.json({ error: "This payroll run is already awaiting approval.", task: latest }, { status: 409 });
  }
  if (latest?.status === "Approved") {
    return Response.json({ error: "This payroll run is already approved and ready for release.", task: latest }, { status: 409 });
  }

  const reviewCount = assuranceResult?.summary.medium ?? run.exceptions;

  // Claim a submittable run and create its approval task in the same
  // transaction. Concurrent submit/recalculate requests can no longer both
  // succeed from the same payroll state.
  const submission = await db.transaction(async (tx) => {
    const [claimed] = await tx.update(payrollRuns)
      .set({ status: "Pending approval" })
      .where(and(
        eq(payrollRuns.id, run.id),
        inArray(payrollRuns.status, SUBMITTABLE),
      ))
      .returning();

    if (!claimed) return null;

    const [task] = await tx.insert(approvalTasks).values({
      organizationId: run.organizationId,
      title: `Review ${run.periodLabel} payroll`,
      detail: `Payroll run #${run.id} · ${reviewCount} review item(s)`,
      approver: checker.name,
      dueLabel: "Required before release",
      priority: reviewCount > 0 ? "High" : "Normal",
    }).returning();

    await tx.insert(auditEvents).values({
      organizationId: run.organizationId,
      actor: user.name,
      action: "Payroll submitted for review",
      resource: run.periodLabel,
      metadata: {
        runId: run.id,
        taskId: task.id,
        makerUserId: user.id,
        approverUserId: checker.id,
        approver: checker.name,
        assurance: assuranceResult?.summary ?? null,
        ruleVersion: run.ruleVersion,
      },
    });

    return { task };
  });

  if (!submission) {
    return Response.json({
      error: "Payroll state changed while review submission was starting. Refresh and retry.",
    }, { status: 409 });
  }

  const automation = await runAutomationEventSafely({
    organizationId: run.organizationId,
    trigger: "payroll.submitted",
    eventKey: `payroll-submitted:${run.id}:${submission.task.id}`,
    context: {
      payrollRunId: run.id,
      periodLabel: run.periodLabel,
      orgUnitId: run.scopeOrgUnitId,
      legalEntityId: run.legalEntityId,
      payrollAmount: Number(run.grossPay),
      netPay: Number(run.netPay),
      employeeCount: Number(entryCount),
      approvalTaskId: submission.task.id,
      approver: checker.name,
    },
  });

  return Response.json({
    task: submission.task,
    maker: { id: user.id, name: user.name },
    approver: { id: checker.id, name: checker.name, role: checker.role },
    automation,
  }, { status: 201 });
}
