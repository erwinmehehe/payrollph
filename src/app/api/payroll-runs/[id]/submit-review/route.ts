import { eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalTasks, payrollRuns } from "@/db/schema";
import { assertOrganizationRole, PAYROLL_OPERATOR_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { buildPayrollAssurance } from "@/lib/payroll-assurance-server";

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

  const body = await request.json().catch(() => ({}));
  const approver = typeof body.approver === "string" ? body.approver.trim() : "";
  if (!approver) {
    return Response.json({ error: "Choose an approver before submitting payroll for review." }, { status: 400 });
  }
  if (approver.toLowerCase() === user.name.toLowerCase()) {
    return Response.json({ error: "Maker and checker must be different people." }, { status: 409 });
  }

  const assuranceResult = await buildPayrollAssurance(runId);
  const blockers = assuranceResult?.assurance.findings.filter((finding) => finding.blocking) ?? [];
  if (blockers.length > 0) {
    return Response.json({
      error: `Payroll assurance found ${blockers.length} blocking issue(s). Resolve them before submitting for approval.`,
      blockingFindings: blockers,
    }, { status: 409 });
  }

  const tasks = await db.select().from(approvalTasks).where(eq(approvalTasks.organizationId, run.organizationId));
  const existing = tasks.find((task) =>
    task.detail.includes(`Payroll run #${run.id}`) && task.status === "Pending",
  );
  if (existing) {
    return Response.json({ error: "This payroll run is already awaiting approval.", task: existing }, { status: 409 });
  }

  const reviewCount = assuranceResult?.assurance.summary.medium ?? run.exceptions;
  const [task] = await db.insert(approvalTasks).values({
    organizationId: run.organizationId,
    title: `Review ${run.periodLabel} payroll`,
    detail: `Payroll run #${run.id} · ${reviewCount} review item(s)`,
    approver,
    dueLabel: "Required before release",
    priority: reviewCount > 0 ? "High" : "Normal",
  }).returning();

  await db.update(payrollRuns)
    .set({ status: "Pending approval" })
    .where(eq(payrollRuns.id, run.id));

  await recordAuditEvent({
    organizationId: run.organizationId,
    actor: user.name,
    action: "Payroll submitted for review",
    resource: run.periodLabel,
    metadata: {
      runId: run.id,
      taskId: task.id,
      approver,
      assurance: assuranceResult?.assurance.summary ?? null,
      ruleVersion: run.ruleVersion,
    },
  });

  return Response.json({ task, maker: user.name, approver }, { status: 201 });
}
