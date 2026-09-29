import { and, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { approvalTasks, auditEvents, payrollEntries, payrollRuns, userOrganizations, users } from "@/db/schema";
import {
  assertOrganizationRole,
  PAYROLL_CHECKER_ROLES,
  PAYROLL_OPERATOR_ROLES,
  roleAllowed,
} from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { buildPayrollAssurance } from "@/lib/payroll-assurance-server";
import { queueMessageOnce } from "@/lib/mailer";

const SUBMITTABLE = ["Needs review", "Processed"];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId)) {
    return Response.json({ error: "Invalid run id." }, { status: 400 });
  }

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run) return Response.json({ error: "Payroll run not found." }, { status: 404 });

  const denied = await assertOrganizationRole(
    user.id,
    run.organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can submit payroll for review.",
  );
  if (denied) return denied;

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

  const assuranceResult = await buildPayrollAssurance(runId);
  const blockers = assuranceResult?.assurance.findings.filter((finding) => finding.blocking) ?? [];
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

  const reviewCount = assuranceResult?.assurance.summary.medium ?? run.exceptions;

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
        assurance: assuranceResult?.assurance.summary ?? null,
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

  let handoffNotification: {
    ok: boolean;
    duplicate?: boolean;
    warning?: string;
  } = { ok: false };

  try {
    const notice = await queueMessageOnce({
      organizationId: run.organizationId,
      recipient: checker.email,
      subject: `Payroll review needed: ${run.periodLabel}`,
      purpose: `payroll-review-${run.id}-${checker.id}`,
      body: [
        `Hi ${checker.name},`,
        "",
        `${user.name} submitted ${run.periodLabel} payroll for your independent review.`,
        `Review items: ${reviewCount}`,
        "",
        "Sign in to Linaw and open Approvals to approve or decline the run.",
        "Payroll cannot be released until an independent checker has decided.",
      ].join("\n"),
    });
    handoffNotification = {
      ok: notice.delivered || notice.queued,
      duplicate: notice.duplicate,
      warning: notice.reason ?? undefined,
    };
  } catch {
    handoffNotification = {
      ok: false,
      warning: "The review was submitted, but the checker notification could not be queued.",
    };
  }

  return Response.json({
    task: submission.task,
    maker: { id: user.id, name: user.name },
    approver: { id: checker.id, name: checker.name, role: checker.role },
    handoffNotification,
  }, { status: 201 });
}
